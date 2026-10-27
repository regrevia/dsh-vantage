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
import { LeaseRegistry, SUMMARY_SYSTEM_PROMPT, SummaryBudget, buildPacket, estimateTokens, publishVerdict, verifyLines } from "../lib/summary.js";
import { buildSnapshot, createRoutes, excerptOf } from "../lib/api.js";

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
  assert.ok(state.round.facts.some((fact) => fact.kind === "check" && fact.statement === "测试未通过"));
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

const BUDGET_CONFIG = {
  enabled: true,
  keepFollowing: false,
  checkIntervalMs: 300_000,
  firstEligibleAfterMs: 180_000,
  minIntervalMs: 900_000,
  maxInputTokens: 1000,
  maxOutputTokens: 250,
  maxRequestsPerRollingHour: 2,
  maxTokensPerRollingHour: 5000,
  maxConcurrentRequests: 1,
  requestDeadlineMs: 20_000,
  retryAttempts: 0,
  provider: "",
  model: ""
};

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

test("summary: the rolling budget stops at the request ceiling", () => {
  const budget = new SummaryBudget(BUDGET_CONFIG, warn);
  budget.now = now;
  assert.deepEqual(budget.admits(SESSION), { ok: true });
  budget.reserve(SESSION);
  assert.deepEqual(budget.admits(SESSION), { ok: false, reason: "running" });
  budget.settle(SESSION, 1250);
  const second = budget.admits(SESSION);
  assert.equal(second.ok, true);
  budget.reserve(SESSION);
  budget.settle(SESSION, 1250);
  assert.equal(budget.admits(SESSION).ok, false);
  assert.equal(budget.admits(SESSION).reason, "budget");
  assert.equal(budget.isExhausted(SESSION), false);
  clock += 3_600_001;
  budget.drain(now());
  assert.equal(budget.used().tokens, 0);
  assert.equal(budget.isExhausted(SESSION), false);
});

test("summary: concurrency is one call per Host, not one per session", () => {
  const budget = new SummaryBudget(BUDGET_CONFIG, warn);
  budget.now = now;
  assert.equal(budget.admits(SESSION).ok, true);
  budget.reserve(SESSION);
  const other = budget.admits("another-session");
  assert.deepEqual(other, { ok: false, reason: "running" }, "a second session cannot start a parallel call");
  // The reservation is already on the books, so the hour sees it too.
  assert.equal(budget.used().tokens, 1250);
  assert.equal(budget.used().requests, 1);
});

test("summary: the ledger survives a restart and charges interrupted calls in full", () => {
  const budget = new SummaryBudget(BUDGET_CONFIG, warn);
  budget.now = now;
  budget.reserve(SESSION);
  budget.settle(SESSION, 900);
  budget.reserve(SESSION);
  const saved = budget.snapshot();
  assert.equal(saved.spent.length, 2);
  // A process that dies mid-call still spent the reservation.
  const restarted = new SummaryBudget(BUDGET_CONFIG, warn);
  restarted.now = now;
  restarted.restore(saved);
  assert.equal(restarted.used().tokens, 900 + 1250);
  assert.equal(restarted.used().requests, 2);
  assert.equal(restarted.used().tokens, 2150);
  assert.deepEqual(restarted.admits(SESSION), { ok: false, reason: "budget" });
  const empty = new SummaryBudget(BUDGET_CONFIG, warn);
  empty.now = now;
  empty.restore({ spent: [{ at: "soon", tokens: "many" }], fingerprints: "nope", paused: [7] });
  assert.deepEqual(empty.used(), { tokens: 0, requests: 0 });
});

test("summary: the packet plus its instruction stays inside the input cap", () => {
  const state = folded([
    ...userTurn(0, "跑测试"),
    ...checkCall(2, "c1", "pnpm test"),
    ...checkCall(3, "c2", "pnpm lint")
  ]);
  const cap = DEFAULT_CONFIG.summary.maxInputTokens;
  const room = Math.max(64, cap - estimateTokens(SUMMARY_SYSTEM_PROMPT) - 8);
  const packet = buildPacket(state.round, 200, room);
  assert.ok(estimateTokens(SUMMARY_SYSTEM_PROMPT) + estimateTokens(packet.text) <= cap, "whole request fits");
});

