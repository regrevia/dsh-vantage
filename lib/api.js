/**
 * The seven exact Fetch routes, and nothing else.
 *
 * Every handler here is a pure projection of state that already exists: rounds
 * folded by the reducer, rounds archived in the store, and the last published
 * short summary. No read handler ever starts a model call — a read that could
 * spend budget is a read that can fail under load — so the two mutating routes
 * exist only to ask an independent scheduler and to keep the visibility lease
 * alive.
 */

import {
  LIMITS,
  ROUTES,
  SCHEMA_VERSION,
  OverviewError,
  clip,
  failure,
  guarded,
  intParam,
  json,
  readJsonBody,
  requiredField,
  requiredParam
} from "./schema.js";
import { chooseStatus, evaluateVerification, rankFacts, roundStateOf } from "./rounds.js";

/** Response headers shared by every answer; nothing here is cacheable. */
const HEADERS = Object.freeze({ "cache-control": "no-store" });

/**
 * Build the route table for one runtime.
 *
 * @param {object} runtime - the runtime wiring described in `index.js`.
 * @returns {object[]} Fetch route registrations.
 */
export function createRoutes(runtime) {
  return [
    {
      path: ROUTES.snapshot,
      methods: ["GET"],
      requestBody: "buffered",
      fetch: (request) => guarded((req) => snapshotRoute(runtime, req), runtime.warn)(request)
    },
    {
      path: ROUTES.history,
      methods: ["GET"],
      requestBody: "buffered",
      fetch: (request) => guarded((req) => historyRoute(runtime, req), runtime.warn)(request)
    },
    {
      path: ROUTES.round,
      methods: ["GET"],
      requestBody: "buffered",
      fetch: (request) => guarded((req) => roundRoute(runtime, req), runtime.warn)(request)
    },
    {
      path: ROUTES.evidence,
      methods: ["GET"],
      requestBody: "buffered",
      fetch: (request) => guarded((req) => evidenceRoute(runtime, req), runtime.warn)(request)
    },
    {
      path: ROUTES.summaryRequest,
      methods: ["POST"],
      requestBody: "buffered",
      fetch: (request) => guarded((req) => summaryRequestRoute(runtime, req), runtime.warn)(request)
    },
    {
      path: ROUTES.summaryAuto,
      methods: ["POST"],
      requestBody: "buffered",
      fetch: (request) => guarded((req) => summaryAutoRoute(runtime, req), runtime.warn)(request)
    },
    {
      path: ROUTES.lease,
      methods: ["POST"],
      requestBody: "buffered",
      fetch: (request) => guarded((req) => leaseRoute(runtime, req), runtime.warn)(request)
    }
  ];
}

/**
 * `GET /snapshot` — the whole first screen in one answer.
 *
 * @param {object} runtime - runtime wiring.
 * @param {Request} request - incoming request.
 * @returns {Promise<Response>} snapshot or unchanged marker.
 */
async function snapshotRoute(runtime, request) {
  const url = new URL(request.url);
  const session = await runtime.session(requiredParam(url, "session"));
  const state = runtime.stateOf(session);
  const revision = snapshotRevision(runtime, session, state);
  if (url.searchParams.get("revision") === revision) {
    return json({ kind: "unchanged", revision }, 200, HEADERS);
  }
  const body = buildSnapshot(runtime, session, state, revision);
  let serialized = JSON.stringify(body);
  if (serialized.length > LIMITS.serializedSnapshot) {
    // Shed the cheapest thing first: condition text and outcome detail. The
    // verdict, the status line, and the history count always survive.
    body.verification.conditions = body.verification.conditions.slice(0, 1);
    body.outcomes.items = body.outcomes.items.slice(0, 1);
    body.outcomes.truncated = true;
    serialized = JSON.stringify(body);
  }
  return new Response(serialized, { status: 200, headers: { ...HEADERS, "content-type": "application/json; charset=utf-8" } });
}

