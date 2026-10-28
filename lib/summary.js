/**
 * Incremental work-topic summaries.
 *
 * Three pieces live here:
 *
 * 1. `SummaryScheduler` decides *when* a summary may run. It is deliberately
 *    small: a cadence window, a per-session single flight, and a fingerprint of
 *    the position already summarised. There is no usage quota, no hourly
 *    admission and no exhaustion state — usage is a diagnostic, never a brake on
 *    the work itself.
 * 2. `buildPacket` turns the current round into the only input the model sees:
 *    the goal, the topics already shown, and id-prefixed activity lines.
 * 3. `summarise`/`verifyTopics` call the model and check every returned topic
 *    against that input. Provenance is mandatory: a topic that does not cite
 *    packet ids is dropped, no matter how plausible it reads.
 *
 * Nothing here schedules the main agent, edits a tool list, or touches Goal,
 * subagent, or team state.
 */

import { LIMITS, clip } from "./schema.js";

/** Default cadence between two summaries of one session. */
export const SUMMARY_INTERVAL_MS = 180000;

/** Default delay before the first summary of a session. */
export const SUMMARY_FIRST_MS = 60000;

/**
 * Decide when a summary is due and refuse to run two at once.
 */
export class SummaryScheduler {
  /**
   * @param {{cadenceMs?: number, firstEligibleMs?: number}} config - cadence settings.
   */
  constructor(config) {
    this.cadenceMs = Number.isFinite(config?.cadenceMs) && config.cadenceMs >= 60000 ? config.cadenceMs : SUMMARY_INTERVAL_MS;
    this.firstEligibleMs = Number.isFinite(config?.firstEligibleMs) && config.firstEligibleMs >= 0
      ? config.firstEligibleMs
      : SUMMARY_FIRST_MS;
    /** @type {Map<string, string>} sessionId -> fingerprint of the published position. */
    this.fingerprints = new Map();
    /** @type {Set<string>} sessions with a request in flight. */
    this.inflight = new Set();
  }

  /**
   * Whether this exact position was already summarised.
   *
   * @param {string} sessionId - runtime session id.
   * @param {string} roundId - round the position belongs to.
   * @param {number} seq - watermark of the position.
   * @returns {boolean} true when nothing new happened.
   */
  duplicate(sessionId, roundId, seq) {
    return this.fingerprints.get(sessionId) === `${roundId}@${seq}`;
  }

  /**
   * Record a published position.
   *
   * @param {string} sessionId - runtime session id.
   * @param {string} roundId - round the position belongs to.
   * @param {number} seq - watermark of the position.
   * @returns {void}
   */
  remember(sessionId, roundId, seq) {
    this.fingerprints.set(sessionId, `${roundId}@${seq}`);
  }

  /**
   * Forget everything about one session, e.g. when its overview is switched off.
   *
   * @param {string} sessionId - runtime session id.
   * @returns {void}
   */
  forget(sessionId) {
    this.fingerprints.delete(sessionId);
    this.inflight.delete(sessionId);
  }

  /**
   * Whether a request of this session is already running.
   *
   * @param {string} sessionId - runtime session id.
   * @returns {boolean} true while one is in flight.
   */
  busy(sessionId) {
    return this.inflight.has(sessionId);
  }

  /** @param {string} sessionId - runtime session id. */
  begin(sessionId) {
    this.inflight.add(sessionId);
  }

  /** @param {string} sessionId - runtime session id. */
  end(sessionId) {
    this.inflight.delete(sessionId);
  }

  /**
   * Whether the cadence allows another summary now.
   *
   * `firstAt` is when the current round started: the first summary of a round
   * may arrive earlier than the steady cadence, because waiting three minutes
   * for the first useful line is worse than showing it once.
   *
   * @param {string} sessionId - runtime session id.
   * @param {{lastAt: number, firstAt: number, now: number}} clock - observed times.
   * @returns {{ok: boolean, reason?: string}} verdict.
   */
  due(sessionId, clock) {
    if (this.inflight.has(sessionId)) return { ok: false, reason: "running" };
    const last = Number.isFinite(clock?.lastAt) ? clock.lastAt : 0;
    const now = Number.isFinite(clock?.now) ? clock.now : Date.now();
    if (last > 0) {
      if (now - last < this.cadenceMs) return { ok: false, reason: "interval" };
      return { ok: true };
    }
    const first = Number.isFinite(clock?.firstAt) ? clock.firstAt : now;
    if (now - first < this.firstEligibleMs) return { ok: false, reason: "interval" };
    return { ok: true };
  }
}

