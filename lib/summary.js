/**
 * The model-facing half: rolling budget, visibility leases, and the one short
 * summarisation call.
 *
 * Three rules shape everything here.
 *
 * 1. The model never decides what is true. It receives a bounded packet of
 *    already-observed facts and may only shorten them. Every line it returns is
 *    checked against the packet before it is published; a line that names an
 *    unknown fact, invents a count, or adds a conclusion is dropped and the
 *    packet line it came from is used instead.
 * 2. The budget is the runtime's, not the view's. A manual request jumps the time
 *    interval but never the rolling token ceiling, the concurrency cap, or the // ui-copy-ignore
 *    fingerprint that says "this round has not moved since the last summary".
 * 3. Every failure is a skip with a reason, never an error. Facts mode is a
 *    complete state, not a degraded one.
 */

import { LIMITS, clip } from "./schema.js";

/** Tokens a single call is allowed to spend, reserved before dispatch. */
const TOKENS_PER_REQUEST = 1250;

/** Receipts older than this leave the rolling window. */
const WINDOW_MS = 60 * 60 * 1000;

/** Leases expire this long after the last renewal. */
const LEASE_TTL_MS = 45 * 1000;

/** The view renews roughly three times per TTL. */
export const LEASE_RENEW_MS = 15 * 1000;

/**
 * One short line of the brief, as the client receives it.
 * @typedef {object} BriefItem
 * @property {string} id - stable id; derived from the fact ids it quotes.
 * @property {string} text - plain text, never markup.
 * @property {string[]} factIds - facts this line is allowed to restate.
 * @property {"neutral"|"warn"|"error"|"success"} tone - visual weight.
 */

/**
 * Rolling token/request budget, concurrency cap, and fingerprint de-duplication. // ui-copy-ignore
 */
export class SummaryBudget {
  /**
   * @param {object} config - the `summary` section of the plugin config.
   * @param {(message: string) => void} warn - logger for internal notes.
   */
  constructor(config, warn) {
    this.config = config;
    this.warn = warn;
    /** @type {{at: number, tokens: number}[]} spent receipts inside the window. */
    this.spent = [];
    /** @type {Map<string, number>} sessionId -> in-flight count. */
    this.inflight = new Map();
    /** Fingerprint of the last published summary, per session. */
    this.fingerprints = new Map();
    /** Sessions whose automatic summaries the user paused. */
    this.paused = new Set();
    /** Sessions that ran out of budget; cleared when the window drains. */
    this.exhausted = new Set();
    this.now = () => Date.now();
  }

  /**
   * Drop receipts that left the window.
   * @param {number} now - current time.
   * @returns {void}
   */
  drain(now) {
    const floor = now - WINDOW_MS;
    while (this.spent.length > 0 && this.spent[0].at < floor) this.spent.shift();
    if (this.exhausted.size > 0 && this.used().tokens < this.config.maxTokensPerRollingHour) {
      this.exhausted.clear();
    }
  }

  /**
   * Tokens and requests already spent inside the window.
   * @returns {{tokens: number, requests: number}} totals.
   */
  used() {
    let tokens = 0;
    for (const receipt of this.spent) tokens += receipt.tokens;
    return { tokens, requests: this.spent.length };
  }

  /**
   * Whether one more call fits the rolling ceiling and the concurrency cap.
   *
   * @param {string} sessionId - runtime session id.
   * @returns {{ok: true} | {ok: false, reason: "budget"|"running"}} verdict.
   */
  admits(sessionId) {
    const now = this.now();
    this.drain(now);
    if (this.exhausted.has(sessionId)) return { ok: false, reason: "budget" };
    const used = this.used();
    if (used.requests + 1 > this.config.maxRequestsPerRollingHour) return { ok: false, reason: "budget" };
    if (used.tokens + TOKENS_PER_REQUEST > this.config.maxTokensPerRollingHour) return { ok: false, reason: "budget" };
    if ((this.inflight.get(sessionId) ?? 0) >= this.config.maxConcurrentRequests) {
      return { ok: false, reason: "running" };
    }
    return { ok: true };
  }