/**
 * Assemble the snapshot payload.
 *
 * @param {object} runtime - runtime wiring.
 * @param {object} session - runtime session.
 * @param {object|undefined} state - projection state.
 * @param {string} revision - revision the client will echo back.
 * @returns {object} snapshot body.
 */
export function buildSnapshot(runtime, session, state, revision) {
  const now = runtime.now();
  const round = state?.round ?? null;
  const brief = runtime.briefOf(session.id);
  const summaryFresh = brief !== undefined && round !== null && brief.roundId === round.roundId && brief.throughSeq === state.lastSeq;
  const mode = summaryFresh ? "summary" : "facts";
  const coverageGap = state === undefined || state.lastSeq < 0;
  const verification = evaluateVerification(round, { coverageGap: false });
  const shownVerification = {
    state: verification.state,
    truncated: verification.conditions.length > LIMITS.shownConditions,
    conditions: verification.conditions.slice(0, LIMITS.shownConditions)
  };
  const status = chooseStatus(state ?? { approvals: {}, jobs: {} }, round, {
    verificationState: verification.state,
    summaryFresh,
    summaryBudgetExhausted: runtime.budget.isExhausted(session.id),
    disconnected: false,
    now
  });
  return {
    kind: "snapshot",
    schemaVersion: SCHEMA_VERSION,
    revision,
    sessionId: session.id,
    generatedAt: now,
    throughSeq: state?.lastSeq ?? -1,
    mode,
    coverage: {
      coreObservedSeq: state?.lastSeq ?? -1,
      evidenceIndexedSeq: state?.lastSeq ?? -1,
      summaryCoveredSeq: summaryFresh ? brief.throughSeq : -1,
      summaryFresh,
      summaryAuto: runtime.budget.autoEnabled(session.id),
      summaryBudgetExhausted: runtime.budget.isExhausted(session.id),
      historyAvailable: runtime.store.count(session.id) > 0
    },
    round:
      round === null
        ? null
        : {
            roundId: round.roundId,
            startedAt: round.startedAt,
            updatedAt: round.updatedAt,
            title: clip(round.title, LIMITS.title),
            statusLine: clip(status.line, LIMITS.statusText),
            statusKey: status.key,
            roundState: roundStateOf(round),
            runtimeState: runtime.connection === "offline" ? "disconnected" : round.reply === null ? "running" : "idle",
            goalState: state?.goal?.state ?? "unknown",
            verificationState: verification.state
          },
    brief: buildBrief(runtime, session.id, round, brief, summaryFresh, status),
    verification: shownVerification,
    outcomes: buildOutcomes(round),
    history: {
      count: runtime.store.count(session.id),
      hasMore: runtime.store.count(session.id) > LIMITS.historyPreview,
      items: runtime.store.recent(session.id, LIMITS.historyPreview)
    },
    notices: buildNotices(runtime, session.id, state, coverageGap)
  };
}

/**
 * The brief block: short-model lines when fresh, deterministic fact lines
 * otherwise. Both are the same shape so the client renders one list.
 *
 * @param {object} runtime - runtime wiring.
 * @param {string} sessionId - runtime session id.
 * @param {object|null} round - open round.
 * @param {object|undefined} brief - last published summary.
 * @param {boolean} fresh - whether the summary still covers `lastSeq`.
 * @param {{key: string, line: string}} status - chosen status.
 * @returns {object} brief payload.
 */
function buildBrief(runtime, sessionId, round, brief, fresh, status) {
  const revision = fresh ? brief.revision : `${sessionId}:${round?.roundId ?? "none"}:facts`;
  if (fresh) {
    return {
      revision,
      generatedAt: brief.generatedAt,
      mode: "summary",
      items: brief.items.slice(0, LIMITS.briefItems)
    };
  }
  // Facts mode: the status line is the first item so the screen is never empty,
  // then the most decision-relevant facts.
  const items = [{ id: "status", text: status.line, factIds: [], tone: "neutral" }];
  for (const fact of rankFacts(round)) {
    if (items.length > LIMITS.briefItems) break;
    items.push({ id: fact.id, text: fact.statement, factIds: [fact.id], tone: toneOf(fact) });
  }
  return { revision, generatedAt: runtime.now(), mode: "facts", items };
}