/**
 * Rough token cost of a string: ASCII at four characters per token, CJK at // ui-copy-ignore
 * roughly one per character. Only used to keep the input inside its cap, so the // ui-copy-ignore
 * estimate deliberately rounds up.
 *
 * @param {string} text - text to measure.
 * @returns {number} estimated tokens.
 */
export function estimateTokens(text) {
  let ascii = 0;
  let wide = 0;
  for (const char of String(text ?? "")) {
    if (char.charCodeAt(0) > 0x2e7f) wide += 1;
    else ascii += 1;
  }
  return Math.ceil(ascii / 4) + wide;
}

/**
 * Build the packet handed to the model.
 *
 * Optional `goal:` and `previous:` lines come first, then one line per activity
 * fact prefixed with its id so the answer can be checked against it. Facts are
 * added in priority order and the packet stops growing at the input cap, so what
 * gets dropped is always the least decision-relevant line.
 *
 * @param {object} round - the open round.
 * @param {{goal?: string, previousTopics?: string[], maxFacts?: number, maxTokens?: number}} [options] - packet options.
 * @returns {{text: string, facts: Map<string, object>, truncated: boolean}} packet, fact index, dropped flag.
 */
export function buildPacket(round, options = {}) {
  const maxFacts = Number.isFinite(options.maxFacts) ? options.maxFacts : 24;
  const maxTokens = Number.isFinite(options.maxTokens) && options.maxTokens > 0 ? options.maxTokens : Number.POSITIVE_INFINITY;
  const lines = [];
  const goal = clip(options.goal ?? "", 120);
  if (goal !== "") lines.push(`goal: ${goal}`);
  const previous = (Array.isArray(options.previousTopics) ? options.previousTopics : [])
    .map((topic) => clip(topic, 60))
    .filter((topic) => topic !== "")
    .slice(0, LIMITS.topics);
  if (previous.length > 0) lines.push(`previous: ${previous.join(" / ")}`);
  const facts = new Map();
  let truncated = false;
  for (const fact of rankForPacket(round).slice(0, maxFacts)) {
    const line = `${fact.id} | ${fact.kind} | ${fact.statement}`;
    if (estimateTokens([...lines, line].join("\n")) > maxTokens) {
      truncated = true;
      continue;
    }
    facts.set(fact.id, fact);
    lines.push(line);
  }
  return { text: lines.join("\n"), facts, truncated };
}

/**
 * Facts in the order a topic should prefer them: unresolved verification first,
 * then whatever moved most recently.
 *
 * @param {object} round - the open round.
 * @returns {object[]} ordered facts.
 */
const FAILED_CHECK_RE = /未通过|失败|错误|报错|不通过|exit\s*(?:code\s*)?[1-9]/iu;

/**
 * Whether a check fact records a failure.
 * @param {object} fact - stored fact.
 * @returns {boolean} true when the check failed.
 */
function checkFailed(fact) {
  return FAILED_CHECK_RE.test(String(fact?.statement ?? ""));
}

