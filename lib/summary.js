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
    /**
     * Every call inside the window, reserved before dispatch: a pending receipt
     * already occupies its share of the ceiling, so two concurrent calls cannot
     * both pass admission. `pending` clears when the call settles or the process
     * that owned it dies (a restored pending receipt is charged in full).
     * @type {{at: number, tokens: number, sessionId: string, pending?: boolean}[]}
     */
    this.spent = [];
    /** @type {Map<string, number>} sessionId -> in-flight count. */
    this.inflight = new Map();
    /** Called after every ledger change so the runtime can persist it. */
    this.onChange = null;
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

  /** Calls still in flight, across every session. */
  pending() {
    return this.spent.filter((receipt) => receipt.pending === true).length;
  }

  /**
   * Persistable ledger state. Pending receipts survive a restart as spent ones:
   * the call really was dispatched and its usage is unknown, so the honest
   * accounting is the full reservation, never a refund.
   * @returns {object} ledger snapshot.
   */
  snapshot() {
    return {
      spent: this.spent.slice(-64).map((receipt) => ({
        at: receipt.at, // ui-copy-ignore
        tokens: receipt.tokens, // ui-copy-ignore
        sessionId: receipt.sessionId,
        pending: receipt.pending === true
      })),
      fingerprints: [...this.fingerprints.entries()].slice(-64),
      paused: [...this.paused] // ui-copy-ignore
    };
  }

  /**
   * Restore a ledger snapshot. Anything unreadable is dropped, and a pending
   * receipt left by a dead process is charged at its reserved amount.
   * @param {object|undefined} data - snapshot from {@link snapshot}.
   * @returns {void}
   */
  restore(data) {
    if (data === null || typeof data !== "object") return;
    const rows = Array.isArray(data.spent) ? data.spent : [];
    this.spent = rows
      .filter((row) => row !== null && typeof row === "object" && Number.isFinite(row.at) && Number.isFinite(row.tokens))
      .map((row) => ({
        at: row.at,
        tokens: Math.max(0, row.tokens),
        sessionId: typeof row.sessionId === "string" ? row.sessionId : "",
        pending: false
      }));
    this.fingerprints = new Map(Array.isArray(data.fingerprints) ? data.fingerprints.filter((row) => Array.isArray(row) && row.length === 2) : []);
    this.paused = new Set(Array.isArray(data.paused) ? data.paused.filter((id) => typeof id === "string") : []);
    this.drain(this.now());
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
    // `used()` already counts pending reservations, so this one admission never
    // oversubscribes the hour even when another call is still in flight.
    const used = this.used();
    if (used.requests + 1 > this.config.maxRequestsPerRollingHour) return { ok: false, reason: "budget" };
    if (used.tokens + TOKENS_PER_REQUEST > this.config.maxTokensPerRollingHour) return { ok: false, reason: "budget" };
    // Concurrency is a Host-wide cap: one summary call at a time, whichever // ui-copy-ignore
    // session asked for it.
    if (this.pending() >= this.config.maxConcurrentRequests) return { ok: false, reason: "running" };
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
    this.spent.push({ at: this.now(), tokens: TOKENS_PER_REQUEST, sessionId, pending: true });
    this.changed();
  }

  /** Tell the owner the ledger moved, so it can persist it. */
  changed() {
    if (typeof this.onChange !== "function") return;
    try {
      this.onChange(this.snapshot());
    } catch {
      // A failed persistence attempt must never break a summary call.
    }
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
    for (let index = this.spent.length - 1; index >= 0; index -= 1) {
      const receipt = this.spent[index];
      if (receipt.pending === true && receipt.sessionId === sessionId) {
        receipt.pending = false;
        receipt.tokens = spent;
        this.changed();
        if (this.used().tokens >= this.config.maxTokensPerRollingHour) this.exhausted.add(sessionId);
        return;
      }
    }
    // A receipt that vanished (restored ledger, changed window) is still charged.
    this.spent.push({ at: this.now(), tokens: spent, sessionId });
    this.changed();
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
    this.changed();
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
    this.changed();
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
 * Rough token cost of a string: ASCII runs at four characters per token, CJK at // ui-copy-ignore
 * roughly one token per character. Only used to keep the input inside its cap, // ui-copy-ignore
 * so the estimate deliberately rounds up.
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
 * Build the packet handed to the model: one-line facts, each prefixed with its
 * id so the answer can be checked against it.
 *
 * The packet is the *whole* input besides the system prompt, so its size is
 * enforced here in tokens: facts are added in priority order and the packet
 * stops growing at the cap. Unresolved verification and blockers rank first, so
 * what gets dropped is always the least decision-relevant line.
 *
 * @param {object} round - the open round.
 * @param {number} maxFacts - how many facts to consider.
 * @param {number} [maxTokens] - cap for this text, in estimated tokens.
 * @returns {{text: string, facts: Map<string, object>, truncated: boolean}} packet, index, and whether facts were dropped.
 */
export function buildPacket(round, maxFacts, maxTokens) {
  const ranked = rankForPacket(round);
  const facts = new Map();
  const lines = [];
  const budget = Number.isFinite(maxTokens) && maxTokens > 0 ? maxTokens : Number.POSITIVE_INFINITY;
  let truncated = false;
  for (const fact of ranked.slice(0, maxFacts)) {
    const line = `${fact.id} | ${fact.kind} | ${fact.statement}`;
    const next = lines.length === 0 ? line : `${lines.join("\n")}\n${line}`;
    if (estimateTokens(next) > budget) {
      truncated = true;
      continue;
    }
    facts.set(fact.id, fact);
    lines.push(line);
  }
  return { text: lines.join("\n"), facts, truncated };
}

/**
 * Facts in the order a brief should prefer them: unresolved verification first,
 * then whatever moved most recently.
 *
 * @param {object} round - the open round.
 * @returns {object[]} ordered facts.
 */
function rankForPacket(round) {
  // Diagnostic notes (a cancelled tool call, an ignored retry) prove nothing a
  // reader can use, so they never reach the model's input.
  const facts = Array.isArray(round?.facts) ? round.facts.filter((fact) => fact.kind !== "note") : [];
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

/**
 * The instruction given to the model. Deliberately short and closed: the answer
 * is data, not prose, and every item must name the facts it restates.
 */
export const SUMMARY_SYSTEM_PROMPT = [
  "You compress an already-verified activity log into at most three items.",
  "Each input line is `id | kind | statement`.",
  "Reply with JSON only, no prose and no code fence:",
  '{"items":[{"factIds":["<id>"],"title":"<one sentence>"}]}',
  "Rules: every item must quote the ids it restates, and only ids from the input;",
  "keep only what those facts state; never add a conclusion, a verdict, an estimate, or a cause;",
  "never invent a number, file name, or test result; quote numbers exactly as written;",
  "write Simplified Chinese; one sentence per item; no more than 40 characters per title;",
  "output an empty list when the input supports nothing."
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
  const parsed = parseAnswer(text);
  if (parsed === null) return [];
  const packetNumbers = new Set();
  for (const fact of facts.values()) {
    for (const match of String(fact.statement).match(/\d+(?:\.\d+)?/gu) ?? []) packetNumbers.add(match);
  }
  const items = [];
  const seen = new Set();
  for (const raw of parsed) {
    if (items.length >= maxItems) break;
    if (raw === null || typeof raw !== "object") continue;
    const title = typeof raw.title === "string" ? raw.title.trim() : "";
    if (title === "" || Array.from(title).length > 60) continue;
    if (title.includes("```") || title.includes("<") || title.includes("http")) continue;
    // Provenance is exact and mandatory: a line that does not name the facts it
    // restates is not accepted, no matter how plausible it reads.
    const cited = Array.isArray(raw.factIds) ? raw.factIds.filter((id) => typeof id === "string" && facts.has(id)) : [];
    if (cited.length === 0) continue;
    const citedFacts = cited.map((id) => facts.get(id));
    if (citedFacts.some((fact) => fact.validity === "needsRecheck")) continue;
    let allowed = true;
    for (const match of title.match(/\d+(?:\.\d+)?/gu) ?? []) {
      if (!packetNumbers.has(match)) allowed = false;
    }
    if (!allowed) continue;
    if (!claimSupported(title, facts)) continue;
    const body = clip(title, LIMITS.factStatement);
    if (body === "" || seen.has(body)) continue;
    seen.add(body);
    items.push({
      id: `b:${[...new Set(cited)].join("+")}`,
      text: body,
      factIds: [...new Set(cited)],
      tone: "neutral"
    });
  }
  return items;
}

/**
 * Read the model's answer as the closed JSON object it was asked for. Prose,
 * a code fence, or a wrong shape all mean "no usable answer".
 *
 * @param {string} text - raw output.
 * @returns {object[]|null} the item list, or null when unreadable.
 */
function parseAnswer(text) {
  const raw = String(text ?? "").trim();
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const value = JSON.parse(raw.slice(start, end + 1));
    return Array.isArray(value?.items) ? value.items : null;
  } catch {
    return null;
  }
}

/**
 * Decide whether an answer may still be published. A summary is only true for
 * the state it was asked about: a newer request, a pause, a new round, or new
 * facts all discard it. The usage is charged either way.
 *
 * @param {{requestId: string, currentRequestId: string|undefined, manual: boolean, autoEnabled: boolean, state: object|undefined, roundId: string, seq: number}} input - what happened while the model ran.
 * @returns {{reason: string, text: string}|null} rejection, or null when publishable.
 */
export function publishVerdict(input) {
  if (input.currentRequestId !== input.requestId) return { reason: "cancelled", text: "这次整理已取消" };
  if (input.manual !== true && input.autoEnabled !== true) return { reason: "disabled", text: "自动摘要已关闭" };
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
