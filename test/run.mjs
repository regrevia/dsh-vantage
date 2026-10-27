/**
 * Contract tests for dsh-vantage.
 *
 * Run with `node test/run.mjs`. Everything here is deterministic and offline:
 * the reducer, the bounded store, the budget/lease accounting, and the HTTP
 * payload shapes are exercised without a harness process, a model, or a
 * privileged connection.
 */

import assert from "node:assert/strict";

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
import { LeaseRegistry, SummaryBudget, buildPacket, verifyLines } from "../lib/summary.js";
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
  assert.equal(roundIdOf(SESSION, 12), `${SESSION.slice(0, 8)}:12`);
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
  assert.ok(state.round.facts.some((fact) => fact.kind === "check" && fact.statement.startsWith("未通过")));
});

test("rounds: an unpaired tool result is a failure, not a check", () => {
  const state = folded([
    ...userTurn(0, "继续"),
    ev(2, "tool/result", { message: { toolCallId: "ghost", isError: true, content: [] } })
  ]);
  assert.equal(state.round.conditions.length, 0);
  assert.ok(state.round.facts.some((fact) => fact.kind === "failure"));
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
    ev(2, "tool/call", { callId: "c1", name: "shell", arguments: "{}" }),
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

test("summary: spending past the token ceiling marks the session exhausted", () => {
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

test("summary: invented numbers and conclusions are dropped", () => {
  const state = folded([...userTurn(0, "跑测试"), ...checkCall(2, "c1", "pnpm test")]);
  const packet = buildPacket(state.round, 8);
  const items = verifyLines(
    ["已通过 pnpm test", "已完成任务，测试全过", "耗时 999 毫秒", "```js\nx\n```"].join("\n"),
    packet.facts,
    3
  );
  const lines = items.map((item) => item.text);
  assert.ok(lines.includes("已通过 pnpm test"), `items=${JSON.stringify(items)}`);
  for (const line of lines) assert.ok(!line.includes("测试全过"), line);
  for (const line of lines) assert.ok(!line.includes("999"), line);
});

// --- store ------------------------------------------------------------------

function roundRecord(index, sessionId = SESSION) {
  return {
    schemaVersion: 1,
    sessionId,
    roundId: `${sessionId.slice(0, 8)}:${index}`,
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
  assert.equal(recent[0].roundId, `${SESSION.slice(0, 8)}:5`);
  assert.equal(store.get(SESSION, `${SESSION.slice(0, 8)}:5`).title, "第 5 轮");
  assert.equal(store.get(SESSION, "missing"), undefined);
});

await testAsync("store: a broken storage domain degrades to memory", async () => {
  const broken = {
    defineDomain() {
      return {};
    },
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
    leases: lease,
    stateOf: () => state,
    briefOf: () => undefined,
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
    const text = excerptOf({ type: "tool/call", data: { name: "shell", arguments: '{"token":"secret"}' } });
    assert.equal(typeof text, "string");
    assert.ok(!text.includes("secret") || text.length <= LIMITS.excerpt);
    assert.equal(excerptOf({ type: "assistant/thinking", data: { text: "secret reasoning" } }), "");
  });
}

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