/**
 * Tone for one fact; purely visual, never a verdict.
 * @param {object} fact - stored fact.
 * @returns {"neutral"|"warn"|"error"|"success"} tone.
 */
function toneOf(fact) {
  if (fact.kind === "failure") return "error";
  if (fact.kind === "blocker") return "warn";
  if (fact.validity === "needsRecheck") return "warn";
  if (fact.kind === "deliverable") return "success";
  return "neutral";
}

/**
 * The three most recent results of the round.
 * @param {object|null} round - open round.
 * @returns {object} outcomes payload.
 */
function buildOutcomes(round) {
  const facts = rankFacts(round).filter((fact) => fact.kind === "deliverable" || fact.kind === "check" || fact.kind === "change");
  return {
    truncated: facts.length > LIMITS.outcomes,
    items: facts.slice(0, LIMITS.outcomes).map((fact) => ({
      id: fact.id,
      kind: fact.kind,
      text: fact.statement,
      factIds: [fact.id]
    }))
  };
}

/**
 * Coverage notices, bounded to two.
 *
 * @param {object} runtime - runtime wiring.
 * @param {string} sessionId - runtime session id.
 * @param {object|undefined} state - projection state.
 * @param {boolean} coverageGap - whether no event has been folded yet.
 * @returns {object[]} notices.
 */
function buildNotices(runtime, sessionId, state, coverageGap) {
  const notices = [];
  if (coverageGap) notices.push({ code: "no-data", text: "尚未收到本会话的记录" });
  if (runtime.connection === "offline") notices.push({ code: "disconnected", text: "连接已断开" });
  if (state?.goal?.state === "unknown") notices.push({ code: "goal-unknown", text: "目标状态暂不可知" });
  if (runtime.budget.isExhausted(sessionId)) notices.push({ code: "summary-paused", text: "自动摘要已暂停" });
  return notices.slice(0, LIMITS.notices);
}

/**
 * A revision string that changes whenever the visible content could change.
 *
 * @param {object} runtime - runtime wiring.
 * @param {object} session - runtime session.
 * @param {object|undefined} state - projection state.
 * @returns {string} revision.
 */
function snapshotRevision(runtime, session, state) {
  const brief = runtime.briefOf(session.id);
  const round = state?.round;
  return [
    state?.lastSeq ?? -1,
    round?.roundId ?? "none",
    round?.reply === null ? "open" : "archived",
    brief?.revision ?? "none",
    runtime.store.count(session.id),
    runtime.budget.isExhausted(session.id) ? "paused" : "ok"
  ].join(":");
}

/**
 * `GET /history` — one page of archived rounds.
 *
 * @param {object} runtime - runtime wiring.
 * @param {Request} request - incoming request.
 * @returns {Promise<Response>} history page.
 */
async function historyRoute(runtime, request) {
  const url = new URL(request.url);
  const session = await runtime.session(requiredParam(url, "session"));
  const limit = intParam(url, "limit", 10, 1, 20);
  const page = runtime.store.page(session.id, { cursor: url.searchParams.get("cursor") ?? undefined, limit });
  return json({ kind: "history", sessionId: session.id, items: page.items, nextCursor: page.nextCursor }, 200, HEADERS);
}

/**
 * `GET /round` — one archived round with its facts.
 *
 * @param {object} runtime - runtime wiring.
 * @param {Request} request - incoming request.
 * @returns {Promise<Response>} round detail.
 */
