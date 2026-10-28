/**
 * Shared vocabulary for the Harness half: clipping, stable ids, response envelopes,
 * and the status vocabulary the client translates.
 *
 * Nothing here renders. Every string that leaves this module is either a fact
 * statement (Chinese by product decision) or a stable machine key the client
 * maps to localised copy. Prose never carries a code that the client must parse.
 */

/** Wire contract version. Bump only alongside a client change. */
export const SCHEMA_VERSION = 3;

/** Route prefix; every route below is one exact Fetch route. */
export const ROUTE_PREFIX = "/api/dsh-vantage";

export const ROUTES = Object.freeze({
  snapshot: `${ROUTE_PREFIX}/snapshot`,
  history: `${ROUTE_PREFIX}/history`,
  round: `${ROUTE_PREFIX}/round`,
  evidence: `${ROUTE_PREFIX}/evidence`,
  summaryRequest: `${ROUTE_PREFIX}/summary/request`,
  enable: `${ROUTE_PREFIX}/enable`
});

/* ------------------------------------------------------------------ *
 * Bounds. Every user-visible string is clipped here so that no code path
 * can publish an unbounded fragment of a log or a tool result.
 * ------------------------------------------------------------------ */

export const LIMITS = Object.freeze({
  title: 120, // ui-copy-ignore
  statusText: 200,
  factStatement: 240,
  factRefs: 8, // ui-copy-ignore
  excerpt: 600, // ui-copy-ignore
  evidenceRows: 3, // ui-copy-ignore
  topics: 3,
  topicHeadline: 60, // ui-copy-ignore
  topicQualifier: 28,
  topicDetails: 2, // ui-copy-ignore
  topicDetailChars: 160,
  briefItems: 3,
  urgentItems: 1,
  totalBriefItems: 4,
  verificationConditions: 12,
  shownConditions: 3,
  outcomes: 3, // ui-copy-ignore
  historyPreview: 5,
  notices: 2, // ui-copy-ignore
  roundFacts: 200,
  urgentFacts: 64,
  serializedSnapshot: 16384
});

/**
 * Clip on a code-point boundary so a surrogate pair is never split, and prefer
 * the last space or Chinese full stop before the cut so a sentence does not end
 * mid-word.
 *
 * @param {unknown} value - candidate text; non-strings yield "".
 * @param {number} max - maximum code points kept, before the ellipsis.
 * @returns {string} clipped text, never longer than `max + 1`.
 */
export function clip(value, max) {
  if (typeof value !== "string") return "";
  const text = value.replace(/\s+/gu, " ").trim();
  if (text === "") return "";
  const points = Array.from(text);
  if (points.length <= max) return text;
  const head = points.slice(0, max);
  for (let cut = head.length; cut > max * 0.6; cut -= 1) {
    const last = head[cut - 1];
    if (last === " " || last === "。" || last === "，" || last === "\n") {
      return `${head.slice(0, cut).join("").trimEnd()}…`;
    }
  }
  return `${head.join("")}…`;
}

/* ------------------------------------------------------------------ *
 * Stable identity. A round id is derived from the runtime session identity and
 * the sequence of the event that opened the round, so a reload, a fork, or a
 * reused display position can never inherit somebody else's watermark.
 * ------------------------------------------------------------------ */

/**
 * Build the stable key of one round.
 * @param {string} sessionId - runtime session id.
 * @param {number} startSeq - sequence of the opening event.
 * @returns {string} opaque round id.
 */
export function roundIdOf(sessionId, startSeq) {
  // The whole session id, not a short prefix: two live sessions that share
  // eight characters would otherwise produce the same round id and overwrite
  // each other's archived history.
  return `${String(sessionId).replace(/^session-/u, "")}:${startSeq}`;
}

/**
 * The readable head of a session id, without the `session-` transport prefix.
 * @param {string} sessionId - runtime session id.
 * @returns {string} eight characters that identify the session.
 */
export function shortSessionId(sessionId) {
  return String(sessionId).replace(/^session-/, "").slice(0, 8);
}

/**
 * Build the stable key of one fact.
 * @param {string} roundId - owning round.
 * @param {string} kind - recogniser kind.
 * @param {string} subject - de-duplication subject inside the kind.
 * @returns {string} opaque fact id.
 */
export function factIdOf(roundId, kind, subject) {
  return `f:${roundId}:${kind}:${subject}`;
}

/* ------------------------------------------------------------------ *
 * Status vocabulary. The client owns the words; the runtime owns the decision.
 * `statusKey` is what the client switches on. `statusLine` is only a fallback
 * for a client that does not know a newer key yet.
 * ------------------------------------------------------------------ */

