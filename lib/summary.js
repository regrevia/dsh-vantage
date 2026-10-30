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
export const SUMMARY_INTERVAL_MS = 60000;

/** Default delay before the first summary of a session. */
export const SUMMARY_FIRST_MS = 0;

/**
 * Decide when a summary is due and refuse to run two at once.
 */
export class SummaryScheduler {
  /**
   * @param {{cadenceMs?: number, firstEligibleMs?: number}} config - cadence settings.
   */
  constructor(config) {
    this.cadenceMs = Number.isFinite(config?.cadenceMs) && config.cadenceMs >= 15000 ? config.cadenceMs : SUMMARY_INTERVAL_MS;
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
  const request = clip(options.request ?? "", 160);
  if (request !== "") lines.push(`request: ${request}`);
  const previousSummary = clip(options.previousSummary ?? "", 240);
  if (previousSummary !== "") lines.push(`previous-summary: ${previousSummary}`);
  const goal = clip(options.goal ?? "", 120);
  if (goal !== "") lines.push(`goal: ${goal}`);
  const previous = (Array.isArray(options.previousTopics) ? options.previousTopics : [])
    .map((topic) => clip(topic, 60))
    .filter((topic) => topic !== "")
    .slice(0, LIMITS.topics);
  if (previous.length > 0) lines.push(`previous: ${previous.join(" / ")}`);
  const report = clip(options.report ?? "", 400);
  if (report !== "") lines.push(`report: ${report}`);
  // What the round said while it worked. A pivot or a narrowing of scope lives
  // here, in the round's own words, before any fact captures it.
  const notes = (Array.isArray(round?.notes) ? round.notes : [])
    .map((note) => clip(note?.text ?? "", 200))
    .filter((note) => note !== "")
    .slice(-4);
  if (notes.length > 0) lines.push(`progress: ${notes.join(" / ")}`);
  // A write's file list says where; only the pair says what. The summariser
  // needs the meaning, and no file name reaches the card from here.
  const changes = [];
  for (const fact of Array.isArray(round?.facts) ? round.facts : []) {
    if (changes.length >= 4) break;
    if (fact.kind !== "change") continue;
    for (const part of Array.isArray(fact.changes) ? fact.changes : []) {
      const before = clip(part?.before ?? "", 80);
      const after = clip(part?.after ?? "", 80);
      if (before === "" && after === "") continue;
      changes.push(after === "" ? `-${before}` : before === "" ? `+${after}` : `-${before} +${after}`);
      if (changes.length >= 4) break;
    }
  }
  if (changes.length > 0) lines.push(`changes: ${changes.join(" / ")}`);
  // A passing check never becomes a headline, but it is the evidence a claim
  // stands on, so the summariser is told that verification happened.
  const verified = (Array.isArray(round?.facts) ? round.facts : [])
    .filter((fact) => fact.kind === "check" && fact.validity !== "needsRecheck" && !checkFailed(fact))
    .map((fact) => clip(fact.statement ?? "", 80))
    .filter((line) => line !== "")
    .slice(0, 3);
  // A pass is never material on its own: it only qualifies work that is already
  // in the packet, so a round of nothing but green checks stays unpublishable.
  if (verified.length > 0 && lines.length > 0) lines.push(`verified: ${verified.join(" / ")}`);
  const facts = new Map();
  let truncated = false;
  for (const fact of rankForPacket(round).slice(0, maxFacts)) {
    const evidence = Array.isArray(fact.detail)
      ? fact.detail.map((part) => String(part?.value ?? "").trim()).filter((part) => part !== "").join("、")
      : "";
    const line = `${fact.id} | ${fact.kind} | ${fact.statement}${evidence === "" ? "" : ` [${clip(evidence, 120)}]`}`;
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
  "You write the progress card of one work round for the person who asked for the work.",
  "Input lines: `request` is the person's ask; `report` is the agent's own closing statement; `fact` lines are `id | kind | statement`; `previous-summary` and `previous` are what the card already said.",
  "Reply with JSON only, no prose and no code fence:",
  '{"summary":"<2-3 sentences>","topics":[{"factIds":["<id>"],"headline":"<one concrete piece of work>","qualifier":"<optional limit>","details":["<one sentence>"]}]}',
  "`topics` is optional: `{\"summary\":\"…\",\"topics\":[]}` is a complete answer when the paragraph already says what happened.",
  "The summary answers three things in order: what the round is solving, what was actually done or found, and what is still open or limiting it.",
  "Write the summary for the person: name the concrete object and the change, not the process; no greeting, no recap of the request, no next-step promise.",
  "The card reports progress, never the request: no 「按你的要求」, no 「这一轮主要」, no restating what the person asked for.",
  "When the fact lines contain a change, the summary and every headline name that change. A check alone never becomes the headline: when a check is all there is, the summary names the check that ran and its verdict.",
  "A check-only round states what ran and what it found（三项校验全部通过，未发现报错）。It never judges how much that proves：不写「只有检查结果支撑」，不写「仍待验证」，也不评价成熟度。",
  "每项检查要写明查的对象和结论（界面文案、视觉样式、用例、实机面板），不用「另一项」「其余检查」「其他校验」指代：读卡片的人看不到句子里省掉的那一项。",
  "不写「检查范围限于」「只查了」这类缩小范围的话：直接说查了哪几项、结果如何。",
  "同一个结论只说一遍：开头讲完结果，后面只补对象和细节，不再来一句「结论均为通过」或「未发现报错」的同义重复。",
  "检查的项数要和下文对得上：三项以内可逐项点名（界面文案、视觉样式、用例），四项以上直接写「五项检查全部通过」；点名却漏掉其中几项，等于说漏了没查。",
  "The card prints the paragraph's opening clause as its heading, so open with the concrete detail rather than a label: the first clause names the object and what happened to it, and the rest of the paragraph adds the result and the limit instead of repeating that clause.",
  "Every topic must quote the ids it restates, and only ids from the fact lines. `report` may support a conclusion but is the agent's claim, not evidence.",
  "A headline names one concrete object and what happened to it (页面范围内定位、字幕避让人脸、历史按需加载), at most 40 characters.",
  "Details add the concrete object, the result and the limit in one sentence; at most two sentences per topic.",
  "When the input states a cause, a root cause, or a verified conclusion, restate it in one clause; never invent a cause, a number, a file, or a next step.",
  "Never put a file name, path, command, tool name, a category such as lint/test/build, a file count, or a commit hash on screen.",
  "Name a deliverable by what it is — 视频、文档、网页、表格 — never by its file name.",
  "Merge related facts into one topic; drop a previous topic once the input no longer supports it.",
  "Write Simplified Chinese. Output an empty topic list and an empty summary when the input supports nothing."
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
    const answer = verifyAnswer(text, input.packet.facts, input.maxTopics, input.packet.text);
    // A summary that says what happened is publishable on its own: the headline
    // list is a second reading of the same material, not a prerequisite for it.
    if (answer.summary === "" && answer.topics.length === 0) return null;
    return { summary: answer.summary, topics: answer.topics, tokens };
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

/** A headline that names a file, path, or command has dropped to implementation detail. */
const FILE_NAME_RE = /(?:[A-Za-z0-9_.@-]+\.[A-Za-z0-9]{1,8}\b|[/\\]|--[a-z])/u;

/**
 * Check a whole answer: the summary paragraph and the topics together. The
 * summary may restate a cause the input states; it may not add one.
 *
 * @param {string} text - raw model output.
 * @param {Map<string, object>} facts - packet index by fact id.
 * @param {number} [maxTopics] - how many topics to keep.
 * @returns {{summary: string, topics: object[]}} verified answer.
 */
export function verifyAnswer(text, facts, maxTopics = LIMITS.topics, context = "") {
  const parsed = parseAnswer(text);
  if (parsed === null) return { summary: "", topics: [] };
  const summary = cleanSummary(parsed.summary, facts, context);
  return { summary, topics: collectTopics(parsed.topics, facts, maxTopics) };
}

/**
 * Keep a summary paragraph only when it is short, plain, and quotes no number
 * the input does not contain.
 *
 * @param {unknown} value - summary candidate.
 * @param {Map<string, object>} facts - packet index by fact id.
 * @returns {string} usable summary, or "".
 */
function cleanSummary(value, facts, context = "") {
  if (typeof value !== "string") return "";
  const text = value.replace(/\s+/gu, " ").trim();
  if (text === "" || text.includes("```") || text.includes("<") || text.includes("http")) return "";
  const numbers = new Set();
  for (const fact of facts.values()) {
    for (const match of String(fact.statement).match(/\d+(?:\.\d+)?/gu) ?? []) numbers.add(match);
  }
  // Progress and change lines are packet material too: a number quoted from them
  // is grounded in what the round actually did, even without a fact of its own.
  for (const match of String(context).match(/\d+(?:\.\d+)?/gu) ?? []) numbers.add(match);
  for (const match of text.match(/\d+(?:\.\d+)?/gu) ?? []) {
    if (!numbers.has(match)) return "";
  }
  if (FILE_NAME_RE.test(text)) return "";
  if (!claimSupported(text, facts)) return "";
  return clip(text, 240);
}

export function verifyTopics(text, facts, maxTopics = LIMITS.topics) {
  const parsed = parseAnswer(text);
  if (parsed === null) return [];
  return collectTopics(parsed.topics, facts, maxTopics);
}

/**
 * @param {object[]} parsed - topic candidates.
 * @param {Map<string, object>} facts - packet index by fact id.
 * @param {number} maxTopics - how many topics to keep.
 * @returns {object[]} verified topics.
 */
function collectTopics(parsed, facts, maxTopics) {
  if (!Array.isArray(parsed)) return [];
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
    // A file name or a command line is how the work was done. The screen states
    // the outcome, so a headline carrying one is dropped rather than shown.
    if (FILE_NAME_RE.test(headline)) continue;
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
    const summary = typeof value?.summary === "string" ? value.summary : "";
    const listed = Array.isArray(value?.topics) ? value.topics : Array.isArray(value?.items) ? value.items : null;
    // A paragraph that says what happened is the whole answer; the headline list
    // is a second reading of the same material and may be empty.
    if (listed === null && summary.trim() === "") return null;
    return { summary, topics: listed ?? [] };
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
  if (state.round.roundId !== input.roundId) return { reason: "fresh", text: "整理期间有新的进展" };
  // Events without new material (a no-op step end, a heartbeat) must not throw
  // away a good summary. Only a change to what the summary talks about does.
  if (typeof input.materialKey === "string" && typeof input.currentMaterialKey === "string") {
    if (input.materialKey !== input.currentMaterialKey) return { reason: "fresh", text: "整理期间有新的进展" };
  } else if (state.lastSeq !== input.seq) {
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