async function roundRoute(runtime, request) {
  const url = new URL(request.url);
  const session = await runtime.session(requiredParam(url, "session"));
  const roundId = requiredParam(url, "round");
  const archived = runtime.store.get(session.id, roundId);
  if (archived !== undefined) {
    return json(
      {
        kind: "round",
        revision: `${archived.archivedAt}:${archived.updatedAt}`,
        round: {
          roundId: archived.roundId,
          title: archived.title,
          startedAt: archived.startedAt,
          archivedAt: archived.archivedAt,
          roundState: "archived",
          runtimeState: archived.runtimeState,
          goalState: archived.goalState,
          verificationState: archived.verificationState,
          statusLine: archived.statusLine,
          facts: archived.facts,
          verification: archived.verification,
          outcomes: archived.outcomes
        }
      },
      200,
      HEADERS
    );
  }
  const state = runtime.stateOf(session);
  const round = state?.round;
  if (round !== null && round !== undefined && round.roundId === roundId) {
    const verification = evaluateVerification(round);
    const status = chooseStatus(state, round, {
      verificationState: verification.state,
      summaryFresh: false,
      summaryBudgetExhausted: false,
      disconnected: false,
      now: runtime.now()
    });
    return json(
      {
        kind: "round",
        revision: `${round.updatedAt}:open`,
        round: {
          roundId: round.roundId,
          title: clip(round.title, LIMITS.title),
          startedAt: round.startedAt,
          archivedAt: 0,
          roundState: roundStateOf(round),
          runtimeState: "running",
          goalState: state.goal?.state ?? "unknown",
          verificationState: verification.state,
          statusLine: status.line,
          facts: rankFacts(round).map(publicFact),
          verification,
          outcomes: buildOutcomes(round)
        }
      },
      200,
      HEADERS
    );
  }
  throw new OverviewError("bad-request", `unknown round "${clip(roundId, 80)}"`, 404);
}

/**
 * Project an internal fact onto the wire shape.
 * @param {object} fact - stored fact.
 * @returns {object} wire fact.
 */
function publicFact(fact) {
  return {
    id: fact.id,
    kind: fact.kind,
    statement: fact.statement,
    basis: fact.basis,
    validity: fact.validity,
    refs: (fact.refs ?? []).map((ref) => ({ seq: ref.seq, label: clip(ref.label, 60) }))
  };
}

/**
 * `GET /evidence` — the excerpts behind one fact.
 *
 * @param {object} runtime - runtime wiring.
 * @param {Request} request - incoming request.
 * @returns {Promise<Response>} evidence payload.
 */
async function evidenceRoute(runtime, request) {
  const url = new URL(request.url);
  const session = await runtime.session(requiredParam(url, "session"));
  const roundId = requiredParam(url, "round");
  const factId = requiredParam(url, "fact");
  const archived = runtime.store.get(session.id, roundId);
  let fact;
  if (archived !== undefined) {
    fact = (archived.facts ?? []).find((item) => item.id === factId);
    if (fact === undefined) {
      // Facts past the round's own bound are still reachable through the fact id
      // check below, but their excerpts were never retained.
      throw new OverviewError("bad-request", "unknown fact", 404);
    }
  } else {
    const state = runtime.stateOf(session);
    const round = state?.round;
    if (round === null || round === undefined || round.roundId !== roundId) {
      throw new OverviewError("bad-request", "unknown round", 404);
    }
    fact = round.facts.find((item) => item.id === factId);
    if (fact === undefined) throw new OverviewError("bad-request", "unknown fact", 404);
  }
  const refs = [];
  for (const ref of (fact.refs ?? []).slice(0, LIMITS.factRefs)) {
    const event = session.eventAt?.(ref.seq);
    refs.push({
      seq: ref.seq,
      type: event?.type ?? "unknown",
      label: clip(ref.label ?? "", 60),
      excerpt: clip(excerptOf(event), LIMITS.excerpt)
    });
  }
  return json({ kind: "evidence", sessionId: session.id, roundId, fact: publicFact(fact), refs }, 200, HEADERS);
}