export const STATUS_KEYS = Object.freeze([
  "checking",
  "needs-input",
  "waiting",
  "failing",
  "no-news",
  "disconnected",
  "running",
  "answered-unverified",
  "verified"
]);

export const VERIFICATION_STATES = Object.freeze([
  "passed",
  "pending",
  "failed",
  "recheck",
  "unknown",
  "na"
]);

export const ROUND_STATES = Object.freeze(["awaiting-reply", "archived"]);
export const RUNTIME_STATES = Object.freeze(["running", "idle", "disconnected"]);
export const GOAL_STATES = Object.freeze([
  "none",
  "active",
  "paused",
  "blocked",
  "complete",
  "unknown"
]);

/* ------------------------------------------------------------------ *
 * Responses.
 * ------------------------------------------------------------------ */

/**
 * A no-store JSON response. Reads are never cacheable: the browser must not
 * serve a stale brief after a reload.
 * @param {unknown} body - serialisable payload.
 * @param {number} status - HTTP status.
 * @returns {Response} response with the mandated headers.
 */
export function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}

/**
 * A structured failure. The message is operator-facing and must never contain a
 * credential, an environment value, or a log tail.
 * @param {string} code - stable failure code.
 * @param {string} message - short cause.
 * @param {number} status - HTTP status.
 * @returns {Response} failure envelope.
 */
export function failure(code, message, status = 400) {
  return json({ error: { code, message } }, status);
}

export class OverviewError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = "OverviewError";
    this.code = code;
    this.status = status;
  }
}

/**
 * Run a route handler and convert every throw into a structured envelope.
 * Unexpected throws are logged once and reported as `internal` without the
 * original message, so a stack or a path cannot leak through the wire.
 *
 * @param {(request: Request) => Promise<Response>} handler - route body.
 * @param {(message: string) => void} warn - runtime logger.
 * @returns {(request: Request) => Promise<Response>} guarded handler.
 */
export function guarded(handler, warn) {
  return async (request) => {
    try {
      return await handler(request);
    } catch (error) {
      if (error instanceof OverviewError) {
        return failure(error.code, error.message, error.status);
      }
      warn(`route failure: ${error instanceof Error ? error.message : String(error)}`);
      return failure("internal", "请求未能完成", 500);
    }
  };
}

/**
 * Read a required query parameter.
 * @param {URL} url - request address.
 * @param {string} name - parameter name.
 * @returns {string} the value.
 * @throws {OverviewError} when absent or blank.
 */
export function requiredParam(url, name) {
  const value = url.searchParams.get(name);
  if (value === null || value.trim() === "") {
    throw new OverviewError("bad-request", `missing ${name}`, 400);
  }
  return value;
}

/**
 * Read a bounded integer query parameter.
 * @param {URL} url - request address.
 * @param {string} name - parameter name.
 * @param {number} fallback - value when absent.
 * @param {number} min - inclusive lower bound.
 * @param {number} max - inclusive upper bound.
 * @returns {number} the clamped value.
 */
export function intParam(url, name, fallback, min, max) {
  const raw = url.searchParams.get(name);
  if (raw === null || raw.trim() === "") return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isSafeInteger(parsed)) {
    throw new OverviewError("bad-request", `${name} is not an integer`, 400);
  }
  return Math.min(max, Math.max(min, parsed));
}

/**
 * Parse a JSON request body with a size ceiling. A body that is too large is
 * rejected before it is parsed, so a huge input cannot cost memory.
 *
 * @param {Request} request - incoming request.
 * @param {number} maxChars - ceiling on the decoded body.
 * @returns {Promise<object>} parsed object body.
 * @throws {OverviewError} when the body is missing, oversized, or not an object.
 */
export async function readJsonBody(request, maxChars = 4096) {
  const text = await request.text();
  if (text.length > maxChars) {
    throw new OverviewError("bad-request", "request body is too large", 413);
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new OverviewError("bad-request", "request body is not valid JSON", 400);
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new OverviewError("bad-request", "request body must be an object", 400);
  }
  return parsed;
}

/**
 * Read a required string field of a body object.
 * @param {object} body - parsed body.
 * @param {string} name - field name.
 * @returns {string} trimmed value.
 * @throws {OverviewError} when absent or blank.
 */
export function requiredField(body, name) {
  const value = body[name];
  if (typeof value !== "string" || value.trim() === "") {
    throw new OverviewError("bad-request", `missing ${name}`, 400);
  }
  return value.trim();
}
