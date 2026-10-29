/**
 * The seven exact Fetch routes, and nothing else.
 *
 * Every handler here is a pure projection of state that already exists: rounds
 * folded by the reducer, rounds archived in the store, and the last published
 * short summary. No read handler ever starts a model call — a read that could
 * start one is a read that can fail under load — so the mutating routes exist
 * only to ask for one summary and to flip the per-session switch.
 */

import { spawnSync } from "node:child_process";
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
import { chooseStatus, evaluateVerification, rankFacts, readableTitle, roundStateOf, summarizeRound } from "./rounds.js";

/** Response headers shared by every answer; nothing here is cacheable. */
const HEADERS = Object.freeze({ "cache-control": "no-store" });

/** Findings that earn a line of their own before the work log does. */
const RESULT_ITEMS = 2;

/**
 * Build the route table for one runtime.
 *
 * @param {object} runtime - the runtime wiring described in `index.js`.
 * @returns {object[]} Fetch route registrations.
 */
export function createRoutes(runtime) {
  return [
    {
      path: ROUTES.snapshot, // ui-copy-ignore
      methods: ["GET"], // ui-copy-ignore
      requestBody: "buffered",
      fetch: (request) => guarded((req) => snapshotRoute(runtime, req), runtime.warn)(request)
    },
    {
      path: ROUTES.history, // ui-copy-ignore
      methods: ["GET"], // ui-copy-ignore
      requestBody: "buffered",
      fetch: (request) => guarded((req) => historyRoute(runtime, req), runtime.warn)(request)
    },
    {
      path: ROUTES.round, // ui-copy-ignore
      methods: ["GET"], // ui-copy-ignore
      requestBody: "buffered",
      fetch: (request) => guarded((req) => roundRoute(runtime, req), runtime.warn)(request)
    },
    {
      path: ROUTES.evidence, // ui-copy-ignore
      methods: ["GET"], // ui-copy-ignore
      requestBody: "buffered",
      fetch: (request) => guarded((req) => evidenceRoute(runtime, req), runtime.warn)(request)
    },
    {
      path: ROUTES.summaryRequest,
      methods: ["POST"], // ui-copy-ignore
      requestBody: "buffered",
      fetch: (request) => guarded((req) => summaryRequestRoute(runtime, req), runtime.warn)(request)
    },
    {
      path: ROUTES.enable, // ui-copy-ignore
      methods: ["POST"], // ui-copy-ignore
      requestBody: "buffered",
      fetch: (request) => guarded((req) => enableRoute(runtime, req), runtime.warn)(request)
    },
    {
      path: ROUTES.open, // ui-copy-ignore
      methods: ["POST"], // ui-copy-ignore
      requestBody: "buffered",
      fetch: (request) => guarded((req) => openRoute(runtime, req), runtime.warn)(request)
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
  // A saved conversation is folded for reading whether or not recording is
  // switched on: opening it must show what already happened. Folding writes
  // nothing and starts no model call, so the switch still governs recording
  // only. A brand-new conversation has no events to fold and stays empty.
  const state = runtime.hasHistory(session) ? runtime.stateOf(session) : null;
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
/** A heading is read at a glance: one clause, not the whole request. */
const HEADLINE_MAX = 42; // ui-copy-ignore

/**
 * Turn a full request or goal sentence into a heading.
 *
 * @param {unknown} value - candidate text.
 * @returns {string} one short line, empty when there is nothing to show.
 */
function headlineOf(value) {
  const flat = typeof value === "string" ? value.replace(/\s+/gu, " ").trim() : "";
  if (flat === "") return "";
  const clause = flat.split(/[：:；;]/u)[0] ?? flat;
  const pick = clause.length >= 6 ? clause : flat;
  return clip(pick, HEADLINE_MAX);
}

/**
 * A heading a person can read: the stored title, else the goal objective, else
 * nothing. Machine markup such as `<goal_round>` is a payload tag, not a title.
 *
 * @param {string} stored - the round title already accepted from an event.
 * @param {unknown} objective - the goal objective, possibly raw.
 * @returns {string} a headline, or "" when neither source is readable.
 */
function titleFrom(stored, objective) {
  const own = headlineOf(readableTitle(stored));
  if (own !== "") return own;
  return headlineOf(readableTitle(objective));
}

export function buildSnapshot(runtime, session, state, revision) {
  const now = runtime.now();
  // A reply seals the turn: `state.round` turns null and `state.settled` keeps
  // the finished round. Show it until the next turn starts, instead of an empty
  // wait screen between turns.
  const open = state?.round ?? null;
  const round = open ?? state?.settled?.round ?? null;
  const brief = runtime.briefOf(session.id);
  const summaryFresh = brief !== undefined && round !== null && brief.roundId === round.roundId && brief.throughSeq === state.lastSeq;
  const mode = summaryFresh ? "summary" : "facts";
  const enabled = runtime.isEnabled(session);
  const readOnly = session?.archived === true || (!enabled && (state?.lastSeq ?? -1) >= 0);
  const coverageGap = (state?.lastSeq ?? -1) < 0;
  const verification = evaluateVerification(round, { coverageGap: false });
  const shownVerification = {
    state: verification.state,
    truncated: verification.conditions.length > LIMITS.shownConditions,
    conditions: verification.conditions.slice(0, LIMITS.shownConditions)
  };
  const status = readOnly
    ? { key: "archived", line: "已保存", tone: "neutral" }
    : chooseStatus(state ?? { approvals: {}, jobs: {} }, round, {
        verificationState: verification.state,
        summaryFresh,
        disconnected: false,
        now
      });
  return {
    kind: "snapshot", // ui-copy-ignore
    schemaVersion: SCHEMA_VERSION,
    revision,
    sessionId: session.id,
    generatedAt: now,
    throughSeq: state?.lastSeq ?? -1,
    mode,
    agent: agentOf(session), // ui-copy-ignore
    sessionTitle: conversationTitleOf(state, round),
    goal: { // ui-copy-ignore
      state: state?.goal?.state ?? "none",
      objective: clip(readableTitle(state?.goal?.objective), LIMITS.goalStatement)
    },
    coverage: { // ui-copy-ignore
      coreObservedSeq: state?.lastSeq ?? -1,
      evidenceIndexedSeq: state?.lastSeq ?? -1,
      summaryCoveredSeq: summaryFresh ? brief.throughSeq : -1,
      summaryFresh,
      enabled,
      readOnly,
      archived: session?.archived === true,
      historyAvailable: runtime.store.count(session.id) > 0
    },
    round:
      round === null
        ? null
        : {
            roundId: round.roundId,
            startedAt: round.startedAt,
            updatedAt: round.updatedAt,
            title: titleFrom(round.title, state?.goal?.objective),
            // The round's own heading, without the goal fallback: the goal has
            // its own line and must not read as the name of the round.
            ownTitle: titleFrom(round.title, ""),
            statusLine: clip(status.line, LIMITS.statusText),
            statusKey: status.key,
            statusTone: status.tone ?? "neutral",
            elapsedMs: Math.max(0, (open === null ? round.archivedAt ?? round.updatedAt : now) - round.startedAt),
            contentAt: summaryFresh ? brief.generatedAt : round.updatedAt,
            roundState: session.archived === true ? "archived" : roundStateOf(round),
            runtimeState:
              session.archived === true
                ? "idle"
                : runtime.connection === "offline"
                  ? "disconnected"
                  : round.reply === null
                    ? "running"
                    : "idle",
            goalState: state?.goal?.state ?? "unknown",
            verificationState: verification.state
          },
    brief: state !== null && state !== undefined
      ? buildBrief(runtime, session.id, round, brief, summaryFresh, status, readOnly, state?.reply?.text ?? state?.lastAssistant?.text)

      : { revision: `${session.id}:off`, generatedAt: now, mode: "facts", items: [] },
    verification: shownVerification,
    outcomes: buildOutcomes(round),
    history: historyOf(runtime, session, round, state),
    notices: state !== null && state !== undefined ? buildNotices(runtime, session.id, state, coverageGap) : []
  };
}

/** Agent preset ids are the stored truth; the page only needs a readable name. */
const AGENT_NAMES = Object.freeze({
  cordis: "Cordis", // ui-copy-ignore
  standard: "DSH", // ui-copy-ignore
  minimal: "Minimal", // ui-copy-ignore
  ptc: "PTC" // ui-copy-ignore
});

/**
 * Who is speaking, from the session header. No header field is invented: an
 * unknown preset keeps its id, and a session without one signs as the harness.
 *
 * @param {object} session - runtime session.
 * @returns {{id: string, name: string, initial: string}} agent identity.
 */
function agentOf(session) {
  const raw = session?.header?.agentPreset;
  const id = typeof raw === "string" && raw.trim() !== "" ? raw.trim() : "";
  const name = AGENT_NAMES[id] ?? (id === "" ? "DSH" : id);
  const initial = [...name][0] ?? "D";
  return { id, name, initial: initial.toUpperCase() };
}

/**
 * The conversation's own title. A stored session title wins; otherwise the
 * current round heading already came from the reader's request.
 *
 * @param {object|undefined} state - projection state.
 * @param {object|null} round - shown round.
 * @returns {string} one line, empty when neither source exists.
 */
function conversationTitleOf(state, round) {
  return titleFrom(state?.sessionTitle ?? "", state?.goal?.objective)
    || titleFrom(round?.title ?? "", state?.goal?.objective)
    || "本次任务";
}

/**
 * The archived rounds behind the current one.
 *
 * The newest completed round is what the panel already shows, so it is not a
 * "previous round": listing it in 历史 as well made one result look like two.
 *
 * @param {object} runtime - runtime wiring.
 * @param {object} session - runtime session.
 * @param {object|null} round - the round the panel shows.
 * @returns {{count: number, hasMore: boolean, items: object[]}} history block.
 */
function historyOf(runtime, session, round, state) {
  const total = runtime.store.count(session.id);
  const recent = runtime.store.recent(session.id, LIMITS.historyPreview + 1);
  let items = round === null ? recent : recent.filter((item) => item.roundId !== round.roundId);
  let count = Math.max(0, total - (recent.length - items.length));
  // A session that was never recorded still folded its rounds in memory; they
  // are the only history it has, so show them without writing anything. The
  // same holds for a live session while the overview is off: nothing was ever
  // stored, but the reader still asked what came before this round.
  if (total === 0 && Array.isArray(state?.recentRounds)) {
    items = state.recentRounds
      .filter((item) => item !== null && item !== undefined && item.roundId !== round?.roundId)
      .map(summarizeRound);
    count = items.length;
  }
  return { count, hasMore: count > LIMITS.historyPreview, items: items.slice(0, LIMITS.historyPreview) };
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
function buildBrief(runtime, sessionId, round, brief, fresh, status, readOnly = false, fallbackText = "") {
  const revision = fresh ? brief.revision : `${sessionId}:${round?.roundId ?? "none"}:facts`;
  if (fresh) {
    const items = (Array.isArray(brief.topics) ? brief.topics : [])
      .slice(0, LIMITS.briefItems)
      .map((topic) => {
        const factIds = Array.isArray(topic.factIds) ? topic.factIds : [];
        const details = Array.isArray(topic.details) ? topic.details : [];
        const matched = toneOfStatement(`${topic.headline ?? ""} ${details.join(" ")}`, round);
        const item = { id: topic.id, factIds, source: "model", urgent: false };
        item.text = topic.headline;
        item.limit = topic.qualifier ?? "";
        item.detail = details.map((line) => ({ label: "", value: line }));
        item.evidence = evidenceOfFacts(round, factIds);
        item.tone = matched.tone ?? "neutral";
        // A summary replaces the fact lines, so it must not lose the one thing a
        // reader can click: the file the topic is about.
        const delivered = deliveredPathOf(round, factIds);
        if (delivered !== "") item.link = { path: delivered, label: topic.headline };
        return item;
      })
      .filter((item) => typeof item.text === "string" && item.text.length > 0);
    const shown = uniqueItems(items);
    if (shown.length === 0) shown.push(noFactsItem());
    return { revision, generatedAt: brief.generatedAt, mode: "summary", items: shown };
  }
  // Facts mode: only what a reader can act on. Edits and passing checks are how
  // the work happened, not what came of it, so they stay off the screen until
  // the summary names the outcome.
  const items = [];
  for (const fact of rankFacts(round)) {
    if (items.length >= RESULT_ITEMS) break;
    if (fact.kind === "change") {
      // One line for the edits themselves, so a round that is still all work and
      // no conclusion says what changed instead of claiming nothing happened.
      const changed = briefItemOf(fact, round);
      if (changed !== null) items.push(changed);
      continue;
    }
    const item = briefItemOf(fact, round);
    if (item !== null) items.push(item);
  }
  const shown = uniqueItems(items);
  if (shown.length === 0 && readOnly === true) {
    // A read-only transcript may hold no tool facts at all. Its closing reply is
    // still the one thing the reader came for, so name it instead of the empty
    // "no conclusion" line. It is quoted, never rewritten.
    const closing = closingLineOf(round?.reply?.text ?? fallbackText);
    if (closing !== "") {
      shown.push({
        id: "conclusion", // ui-copy-ignore
        label: round?.reply === null || round?.reply === undefined ? "最近回复" : "结论",
        value: closing, // ui-copy-ignore
        source: "transcript", // ui-copy-ignore
        factIds: [], // ui-copy-ignore
        evidence: [] // ui-copy-ignore
      });
    }
  }
  if (shown.length === 0) shown.push(noFactsItem());
  return { revision, generatedAt: runtime.now(), mode: "facts", items: shown };
}

/**
 * The first useful line of a closing reply, stripped of markdown ornament.
 *
 * @param {string|undefined} text - assistant reply text.
 * @returns {string} one bounded line, or "".
 */
function closingLineOf(text) {
  const lines = String(text ?? "").split("\n");
  for (const raw of lines) {
    const line = raw
      .replace(/^\s*(?:```|>|#{1,6}\s*|[-*+•]\s+|\d+[.、)]\s*)/u, "")
      .replace(/[*_`]/gu, "")
      .trim();
    if (line.length >= 4) return clip(line, LIMITS.factStatement);
  }
  return "";
}

/**
 * Drop rows that restate another row. A model may write the same headline twice
 * from two fact ids, and the reader sees one finding listed twice.
 *
 * @param {object[]} items - brief rows.
 * @returns {object[]} rows with duplicate text removed.
 */
function uniqueItems(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = plainSentence(item.text ?? "");
    if (key === "" || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Turn one stored fact into a brief row: a conclusion a reader can use, the
 * qualifier that limits it, and the detail shown only when expanded.
 *
 * Facts that merely prove work happened (an assertion in a reply) never become
 * a conclusion of their own; they stay reachable as evidence.
 *
 * @param {object} fact - stored fact.
 * @param {object|null} round - open round.
 * @returns {object|null} brief item, or null when it does not belong on screen.
 */

function briefItemOf(fact, round) {
  if (fact.kind === "report") return null;
  const item = (text, limit, detail, tone, urgent = false) =>
    ({ id: fact.id, factIds: [fact.id], source: "rule", text, limit, detail, tone, urgent, evidence: evidenceOfFacts(round, [fact.id]) });
  const sentence = shortStatement(sanitizeBriefText(fact.statement));
  if (fact.kind === "check") {
    // Only a failed check is a finding. A check that passed — stale or not — is
    // proof for a claim: it stays in 依据 and never takes a line of its own.
    if (!checkFailed(fact.statement)) return null;
    return item(checkFailureLine(fact), fact.validity === "needsRecheck" ? "改动后尚未复验" : "", [], "error");
  }
  if (fact.kind === "change") {
    // Defensive: facts mode skips edits before reaching here, but a stored round
    // may still hand one in. The line names the work, never a source file name.
    const stale = round !== null && (round.checksStaleAt ?? 0) >= (fact.createdAt ?? 0);
    return item(changeLineOf(fact), stale ? "已有改动 先前验证需重跑" : "", fileRowsOf(fact), "neutral");
  }
  if (fact.kind === "deliverable") {
    const row = item(sentence, "", [], "success");
    const path = (Array.isArray(fact.files) ? fact.files : []).find((file) => typeof file === "string" && file !== "");
    if (path !== undefined) row.link = { path, label: sentence };
    return row;
  }
  if (fact.kind === "interruption") return item(sentence, "", [], "neutral");
  if (fact.kind === "blocker") return item(sentence, "", [], "warn", true);
  if (fact.kind === "failure") return item(sentence, "", [], "error", true);
  return null;
}

/**
 * Say what a change touched in words the reader can place. Basenames, not full
 * paths: the path list is evidence, and a bare count is not a result.
 *
 * @param {object} fact - change fact with a `files` list.
 * @returns {string} one line.
 */
function changeLineOf(fact) {
  const names = (Array.isArray(fact.files) ? fact.files : []).map(String).filter((file) => file !== "");
  if (names.length === 0) return "";
  const kinds = new Set(names.map((file) => {
    if (/\.(?:md|mdx|txt|pdf|docx?|xlsx?|pptx?)$/iu.test(file)) return "doc";
    if (/\.(?:css|scss|less|html?)$/iu.test(file)) return "ui";
    if (/\.(?:png|jpe?g|webp|gif|svg|mp4|mov|webm|mp3|wav)$/iu.test(file)) return "media";
    return "code";
  }));
  if (kinds.size === 1 && kinds.has("doc")) return "更新了文档";
  if (kinds.size === 1 && kinds.has("ui")) return "更新了界面样式";
  if (kinds.size === 1 && kinds.has("media")) return "更新了素材";
  return "更新了实现";
}

/**
 * The files behind one change, shown only when a reader expands the line.
 *
 * @param {object} fact - change fact with a `files` list.
 * @returns {object[]} detail rows, at most one.
 */
function fileRowsOf(fact) {
  const names = (Array.isArray(fact.files) ? fact.files : [])
    .map((file) => String(file).split("/").filter((part) => part !== "").pop() ?? "")
    .filter((name) => name !== "");
  if (names.length === 0) return [];
  const shown = names.slice(0, 8).join("、");
  return [{ label: "文件", value: names.length > 8 ? `${shown} 等 ${names.length} 个` : shown }];
}

/**
 * Name a failed verification by its kind. The subject of a check fact carries
 * the kind and the target the runner saw; only the kind belongs on screen.
 *
 * @param {object} fact - failed check fact.
 * @returns {string} one line.
 */
function checkFailureLine(fact) {
  const found = /^topic:([a-z]+):/u.exec(typeof fact.subject === "string" ? fact.subject : "");
  const label = found === null ? "验证" : CHECK_FAILURE_LABELS[found[1]] ?? "验证";
  return `${label}未通过`;
}

/**
 * A sentence reduced to the characters that carry meaning, so punctuation and
 * spacing cannot hide the fact a model line came from.
 *
 * @param {string} text - any short claim.
 * @returns {string} comparable text.
 */
function plainSentence(text) {
  return String(text ?? "").replace(/[\s。！？；：，、.!?;:,]/gu, "").trim();
}

/**
 * Recover the colour a model line deserves from the fact it was written from.
 * A green line therefore always points at a check that really passed, instead of
 * at the model's own optimism.
 *
 * @param {string} text - one model-written brief line.
 * @param {object} round - the round those facts belong to.
 * @returns {{tone?: string, limit?: string}} colour and qualifier, if any.
 */
function toneOfStatement(text, round) {
  const line = plainSentence(text);
  if (line.length < 4) return {};
  const tokens = tokensOf(line);
  const facts = Array.isArray(round?.facts) ? round.facts : [];
  for (const fact of facts) {
    const claim = plainSentence(fact.statement);
    if (claim.length < 4) continue;
    // The same verdict may be worded by what ran rather than by the target, and
    // that wording never becomes stored text: it only decides the colour.
    if (fact.kind === "check" && sameVerdict(line, claim)) {
      const words = CHECK_KIND_WORDS[checkKindOf(fact)] ?? [];
      if (words.some((word) => line.toLowerCase().includes(word))) return factTone(fact, round);
    }
    if (line.includes(claim) || claim.includes(line)) return factTone(fact, round);
    // A model line may add one word ("Lint 检查通过" for the fact "Lint 通过"), so
    // the fact is the one sharing at least two meaningful tokens.
    const sharedTokens = [...tokensOf(claim)].filter((token) => tokens.has(token)); // ui-copy-ignore
    if (sharedTokens.length >= 2) {
      const broad = briefItemOf(fact, round);
      if (broad !== null) return factTone(fact, round);
      continue;
    }
    // A check paraphrased down to its subject ("Build 失败" for "Build 未通过")
    // keeps one shared word; the verdict decides the colour, never the model's
    // wording alone. // ui-copy-ignore
    if (sharedTokens.length === 1 && fact.kind === "check" && sameVerdict(line, claim)) {
      return factTone(fact, round);
    }
  }
  return {};
}

/**
 * Whether a paraphrase and a check fact name the same outcome. Both must carry
 * a verdict word, and the words must agree.
 *
 * @param {string} line - normalised model line.
 * @param {string} claim - normalised fact statement.
 * @returns {boolean} true when both say pass, or both say fail.
 */
const FAILING_WORDS = /未通过|失败|错误|报错|不通过|exit\s*(?:code\s*)?[1-9]/iu;

/**
 * Whether a stored check fact records a failure. The statement is written by this
 * plugin, so a failed run always carries its verdict words or a non-zero exit.
 *
 * @param {string} statement - check fact statement.
 * @returns {boolean} true when the check failed.
 */
function checkFailed(statement) {
  return FAILING_WORDS.test(String(statement ?? ""));
}

function sameVerdict(line, claim) {
  const failing = FAILING_WORDS;
  const passing = /通过|成功|pass/iu;
  const lineFailed = failing.test(line);
  const linePassed = passing.test(line);
  if (!lineFailed && !linePassed) return false;
  const claimFailed = failing.test(claim) || claim.includes("未通过");
  const claimPassed = passing.test(claim) && !claimFailed;
  return lineFailed === claimFailed && linePassed === claimPassed;
}

/**
 * The presentation a fact already earned in facts mode.
 *
 * @param {object} fact - the source fact.
 * @param {object} round - its round.
 * @returns {{tone?: string, limit?: string, detail?: object[]}} colour, qualifier, detail.
 */
function factTone(fact, round) {
  const item = briefItemOf(fact, round);
  if (item === null) return {};
  const out = { tone: item.tone, detail: item.detail };
  if (item.limit !== "") out.limit = item.limit;
  return out;
}

/**
 * Meaningful pieces of a short claim: Latin words plus two-character Chinese
 * runs, which is enough to tell "Lint 通过" from "已修改 3 个文件".
 *
 * @param {string} text - normalised sentence.
 * @returns {Set<string>} tokens.
 */
/** Words a reader may use for each kind of check, used only to match a model line. */
const CHECK_KIND_WORDS = Object.freeze({
  build: ["构建", "编译", "build"],
  test: ["测试", "test", "tests"],
  lint: ["lint"],
  typecheck: ["类型检查", "类型", "typecheck", "tsc"]
});

/**
 * Read the internal kind a check fact groups under.
 *
 * @param {object} fact - stored fact.
 * @returns {string} the kind, or "" when the subject carries none.
 */
function checkKindOf(fact) {
  const match = /^topic:([a-z]+):/u.exec(String(fact?.subject ?? ""));
  return match === null ? "" : match[1];
}

function tokensOf(text) {
  const out = new Set();
  for (const word of String(text).match(/[a-zA-Z0-9.]+/gu) ?? []) out.add(word.toLowerCase());
  const han = String(text).match(/[\u4e00-\u9fa5]+/gu) ?? [];
  for (const run of han) {
    for (let index = 0; index + 2 <= run.length; index += 1) out.add(run.slice(index, index + 2));
  }
  return out;
}

/**
 * The single honest row for a round with nothing reportable yet.
 * @returns {object} brief item.
 */
/** How a fact reached the record, in the reader's words. */
const EVIDENCE_LABELS = Object.freeze({ intent: "计划", reported: "汇报", observed: "观察" });

// A failed check is reported by the kind of verification, never by the runner
// or the file it happened to run: 「自动测试未通过」 is a finding, a file name
// is an implementation detail.
const CHECK_FAILURE_LABELS = Object.freeze({ lint: "代码检查", typecheck: "类型检查", build: "构建", test: "自动测试", check: "验证" });

/**
 * The facts a topic cited, as short source rows. A topic that cites nothing never
 * reaches this function: verification already dropped it.
 *
 * @param {object|null} round - the round those facts belong to.
 * @param {string[]} factIds - cited fact ids.
 * @returns {{label: string, text: string}[]} source rows.
 */
/**
 * The one delivered file a set of facts points at, if any.
 *
 * @param {object} round - the round those facts belong to.
 * @param {string[]} factIds - facts the row cites.
 * @returns {string} an absolute path, or "" when the row delivered nothing.
 */
function deliveredPathOf(round, factIds) {
  const list = round?.facts instanceof Map ? [...round.facts.values()] : Array.isArray(round?.facts) ? round.facts : [];
  const wanted = new Set(factIds);
  for (const fact of list) {
    if (!wanted.has(fact.id) || fact.kind === "check") continue;
    const files = Array.isArray(fact.files) ? fact.files : [];
    const path = files.find((file) => typeof file === "string" && file !== "");
    if (path !== undefined) return path;
  }
  return "";
}

function evidenceOfFacts(round, factIds) {
  const list = round?.facts instanceof Map ? [...round.facts.values()] : Array.isArray(round?.facts) ? round.facts : [];
  const facts = new Map(list.map((fact) => [fact.id, fact]));
  const rows = [];
  for (const id of factIds) {
    const fact = facts.get(id);
    if (fact === undefined) continue;
    if (fact.kind === "check") continue;
    const category = fact.kind === "intent" || fact.kind === "goal"
      ? "intent"
      : fact.kind === "report" || fact.kind === "activity"
        ? "reported"
        : "observed";
    rows.push({ label: EVIDENCE_LABELS[category], text: clip(sanitizeBriefText(fact.statement), 240) });
  }
  return rows;
}

// A round that is still working has not failed to produce anything: saying so
// would report the wait itself as a result.
function noFactsItem() {
  return { id: "no-facts", label: "结论", value: "尚未形成结论", factIds: [], source: "rule", text: "", limit: "", detail: [], tone: "neutral", urgent: false, evidence: [] };
}

/**
 * Remove shell lines and paths that crept into a claim, because a command is not
 * a result. The full text stays available as evidence.
 * @param {string} text - candidate statement.
 * @returns {string} a sentence.
 */
function sanitizeBriefText(text) {
  const one = String(text ?? "").split("\n")[0].trim();
  const cut = one.split(/[：:]\s*(?:cd|npm|pnpm|npx|node|python3?|bash|git|curl)\b/u)[0];
  const clean = cut.replace(/`[^`]*`/gu, "").replace(/\s{2,}/gu, " ").trim();
  return clip(clean === "" ? "有新的结果" : clean, 120);
}

/**
 * Tone for one fact; purely visual, never a verdict.
 * @param {object} fact - stored fact.
 * @returns {"neutral"|"warn"|"error"|"success"} tone.
 */
function toneOf(fact) {
  if (fact.kind === "failure") return "error";
  if (fact.kind === "blocker") return "warn";
  if (fact.kind === "interruption") return "neutral";
  if (fact.validity === "needsRecheck") return "warn";
  if (fact.kind === "deliverable" || fact.kind === "check") return "success";
  return "neutral";
}

/**
 * The three most recent results of the round.
 * @param {object|null} round - open round.
 * @returns {object} outcomes payload.
 */
function buildOutcomes(round) {
  const seen = new Set();
  const facts = rankFacts(round).filter((fact) => {
    if (fact.kind !== "deliverable") return false;
    if (artifactTargetOf(fact) === null) return false;
    const key = plainSentence(fact.statement ?? "");
    if (key === "" || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return {
    truncated: facts.length > LIMITS.outcomes,
    items: facts.slice(0, LIMITS.outcomes).map((fact) => {
      const item = {
        id: fact.id, // ui-copy-ignore
        kind: fact.kind, // ui-copy-ignore
        text: fact.statement, // ui-copy-ignore
        factIds: [fact.id] // ui-copy-ignore
      };
      const target = artifactTargetOf(fact);
      if (target?.url !== undefined) item.link = { url: target.url, label: fact.statement };
      else if (target?.path !== undefined) item.link = { path: target.path, label: fact.statement };
      return item;
    })
  };
}

/** Files a reader thinks of as an artifact: a document, report, archive, or media. */
const ARTIFACT_PATH_RE = /\.(?:md|mdx|pdf|docx?|xlsx?|pptx?|key|pages|numbers|zip|tgz|tar\.gz|png|jpe?g|webp|gif|svg|mp4|mov|webm|mp3|wav|html?)$/iu;

/**
 * Where a delivered artifact can be opened, if it is one.
 *
 * A single source file is not a deliverable a reader wants on this list, and a
 * check that printed "通过" is evidence, not an artifact. Only a document-level
 * file or a commit URL qualifies.
 *
 * @param {object} fact - deliverable fact.
 * @returns {{url: string}|{path: string}|null} open target.
 */
function artifactTargetOf(fact) {
  const url = typeof fact.url === "string" && /^https:\/\//u.test(fact.url) ? fact.url : "";
  if (url !== "") return { url };
  const files = Array.isArray(fact.files) ? fact.files : [];
  const path = files.find((file) => typeof file === "string" && ARTIFACT_PATH_RE.test(file));
  if (path !== undefined) return { path };
  if (typeof fact.subject === "string" && ARTIFACT_PATH_RE.test(fact.subject) && files.length === 1) return { path: files[0] };
  return null;
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
    runtime.isEnabled(session) ? "on" : "off",
    session?.archived === true || (!runtime.isEnabled(session) && (state?.lastSeq ?? -1) >= 0) ? "read-only" : "live"
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
  const exclude = url.searchParams.get("exclude") ?? "";
  const page = runtime.store.page(session.id, { cursor: url.searchParams.get("cursor") ?? undefined, limit });
  let items = exclude === "" ? page.items : page.items.filter((item) => item.roundId !== exclude);
  let nextCursor = page.nextCursor;
  if (items.length === 0) {
    const state = runtime.stateOf(session);
    const rounds = Array.isArray(state?.recentRounds) ? state.recentRounds : [];
    if (rounds.length > 0) {
      items = rounds.filter((item) => item.roundId !== exclude).map(summarizeRound).slice(0, limit);
      nextCursor = null;
    }
  }
  return json({ kind: "history", sessionId: session.id, items, nextCursor }, 200, HEADERS);
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
        kind: "round", // ui-copy-ignore
        revision: `${archived.archivedAt}:${archived.updatedAt}`,
        round: { // ui-copy-ignore
          roundId: archived.roundId, // ui-copy-ignore
          title: headlineOf(archived.title), // ui-copy-ignore
          startedAt: archived.startedAt,
          archivedAt: archived.archivedAt,
          roundState: "archived",
          runtimeState: archived.runtimeState,
          goalState: archived.goalState,
          verificationState: archived.verificationState,
          statusLine: archived.statusLine,
          brief: buildBrief(runtime, session.id, archived, undefined, false, archived.verificationState), // ui-copy-ignore
          facts: archived.facts, // ui-copy-ignore
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
    const readOnly = session?.archived === true;
    const verification = evaluateVerification(round);
    const status = chooseStatus(state, round, {
      verificationState: verification.state,
      summaryFresh: false,
      disconnected: false,
      now: runtime.now() // ui-copy-ignore
    });
    return json(
      {
        kind: "round", // ui-copy-ignore
        revision: `${round.updatedAt}:${readOnly ? "saved" : "open"}`,
        round: { // ui-copy-ignore
          roundId: round.roundId, // ui-copy-ignore
          title: headlineOf(round.title),
          startedAt: round.startedAt,
          archivedAt: readOnly ? round.updatedAt : 0,
          roundState: readOnly ? "archived" : roundStateOf(round),
          runtimeState: readOnly ? "idle" : "running",
          goalState: state.goal?.state ?? "unknown",
          verificationState: verification.state,
          statusLine: readOnly ? "已保存" : status.line,
          facts: rankFacts(round).map(publicFact),
          verification,
          outcomes: buildOutcomes(round)
        }
      },
      200,
      HEADERS
    );
  }
  {
    const state = runtime.stateOf(session);
    const folded = Array.isArray(state?.recentRounds)
      ? state.recentRounds.find((item) => item !== null && item !== undefined && item.roundId === roundId)
      : undefined;
    if (folded !== undefined) {
      const verification = evaluateVerification(folded);
      return json(
        {
          kind: "round", // ui-copy-ignore
          revision: `${folded.updatedAt}:saved`,
          round: { // ui-copy-ignore
            roundId: folded.roundId, // ui-copy-ignore
            title: headlineOf(folded.title),
            startedAt: folded.startedAt,
            archivedAt: folded.archivedAt,
            roundState: "archived",
            runtimeState: "idle",
            goalState: state.goal?.state ?? "none",
            verificationState: verification.state,
            statusLine: "已保存",
            brief: buildBrief(runtime, session.id, folded, undefined, false, verification.state), // ui-copy-ignore
            facts: rankFacts(folded).map(publicFact),
            verification,
            outcomes: buildOutcomes(folded)
          }
        },
        200,
        HEADERS
      );
    }
  }
  throw new OverviewError("bad-request", `unknown round "${clip(roundId, 80)}"`, 404);
}

/**
 * A path inside a fact statement is noise on a one-line brief: the name is
 * what the reader recognises, the directory is where it happens to live.
 * Rounds folded before that rule are still in storage, so it is applied here
 * too rather than only when the fact is created.
 *
 * @param {string} statement - stored fact statement.
 * @returns {string} statement safe to show.
 */
function shortStatement(statement) {
  if (typeof statement !== "string") return statement;
  return statement.replace(/已生成：(.+)$/u, (whole, raw) => {
    const parts = raw.split(/[\\/]+/u).filter((part) => part !== "");
    return parts.length === 0 ? whole : `已生成：${parts[parts.length - 1]}`;
  });
}

/**
 * Project an internal fact onto the wire shape.
 * @param {object} fact - stored fact.
 * @returns {object} wire fact.
 */
export function publicFact(fact) {
  return {
    id: fact.id, // ui-copy-ignore
    kind: fact.kind, // ui-copy-ignore
    statement: shortStatement(fact.statement),
    basis: fact.basis, // ui-copy-ignore
    validity: fact.validity, // ui-copy-ignore
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
  const seen = new Set();
  const refs = [];
  for (const ref of (fact.refs ?? []).slice(0, LIMITS.factRefs)) {
    const event = session.eventAt?.(ref.seq);
    const excerpt = clip(excerptOf(event), LIMITS.excerpt);
    if (seen.has(excerpt)) continue;
    seen.add(excerpt);
    refs.push({
      seq: ref.seq,
      type: event?.type ?? "unknown",
      label: clip(ref.label ?? "", 60),
      excerpt,
      time: typeof event?.time === "number" ? event.time : 0
    });
  }
  // A reader follows at most a few traces; the rest would repeat the same line.
  const recent = refs.slice(-LIMITS.evidenceRows);
  return json({ kind: "evidence", sessionId: session.id, roundId, fact: publicFact(fact), refs: recent }, 200, HEADERS);
}

/**
 * Replace absolute paths with their file name.
 *
 * The directory a file lives in is the same for every row of one working tree,
 * so repeating it makes eight traces read as one long path wall. The name is
 * what tells two traces apart.
 *
 * @param {string} text - excerpt text.
 * @returns {string} excerpt without directory prefixes.
 */
function shortenPaths(text) {
  return text.replace(/(^|[\s("'`])(?:\/(?:[^\s"'`/]+\/)+)([^\s"'`/]+)/gu, (match, lead, name) => lead + name);
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
      return shortenPaths(blocksText(data.message?.content) || data.error?.code || "");
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
  return clip(stripMarkup(parts.join(" ")), 600);
}

/**
 * Drop the tag-shaped markup a tool payload wraps its own fields in.
 *
 * A result body is written for a model, not for a reader: it carries
 * `<path>`, `<type>` and `<content>` around text a person would read as a
 * sentence. The brackets stay in the excerpt for a moment and read as a
 * rendering failure, so they are removed before anything is shown.
 *
 * @param {string} text - joined text.
 * @returns {string} text without tag-shaped markup.
 */
function stripMarkup(text) {
  return String(text ?? "").replace(/<\/?[a-zA-Z][^>]{0,120}>/gu, " ").replace(/[ \t]{2,}/gu, " ").trim();
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
  if (session.archived === true) return failure("read-only", "已保存的会话只可查看", 409);
  const verdict = await runtime.requestSummary(session, { manual: true });
  return json(verdict, 200, HEADERS);
}

/**
 * `POST /enable` — the per-session master switch. This side owns the decision:
 * every window reads the answer from the next snapshot, so two windows cannot
 * disagree, and switching off takes effect before this answer is written.
 *
 * @param {object} runtime - runtime wiring.
 * @param {Request} request - incoming request.
 * @returns {Promise<Response>} the new state.
 */
async function enableRoute(runtime, request) {
  const body = await readJsonBody(request);
  const session = await runtime.session(requiredField(body, "session"));
  if (session.archived === true) return failure("read-only", "已保存的会话只可查看", 409);
  if (typeof body.enabled !== "boolean") return failure("bad-request", "enabled is required", 400);
  const answer = await runtime.setEnabled(session, body.enabled);
  return json(
    {
      kind: "enable",
      enabled: answer.enabled,
      generation: answer.generation,
      throughSeq: answer.enabled ? (runtime.stateOf(session)?.lastSeq ?? -1) : -1
    },
    200,
    HEADERS
  );
}

/**
 * `POST /open` — open one delivered file in the system viewer.
 *
 * The path is the only thing the client sends, so it must be a deliverable the
 * current round recorded; anything else is refused rather than opened.
 *
 * @param {object} runtime - runtime wiring.
 * @param {Request} request - incoming request.
 * @returns {Promise<Response>} open acknowledgement.
 */
async function openRoute(runtime, request) {
  const body = await readJsonBody(request);
  const session = await runtime.session(requiredField(body, "session"));
  const path = typeof body.path === "string" ? body.path : "";
  const url = typeof body.url === "string" ? body.url : "";
  const target = path !== "" ? path : url;
  if (target === "") return failure("bad-request", "path or url is required", 400);
  if (url !== "" && !/^https:\/\//u.test(url)) return failure("bad-request", "url must be https", 400);
  const state = runtime.stateOf(session);
  const rounds = [state?.round, state?.settled?.round].filter((round) => round !== null && round !== undefined);
  const known = rounds.some((round) =>
    (Array.isArray(round.facts) ? round.facts : []).some(
      (fact) =>
        fact.kind === "deliverable" &&
        ((path !== "" && (Array.isArray(fact.files) ? fact.files : []).includes(path)) ||
          (url !== "" && fact.url === url))
    )
  );
  if (!known) return failure("bad-request", "unknown deliverable", 404);
  const opener = typeof runtime.openPath === "function" ? runtime.openPath : openPath;
  try {
    opener(target);
  } catch (error) {
    return failure("unavailable", "cannot open", 500);
  }
  return json({ kind: "open", opened: true }, 200, HEADERS);
}

/**
 * Hand a path to the desktop's own file handler.
 *
 * @param {string} target - absolute path already checked against a deliverable.
 */
function openPath(target) {
  // `open` returns as soon as the viewer is told about the file, so waiting for
  // the exit code is cheap and lets the route report a real failure.
  const result = spawnSync("open", [target], { stdio: "ignore" });
  if (result.error !== undefined || result.status !== 0) throw new Error("cannot open");
}