function rankForPacket(round) {
  // Diagnostic notes (a cancelled tool call, an ignored retry) prove nothing a
  // reader can use, so they never reach the model's input. A passing check is
  // evidence for a claim, never a topic of its own, so it stays out of the input
  // as well; a failed or stale check does change what the round needs.
  const facts = Array.isArray(round?.facts)
    ? round.facts.filter((fact) => {
      if (fact.kind === "note") return false;
      if (fact.kind !== "check") return true;
      return fact.validity === "needsRecheck" || checkFailed(fact);
    })
    : [];
  const weight = (fact) => {
    if (fact.validity === "needsRecheck") return 0;
    if (fact.kind === "blocker") return 1;
    if (fact.kind === "failure") return 2;
    if (fact.kind === "activity") return 3;
    if (fact.kind === "change") return 4;
    if (fact.kind === "check") return 5;
    if (fact.kind === "deliverable") return 6;
    return 7;
  };
  return facts.sort((a, b) => weight(a) - weight(b) || (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
}

/**
 * The instruction given to the model. Deliberately short and closed: the answer
 * is data, not prose, and every topic must name the facts it restates.
 */
export const SUMMARY_SYSTEM_PROMPT = [
  "You summarise an activity log into 1–3 work topics for the person who asked for the work.",
  "Each input line is `id | kind | statement`; a `goal:` line and a `previous:` line may precede them.",
  "Reply with JSON only, no prose and no code fence:",
  '{"topics":[{"factIds":["<id>"],"headline":"<one topic>","qualifier":"<optional status>","details":["<optional one sentence>"]}]}',
  "Rules: every topic must quote the ids it restates, and only ids from the input;",
  "the headline names the piece of work, never a tool name, a category such as lint/test/build, or a line number;",
  "name the file, screen, or behaviour the work touched, never a file count such as 已修改 4 个文件。",
  "merge related facts into one topic; drop a previous topic once the log no longer supports it;",
  "keep the qualifier to a short limit on the headline (a file count, a condition), never a verdict;",
  "write Simplified Chinese; at most 40 characters per headline and 2 detail sentences per topic;",
  "never add a conclusion, a cause, an estimate, or a next step; never invent a number or a file name;",
  "output an empty list when the input supports nothing."
].join("\n");

/**
 * Compress facts into work topics. Returns `null` when the model is unavailable
 * or the answer cannot be verified, which the caller treats as "stay in facts
 * mode" — never as an error.
 *
 * @param {object} ctx - runtime plugin context.
 * @param {object} input - packet, route, deadline, and prompt hints.
 * @returns {Promise<{topics: object[], tokens: number}|null>} verified topics.
 */
export async function summarise(ctx, input) {
  const llm = safeService(ctx, "llm");
  if (llm === undefined) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("summary timed out")), input.deadlineMs);
  try {
    const call = await llm.prepareCall(
      { provider: input.provider, model: input.model, maxTokens: input.maxOutputTokens },
      controller.signal
    );
    const messages = [{ role: "user", content: [{ type: "text", text: input.packet.text }] }];
    const options = Object.freeze(Object.assign({}, call.config, {
      system: SUMMARY_SYSTEM_PROMPT, // ui-copy-ignore
      messages,
      sessionId: input.sessionId,
      purpose: "vantage-summary", // ui-copy-ignore
      signal: controller.signal // ui-copy-ignore
    }));
    let text = "";
    let terminal;
    let tokens = 0;
    for await (const chunk of call.stream(options)) {
      if (controller.signal.aborted) break;
      if (chunk.type === "text-delta" || chunk.type === "text") {
        text += typeof chunk.text === "string" ? chunk.text : typeof chunk.delta === "string" ? chunk.delta : "";
      } else if (chunk.type === "block-end" && chunk.block?.type === "text") {
        // A full-block answer repeats what the deltas already contributed.
        if (text === "") text = chunk.block.text ?? "";
      } else if (chunk.type === "usage" && Number.isFinite(chunk.usage?.totalTokens)) {
        tokens = chunk.usage.totalTokens;
      } else if (chunk.type === "finish") {
        terminal = chunk.reason;
      }
    }
    if (terminal?.kind === "error") return null;
    if (text.trim() === "") return null;
    const topics = verifyTopics(text, input.packet.facts, input.maxTopics);
    if (topics.length === 0) return null;
    return { topics, tokens };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Outcomes a topic may report only when a packet fact says the same thing. */
const COMPLETION_CLAIM_RE =
  /(?:已完成|已经完成|任务完成|全部完成|已修复|修复完成|已解决|测试(?:全部)?通过|全部测试通过|验证通过|构建成功|all tests? pass|task complete|fixed|resolved)/iu;

/**
 * Whether a topic asserts that work finished, and whether a packet fact backs it.
 *
 * @param {string} line - candidate text.
 * @param {Map<string, object>} facts - packet index by fact id.
 * @returns {boolean} true when the claim may be shown.
 */
function claimSupported(line, facts) {
  const claim = line.match(COMPLETION_CLAIM_RE);
  if (claim === null) return true;
  const phrase = claim[0].toLowerCase();
  for (const fact of facts.values()) {
    if (String(fact.statement).toLowerCase().includes(phrase)) return true;
  }
  return false;
}

/**
 * Check every returned topic against the packet. A topic survives only if it is
 * short, cites packet facts, and quotes no number the packet does not contain.
 *
 * @param {string} text - raw model output.
 * @param {Map<string, object>} facts - packet index by fact id.
 * @param {number} [maxTopics] - how many topics to keep.
 * @returns {object[]} verified topics.
 */
/** Headlines that count files instead of naming what changed. */
const VAGUE_COUNT_RE = /^(?:已)?(?:修改|改动|更新|新增|编辑)(?:了|)\s*\d+\s*(?:个|)文件/u;

export function verifyTopics(text, facts, maxTopics = LIMITS.topics) {
  const parsed = parseAnswer(text);
  if (parsed === null) return [];
  const packetNumbers = new Set();
  for (const fact of facts.values()) {
    for (const match of String(fact.statement).match(/\d+(?:\.\d+)?/gu) ?? []) packetNumbers.add(match);
  }
  const topics = [];
  const seen = new Set();
  for (const raw of parsed) {
    if (topics.length >= maxTopics) break;
    if (raw === null || typeof raw !== "object") continue;
    const headline = typeof raw.headline === "string" ? raw.headline.trim() : typeof raw.title === "string" ? raw.title.trim() : "";
    if (headline === "" || Array.from(headline).length > LIMITS.topicHeadline) continue;
    if (headline.includes("```") || headline.includes("<") || headline.includes("http")) continue;
    // A count of touched files is not a piece of work: the reader cannot tell
    // what it changed, and the facts already name the files.
    if (VAGUE_COUNT_RE.test(headline)) continue;
    // Provenance is exact and mandatory: a topic that does not name the facts it
    // restates is not accepted, no matter how plausible it reads.
    const cited = Array.isArray(raw.factIds) ? raw.factIds.filter((id) => typeof id === "string" && facts.has(id)) : [];
    if (cited.length === 0) continue;
    let allowed = true;
    for (const match of headline.match(/\d+(?:\.\d+)?/gu) ?? []) {
      if (!packetNumbers.has(match)) allowed = false;
    }
    if (!allowed || !claimSupported(headline, facts)) continue;
    const body = clip(headline, LIMITS.topicHeadline);
    if (body === "" || seen.has(body)) continue;
    const unique = [...new Set(cited)];
    const qualifier = sanitizeLine(raw.qualifier, LIMITS.topicQualifier);
    const details = [];
    if (Array.isArray(raw.details)) {
      for (const line of raw.details) {
        const clean = sanitizeLine(line, LIMITS.topicDetailChars);
        if (clean === "") continue;
        let ok = true;
        for (const match of clean.match(/\d+(?:\.\d+)?/gu) ?? []) {
          if (!packetNumbers.has(match)) ok = false;
        }
        if (!ok || !claimSupported(clean, facts)) continue;
        details.push(clean);
        if (details.length >= LIMITS.topicDetails) break;
      }
    }
    seen.add(body);
    topics.push({
      id: `t:${unique.join("+")}`,
      headline: body,
      qualifier,
      details,
      factIds: unique,
      state: "recorded" // ui-copy-ignore
    });
  }
  return topics;
}

/**
 * Clean one optional free-text field: no markup, no links, no code fences.
 *
 * @param {unknown} value - candidate text.
 * @param {number} max - maximum code points.
 * @returns {string} cleaned text, empty when nothing usable remains.
 */
function sanitizeLine(value, max) {
  if (typeof value !== "string") return "";
  const text = value.replace(/\s+/gu, " ").trim();
  if (text === "" || text.includes("```") || text.includes("<") || text.includes("http")) return "";
  return clip(text, max);
}

/**
 * Read the model's answer as the closed JSON object it was asked for.
 *
 * @param {string} text - raw output.
 * @returns {object[]|null} the topic list, or null when unreadable.
 */
function parseAnswer(text) {
  const raw = String(text ?? "").trim();
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const value = JSON.parse(raw.slice(start, end + 1));
    if (Array.isArray(value?.topics)) return value.topics;
    return Array.isArray(value?.items) ? value.items : null;
  } catch {
    return null;
  }
}

/**
 * Decide whether an answer may still be published. A summary is only true for
 * the state it was asked about: a newer request, a switched-off session, a new
 * generation, a new round, or new facts all discard it.
 *
 * @param {{requestId: string, currentRequestId: string|undefined, manual: boolean, enabled: boolean, generation: number, expectedGeneration: number, state: object|undefined, roundId: string, seq: number}} input - what happened while the model ran.
 * @returns {{reason: string, text: string}|null} rejection, or null when publishable.
 */
export function publishVerdict(input) {
  if (input.currentRequestId !== input.requestId) return { reason: "cancelled", text: "这次整理已取消" };
  if (input.generation !== input.expectedGeneration) return { reason: "cancelled", text: "这次整理已取消" };
  if (input.manual !== true && input.enabled !== true) return { reason: "disabled", text: "概览已关闭" };
  const state = input.state;
  if (state === undefined || state.round === null || state.round === undefined) {
    return { reason: "fresh", text: "整理期间有新的进展" };
  }
  if (state.round.roundId !== input.roundId || state.lastSeq !== input.seq) {
    return { reason: "fresh", text: "整理期间有新的进展" };
  }
  return null;
}

/**
 * Fetch a service if the runtime exposes it, without throwing.
 *
 * @param {object} ctx - runtime plugin context.
 * @param {string} name - service name.
 * @returns {any} the service, or undefined.
 */
export function safeService(ctx, name) {
  try {
    return ctx.get?.(name);
  } catch {
    return undefined;
  }
}