/**
 * One bounded plain-text line for an evidence reference. Tool payloads and
 * reasoning are never reproduced; only what a reader could already see.
 *
 * @param {object|undefined} event - session event.
 * @returns {string} excerpt text.
 */
export function excerptOf(event) {
  if (event === undefined || event === null) return "";
  const data = event.data ?? {};
  switch (event.type) {
    case "user/message":
    case "assistant/message":
      return blocksText(data.message?.content);
    case "tool/call":
      return `${data.name ?? "tool"} ${clip(typeof data.arguments === "string" ? data.arguments : "", 300)}`;
    case "tool/result":
      return blocksText(data.message?.content) || data.error?.code || "";
    case "todo/write": {
      const todos = Array.isArray(data.todos) ? data.todos : [];
      return todos.map((todo) => `${todo.status === "completed" ? "[x]" : "[ ]"} ${todo.text ?? ""}`).join(" ");
    }
    case "goal/change":
      return data.operation === "clear" ? "goal cleared" : data.goal?.objective ?? data.operation ?? "";
    case "job/registered":
    case "job/settled":
      return [data.job?.kind, data.job?.status, data.outcome?.status].filter(Boolean).join(" ");
    case "approval/asked":
      return `${data.toolName ?? "tool"} ${data.reason ?? ""}`;
    case "approval/decided":
      return String(data.outcome ?? "");
    default:
      return "";
  }
}

/**
 * Visible text of a content-block list.
 * @param {unknown} content - content blocks.
 * @returns {string} joined text.
 */
function blocksText(content) {
  if (!Array.isArray(content)) return "";
  const parts = [];
  for (const block of content) {
    if (block?.type === "text" && typeof block.text === "string") parts.push(block.text);
  }
  return clip(parts.join(" "), 600);
}

/**
 * `POST /summary/request` — ask the scheduler for one summary. The answer is
 * always a verdict, never a summary: the next snapshot carries the result.
 *
 * @param {object} runtime - runtime wiring.
 * @param {Request} request - incoming request.
 * @returns {Promise<Response>} queued, or a skip reason.
 */
async function summaryRequestRoute(runtime, request) {
  const body = await readJsonBody(request);
  const session = await runtime.session(requiredField(body, "session"));
  const verdict = await runtime.requestSummary(session, { manual: true });
  return json(verdict, 200, HEADERS);
}

/**
 * `POST /summary/auto` — the "keep following" switch of one session.
 *
 * @param {object} runtime - runtime wiring.
 * @param {Request} request - incoming request.
 * @returns {Promise<Response>} the new state.
 */
async function summaryAutoRoute(runtime, request) {
  const body = await readJsonBody(request);
  const session = await runtime.session(requiredField(body, "session"));
  const enabled = body.enabled === true;
  runtime.setAuto(session.id, enabled);
  return json({ kind: "auto", enabled }, 200, HEADERS);
}

/**
 * `POST /lease` — acquire, renew, or release the visibility lease.
 *
 * @param {object} runtime - runtime wiring.
 * @param {Request} request - incoming request.
 * @returns {Promise<Response>} lease state, or the documented limit error.
 */
async function leaseRoute(runtime, request) {
  const body = await readJsonBody(request);
  const session = await runtime.session(requiredField(body, "session"));
  const leaseId = typeof body.leaseId === "string" && body.leaseId !== "" ? clip(body.leaseId, 64) : "";
  if (leaseId === "") return failure("bad-request", "leaseId is required", 400);
  try {
    const lease = runtime.leases.touch(session.id, leaseId, body.visible !== false);
    return json({ kind: "lease", ...lease }, 200, HEADERS);
  } catch (error) {
    if (error?.code === "lease/limit") return failure("lease/limit", "too many concurrent views", 429);
    throw error;
  }
}