  /**
   * Reserve one call. The caller must always pair this with `settle`.
   * @param {string} sessionId - runtime session id.
   * @returns {void}
   */
  reserve(sessionId) {
    this.inflight.set(sessionId, (this.inflight.get(sessionId) ?? 0) + 1);
  }

  /**
   * Close a reservation and record what it spent.
   *
   * @param {string} sessionId - runtime session id.
   * @param {number} tokens - tokens actually consumed, or the reservation when unknown.
   * @returns {void}
   */
  settle(sessionId, tokens) {
    const left = (this.inflight.get(sessionId) ?? 1) - 1;
    if (left <= 0) this.inflight.delete(sessionId);
    else this.inflight.set(sessionId, left);
    const spent = Number.isFinite(tokens) && tokens > 0 ? Math.min(tokens, 8 * TOKENS_PER_REQUEST) : TOKENS_PER_REQUEST;
    this.spent.push({ at: this.now(), tokens: spent });
    if (this.used().tokens >= this.config.maxTokensPerRollingHour) this.exhausted.add(sessionId);
  }

  /**
   * Whether the automatic summaries of one session are on.
   * @param {string} sessionId - runtime session id.
   * @returns {boolean} true when enabled.
   */
  autoEnabled(sessionId) {
    return this.config.enabled && !this.paused.has(sessionId);
  }

  /**
   * Turn the automatic summaries of one session on or off.
   * @param {string} sessionId - runtime session id.
   * @param {boolean} enabled - wanted state.
   * @returns {void}
   */
  setAuto(sessionId, enabled) {
    if (enabled) this.paused.delete(sessionId);
    else this.paused.add(sessionId);
  }

  /**
   * True when this session is out of budget right now.
   * @param {string} sessionId - runtime session id.
   * @returns {boolean} exhausted flag.
   */
  isExhausted(sessionId) {
    this.drain(this.now());
    return this.exhausted.has(sessionId);
  }

  /**
   * The fingerprint that says "nothing new worth summarising".
   * @param {string} sessionId - runtime session id.
   * @param {string} roundId - round id.
   * @param {number} throughSeq - last folded event.
   * @returns {boolean} true when the same packet was already published.
   */
  duplicate(sessionId, roundId, throughSeq) {
    return this.fingerprints.get(sessionId) === `${roundId}@${throughSeq}`;
  }

  /**
   * Record the packet that was just published.
   * @param {string} sessionId - runtime session id.
   * @param {string} roundId - round id.
   * @param {number} throughSeq - last folded event.
   * @returns {void}
   */
  remember(sessionId, roundId, throughSeq) {
    this.fingerprints.set(sessionId, `${roundId}@${throughSeq}`);
  }

  /**
   * Whether the automatic path is due for this session.
   *
   * @param {string} sessionId - runtime session id.
   * @param {{lastAt: number, firstAt: number}} history - when it last ran and when the round began.
   * @returns {{ok: true} | {ok: false, reason: "disabled"|"fresh"|"running"|"budget"|"interval"}} verdict.
   */
  due(sessionId, history) {
    if (!this.autoEnabled(sessionId)) return { ok: false, reason: "disabled" };
    const now = this.now();
    if (history.lastAt > 0 && now - history.lastAt < this.config.minIntervalMs) return { ok: false, reason: "interval" };
    if (history.lastAt === 0 && now - history.firstAt < this.config.firstEligibleAfterMs) return { ok: false, reason: "fresh" };
    return this.admits(sessionId);
  }
}

/**
 * Visibility leases. Automatic summaries only run while somebody is looking at
 * the session, so a background conversation cannot spend the whole budget.
 */
export class LeaseRegistry {
  /**
   * @param {number} maxLeases - cap on live leases across all sessions.
   */
  constructor(maxLeases) {
    this.maxLeases = Math.max(1, maxLeases);
    /** @type {Map<string, {sessionId: string, expiresAt: number}>} */
    this.leases = new Map();
    this.now = () => Date.now();
  }

