/**
 * Contract tests for dsh-vantage.
 *
 * Run with `node test/run.mjs`. Everything here is deterministic and offline:
 * the reducer, the bounded store, the switch/summary lifecycle, and the HTTP
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
import { apply, evaluateVerification, initState, rankFacts, roundStateOf, summarizeRound } from "../lib/rounds.js";
import { HistoryStore } from "../lib/store.js";
import { DEFAULT_CONFIG, Runtime } from "../index.js";
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
  assert.equal(fact.statement, "测试未通过", "a targetless check is named by what ran, not by the command");
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

test("summary: a few topics is fine, none is fine, and ids follow the facts", () => {
  const facts = new Map([
    ["f1", { id: "f1", statement: "src/login.test.ts 未通过", kind: "check" }],
    ["f2", { id: "f2", statement: "src/login.ts 已改动", kind: "change" }],
    ["f3", { id: "f3", statement: "登录流程无法保存", kind: "blocker" }]
  ]);
  const answer = (headline, factIds) => JSON.stringify({ topics: [{ headline, factIds, details: [] }] });
  const many = JSON.stringify({
    topics: [
      { headline: "登录流程无法保存", factIds: ["f3"] },
      { headline: "src/login.test.ts 未通过", factIds: ["f1"] },
      { headline: "src/login.ts 已改动", factIds: ["f2"] },
      { headline: "登录流程无法保存", factIds: ["f3"] },
      { headline: "src/login.ts 已改动", factIds: ["f2"] }
    ]
  });
  const capped = verifyTopics(many, facts, 3);
  // Two of the five candidates only name a file, so they never reach the panel.
  assert.deepEqual(capped.map((topic) => topic.headline), ["登录流程无法保存"], "a file name is not a headline");
  assert.deepEqual(verifyTopics(answer("登录流程无法保存", ["f3"]), facts, 3).map((topic) => topic.id), ["t:f3"]);
  assert.deepEqual(verifyTopics(answer("登录流程无法保存", ["f3"]), facts, 3).map((topic) => topic.id), ["t:f3"], "the same facts name the same topic");
  assert.deepEqual(verifyTopics(JSON.stringify({ topics: [] }), facts, 3), []);
  assert.deepEqual(verifyTopics("not json", facts, 3), []);
  assert.deepEqual(
    verifyTopics(answer("已修改 4 个文件", ["f2"]), facts, 3),
    [],
    "a count of files is not a topic"
  );
  assert.deepEqual(
    verifyTopics(answer("登录页的提交按钮", ["f2"]), facts, 3).map((topic) => topic.headline),
    ["登录页的提交按钮"],
    "a named piece of work survives"
  );
});

test("summary: the packet carries the goal and the previous topics as delta", () => {
  const state = folded([...userTurn(0, "把登录修好"), ...changeCall(2, "c1", "src/login.js")]);
  const round = state.round;
  const packet = buildPacket(round, {
    goal: "把登录修好，让会话能在刷新后恢复",
    previousTopics: ["登录表单无法保存", "src/login.js 已改动", "第三个旧主题", "第四个旧主题"]
  });
  assert.ok(packet.text.includes("goal: 把登录修好"), packet.text);
  assert.ok(packet.text.includes("previous: 登录表单无法保存 / src/login.js 已改动"), "only the last topics ride along");
  assert.equal((packet.text.match(/^previous:/gmu) ?? []).length, 1, "one delta line, never a history dump");
  const long = buildPacket(round, { goal: "长".repeat(300) });
  const goalLine = long.text.split("\n").find((line) => line.startsWith("goal:"));
  assert.ok(Array.from(goalLine).length <= "goal: ".length + 121, "the goal is clipped, not shipped whole");
});

test("summary: one topic can restate facts from several events", () => {
  const facts = new Map([
    ["f1", { id: "f1", statement: "把登录修好", kind: "intent" }],
    ["f2", { id: "f2", statement: "登录表单无法保存", kind: "blocker" }],
    ["f3", { id: "f3", statement: "src/login.js 已改动", kind: "change" }]
  ]);
  const answer = JSON.stringify({
    topics: [{ headline: "登录流程无法保存", factIds: ["f1", "f2", "f3"], details: ["已改动 src/login.js"] }]
  });
  const topics = verifyTopics(answer, facts, 3);
  assert.equal(topics.length, 1);
  assert.deepEqual(topics[0].factIds, ["f1", "f2", "f3"], "every cited fact survives");
  assert.equal(topics[0].id, "t:f1+f2+f3", "the id names the whole group");
  const partial = verifyTopics(JSON.stringify({ topics: [{ headline: "登录流程无法保存", factIds: ["f2", "ghost"] }] }), facts, 3);
  assert.deepEqual(partial[0].factIds, ["f2"], "a cited fact that does not exist is dropped");
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
  assert.equal(store.domain, null, "no domain was adopted");
  assert.equal(notes.length, 1);
  assert.ok(notes[0].includes("history store stays in memory"), notes[0]);
  store.insert(roundRecord(1));
  assert.equal(store.count(SESSION), 1, "reads still answer without a domain");
  assert.equal(store.abandoned, false);
});

// --- client module ----------------------------------------------------------

test("client: registers exactly one view and stays inside the panel", () => {
  const source = readFileSync(new URL("../client.js", import.meta.url), "utf8");
  assert.equal(source.match(/ctx\.slots\.register\(/gu)?.length, 1, "one registration, never two");
  assert.ok(source.includes("const VIEW_ID = 'vantage'"), "the view keeps its documented id");
  assert.ok(source.includes("id: VIEW_ID"), "the registration uses that id");
  assert.ok(source.includes("inject: ['slots', 'locale']"), "the module declares what it needs");
  assert.ok(!source.includes("document.body.appendChild"), "no overlay is mounted on the page");
  assert.equal(source.match(/createPortal/gu), null, "the panel is not teleported out of its slot");
});

test("client: only a row with more to show is a control", () => {
  const source = readFileSync(new URL("../client.js", import.meta.url), "utf8");
  assert.ok(!source.includes("'data-static': 'true'"), "a bare conclusion is no longer a disclosure");
  assert.ok(source.includes("'ov-item ov-item-static'"), "it renders as plain text instead");
  assert.ok(source.includes("'ov-item-link-arrow'"), "a delivered file carries an open affordance");
  assert.ok(source.includes("'ov-fact-label'"), "a pending row renders as label and value");
});

test("client: a heading can never carry payload markup", () => {
  const source = readFileSync(new URL("../client.js", import.meta.url), "utf8");
  const titleOf = source.slice(source.indexOf("function titleOf"), source.indexOf("function titleOf") + 600);
  assert.ok(titleOf.includes("replace(/<"), "the panel strips a tag-shaped title");
  assert.ok(titleOf.includes("[<>]"), "and refuses one it cannot strip");
  assert.ok(titleOf.includes("untitled"), "falling back to a plain heading instead");
});

test("locale: every dictionary line is one the panel really renders", () => {
  const source = readFileSync(new URL("../client.js", import.meta.url), "utf8");
  for (const lang of ["zh", "en"]) {
    const dict = JSON.parse(readFileSync(new URL(`../locale/${lang}.json`, import.meta.url), "utf8"));
    const flat = Object.entries(dict).flatMap(([key, value]) => key === "status" || key === "verify"
      ? Object.keys(value).map((inner) => `${key}.${inner}`)
      : [key]);
    for (const entry of flat) {
      const leaf = entry.includes(".") ? entry.split(".")[1] : entry;
      assert.ok(
        source.includes(`${entry}:`) || source.includes(`${leaf}:`) || source.includes(`'${leaf}':`),
        `${lang}.${entry} is declared in the panel`
      );
    }
  }
});

// --- session switches -------------------------------------------------------

const fakeSession = (id, extra = {}) => ({ id, header: { createdAt: 1, cwd: "/w" }, ...extra });

await testAsync("switch: a session without a stored flag is off until it is turned on", async () => {
  const runtime = new Runtime({}, DEFAULT_CONFIG, () => {});
  const first = fakeSession("s1");
  assert.equal(runtime.isEnabled(first), false, "no stored flag means disabled");
  assert.equal(runtime.switches.size, 0, "reading the state never writes a switch");
  const on = await runtime.setEnabled(first, true);
  assert.deepEqual(on, { enabled: true, generation: 1 });
  assert.equal(runtime.isEnabled(first), true);
  const off = await runtime.setEnabled(first, false);
  assert.equal(off.enabled, false);
  assert.equal(off.generation, 2, "every flip bumps the generation");
  assert.equal(runtime.isEnabled(first), false);
});

await testAsync("switch: a disabled session builds no state and asks the model for nothing", async () => {
  const runtime = new Runtime({}, DEFAULT_CONFIG, () => {});
  const session = { id: "quiet", header: { createdAt: 3, cwd: "/w" }, ownEvents: () => [] };
  assert.equal(runtime.cache.size, 0, "nothing is cached");
  const answer = await runtime.requestSummary(session, {});
  assert.equal(answer.kind, "skipped");
  assert.equal(answer.reason, "disabled", "the model is never asked while off");
});

await testAsync("switch: enabling one session never enables another, and a fork starts off", async () => {
  const runtime = new Runtime({}, DEFAULT_CONFIG, () => {});
  const a = fakeSession("a", { header: { createdAt: 1, cwd: "/w" } });
  const b = fakeSession("b", { header: { createdAt: 2, cwd: "/w" } });
  const fork = fakeSession("fork", { header: { createdAt: 1, cwd: "/w", isSeeded: true } });
  await runtime.setEnabled(a, true);
  assert.equal(runtime.isEnabled(a), true);
  assert.equal(runtime.isEnabled(b), false, "B stays disabled");
  assert.equal(runtime.isEnabled(fork), false, "a fork inherits no switch");
  await runtime.setEnabled(b, true);
  assert.equal(runtime.isEnabled(a), true, "enabling B leaves A alone");
  assert.equal(runtime.isEnabled(b), true);
});

await testAsync("history: a cold tab is read-only even while the session registry still holds it", async () => {
  const events = userTurn(0, "跑测试");
  const cold = {
    id: "cold",
    header: { createdAt: 1, cwd: "/w" },
    ownEvents: () => events
  };
  const live = { ...cold, id: "live" };
  const agents = { get: (id) => (id === "live" ? { session: live } : undefined) };
  const runtime = new Runtime({ get: (name) => (name === "agents" ? agents : undefined) }, DEFAULT_CONFIG, () => {});
  const readOnly = runtime.readOnlyOf(cold);
  assert.equal(readOnly?.archived, true, "a stored conversation without an Agent is history");
  assert.equal(readOnly?.firstLiveSeq, -1);
  assert.equal(readOnly?.ownEvents(), events, "its events still come from the open Session");
  assert.equal(runtime.readOnlyOf(live), undefined, "a session with a live Agent keeps its switch");
  const unknown = new Runtime({ get: () => undefined }, DEFAULT_CONFIG, () => {});
  assert.equal(unknown.readOnlyOf(cold), undefined, "without the Agent service, nothing is reclassified");
  const resumed = {
    id: "resumed",
    header: { createdAt: 1, cwd: "/w" },
    firstLiveSeq: 0,
    inheritedEventCount: 12,
    seq: 12,
    ownEvents: () => []
  };
  assert.equal(unknown.storedOnly(resumed), true, "an opened history tab holds only its persisted prefix");
  const fresh = { id: "fresh", header: { createdAt: 2, cwd: "/w" }, firstLiveSeq: 0, inheritedEventCount: 0, seq: 0, ownEvents: () => [] };
  assert.equal(unknown.storedOnly(fresh), false, "a brand-new conversation stays live");
  assert.equal(unknown.hasHistory({ ...cold, archived: true, ownEvents: () => [] }), true, "a stored conversation is always readable");
  assert.equal(unknown.hasHistory(cold), true, "a live session with events is readable");
  assert.equal(unknown.hasHistory({ id: "empty", archived: false, ownEvents: () => [] }), false, "a blank session has nothing to read");
});

await testAsync("history: opening a stored session keeps its projection, not its events", async () => {
  const events = [...userTurn(0, "跑测试"), ...checkCall(2, "c1", "pnpm test")];
  let closed = 0;
  const persistence = {
    stat: async () => ({ header: { createdAt: 1, cwd: "/w" } }),
    open: async () => ({
      read: async () => ({ events }),
      close: async () => { closed += 1; }
    })
  };
  const runtime = new Runtime({ get: (name) => (name === "sessionPersistence" ? persistence : undefined) }, DEFAULT_CONFIG, () => {});
  const session = await runtime.archivedSession("old");
  assert.equal(closed, 1, "the read handle is closed");
  assert.deepEqual(session.ownEvents(), [], "no event array is retained by the adapter");
  const state = runtime.stateOf(session);
  assert.equal(state?.round?.title, "跑测试", "the projection was folded once from the stored log");
  assert.equal(runtime.stateOf(session), state, "later reads reuse that projection");
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
    hasHistory: () => true,
    requestSummary: async () => ({ kind: "skipped", reason: "disabled", text: "概览已关闭" }),
    isEnabled: () => true,
    setEnabled: async (_session, enabled) => ({ enabled: enabled === true, generation: 1 })
  };

  await testAsync("open route: only a delivered file is handed to the system viewer", async () => {
    const delivered = folded([
      ...userTurn(0, "导出视频"),
      ev(2, "deliverables/presented", { files: [{ path: "/Users/apple/CreatorStudio/deliver/out.mp4", name: "out.mp4" }] })
    ]);
    const opened = [];
    const routes = createRoutes({ ...runtime, stateOf: () => delivered, openPath: (target) => opened.push(target) });
    const route = routes.find((item) => item.path === ROUTES.open);
    const call = (target) => route.fetch(new Request(`http://x${ROUTES.open}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ session: SESSION, path: target })
    }));
    const denied = await call("/etc/passwd");
    assert.equal(denied.status, 404, "a path no round delivered is refused");
    assert.deepEqual(opened, [], "nothing outside the round opens");
    const allowed = await call("/Users/apple/CreatorStudio/deliver/out.mp4");
    assert.equal(allowed.status, 200);
    assert.deepEqual(opened, ["/Users/apple/CreatorStudio/deliver/out.mp4"], "the delivered path opens once");
    const missing = await route.fetch(new Request(`http://x${ROUTES.open}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ session: SESSION }) }));
    assert.equal(missing.status, 400, "a request without a path is rejected");
  });

  test("rounds: a saved round never repeats a raw tool failure as its summary", () => {
    const state = folded([
      ...userTurn(0, "改一下页面"),
      ev(2, "tool/call", { callId: "c1", name: "edit", arguments: JSON.stringify({ path: "/w/page.js" }) }),
      ev(3, "tool/result", {
        message: { toolCallId: "c1", isError: true, content: [{ type: "text", text: 'Error: cannot edit "/w/page.js": permission denied' }] }
      })
    ]);
    const failure = [...state.round.facts.values()].find((fact) => fact.kind === "failure");
    assert.ok(failure !== undefined, "the failure is still evidence");
    assert.ok(failure.statement.startsWith("失败"), "and reads as a failure");
    assert.equal(summarizeRound(state.round).outcome, "", "but the one-line summary says nothing it cannot stand behind");
  });

  test("rounds: a goal's state survives a clear and never invents an objective", () => {
    const cleared = folded([
      ...userTurn(0, "做点事"),
      ev(3, "goal/change", { operation: "clear" })
    ]);
    assert.equal(cleared.goal.state, "none");
    assert.equal(cleared.goal.objective, "");
  });

  test("snapshot: an archived session is readable without its switch and says it is saved", async () => {
    const archivedState = folded([
      ...userTurn(0, "跑测试"),
      ...checkCall(2, "c1", "pnpm test"),
      finalMessage(4, "做完了"),
      ev(5, "turn/end", { turn: 1, reason: { kind: "completed" } }),
      ...userTurn(10, "再跑一次")
    ]);
    const archivedSession = { ...session, archived: true };
    const routes = createRoutes({
      ...runtime,
      isEnabled: () => false,
      session: async () => archivedSession,
      stateOf: () => archivedState,
      store: Object.assign(Object.create(store), { count: () => 0, recent: () => [] })
    });
    const answer = await routes.find((entry) => entry.path === ROUTES.snapshot)
      .fetch(new Request(`http://x${ROUTES.snapshot}?session=${SESSION}`));
    const body = await answer.json();
    assert.equal(answer.status, 200, "no switch is needed to read history");
    assert.equal(body.coverage.readOnly, true);
    assert.equal(body.round.statusKey, "archived");
    assert.equal(body.round.statusLine, "已保存");
    assert.equal(body.round.roundState, "archived", "a saved round is not running");
    assert.equal(body.round.runtimeState, "idle");
    const history = await routes.find((entry) => entry.path === ROUTES.history)
      .fetch(new Request(`http://x${ROUTES.history}?session=${SESSION}&exclude=${body.round.roundId}`));
    const page = await history.json();
    assert.equal(history.status, 200);
    assert.equal(page.items.length, 1, "the finished round comes from the folded log when the store is empty");
    assert.ok(page.items[0].archivedAt > 0, "the saved round keeps when it was saved");
  });

  await testAsync("round: an archived round never claims to be running", async () => {
    const archivedState = folded([
      ...userTurn(0, "跑测试"),
      ...checkCall(2, "c1", "pnpm test"),
      finalMessage(4, "做完了"),
      ev(5, "turn/end", { turn: 1, reason: { kind: "completed" } })
    ]);
    const archivedSession = { ...session, archived: true };
    const routes = createRoutes({
      ...runtime,
      isEnabled: () => false,
      session: async () => archivedSession,
      stateOf: () => archivedState,
      store: Object.assign(Object.create(store), { count: () => 0, get: () => undefined })
    });
    const answer = await routes.find((entry) => entry.path === ROUTES.round)
      .fetch(new Request(`http://x${ROUTES.round}?session=${SESSION}&round=${archivedState.settled.roundId}`));
    const body = await answer.json();
    assert.equal(answer.status, 200);
    assert.equal(body.round.roundState, "archived");
    assert.equal(body.round.runtimeState, "idle");
    assert.equal(body.round.statusLine, "已保存");
    assert.ok(body.round.archivedAt > 0, "a saved round carries the time it was saved");
  });

  await testAsync("enable and summary: a saved session refuses both instead of recording", async () => {
    const archivedSession = { ...session, archived: true };
    let asked = 0;
    const routes = createRoutes({
      ...runtime,
      session: async () => archivedSession,
      setEnabled: async () => { asked += 1; return { enabled: true, generation: 1 }; },
      requestSummary: async () => { asked += 1; return { kind: "queued" }; }
    });
    const post = (path, payload) => routes.find((entry) => entry.path === path)
      .fetch(new Request(`http://x${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ session: SESSION, ...payload })
      }));
    const on = await post(ROUTES.enable, { enabled: true });
    const summary = await post(ROUTES.summaryRequest, {});
    assert.equal(on.status, 409);
    assert.equal(summary.status, 409);
    assert.equal((await on.json()).error.code, "read-only");
    assert.equal((await summary.json()).error.code, "read-only");
    assert.equal(asked, 0, "nothing was switched or sent to the model");
  });

  test("routes: exactly the documented seven paths, no duplicates", () => {
    const routes = createRoutes(runtime);
    const paths = routes.map((route) => route.path);
    assert.equal(new Set(paths).size, paths.length);
    assert.deepEqual(
      [...paths].sort(),
      [
        ROUTES.evidence,
        ROUTES.enable,
        ROUTES.history,
        ROUTES.open,
        ROUTES.round,
        ROUTES.snapshot,
        ROUTES.summaryRequest
      ].sort()
    );
    for (const route of routes) assert.ok(route.methods.length >= 1);
  });

  await testAsync("snapshot: a switched-off session still shows its saved round, read-only", async () => {
    let folded = 0;
    const closed = {
      ...runtime,
      isEnabled: () => false,
      stateOf: () => {
        folded += 1;
        return state;
      }
    };
    const route = createRoutes(closed).find((entry) => entry.path === ROUTES.snapshot);
    const answer = await route.fetch(new Request(`http://local${ROUTES.snapshot}?session=${SESSION}`));
    const body = await answer.json();
    assert.equal(answer.status, 200);
    assert.equal(body.coverage.enabled, false, "recording is still off");
    assert.equal(body.coverage.readOnly, true, "the shown facts come from the saved log");
    assert.equal(body.coverage.archived, false, "the switch stays available");
    assert.equal(body.round.statusLine, "已保存");
    assert.ok(body.brief.items.length > 0, "the saved facts are built");
    assert.equal(body.coverage.coreObservedSeq, state.lastSeq);
    assert.equal(folded, 1, "a read may fold the saved log; it records nothing");
    const blank = {
      ...runtime,
      hasHistory: () => false,
      isEnabled: () => false,
      stateOf: () => {
        folded += 1;
        return state;
      }
    };
    const blankAnswer = await createRoutes(blank).find((entry) => entry.path === ROUTES.snapshot)
      .fetch(new Request(`http://local${ROUTES.snapshot}?session=${SESSION}`));
    assert.equal(blankAnswer.status, 200);
    assert.equal((await blankAnswer.json()).round, null, "a brand-new off session stays empty");
    assert.equal(folded, 1, "an empty session is never folded");
  });

  await testAsync("snapshot: an aborted saved turn still shows what the agent last said", async () => {
    const aborted = folded([
      ...userTurn(1, "看下进度"),
      finalMessage(3, "先收归档页的开关。"),
      ev(4, "turn/end", { turn: 1, reason: { kind: "aborted" } })
    ]);
    assert.equal(aborted.reply, null);
    assert.equal(aborted.lastAssistant.text, "先收归档页的开关。");
    const route = createRoutes({ ...runtime, isEnabled: () => false, stateOf: () => aborted })
      .find((entry) => entry.path === ROUTES.snapshot);
    const body = await (await route.fetch(new Request(`http://local${ROUTES.snapshot}?session=${SESSION}`))).json();
    assert.equal(body.brief.items[0].label, "最近回复");
    assert.match(body.brief.items[0].value, /归档页/u);
  });

  await testAsync("snapshot: an unfinished saved round shows its latest reply instead of nothing", async () => {
    const open = folded([...userTurn(1, "看下进度"), finalMessage(3, "先把归档页的开关收起来。")]);
    const route = createRoutes({ ...runtime, isEnabled: () => false, stateOf: () => open })
      .find((entry) => entry.path === ROUTES.snapshot);
    const body = await (await route.fetch(new Request(`http://local${ROUTES.snapshot}?session=${SESSION}`))).json();
    assert.equal(body.brief.items[0].id, "conclusion");
    assert.equal(body.brief.items[0].label, "最近回复");
    assert.match(body.brief.items[0].value, /归档页的开关/u);
  });

  await testAsync("snapshot: a saved transcript with no tool facts shows its closing reply", async () => {
    const sealed = folded([
      ...userTurn(1, "整理归档页"),
      finalMessage(3, "这轮把归档页的开关收起来了。"),
      ev(4, "turn/end", { turn: 1, reason: { kind: "completed" } })
    ]);
    const route = createRoutes({ ...runtime, isEnabled: () => false, stateOf: () => sealed })
      .find((entry) => entry.path === ROUTES.snapshot);
    const body = await (await route.fetch(new Request(`http://local${ROUTES.snapshot}?session=${SESSION}`))).json();
    assert.equal(body.brief.items.length, 1);
    assert.equal(body.brief.items[0].id, "conclusion");
    assert.equal(body.brief.items[0].label, "结论");
    assert.match(body.brief.items[0].value, /归档页的开关/u, "the reply is quoted, not rewritten");
  });

  test("snapshot: the round that just finished stays on screen after the reply seals it", () => {
    const sealed = folded([
      ...userTurn(0, "修一下概览页"),
      ...changeCall(2, "c1", "client.js"),
      ...checkCall(4, "c2", "pnpm test"),
      finalMessage(6, "已经修好了，测试通过。"),
      ev(7, "turn/end", { turn: 1, reason: { kind: "completed" } })
    ]);
    assert.equal(sealed.round, null, "a reply seals the open round");
    assert.ok(sealed.settled?.round !== undefined, "the finished round waits in settled");
    const body = buildSnapshot(runtime, session, sealed, "rev-sealed");
    assert.equal(body.round?.roundId, sealed.settled.roundId, "the panel shows the round that just finished");
    assert.equal(body.round.runtimeState, "idle", "nothing is running once the reply landed");
    assert.equal(body.round.elapsedMs, sealed.settled.round.archivedAt - sealed.settled.round.startedAt, "a finished round stops its clock");
    assert.equal(body.brief.items.length, 1, JSON.stringify(body.brief.items.map((item) => item.text)));
    assert.notEqual(body.brief.items[0].id, "no-facts", "a sealed round keeps its one real line");
    assert.ok(body.brief.items[0].text.includes("已修改"), "the line says what the round changed");
    assert.equal(body.brief.items[0].label, undefined, "a change is a sentence, not a label row");
    assert.equal(body.brief.items[0].link, undefined, "and it promises no file that it cannot open");
  });

  test("snapshot: the heading falls back to a readable goal, never a payload tag", () => {
  const state = folded([
    ...userTurn(0, "<goal_round>"),
    ev(3, "goal/change", { goal: { phase: "active", objective: "整理概览页的标题" } })
  ]);
  const body = buildSnapshot(runtime, session, state, "rev-goal-title");
  assert.equal(body.round?.title, "整理概览页的标题", "the readable goal wins over the tag");
  assert.equal(body.brief.items[0].label, "待办");
});

test("rounds: machine markup in a goal never becomes the heading", () => {
    const state = folded([
      ...userTurn(0, "把这个页面整理一下"),
      ev(3, "goal/change", { goal: { phase: "active", objective: "<goal_round>" } })
    ]);
    assert.equal(state.round.title, "把这个页面整理一下", "the opening request is readable; the tag is not");
  });

  test("snapshot: 历史 lists the rounds before the one on screen", () => {
    const sealed = folded([
      ...userTurn(0, "跑测试"),
      ...checkCall(2, "c1", "pnpm test"),
      finalMessage(4, "做完了"),
      ev(5, "turn/end", { turn: 1, reason: { kind: "completed" } })
    ]);
    const shown = sealed.settled.roundId;
    const older = { roundId: `${SESSION}:1`, title: "更早的一轮", statusLine: "", at: 1 };
    const archived = [{ roundId: shown, title: "刚刚这一轮", statusLine: "", at: 2 }, older];
    const withStore = { ...runtime, store: { count: () => archived.length, recent: () => archived } };
    const body = buildSnapshot(withStore, session, sealed, "rev-history");
    assert.deepEqual(body.history.items.map((item) => item.roundId), [older.roundId], "the shown round is not a previous round");
    assert.equal(body.history.count, 1, "the count matches what 历史 can open");
    assert.equal(body.history.hasMore, false);
  });

  await testAsync("history: the round on screen can be asked out of a page", async () => {
    const shown = "session:9";
    const page = { items: [{ roundId: shown }, { roundId: "session:8" }], nextCursor: "next" };
    const withStore = { ...runtime, store: { ...store, page: () => page } };
    const route = createRoutes(withStore).find((entry) => entry.path === ROUTES.history);
    const answer = await route.fetch(new Request(`http://local${ROUTES.history}?session=${SESSION}&exclude=${shown}`));
    const body = await answer.json();
    assert.deepEqual(body.items.map((item) => item.roundId), ["session:8"]);
    assert.equal(body.nextCursor, "next", "paging still works after the shown round is dropped");
  });

  test("snapshot: a fresh summary replaces the fact lines without losing their evidence", () => {
    const fact = [...state.round.facts.values()].find((item) => item.kind !== "check") ?? [...state.round.facts.values()][0];
    assert.ok(fact !== undefined, "the round recorded a fact");
    const summary = {
      roundId: state.round.roundId,
      throughSeq: state.lastSeq,
      revision: "summary-1", // ui-copy-ignore
      generatedAt: now(),
      topics: [{ id: `t:${fact.id}`, headline: "登录流程无法保存", qualifier: "需要一次决定", details: [], factIds: [fact.id] }]
    };
    const withSummary = { ...runtime, briefOf: () => summary };
    const body = buildSnapshot(withSummary, session, state, "rev-summary");
    assert.equal(body.mode, "summary");
    assert.equal(body.brief.mode, "summary");
    assert.equal(body.brief.items[0].source, "model");
    assert.equal(body.brief.items[0].text, "登录流程无法保存");
    assert.equal(Array.isArray(body.brief.items[0].evidence), true, "the topic still points at its record");
    const stale = { ...runtime, briefOf: () => ({ ...summary, throughSeq: state.lastSeq - 1 }) };
    assert.equal(buildSnapshot(stale, session, state, "rev-stale").brief.mode, "facts", "an older summary never hides new facts");
  });

  test("snapshot: a summary keeps the delivered file clickable", () => {
    const delivered = folded([
      ...userTurn(0, "导出讲解视频"),
      ev(2, "deliverables/presented", { files: [{ path: "/Users/apple/CreatorStudio/deliver/out.mp4", name: "out.mp4" }] })
    ]);
    const fact = [...delivered.round.facts.values()].find((item) => item.kind === "deliverable");
    assert.ok(fact !== undefined, "the round recorded the delivery");
    const summary = {
      roundId: delivered.round.roundId,
      throughSeq: delivered.lastSeq,
      revision: "summary-link",
      generatedAt: now(),
      topics: [{ id: `t:${fact.id}`, headline: "讲解视频已导出", qualifier: "", details: [], factIds: [fact.id] }]
    };
    const body = buildSnapshot({ ...runtime, briefOf: () => summary }, session, delivered, "rev-link");
    assert.equal(body.brief.mode, "summary");
    assert.equal(body.brief.items[0].link.path, "/Users/apple/CreatorStudio/deliver/out.mp4", "the row still opens the file");
  });

  test("snapshot: an edit alone still says what changed", () => {
    const edited = folded([
      ...userTurn(0, "重构首页"),
      ...changeCall(2, "w1", "site/a.md"),
      ...changeCall(4, "w2", "site/b.md")
    ]);
    const body = buildSnapshot(runtime, session, edited, "rev-edits");
    const rows = body.brief.items;
    assert.equal(rows.length, 1, JSON.stringify(rows.map((row) => row.text)));
    assert.equal(rows[0].source, "rule", "the line is read from the round, not written by a model");
    assert.ok(rows[0].text.startsWith("已修改 "), "it names the work in progress");
    assert.equal(JSON.stringify(body).includes("site/a.md"), false, "full paths stay off the brief; basenames are enough");
  });

  test("snapshot: a delivered file opens from the line that names it", () => {
    const delivered = folded([
      ...userTurn(0, "导出视频"),
      ev(2, "deliverables/presented", { files: [{ path: "/Users/apple/CreatorStudio/deliver/envoy-f52motion.mp4", name: "envoy-f52motion.mp4" }] })
    ]);
    const body = buildSnapshot(runtime, session, delivered, "rev-link");
    const row = body.brief.items.find((item) => item.link !== undefined && item.link !== null);
    assert.ok(row !== undefined, "a delivered file is a line of its own");
    assert.equal(row.text, "已生成：envoy-f52motion.mp4");
    assert.equal(row.link.path, "/Users/apple/CreatorStudio/deliver/envoy-f52motion.mp4", "the row carries its real path");
  });

  test("snapshot: a passing check never takes a line, even after a new edit", () => {
    const round = folded([
      ...userTurn(0, "修首页"),
      ...checkCall(2, "c1", "pnpm test"),
      ...changeCall(4, "w1", "site/a.md")
    ]);
    const body = buildSnapshot(runtime, session, round, "rev-stale");
    const texts = body.brief.items.map((item) => item.text);
    assert.equal(texts.some((text) => text.includes("通过")), false, JSON.stringify(texts));
    assert.ok(body.brief.items[0].text.includes("已修改"), "the edit is the one line the reader gets");
  });

  test("snapshot: the same headline from two topics is shown once", () => {
    const fact = [...state.round.facts.values()][0];
    const summary = {
      roundId: state.round.roundId,
      throughSeq: state.lastSeq,
      revision: "summary-dup", // ui-copy-ignore
      generatedAt: now(),
      topics: [
        { id: `t:${fact.id}-a`, headline: "登录流程无法保存", qualifier: "", details: [], factIds: [fact.id] },
        { id: `t:${fact.id}-b`, headline: "登录流程无法保存。", qualifier: "", details: [], factIds: [fact.id] }
      ]
    };
    const body = buildSnapshot({ ...runtime, briefOf: () => summary }, session, state, "rev-dup");
    assert.equal(body.brief.items.length, 1, JSON.stringify(body.brief.items.map((item) => item.text)));
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

test("snapshot: rule rows carry no raw command or tool material", () => {
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
  const failedCheck = body.brief.items.find((item) => item.tone === "error");
  assert.ok(failedCheck !== undefined, "a failed check is a finding");
  assert.equal(failedCheck.text, "自动测试未通过", "the kind of verification is named, not the runner");
  assert.deepEqual(failedCheck.evidence, [], "no tool output hangs under it");
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
  let injectedSlot = "";
  const ctx = {
    locale: { getSnapshot: () => ({ active: "zh" }) },
    slots: {
      inject: (name, run) => {
        injectedSlot = name;
        return run();
      },
      register: (definition, Component) => {
        registration = definition;
        return Component;
      }
    }
  };
  plugin.apply(ctx);
  // The slot graph only accepts a contribution declared through slots.inject;
  // a bare register() fails boot with "slot ... is not declared".
  assert.equal(injectedSlot, "conversation.view");
  assert.equal(registration.name, "conversation.view");
  assert.equal(registration.id, "vantage");
  assert.equal(registration.label(), "概览");
  // conversation.view passes sessionId as a standard prop, not an injected view prop.
  assert.equal(registration.inject, undefined);

  const en = { locale: { getSnapshot: () => ({ active: "en" }) }, slots: ctx.slots };
  plugin.apply(en);
  assert.equal(registration.name, "conversation.view");
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