test("summary: the shipped defaults match the documented policy", () => {
  const { summary } = DEFAULT_CONFIG;
  assert.equal(summary.maxInputTokens, 1000);
  assert.equal(summary.maxOutputTokens, 250);
  assert.equal(summary.maxRequestsPerRollingHour, 2);
  assert.equal(summary.maxTokensPerRollingHour, 2500);
  assert.equal(summary.maxConcurrentRequests, 1);
  assert.equal(summary.retryAttempts, 0);
  assert.equal(summary.firstEligibleAfterMs, 300_000);
  assert.equal(summary.minIntervalMs, 1_800_000);
});

test("summary: duplicate summaries for the same coverage are refused", () => {
  const budget = new SummaryBudget(BUDGET_CONFIG, warn);
  budget.now = now;
  assert.equal(budget.duplicate(SESSION, "r1", 42), false);
  budget.remember(SESSION, "r1", 42);
  assert.equal(budget.duplicate(SESSION, "r1", 42), true);
  assert.equal(budget.duplicate(SESSION, "r1", 43), false);
});

test("summary: the auto switch pauses one session only", () => {
  const budget = new SummaryBudget(BUDGET_CONFIG, warn);
  assert.equal(budget.autoEnabled(SESSION), true);
  budget.setAuto(SESSION, false);
  assert.equal(budget.autoEnabled(SESSION), false);
  assert.equal(budget.autoEnabled("other"), true);
  budget.setAuto(SESSION, true);
  assert.equal(budget.autoEnabled(SESSION), true);
});

test("summary: publish re-validation discards a stale, paused, or superseded answer", () => {
  const base = { requestId: "r1", currentRequestId: "r1", manual: true, autoEnabled: true, roundId: "s:1", seq: 7 };
  const live = { round: { roundId: "s:1" }, lastSeq: 7 };
  assert.equal(publishVerdict({ ...base, state: live }), null);
  assert.equal(publishVerdict({ ...base, state: live, currentRequestId: "r2" }).reason, "cancelled");
  assert.equal(publishVerdict({ ...base, state: live, manual: false, autoEnabled: false }).reason, "disabled");
  assert.equal(publishVerdict({ ...base, state: live, manual: false, autoEnabled: true }), null);
  assert.equal(publishVerdict({ ...base, state: { round: { roundId: "s:1" }, lastSeq: 8 } }).reason, "fresh");
  assert.equal(publishVerdict({ ...base, state: { round: { roundId: "s:2" }, lastSeq: 7 } }).reason, "fresh");
  assert.equal(publishVerdict({ ...base, state: undefined }).reason, "fresh");
});

test("summary: spending past the token ceiling marks the session exhausted", () => { // ui-copy-ignore
  const tight = new SummaryBudget({ ...BUDGET_CONFIG, maxTokensPerRollingHour: 1200, maxRequestsPerRollingHour: 4 }, warn);
  tight.now = now;
  tight.reserve(SESSION);
  tight.settle(SESSION, 1250);
  assert.equal(tight.isExhausted(SESSION), true);
  assert.deepEqual(tight.admits(SESSION), { ok: false, reason: "budget" });
});

test("summary: leases cap the number of watching windows", () => {
  const leases = new LeaseRegistry(1);
  leases.now = now;
  const first = leases.touch(SESSION, "a", true);
  assert.equal(first.visible, true);
  assert.equal(leases.visible(SESSION), true);
  assert.throws(() => leases.touch(SESSION, "b", true), (error) => error.code === "lease/limit");
  leases.touch(SESSION, "a", false);
  assert.equal(leases.visible(SESSION), false);
  const again = leases.touch(SESSION, "b", true);
  assert.equal(again.visible, true);
});

test("summary: the packet is bounded and only ships observed facts", () => {
  const state = folded([...userTurn(0, "跑测试"), ...checkCall(2, "c1", "pnpm test")]);
  const packet = buildPacket(state.round, 8);
  assert.ok(packet.text.length > 0);
  assert.ok(packet.facts.size >= 1);
  assert.ok(packet.text.split("\n").length <= 8);
});

