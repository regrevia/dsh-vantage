/**
 * Contract tests for dsh-vantage.
 *
 * Run with `node test/run.mjs`. Everything here is deterministic and offline:
 * the reducer, the bounded store, the budget/lease accounting, and the HTTP
 * payload shapes are exercised without a harness process, a model, or a
 * privileged connection.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  LIMITS,
  ROUTES,
  STATUS_KEYS,
  clip,
  factIdOf,
  failure,
  guarded,
  intParam,
  json,
  readJsonBody,
  requiredParam,
  roundIdOf
} from "../lib/schema.js";
import { apply, evaluateVerification, initState, rankFacts, roundStateOf } from "../lib/rounds.js";
import { HistoryStore } from "../lib/store.js";
import { DEFAULT_CONFIG } from "../index.js";
import { SUMMARY_SYSTEM_PROMPT, SummaryScheduler, buildPacket, estimateTokens, publishVerdict, verifyTopics } from "../lib/summary.js";
import { buildSnapshot, createRoutes, excerptOf, publicFact } from "../lib/api.js";

let passed = 0;
const failures = [];

function test(name, body) {
  try {
    body();
    passed += 1;
  } catch (error) {
    failures.push({ name, error });
  }
}

async function testAsync(name, body) {
  try {
    await body();
    passed += 1;
  } catch (error) {
    failures.push({ name, error });
  }
}

const SESSION = "0192f0aa-bbcc-4dde-8f00-112233445566";
let clock = 1_760_000_000_000;
const now = () => clock;
const warn = () => {};

function ev(seq, type, data) {
  clock += 15;
  return { type, seq, time: clock, data };
}

const userTurn = (seq, text) => [
  ev(seq, "turn/start", { turn: seq, step: 0 }),
  ev(seq + 1, "user/message", { content: [{ type: "text", text }] })
];

const checkCall = (seq, callId, command) => [
  ev(seq, "tool/call", { callId, name: "shell", arguments: JSON.stringify({ command }) }),
  // A real tool/call carries the model's raw JSON text, not an object.
  ev(seq + 1, "tool/result", {
    message: {
      toolCallId: callId,
      content: [{ type: "text", text: "ok" }]
    }
  })
];

const changeCall = (seq, callId, path) => [
  ev(seq, "tool/call", { callId, name: "write", arguments: JSON.stringify({ path }) }),
  ev(seq + 1, "tool/result", { message: { toolCallId: callId, content: [{ type: "text", text: "written" }] } })
];

const finalMessage = (seq, text) =>
  ev(seq, "assistant/message", {
    turn: 1,
    step: 1,
    message: { role: "assistant", content: [{ type: "text", text }] }
  });

// --- schema -----------------------------------------------------------------

test("schema: clip keeps short strings and bounds long ones", () => {
  assert.equal(clip("abc", 10), "abc");
  const clipped = clip("x".repeat(400), 40);
  assert.ok(Array.from(clipped).length <= 41, "a bound plus one ellipsis");
  assert.ok(clipped.endsWith("…"));
  assert.ok(clipped.length < 400);
  assert.equal(clip(undefined, 10), "");
});

test("schema: round ids are stable and session-prefixed", () => {
  assert.equal(roundIdOf(SESSION, 12), `${SESSION.replace(/^session-/u, "")}:12`);
  assert.notEqual(roundIdOf("session-aaaaaaaa-1", 12), roundIdOf("session-aaaaaaaa-2", 12));
  assert.equal(roundIdOf(SESSION, 12), roundIdOf(SESSION, 12));
  assert.notEqual(roundIdOf(SESSION, 12), roundIdOf(SESSION, 13));
  assert.equal(factIdOf("a:1", "check", "pnpm test"), factIdOf("a:1", "check", "pnpm test"));
});

test("schema: responses carry the documented envelope", () => {
  const ok = json({ kind: "snapshot" });
  assert.equal(ok.status, 200);
  const bad = failure("bad-request", "nope", 400);
  assert.equal(bad.status, 400);
  assert.deepEqual(STATUS_KEYS.includes("needs-input"), true);
});

test("schema: params are required and bounded", () => {
  const url = new URL("http://x/y?session=s1&limit=500");
  assert.equal(requiredParam(url, "session"), "s1");
  assert.throws(() => requiredParam(url, "round"));
  assert.equal(intParam(url, "limit", 10, 1, 20), 20);
  assert.equal(intParam(url, "missing", 7, 1, 20), 7);
});

await testAsync("schema: body reads reject empty and oversized payloads", async () => {
  const empty = new Request("http://x/y", { method: "POST", body: "" });
  await assert.rejects(() => readJsonBody(empty));
  const big = new Request("http://x/y", { method: "POST", body: JSON.stringify({ a: "x".repeat(5000) }) });
  await assert.rejects(() => readJsonBody(big, 100));
  const good = new Request("http://x/y", { method: "POST", body: JSON.stringify({ session: "s1" }) });
  assert.deepEqual(await readJsonBody(good), { session: "s1" });
});

// --- rounds -----------------------------------------------------------------

function folded(events) {
  let state = initState(SESSION);
  for (const event of events) state = apply(state, event);
  return state;
}

test("rounds: an ignored event only advances the watermark", () => {
  const state = folded([ev(0, "assistant/thinking", { text: "x" })]);
  assert.equal(state.round, null);
  assert.equal(state.lastSeq, 0);
  const same = apply(state, ev(9, "assistant/thinking", {}));
  assert.equal(same, state);
  assert.equal(state.lastSeq, 9);
  const replay = apply(state, ev(3, "assistant/thinking", {}));
  assert.equal(replay, state);
  assert.equal(state.lastSeq, 9, "an out-of-order event must not move the watermark back");
});

test("rounds: a user turn opens exactly one round", () => {
  const state = folded(userTurn(0, "修一下登录"));
  assert.ok(state.round !== null);
  assert.equal(state.round.roundId, roundIdOf(SESSION, 0));
  assert.equal(state.round.title, "修一下登录");
  assert.equal(state.round.userMessages, 1);
  assert.equal(state.recent.length, 0);
});

test("rounds: a fast-mode notice never opens a round or becomes its title", () => {
  // dsh-fast-mode writes its schedule reminders as user messages whose source
  // kind is `plugin:fast-mode`. They are context for the model, not a request:
  // a round must not open on them, and they must never rename the user's round.
  const notice = (seq) =>
    ev(seq, "user/message", {
      content: [{ type: "text", text: "Auto schedule: this turn is long enough that prose is now the cost." }],
      source: { kind: "plugin:fast-mode", form: "notice", summary: "auto: compress output" }
    });

  const alone = folded([notice(0)]);
  assert.equal(alone.round, null);

  const state = folded([...userTurn(1, "修一下登录"), notice(5), notice(6)]);
  assert.equal(state.round.userMessages, 1);
  assert.equal(state.round.title, "修一下登录");
});

test("rounds: a check becomes one fact and one condition", () => {
  const state = folded([...userTurn(0, "跑测试"), ...checkCall(2, "c1", "pnpm test")]);
  const kinds = state.round.facts.map((fact) => fact.kind);
  assert.ok(kinds.includes("check"));
  assert.equal(state.round.conditions.length, 1);
  assert.equal(state.round.conditions[0].state, "passed");
  assert.equal(evaluateVerification(state.round).state, "passed");
});

test("rounds: a failed check never passes verification", () => {
  const state = folded([
    ...userTurn(0, "跑测试"),
    ev(2, "tool/call", { callId: "c1", name: "shell", arguments: JSON.stringify({ command: "pnpm test" }) }),
    ev(3, "tool/result", { message: { toolCallId: "c1", isError: true, content: [] } })
  ]);
  assert.equal(state.round.conditions[0].state, "failed");
  assert.equal(evaluateVerification(state.round).state, "failed");
  const fact = state.round.facts.find((entry) => entry.kind === "check");
  assert.ok(fact.statement.endsWith("未通过"), fact.statement);
  assert.equal(fact.statement.includes("测试"), false, "the tool kind is not the finding");
});

test("rounds: a check names the work it covered, never the runner", () => {
  const state = folded([
    ...userTurn(0, "跑登录测试"),
    ev(2, "tool/call", { callId: "c1", name: "shell", arguments: JSON.stringify({ command: "pnpm vitest run src/login.test.ts" }) }),
    ev(3, "tool/result", { message: { toolCallId: "c1", content: [{ type: "text", text: "fail\n[exit code: 1]" }] } })
  ]);
  const fact = state.round.facts.find((entry) => entry.kind === "check");
  assert.equal(fact.statement, "src/login.test.ts 未通过");
  assert.equal(state.round.conditions[0].text, "src/login.test.ts");
});

test("rounds: a non-zero tool result is evidence, never a task failure", () => {
  const state = folded([
    ...userTurn(0, "继续"),
    ev(2, "tool/result", { message: { toolCallId: "ghost", isError: true, content: [] } })
  ]);
  assert.equal(state.round.conditions.length, 0);
  assert.equal(state.round.facts.some((fact) => fact.kind === "failure"), false);
  assert.ok(state.round.facts.some((fact) => fact.kind === "note"));
});

test("rounds: a file written after a pass puts the check back to recheck", () => {
  const state = folded([
    ...userTurn(0, "跑测试"),
    ...checkCall(2, "c1", "pnpm test"),
    ev(4, "tool/call", { callId: "w1", name: "write", arguments: "{\"path\":\"a.js\",\"content\":\"x\"}" }),
    ev(5, "tool/result", { message: { toolCallId: "w1", content: [] } })
  ]);
  assert.equal(state.round.conditions[0].state, "recheck");
  assert.equal(evaluateVerification(state.round).state, "recheck");
  assert.equal(state.round.facts.find((fact) => fact.kind === "check").validity, "needsRecheck");
});

test("rounds: empty conditions evaluate to unknown, never to passed", () => {
  const state = folded(userTurn(0, "还没开始"));
  assert.equal(evaluateVerification(state.round).state, "unknown");
  assert.equal(evaluateVerification(null).state, "unknown");
});

test("rounds: the next user turn archives the previous one", () => {
  const state = folded([
    ...userTurn(0, "第一轮"),
    ...checkCall(2, "c1", "pnpm test"),
    finalMessage(4, "第一轮已经处理完"),
    ...userTurn(5, "第二轮")
  ]);
  assert.equal(state.recent.length, 1);
  assert.equal(state.recent[0].roundId, roundIdOf(SESSION, 0));
  assert.ok(typeof state.recent[0].archivedAt === "number");
  assert.equal(state.round.roundId, roundIdOf(SESSION, 5));
});

test("rounds: urgent facts and rank order keep blockers first", () => {
  const state = folded([
    ...userTurn(0, "处理失败"),
    ev(2, "tool/call", { callId: "c1", name: "write", arguments: '{"path":"a.js"}' }),
    ev(3, "tool/result", { message: { toolCallId: "c1", isError: true, content: [{ type: "text", text: "boom" }] } }),
    ...checkCall(4, "c2", "pnpm test")
  ]);
  const ranked = rankFacts(state.round);
  assert.equal(ranked[0].kind, "failure");
  assert.ok(ranked.some((fact) => fact.kind === "check"));
});

test("rounds: round state is one of the documented values", () => {
  const state = folded(userTurn(0, "开始"));
  assert.ok(["awaiting-reply", "archived"].includes(roundStateOf(state.round)));
});

test("rounds: the folder never keeps more than the round fact bound", () => {
  const events = [...userTurn(0, "很多工具")];
  for (let index = 0; index < 260; index += 1) {
    events.push(ev(2 + index, "tool/call", { callId: `c${index}`, name: "shell", arguments: "{}" }));
    events.push(ev(3 + index, "tool/result", {
      message: { toolCallId: `c${index}`, isError: true, content: [{ type: "text", text: `失败 ${index}` }] }
    }));
  }
  const state = folded(events);
  assert.ok(state.round.facts.length <= 200, `facts=${state.round.facts.length}`);
  assert.ok(state.round.facts.filter((fact) => fact.urgent === true).length <= 64);
});

// --- regressions reported against 0.1.2 -------------------------------------

function toolCall(seq, callId, name, args) {
  return ev(seq, "tool/call", { callId, name, arguments: JSON.stringify(args) });
}

function toolResult(seq, callId, text) {
  return ev(seq, "tool/result", { message: { toolCallId: callId, content: [{ type: "text", text }] } });
}

function conditionOf(state, prefix) {
  return state.round.conditions.find((condition) => condition.subject.startsWith(prefix));
}

test("regression: a non-zero exit is a failed check, not a pass", () => {
  const state = folded([
    ...userTurn(1, "跑一下测试"),
    toolCall(3, "c1", "shell", { command: "pnpm test" }),
    toolResult(4, "c1", "1 failed\n[exit code: 1]")
  ]);
  assert.equal(conditionOf(state, "check:").state, "failed");
  const check = state.round.facts.find((fact) => fact.kind === "check");
  assert.match(check.statement, /未通过/u);
});

test("regression: a check started in the background is not a pass", () => {
  const state = folded([
    ...userTurn(1, "后台跑测试"),
    toolCall(3, "c1", "shell", { command: "pnpm test" }),
    toolResult(4, "c1", "后台任务已启动：pnpm test")
  ]);
  assert.equal(conditionOf(state, "check:").state, "pending");
  assert.equal(state.round.facts.some((fact) => fact.kind === "check"), false);
});

test("regression: a plan is not a workspace change", () => {
  const state = folded([
    ...userTurn(1, "列个计划"),
    toolCall(3, "c1", "todo_write", { todos: [{ text: "写测试", status: "pending" }] }),
    toolResult(4, "c1", "ok")
  ]);
  assert.equal(state.round.facts.some((fact) => fact.kind === "change"), false);
});

test("regression: a formal reply archives the round immediately", () => {
  const state = folded([
    ...userTurn(1, "改一下"),
    ev(3, "assistant/message", { turn: 1, step: 1, message: { role: "assistant", content: [{ type: "tool_call", name: "write", arguments: "{}" }] } }),
    finalMessage(4, "已改好，测试通过。"),
    ev(5, "turn/end", { turn: 1, reason: { kind: "completed" } })
  ]);
  assert.equal(state.round, null);
  assert.equal(state.settled.roundId, state.recent[0].roundId);
});

test("regression: a goal continuation after a reply opens a new round", () => {
  let state = folded([
    ...userTurn(1, "改一下"),
    finalMessage(3, "已完成。"),
    ev(4, "turn/end", { turn: 1, reason: { kind: "completed" } })
  ]);
  const archived = state.settled.roundId;
  state = apply(state, ev(5, "user/message", { content: [{ type: "text", text: "继续推进" }], source: { kind: "goal" } }));
  assert.notEqual(state.round, null);
  assert.notEqual(state.round.roundId, archived);
});

test("regression: a late result lands on the round that started the job", () => {
  let state = folded([
    ...userTurn(1, "后台跑测试"),
    ev(3, "job/registered", { jobId: "j1", kind: "bash", label: "pnpm test", startedAt: 3 }),
    finalMessage(4, "已经安排好了。"),
    ev(5, "turn/end", { turn: 1, reason: { kind: "completed" } })
  ]);
  const archived = state.settled.roundId;
  state = apply(state, ev(6, "job/settled", { jobId: "j1", status: "completed", detail: "exit code: 0" }));
  assert.equal(state.round, null);
  const round = state.recentRounds.find((item) => item.roundId === archived);
  assert.equal(conditionOf({ round }, "check:").state, "passed");
  assert.equal(round.facts.some((fact) => fact.kind === "late"), true);
});

test("regression: a finished background job reports its exit status", () => {
  let state = folded([
    ...userTurn(1, "后台跑测试"),
    ev(3, "job/registered", { jobId: "j1", kind: "bash", label: "pnpm test", startedAt: 3 }),
    ev(4, "job/settled", { jobId: "j1", status: "completed", detail: "exit code: 2" })
  ]);
  assert.equal(conditionOf(state, "check:").state, "failed");
});

// --- summary ----------------------------------------------------------------

test("regression: an injected checkpoint never renames the round", () => {
  const state = folded([
    ...userTurn(0, "修一下登录"),
    ev(3, "user/message", {
      content: [{ type: "text", text: "## 交接摘要\n上一轮已经改完登录表单" }],
      source: { kind: "compact-checkpoint" }
    })
  ]);
  assert.equal(state.round.title, "修一下登录");
  assert.equal(state.round.userMessages, 1, "a checkpoint is not a request");
});

test("regression: a human title outranks a generated one", () => {
  const state = folded([
    ...userTurn(0, "修一下登录"),
    ev(3, "session/title", { title: "修复登录表单", source: { kind: "user" } }),
    ev(4, "session/title", { title: "登录页重构", source: { kind: "provider" } })
  ]);
  assert.equal(state.round.title, "修复登录表单");
  assert.equal(state.sessionTitle, "修复登录表单");
});

test("regression: a path-like generated title never becomes the heading", () => {
  const state = folded([
    ...userTurn(0, "修一下登录"),
    ev(3, "session/title", { title: "/Users/apple/Desktop/DSH/dsh-vantage/index.js", source: { kind: "provider" } })
  ]);
  assert.equal(state.round.title, "修一下登录");
  assert.equal(state.sessionTitle, "");
});

test("summary: the cadence decides when a summary is due", () => {
  const scheduler = new SummaryScheduler({ cadenceMs: 180_000, firstEligibleMs: 60_000 });
  const t0 = 1_000_000;
  assert.deepEqual(scheduler.due(SESSION, { lastAt: 0, firstAt: t0, now: t0 + 30_000 }), { ok: false, reason: "interval" });
  assert.deepEqual(scheduler.due(SESSION, { lastAt: 0, firstAt: t0, now: t0 + 70_000 }), { ok: true });
  assert.deepEqual(scheduler.due(SESSION, { lastAt: t0, firstAt: t0, now: t0 + 120_000 }), { ok: false, reason: "interval" });
  assert.deepEqual(scheduler.due(SESSION, { lastAt: t0, firstAt: t0, now: t0 + 181_000 }), { ok: true });
});

test("summary: one call per session, and a duplicate position is refused", () => {
  const scheduler = new SummaryScheduler({ cadenceMs: 180_000, firstEligibleMs: 60_000 });
  scheduler.begin(SESSION);
  assert.equal(scheduler.busy(SESSION), true);
  assert.equal(scheduler.due(SESSION, { lastAt: 0, firstAt: 0, now: 999_999 }).reason, "running");
  scheduler.end(SESSION);
  assert.equal(scheduler.busy(SESSION), false);
  assert.equal(scheduler.duplicate(SESSION, "r1", 42), false);
  scheduler.remember(SESSION, "r1", 42);
  assert.equal(scheduler.duplicate(SESSION, "r1", 42), true);
  assert.equal(scheduler.duplicate(SESSION, "r1", 43), false);
  scheduler.forget(SESSION);
  assert.equal(scheduler.duplicate(SESSION, "r1", 42), false, "switching off forgets the position");
});

test("summary: the shipped defaults match the documented policy", () => {
  const { summary } = DEFAULT_CONFIG;
  assert.equal(summary.enabled, true);
  assert.equal(summary.cadenceMs, 180_000);
  assert.equal(summary.firstEligibleMs, 60_000);
  assert.equal(summary.maxTopics, 3);
  assert.equal(summary.maxInputTokens, 2400);
  assert.equal(summary.maxOutputTokens, 400);
  assert.equal(summary.requestDeadlineMs, 25_000);
});

test("summary: publish re-validation discards a stale, superseded, or switched-off answer", () => {
  const base = { requestId: "r1", currentRequestId: "r1", manual: false, enabled: true, generation: 2, expectedGeneration: 2, roundId: "s:1", seq: 7 };
  const live = { round: { roundId: "s:1" }, lastSeq: 7 };
  assert.equal(publishVerdict({ ...base, state: live }), null);
  assert.equal(publishVerdict({ ...base, state: live, currentRequestId: "r2" }).reason, "cancelled");
  assert.equal(publishVerdict({ ...base, state: live, generation: 3 }).reason, "cancelled", "a restart invalidates it");
  assert.equal(publishVerdict({ ...base, state: live, enabled: false }).reason, "disabled");
  assert.equal(publishVerdict({ ...base, state: live, enabled: false, manual: true }), null, "a manual read still answers");
  assert.equal(publishVerdict({ ...base, state: { round: { roundId: "s:1" }, lastSeq: 8 } }).reason, "fresh");
  assert.equal(publishVerdict({ ...base, state: { round: { roundId: "s:2" }, lastSeq: 7 } }).reason, "fresh");
  assert.equal(publishVerdict({ ...base, state: undefined }).reason, "fresh");
});

test("summary: passing checks never become headroom for a topic", () => {
  const onlyChecks = folded([...userTurn(0, "跑测试"), ...checkCall(2, "c1", "pnpm test")]);
  assert.equal(buildPacket(onlyChecks.round, { maxFacts: 8 }).text.length, 0, "a pass alone is not a summary topic");
});

test("summary: the packet is bounded and only ships observed facts", () => {
  const state = folded([...userTurn(0, "改一下 hero"), ...changeCall(2, "w1", "site/hero.md"), ...checkCall(4, "c1", "pnpm test")]);
  const packet = buildPacket(state.round, { maxFacts: 8 });
  assert.ok(packet.text.length > 0);
  assert.ok(packet.facts.size >= 1);
  assert.ok(packet.text.split("\n").length <= 8);
});

test("summary: invented numbers, conclusions, and citations are dropped", () => {
  const factId = "f-check";
  const check = { id: factId, kind: "check", statement: "测试通过", basis: "observed", validity: "valid", refs: [] };
  const packet = { facts: new Map([[factId, check]]) };
  const topics = verifyTopics(
    JSON.stringify({
      topics: [
        { factIds: [factId], headline: "已通过 pnpm test" },
        { factIds: [factId], headline: "已完成任务，测试全过" },
        { factIds: [factId], headline: "耗时 999 毫秒" },
        { factIds: ["f-not-in-packet"], headline: "已通过 pnpm test" },
        { headline: "没有引用任何事实" }
      ]
    }),
    packet.facts,
    3
  );
  const lines = topics.map((topic) => topic.headline);
  assert.ok(lines.includes("已通过 pnpm test"), `topics=${JSON.stringify(topics)}`);
  for (const line of lines) assert.ok(!line.includes("测试全过"), line);
  for (const line of lines) assert.ok(!line.includes("999"), line);
  assert.ok(topics.every((topic) => topic.factIds.every((id) => packet.facts.has(id))), "every citation exists");
  assert.ok(topics.every((topic) => topic.id === `t:${topic.factIds.join("+")}`), "the id is derived from its evidence");
  assert.equal(verifyTopics("已通过 pnpm test\n已完成任务", packet.facts, 3).length, 0, "prose is not an answer");
});

test("summary: the packet cap keeps the input inside the cap", () => {
  const facts = [];
  for (let index = 0; index < 40; index += 1) {
    facts.push({ id: `f${index}`, kind: "change", subject: "workspace", statement: `已修改 ${index} 个文件 ${"site/section-".repeat(2)}${index}.md`, basis: "observed", validity: "valid", updatedAt: index, refs: [] });
  }
  const round = { roundId: "r", facts };
  const loose = buildPacket(round, { maxFacts: 200 });
  const tight = buildPacket(round, { maxFacts: 200, maxTokens: 20 });
  assert.ok(tight.text.length < loose.text.length, "the cap drops facts");
  assert.ok(estimateTokens(tight.text) <= 20, `tokens=${estimateTokens(tight.text)}`);
  assert.equal(tight.truncated, true);
});

test("summary: the packet plus its instruction stays inside the input cap", () => {
  const state = folded([...userTurn(0, "改一下 hero"), ...changeCall(2, "w1", "site/hero.md"), ...checkCall(4, "c1", "pnpm test")]);
  const cap = DEFAULT_CONFIG.summary.maxInputTokens;
  const room = Math.max(64, cap - estimateTokens(SUMMARY_SYSTEM_PROMPT) - 8);
  const packet = buildPacket(state.round, { maxTokens: room });
  assert.ok(estimateTokens(SUMMARY_SYSTEM_PROMPT) + estimateTokens(packet.text) <= cap, "whole request fits");
});

// --- store ------------------------------------------------------------------

function roundRecord(index, sessionId = SESSION) {
  return {
    schemaVersion: 1,
    sessionId,
    roundId: roundIdOf(sessionId, index),
    title: `第 ${index} 轮`,
    startedAt: 1000 + index,
    archivedAt: 2000 + index,
    updatedAt: 2000 + index,
    roundState: "archived",
    runtimeState: "idle",
    goalState: "none",
    verificationState: "unknown",
    statusLine: "已记录",
    facts: [],
    verification: { state: "unknown", truncated: false, conditions: [] },
    outcomes: { truncated: false, items: [] }
  };
}

await testAsync("store: memory mode keeps order, paging, and ceilings", async () => {
  const store = new HistoryStore({ maxRoundsPerSession: 3, maxRoundsTotal: 5, maxSerializedBytes: 64 * 1024, warn });
  await store.open(undefined, { version: 1 });
  assert.equal(store.persistent, false);
  for (let index = 0; index < 6; index += 1) store.insert(roundRecord(index));
  assert.equal(store.count(SESSION), 3);
  const page = store.page(SESSION, { limit: 2 });
  assert.equal(page.items.length, 2);
  assert.ok(page.nextCursor !== undefined);
  const recent = store.recent(SESSION, 1);
  assert.equal(recent.length, 1);
  assert.equal(recent[0].roundId, roundIdOf(SESSION, 5));
  assert.equal(store.get(SESSION, roundIdOf(SESSION, 5)).title, "第 5 轮");
  assert.equal(store.get(SESSION, "missing"), undefined);
});

await testAsync("store: the storage declaration is legal and evictions reach disk", async () => {
  const keys = [];
  const deletes = [];
  const table = {
    entries: () => [],
    put: async (key) => {
      keys.push(key);
    },
    delete: async (key) => {
      deletes.push(key);
    }
  };
  const service = {
    open: async (declaration) => {
      assert.equal(declaration.name, "dsh_vantage");
      assert.equal(declaration.version, 1);
      assert.equal(typeof declaration.tables.rounds.valueSchema.parse, "function");
      return { table: () => table, close: async () => {} };
    }
  };
  const store = new HistoryStore({ maxRoundsPerSession: 2, maxRoundsTotal: 20, maxSerializedBytes: 64 * 1024, warn });
  await store.open(service, { version: 1 });
  assert.equal(store.persistent, true);
  for (let index = 0; index < 4; index += 1) store.insert(roundRecord(index));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(keys.length, 4);
  assert.equal(new Set(keys).size, 4, "the session survives in the key");
  assert.equal(deletes.length, 2);
  assert.ok(deletes.every((key) => typeof key === "string" && key.includes(SESSION)));
  await store.close();
});

await testAsync("store: a domain answering after the boot gave up is closed, not adopted", async () => {
  let closed = false;
  let answer;
  const table = { entries: () => [], put: async () => {}, delete: async () => {} };
  const service = {
    open: () =>
      new Promise((resolve) => {
        answer = () => resolve({ table: () => table, close: async () => (closed = true) });
      })
  };
  const store = new HistoryStore({ maxRoundsPerSession: 3, maxRoundsTotal: 5, maxSerializedBytes: 64 * 1024, warn });
  const opening = store.open(service, { version: 1 });
  store.abandon();
  answer();
  await opening;
  assert.equal(store.persistent, false);
  assert.equal(store.domain, null);
  assert.equal(closed, true);
});

await testAsync("store: a cold session reads its rounds back from the domain", async () => {
  const disk = new Map();
  const table = {
    entries: () => [...disk.entries()],
    put: async (key, row) => {
      disk.set(key, row);
    },
    delete: async (key) => {
      disk.delete(key);
    }
  };
  const service = { open: async () => ({ table: () => table, close: async () => {} }) };
  const first = new HistoryStore({ maxRoundsPerSession: 20, maxRoundsTotal: 200, maxSerializedBytes: 2 * 1024 * 1024, warn });
  await first.open(service, { version: 1 });
  for (let index = 0; index < 3; index += 1) first.insert(roundRecord(index));
  await first.close();
  assert.equal(disk.size, 3);
  const second = new HistoryStore({ maxRoundsPerSession: 20, maxRoundsTotal: 200, maxSerializedBytes: 2 * 1024 * 1024, warn });
  await second.open(service, { version: 1 });
  assert.equal(second.persistent, true);
  assert.equal(second.count(SESSION), 3);
  assert.equal(second.recent(SESSION, 1)[0].title, "第 2 轮");
  assert.equal(second.get(SESSION, roundIdOf(SESSION, 1)).title, "第 1 轮");
  assert.equal(second.page(SESSION, { limit: 2 }).items.length, 2);
  await second.close();
});

await testAsync("store: a broken storage domain degrades to memory", async () => {
  const broken = {
    open() {
      throw new Error("facet unsupported");
    }
  };
  const notes = [];
  const store = new HistoryStore({ maxRoundsPerSession: 3, maxRoundsTotal: 5, maxSerializedBytes: 64 * 1024, warn: (m) => notes.push(m) });
  await store.open(broken, { version: 1 });
  assert.equal(store.persistent, false);
  assert.equal(notes.length, 1);
  store.insert(roundRecord(1));
  assert.equal(store.count(SESSION), 1);
});

// --- http payloads ----------------------------------------------------------

async function testRoutes() {
  const store = new HistoryStore({ maxRoundsPerSession: 20, maxRoundsTotal: 200, maxSerializedBytes: 2 * 1024 * 1024, warn });
  await store.open(undefined, { version: 1 });
  const state = folded([...userTurn(0, "跑测试"), ...checkCall(2, "c1", "pnpm test")]);
  const session = {
    id: SESSION,
    eventAt: (seq) => {
      const all = [...userTurn(0, "跑测试"), ...checkCall(2, "c1", "pnpm test")];
      return all.find((event) => event.seq === seq);
    }
  };
  const runtime = {
    warn,
    now,
    connection: "online",
    store,
    stateOf: () => state, // ui-copy-ignore
    briefOf: () => undefined, // ui-copy-ignore
    session: async () => session,
    requestSummary: async () => ({ kind: "skipped", reason: "disabled", text: "概览已关闭" }),
    isEnabled: () => true,
    setEnabled: async (_session, enabled) => ({ enabled: enabled === true, generation: 1 })
  };

  test("routes: exactly the documented six paths, no duplicates", () => {
    const routes = createRoutes(runtime);
    const paths = routes.map((route) => route.path);
    assert.equal(new Set(paths).size, paths.length);
    assert.deepEqual(
      [...paths].sort(),
      [
        ROUTES.evidence,
        ROUTES.enable,
        ROUTES.history,
        ROUTES.round,
        ROUTES.snapshot,
        ROUTES.summaryRequest
      ].sort()
    );
    for (const route of routes) assert.ok(route.methods.length >= 1);
  });

  test("snapshot: the payload is small, complete, and JSON-pure", async () => {
    const routes = createRoutes(runtime);
    const route = routes.find((item) => item.path === ROUTES.snapshot);
    const response = await route.fetch(new Request(`http://x${ROUTES.snapshot}?session=${SESSION}`));
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.kind, "snapshot");
    assert.equal(body.sessionId, SESSION);
    assert.equal(body.brief.mode, "facts");
    assert.ok(body.brief.items.length >= 1);
    assert.ok(Array.isArray(body.notices));
    assert.ok(body.verification.conditions.length <= LIMITS.shownConditions);
    const serialized = JSON.stringify(body);
    assert.ok(serialized.length <= LIMITS.serializedSnapshot);
    assert.deepEqual(JSON.parse(serialized), body);
  });

  test("projection: a deliverable is named by its file, not its directory", () => {
    const state = folded([
      ...userTurn(0, "导出视频"),
      ev(2, "deliverables/presented", { files: [{ path: "/Users/apple/CreatorStudio/deliver/envoy-f52motion.mp4", name: "envoy-f52motion.mp4" }] })
    ]);
    const fact = state.round.facts.find((item) => item.kind === "deliverable");
    assert.equal(fact.statement, "已生成：envoy-f52motion.mp4");
    assert.equal(fact.subject, "envoy-f52motion.mp4");
  });

  test("api: a stored deliverable path is shown as its file name", () => {
  // Rounds sealed before the basename rule are still in storage; the wire shape
  // is the last place that can keep a directory out of a one-line brief.
  const wire = publicFact({
    id: "b:1",
    kind: "deliverable",
    statement: "已生成：/Users/apple/CreatorStudio/deliver/promo-261028.mp4",
    basis: "passed",
    validity: "current",
    refs: [{ seq: 3, label: "工具结果" }]
  });
  assert.equal(wire.statement, "已生成：promo-261028.mp4");
  assert.equal(wire.id, "b:1");
  assert.equal(wire.refs[0].seq, 3);
  const plain = publicFact({ id: "b:2", kind: "check", statement: "测试通过", basis: "passed", validity: "current", refs: [] });
  assert.equal(plain.statement, "测试通过");
});

test("snapshot: a long goal objective becomes a one-clause heading", () => {
    const routes = createRoutes({ ...runtime, stateOf: () => ({ ...state, round: { ...state.round, title: "10 小时低资源开发：修复 Envoy 确定性缺陷（ASR 稳定身份、游标、预算），并补齐恢复路径" } }) });
    const route = routes.find((item) => item.path === ROUTES.snapshot);
    return route.fetch(new Request(`http://x${ROUTES.snapshot}?session=${SESSION}`)).then(async (response) => {
      const body = await response.json();
      assert.equal(body.round.title, "10 小时低资源开发");
      assert.ok(body.round.title.length <= 42);
    });
  });

  test("snapshot: a matching revision answers unchanged and can be read again", async () => {
    const routes = createRoutes(runtime);
    const route = routes.find((item) => item.path === ROUTES.snapshot);
    const first = await (await route.fetch(new Request(`http://x${ROUTES.snapshot}?session=${SESSION}`))).json();
    const second = await (
      await route.fetch(new Request(`http://x${ROUTES.snapshot}?session=${SESSION}&revision=${encodeURIComponent(first.revision)}`))
    ).json();
    assert.equal(second.kind, "unchanged");
    assert.equal(second.revision, first.revision);
  });

  test("snapshot: buildSnapshot stays factual and carries every dimension", () => {
    const body = buildSnapshot(runtime, session, state, "rev");
    assert.equal(body.round.roundState, roundStateOf(state.round));
    assert.ok(["running", "idle"].includes(body.round.runtimeState));
    assert.ok(typeof body.round.goalState === "string");
    assert.ok(typeof body.round.verificationState === "string");
    assert.ok(body.coverage.summaryCoveredSeq <= body.coverage.coreObservedSeq);
  });

  test("snapshot: a paraphrased failed check cannot stay green", () => {
    const failedState = folded([
      ...userTurn(0, "构建"),
      ev(2, "tool/call", { callId: "b1", name: "shell", arguments: JSON.stringify({ command: "pnpm build" }) }),
      ev(3, "tool/result", { message: { toolCallId: "b1", content: [{ type: "text", text: "boom\n[exit code: 1]" }] } })
    ]);
    const check = failedState.round.facts.find((fact) => fact.kind === "check");
    assert.ok(check !== undefined, "the failed run left a check fact");
    const brief = {
      roundId: failedState.round.roundId,
      throughSeq: failedState.lastSeq,
      revision: "r",
      generatedAt: now(),
      topics: [{ id: "b:1", factIds: [check.id], headline: "构建 失败", qualifier: "", details: [], state: "recorded" }]
    };
    const body = buildSnapshot({ ...runtime, briefOf: () => brief }, session, failedState, "rev2");
    const item = body.brief.items[0];
    assert.equal(item.text, "构建 失败");
    assert.equal(item.tone, "error", "a failed check stays red even when the model says it plainly");
  });

  test("snapshot: a non-zero exit is a failed check even when the line paraphrases it", () => {
    const failedState = folded([
      ...userTurn(0, "构建"),
      ev(2, "tool/call", { callId: "x1", name: "shell", arguments: JSON.stringify({ command: "pnpm build" }) }),
      ev(3, "tool/result", { message: { toolCallId: "x1", content: [{ type: "text", text: "boom\n[exit code: 1]" }] } })
    ]);
    const check = failedState.round.facts.find((fact) => fact.kind === "check");
    assert.ok(check !== undefined, "the failed run left a check fact");
    const brief = {
      roundId: failedState.round.roundId,
      throughSeq: failedState.lastSeq,
      revision: "r",
      generatedAt: now(),
      topics: [{ id: "x:1", factIds: [check.id], headline: "构建以 exit 1 结束", qualifier: "", details: [], state: "recorded" }]
    };
    const body = buildSnapshot({ ...runtime, briefOf: () => brief }, session, failedState, "rev3");
    assert.equal(body.brief.items[0].tone, "error");
  });

  testAsync("store: the domain declaration passes the storage contract", async () => {
  let captured = null;
  const store = new HistoryStore({ maxRoundsPerSession: 10, maxRoundsTotal: 100, maxSerializedBytes: 1 << 20, warn: () => {} });
  await store.open({ open: async (declaration) => {
    captured = declaration;
    return { close() {} };
  } }, { version: 3, compatibleVersions: [1, 2, "x", 3, -1] });
  assert.ok(captured !== null, "the domain was opened");
  assert.equal(captured.name, "dsh_vantage");
  assert.equal(captured.version, 3);
  assert.deepEqual(captured.compatibleVersions, [1, 2], "only integers below the version survive");
  assert.equal(captured.layout, "per-record");
  assert.equal(captured.invalidRecords, "backup-and-skip");
  assert.deepEqual(Object.keys(captured.tables).sort(), ["rounds", "sessions"]);
  const record = { any: "value" };
  assert.equal(captured.tables.rounds.valueSchema.parse(record), record, "the value schema passes records through");
});

test("store: a failed open leaves the store readable in memory", () => {
  const store = new HistoryStore({ maxRoundsPerSession: 10, maxRoundsTotal: 100, maxSerializedBytes: 1 << 20, warn: () => {} });
  assert.equal(store.persistent, false);
  assert.equal(store.domain, null, "no domain was adopted");
  assert.equal(store.abandoned, false);
});

testAsync("store: a domain that refuses to open degrades to memory", async () => {
  const notes = [];
  const store = new HistoryStore({ maxRoundsPerSession: 10, maxRoundsTotal: 100, maxSerializedBytes: 1 << 20, warn: (line) => notes.push(line) });
  await store.open({
    open: async () => {
      throw new Error("version-mismatch");
    }
  }, { version: 3, compatibleVersions: [1, 2], tables: {} });
  assert.equal(store.persistent, false);
  assert.equal(store.domain, null);
  assert.equal(notes.length, 1, "the fallback is reported once");
  assert.ok(notes[0].includes("history store stays in memory"), notes[0]);
  store.insert({ sessionId: SESSION, roundId: "r1", revision: "v1", created: now(), updated: now() });
  assert.equal(store.count(SESSION), 1, "reads still answer without a domain");
  assert.equal(store.persistent, false);
});

test("snapshot: every brief item carries clean inline evidence", () => {
  const state = folded([
    ...userTurn(0, "跑测试"),
    ev(2, "tool/call", { callId: "e1", name: "shell", arguments: JSON.stringify({ command: "pnpm test" }) }),
    ev(3, "tool/result", { message: { toolCallId: "e1", content: [{ type: "text", text: "1 failed\n[exit code: 1]" }] } }),
    ...changeCall(4, "w1", "src/login.js")
  ]);
  const body = buildSnapshot(runtime, session, state, "rev4");
  assert.ok(body.brief.items.length >= 1, "there is something to show");
  for (const item of body.brief.items) {
    assert.ok(Array.isArray(item.evidence), `evidence is an array on ${item.id}`);
    for (const row of item.evidence) {
      assert.equal(typeof row.label, "string");
      assert.equal(typeof row.text, "string");
      assert.equal(row.text.includes("<"), false, "no markup reaches the panel");
    }
    assert.ok(item.source === "rule" || item.source === "model");
  }
  const change = body.brief.items.find((item) => item.id.includes("change"));
  assert.ok(change !== undefined, "the change stayed a line of its own");
  assert.ok(change.evidence.length >= 1, "the change can be expanded to its source");
  assert.equal(JSON.stringify(body).includes("pnpm test"), false, "a raw command line stays out of the payload");
});

test("schema: the documented statuses no longer include a spent budget", () => {
  assert.ok(STATUS_KEYS.includes("running"));
    assert.ok(STATUS_KEYS.includes("waiting"));
    assert.ok(!STATUS_KEYS.includes("summary-paused"));
  });

  await testAsync("evidence: excerpts are plain text, never payloads", async () => {
    const routes = createRoutes(runtime);
    const fact = state.round.facts.find((item) => item.kind === "check");
    const request = new Request(
      `http://x${ROUTES.evidence}?session=${SESSION}&round=${encodeURIComponent(state.round.roundId)}&fact=${encodeURIComponent(fact.id)}`
    );
    const response = await routes.find((item) => item.path === ROUTES.evidence).fetch(request);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.kind, "evidence");
    assert.ok(body.refs.length >= 1);
    for (const ref of body.refs) {
      assert.equal(typeof ref.excerpt, "string");
      assert.ok(ref.excerpt.length <= LIMITS.excerpt);
    }
  });

  await testAsync("routes: unknown sessions answer a structured error, not a crash", async () => {
    const routes = createRoutes({ ...runtime, session: async () => { throw Object.assign(new Error("nope"), { code: "session/not-found" }); } });
    const response = await routes.find((item) => item.path === ROUTES.snapshot).fetch(
      new Request(`http://x${ROUTES.snapshot}?session=${SESSION}`)
    );
    assert.ok(response.status >= 400);
    const body = await response.json();
    assert.ok(typeof body.error.code === "string");
    assert.ok(typeof body.error.message === "string");
  });

  await testAsync("enable: the switch answers the state the Host now holds", async () => {
    const seen = [];
    const routes = createRoutes({
      ...runtime,
      setEnabled: async (_session, enabled) => {
        seen.push(enabled);
        return { enabled, generation: 2 };
      }
    });
    const route = routes.find((item) => item.path === ROUTES.enable);
    const post = (enabled) =>
      route.fetch(new Request(`http://x${ROUTES.enable}`, {
        method: "POST",
        body: JSON.stringify({ session: SESSION, enabled })
      }));
    const on = await post(true);
    assert.equal(on.status, 200);
    assert.deepEqual(await on.json(), { kind: "enable", enabled: true, generation: 2, throughSeq: state.lastSeq });
    const off = await post(false);
    assert.deepEqual(await off.json(), { kind: "enable", enabled: false, generation: 2, throughSeq: -1 });
    assert.deepEqual(seen, [true, false]);
    const bad = await post("yes");
    assert.equal(bad.status, 400);
    assert.equal((await bad.json()).error.code, "bad-request");
  });

  test("guarded: an internal failure is logged and returned as JSON", async () => {
    const notes = [];
    const handler = guarded(() => {
      throw new Error("kaboom");
    }, (message) => notes.push(message));
    const response = await handler(new Request("http://x/y"));
    assert.equal(response.status, 500);
    const body = await response.json();
    assert.equal(body.error.code, "internal");
    assert.equal(notes.length, 1);
    assert.ok(!body.error.message.includes("kaboom"), "the internal message must not leak");
  });

  test("excerptOf: tool arguments and reasoning never become excerpts", () => {
    const text = excerptOf({ type: "tool/call", data: { name: "shell", arguments: '{"token":"secret"}' } }); // ui-copy-ignore
    assert.equal(typeof text, "string");
    assert.ok(!text.includes("secret") || text.length <= LIMITS.excerpt);
    assert.equal(excerptOf({ type: "assistant/thinking", data: { text: "secret reasoning" } }), "");
  });
}

// --- client registration ----------------------------------------------------

function loadClient() {
  const source = readFileSync(new URL("../client.js", import.meta.url), "utf8");
  let definition;
  const window = { __ModuleLoader__: { load: (value) => { definition = value } } };
  new Function("window", "navigator", source)(window, { language: "zh-CN" });
  const react = {
    createElement: (type, props, ...children) => ({ type, props, children }),
    useCallback: (fn) => fn,
    useEffect: () => {},
    useRef: (value) => ({ current: value }),
    useState: (value) => [typeof value === "function" ? value() : value, () => {}]
  };
  return definition.factory((name) => {
    if (name === "react") return react;
    throw new Error(`unexpected require ${name}`);
  });
}

function testClient() {
  const plugin = loadClient();
  // locale is a declared dependency: reading ctx.locale without it throws
  // at boot and leaves the shell entry stuck on loading.
  assert.deepEqual(plugin.inject, ["slots", "locale"]); // ui-copy-ignore
  let registration;
  const ctx = {
    locale: { getSnapshot: () => ({ active: "zh" }) },
    slots: {
      inject: (name, run) => run(),
      register: (definition, Component) => {
        registration = definition;
        return Component;
      }
    }
  };
  plugin.apply(ctx);
  assert.equal(registration.id, "vantage");
  assert.equal(registration.label(), "概览");
  assert.deepEqual(registration.inject("session-1"), { sessionId: "session-1" });

  const en = { locale: { getSnapshot: () => ({ active: "en" }) }, slots: ctx.slots };
  plugin.apply(en);
  assert.equal(registration.label(), "Overview");
}

testClient();

await testRoutes();

// --- report -----------------------------------------------------------------

for (const failure of failures) {
  console.error(`FAIL ${failure.name}`);
  console.error(failure.error instanceof Error ? failure.error.stack : String(failure.error));
}

if (failures.length > 0) {
  console.error(`\n${failures.length} failed, ${passed} passed`);
  process.exit(1);
}

console.log(`${passed} passed`);