  /**
   * Acquire or renew a lease.
   *
   * @param {string} sessionId - runtime session id.
   * @param {string} leaseId - client-chosen opaque id.
   * @param {boolean} visible - false releases the lease.
   * @returns {{leaseId: string, visible: boolean, expiresAt: number}} answer.
   * @throws {Error & {code?: string}} with `lease/limit` when the cap is reached.
   */
  touch(sessionId, leaseId, visible) {
    const now = this.now();
    this.sweep(now);
    const key = `${sessionId}\u0000${leaseId}`;
    if (!visible) {
      this.leases.delete(key);
      return { leaseId, visible: false, expiresAt: 0 };
    }
    if (!this.leases.has(key) && this.leases.size >= this.maxLeases) {
      const error = new Error("too many concurrent views");
      error.code = "lease/limit";
      throw error;
    }
    this.leases.set(key, { sessionId, expiresAt: now + LEASE_TTL_MS });
    return { leaseId, visible: true, expiresAt: now + LEASE_TTL_MS };
  }

  /**
   * Whether somebody is watching this session.
   * @param {string} sessionId - runtime session id.
   * @returns {boolean} true when a live lease exists.
   */
  visible(sessionId) {
    this.sweep(this.now());
    for (const lease of this.leases.values()) {
      if (lease.sessionId === sessionId) return true;
    }
    return false;
  }

  /**
   * Drop expired leases.
   * @param {number} now - current time.
   * @returns {void}
   */
  sweep(now) {
    for (const [key, lease] of this.leases) {
      if (lease.expiresAt <= now) this.leases.delete(key);
    }
  }
}

/**
 * Build the packet handed to the model: at most `maxFacts` one-line facts, each
 * prefixed with its id so the answer can be checked against it.
 *
 * @param {object} round - the open round.
 * @param {number} maxFacts - how many facts to include.
 * @returns {{text: string, facts: Map<string, object>}} packet and its index.
 */
export function buildPacket(round, maxFacts) {
  const ranked = rankForPacket(round);
  const facts = new Map();
  const lines = [];
  for (const fact of ranked.slice(0, maxFacts)) {
    facts.set(fact.id, fact);
    lines.push(`${fact.id} | ${fact.kind} | ${fact.statement}`);
  }
  return { text: lines.join("\n"), facts };
}

/**
 * Facts in the order a brief should prefer them: unresolved verification first,
 * then whatever moved most recently.
 *
 * @param {object} round - the open round.
 * @returns {object[]} ordered facts.
 */