test("summary: invented numbers, conclusions, and citations are dropped", () => {
  const state = folded([...userTurn(0, "跑测试"), ...checkCall(2, "c1", "pnpm test")]);
  const packet = buildPacket(state.round, 8);
  const [factId] = [...packet.facts.keys()];
  assert.ok(factId, "packet has a fact to cite");
  const items = verifyLines(
    JSON.stringify({
      items: [
        { factIds: [factId], title: "已通过 pnpm test" },
        { factIds: [factId], title: "已完成任务，测试全过" },
        { factIds: [factId], title: "耗时 999 毫秒" },
        { factIds: ["f-not-in-packet"], title: "已通过 pnpm test" },
        { title: "没有引用任何事实" }
      ]
    }),
    packet.facts,
    3
  );
  const lines = items.map((item) => item.text);
  assert.ok(lines.includes("已通过 pnpm test"), `items=${JSON.stringify(items)}`);
  for (const line of lines) assert.ok(!line.includes("测试全过"), line);
  for (const line of lines) assert.ok(!line.includes("999"), line);
  assert.ok(items.every((item) => item.factIds.every((id) => packet.facts.has(id))), "every citation exists");
  assert.equal(verifyLines("已通过 pnpm test\n已完成任务", packet.facts, 3).length, 0, "prose is not an answer");
});

test("summary: the packet cap keeps the input inside the token budget", () => {
  const state = folded([...userTurn(0, "跑测试"), ...checkCall(2, "c1", "pnpm test")]);
  const loose = buildPacket(state.round, 200);
  const tight = buildPacket(state.round, 200, 20);
  assert.ok(tight.text.length < loose.text.length, "the cap drops facts");
  assert.ok(estimateTokens(tight.text) <= 20, `tokens=${estimateTokens(tight.text)}`);
  assert.equal(tight.truncated, true);
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
  const lease = new LeaseRegistry(8);
  const budget = new SummaryBudget(BUDGET_CONFIG, warn);
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
    budget,
    leases: lease, // ui-copy-ignore
    stateOf: () => state, // ui-copy-ignore
    briefOf: () => undefined, // ui-copy-ignore
    session: async () => session,
    requestSummary: async () => ({ kind: "skipped", reason: "disabled", text: "自动摘要已关闭" }),
    setAuto: (sessionId, enabled) => budget.setAuto(sessionId, enabled)
  };

  test("routes: exactly the documented seven paths, no duplicates", () => {
    const routes = createRoutes(runtime);
    const paths = routes.map((route) => route.path);
    assert.equal(new Set(paths).size, paths.length);
    assert.deepEqual(
      [...paths].sort(),
      [
        ROUTES.evidence,
        ROUTES.history,
        ROUTES.lease,
        ROUTES.round,
        ROUTES.snapshot,
        ROUTES.summaryAuto,
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
      items: [{ id: "b:1", factIds: [check.id], text: "构建 失败", tone: "neutral" }]
    };
    const body = buildSnapshot({ ...runtime, briefOf: () => brief }, session, failedState, "rev2");
    const item = body.brief.items[0];
    assert.equal(item.text, "构建 失败");
    assert.equal(item.tone, "error", "a failed check stays red even when the model says it plainly");
  });

  test("schema: the running status is part of the documented set", () => {
    assert.ok(STATUS_KEYS.includes("running"));
    assert.ok(STATUS_KEYS.includes("waiting"));
    assert.ok(STATUS_KEYS.includes("summary-paused"));
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

  await testAsync("lease: limit answers a structured 429", async () => {
    const tight = new LeaseRegistry(1);
    const routes = createRoutes({ ...runtime, leases: tight });
    const route = routes.find((item) => item.path === ROUTES.lease);
    const post = (leaseId) =>
      route.fetch(new Request(`http://x${ROUTES.lease}`, {
        method: "POST",
        body: JSON.stringify({ session: SESSION, leaseId })
      }));
    assert.equal((await post("one")).status, 200);
    const limited = await post("two");
    assert.equal(limited.status, 429);
    const body = await limited.json();
    assert.equal(body.error.code, "lease/limit");
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