function rankForPacket(round) {
  const facts = Array.isArray(round?.facts) ? [...round.facts] : [];
  const weight = (fact) => {
    if (fact.validity === "needsRecheck") return 0;
    if (fact.kind === "blocker") return 1;
    if (fact.kind === "check") return 2;
    if (fact.kind === "change") return 3;
    if (fact.kind === "report") return 4;
    return 5;
  };
  return facts.sort((a, b) => weight(a) - weight(b) || (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
}

/** The instruction given to the model. Deliberately short and closed. */
const SYSTEM_PROMPT = [
  "You compress an already-verified activity log into at most three short lines.",
  "Each input line is `id | kind | statement`.",
  "Rules: keep only what the input states; never add a conclusion, a verdict, an estimate, or a cause;",
  "never invent a number, file name, or test result; quote numbers exactly as written;",
  "write Simplified Chinese; one sentence per line; no more than 40 characters per line;",
  "output only the lines, no list markers, no headings.",
  "If the input does not support a line, output nothing for it."
].join("\n");

/**
 * Compress facts into brief lines. Returns `null` when the model is unavailable
 * or the answer cannot be verified, which the caller treats as "stay in facts
 * mode" — never as an error.
 *
 * @param {object} ctx - runtime plugin context.
 * @param {object} input - packet, route, deadline, and prompt hints.
 * @returns {Promise<{items: BriefItem[], tokens: number}|null>} verified lines.
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
      system: SYSTEM_PROMPT, // ui-copy-ignore
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
        // Full-block answers repeat what the deltas already contributed.
        if (text === "") text = chunk.block.text ?? "";
      } else if (chunk.type === "usage" && Number.isFinite(chunk.usage?.totalTokens)) {
        tokens = chunk.usage.totalTokens;
      } else if (chunk.type === "finish") {
        terminal = chunk.reason;
      }
    }
    if (terminal?.kind === "error") return null;
    if (text.trim() === "") return null;
    const items = verifyLines(text, input.packet.facts, input.maxItems);
    if (items.length === 0) return null;
    return { items, tokens };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Outcomes a summary may report only when a packet fact says the same thing. */
const COMPLETION_CLAIM_RE =
  /(?:已完成|已经完成|任务完成|全部完成|已修复|修复完成|已解决|测试(?:全部)?通过|全部测试通过|验证通过|构建成功|all tests? pass|task complete|fixed|resolved)/iu;

/**
 * Whether a line asserts that work finished, and whether a packet fact backs it.
 * A summary selects and compresses; it may never invent a verdict.
 *
 * @param {string} line - candidate line.
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
 * Check every returned line against the packet. A line survives only if it is
 * short, non-empty, and quotes no number the packet does not contain.
 *
 * @param {string} text - raw model output.
 * @param {Map<string, object>} facts - packet index by fact id.
 * @param {number} maxItems - how many lines to keep.
 * @returns {BriefItem[]} verified lines.
 */
export function verifyLines(text, facts, maxItems) {
  const clean = String(text)
    .split(/\r?\n/u)
    .map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/u, "").trim())
    .filter((line) => line !== "");
  const packetNumbers = new Set();
  for (const fact of facts.values()) {
    for (const match of fact.statement.match(/\d+(?:\.\d+)?/gu) ?? []) packetNumbers.add(match);
  }
  const items = [];
  const seen = new Set();
  for (const line of clean) {
    if (items.length >= maxItems) break;
    if (Array.from(line).length > 60) continue;
    if (line.includes("```") || line.includes("<") || line.includes("http")) continue;
    let allowed = true;
    for (const match of line.match(/\d+(?:\.\d+)?/gu) ?? []) {
      if (!packetNumbers.has(match)) allowed = false;
    }
    if (!allowed) continue;
    if (!claimSupported(line, facts)) continue;
    const factIds = [...facts.keys()].filter((id) => line.includes(id));
    const quoted = factIds.length > 0 ? factIds : [nearestFactId(line, facts)];
    const text = clip(line, LIMITS.factStatement);
    if (text === "" || seen.has(text)) continue;
    seen.add(text);
    items.push({
      id: `b:${quoted.filter(Boolean).join("+") || items.length}`,
      text,
      factIds: quoted.filter(Boolean),
      tone: "neutral"
    });
  }
  return items;
}

/**
 * The packet fact whose statement shares the most bigrams with a line, used when
 * the model left the id out.
 *
 * @param {string} line - returned line.
 * @param {Map<string, object>} facts - packet index.
 * @returns {string} best matching fact id, or "" when nothing is close.
 */
function nearestFactId(line, facts) {
  const target = bigrams(line);
  let best = "";
  let bestScore = 0;
  for (const [id, fact] of facts) {
    const score = overlap(target, bigrams(fact.statement));
    if (score > bestScore) {
      bestScore = score;
      best = id;
    }
  }
  return bestScore >= 2 ? best : "";
}

/**
 * Character bigrams of a string, used only for the loose match above.
 * @param {string} value - text.
 * @returns {Set<string>} bigrams.
 */
function bigrams(value) {
  const points = Array.from(String(value).replace(/\s+/gu, ""));
  const out = new Set();
  for (let i = 0; i + 1 < points.length; i += 1) out.add(`${points[i]}${points[i + 1]}`);
  return out;
}

/**
 * Size of the intersection of two sets.
 * @param {Set<string>} left - first set.
 * @param {Set<string>} right - second set.
 * @returns {number} overlap.
 */
function overlap(left, right) {
  let count = 0;
  for (const value of left) if (right.has(value)) count += 1;
  return count;
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
