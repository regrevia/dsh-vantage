/**
 * Work segments: the unit the overview shows instead of tool calls.
 *
 * A tool call proves the model did something; it never says what the work was.
 * This module folds the round's internal facts into a few statements a reader
 * can act on, and refuses to print the ones that only name a command.
 *
 * Two sources, in order of authority:
 *   1. the verified summary's topics — written by the model, checked against
 *      real facts by `verifyAnswer`, so they carry meaning rather than counts;
 *   2. the round's own facts — one statement per kind of work, only when the
 *      statement names an object, a change, or a result.
 *
 * Commands, paths and file reads are evidence here, never segments.
 */

/** Kinds that may become a visible segment on their own. */
const SEGMENT_KINDS = Object.freeze(["change", "check", "deliverable", "blocker", "failure", "interruption"]);

/**
 * Statements that only describe the act of working. They are what a reader
 * complains about when a panel says "检查中" or "更新了实现" and nothing else.
 */
const EMPTY_STATEMENT = /(?:正在检查|正在处理|更新了实现|完成若干(?:次)?检查|又完成几处收尾|等待后台结果|已处理若干文件|本轮没有改动|所有检查均已通过|暂无|未记录|收尾|阶段性)/u;

/** A command, an argument list or a bare tool name is not a work statement. */
const COMMAND_SHAPE = /^\s*(?:[$#>]\s*)?(?:grep|rg|egrep|cat|sed|awk|tail|head|ls|find|xargs|python3?|node|npm|pnpm|yarn|npx|git|curl|wget|sleep|cd|echo|mkdir|rm|cp|mv|chmod|chown|brew|pip3?|uv|timeout|test|bash|sh|zsh)\b/iu;
const ARGUMENT_SHAPE = /^(?:-{1,2}[A-Za-z]|[A-Za-z_][A-Za-z0-9_]*=)/u;

/**
 * Whether a line is a command rather than a statement about the work.
 * @param {unknown} text - candidate line.
 * @returns {boolean} true when it reads as a command.
 */
export function commandShaped(text) {
  const body = String(text ?? "").trim();
  if (body === "") return false;
  if (COMMAND_SHAPE.test(body)) return true;
  if (ARGUMENT_SHAPE.test(body)) return true;
  // A bare path names a place, not a piece of work. A sentence that merely
  // happened to contain a path ("已生成：/repo/out.txt") is still a statement.
  if (/^(?:~|\.{0,2})\//u.test(body) && !/\s/u.test(body) && !/[\u4e00-\u9fff]/u.test(body)) return true;
  return false;
}

/**
 * Whether a statement can stand in front of a reader.
 * @param {unknown} text - candidate statement.
 * @returns {boolean} true when it names work a reader cares about.
 */
export function usableStatement(text) {
  const body = String(text ?? "").trim();
  if (body.length < 6) return false;
  if (commandShaped(body)) return false;
  if (EMPTY_STATEMENT.test(body)) return false;
  return true;
}

/**
 * The state of a segment, from the facts behind it.
 * @param {object[]} facts - facts in the segment.
 * @returns {"blocked"|"done"|"in_progress"} one of three states.
 */
function stateOfFacts(facts) {
  const kinds = new Set(facts.map((fact) => fact.kind));
  if (kinds.has("blocker") || kinds.has("failure") || kinds.has("interruption")) return "blocked";
  if (kinds.has("deliverable")) return "done";
  return "in_progress";
}

/**
 * Fold verified summary topics into segments. A topic without details is still
 * a segment: its headline is what the model said the stretch of work was about.
 *
 * @param {object[]} topics - verified topics from the stored summary.
 * @param {object[]} facts - the round's facts, for ids and state.
 * @param {number} max - most segments to return.
 * @returns {object[]} segments, oldest topic first.
 */
function segmentsFromTopics(topics, facts, max) {
  const byId = new Map(facts.filter((fact) => fact !== null && fact !== undefined && typeof fact.id === "string").map((fact) => [fact.id, fact]));
  const out = [];
  const seen = new Set();
  for (const topic of topics) {
    if (out.length >= max) break;
    const headline = typeof topic?.headline === "string" ? topic.headline.trim() : "";
    if (!usableStatement(headline)) continue;
    const key = headline.replace(/[\s。！？；：，、.!?;:,]/gu, "");
    if (key === "" || seen.has(key)) continue;
    seen.add(key);
    const ids = (Array.isArray(topic.factIds) ? topic.factIds : []).filter((id) => typeof id === "string");
    const backing = ids.map((id) => byId.get(id)).filter(Boolean);
    const details = (Array.isArray(topic.details) ? topic.details : [])
      .map((detail) => String(detail ?? "").trim())
      .filter((detail) => usableStatement(detail) && !headline.includes(detail))
      .slice(0, 2);
    const times = backing.map((fact) => Number(fact.updatedAt ?? fact.createdAt ?? 0)).filter((at) => at > 0);
    out.push({
      id: `seg:${out.length + 1}`,
      topic: headline,
      details,
      state: backing.length > 0 ? stateOfFacts(backing) : "in_progress",
      factIds: ids,
      at: times.length > 0 ? Math.min(...times) : 0
    });
  }
  return out;
}

/**
 * Fold the round's remaining facts into at most one segment per kind of work,
 * in the order the work happens: what was found, what changed, what was
 * checked, what was delivered. Only clean statements survive; a round whose
 * facts are all commands and file reads yields no segment at all, which the
 * panel shows as an honest wait instead of a log.
 *
 * @param {object[]} facts - the round's facts.
 * @param {number} max - most segments to return.
 * @returns {object[]} segments.
 */
function segmentsFromFacts(facts, max) {
  const groups = [];
  const order = ["change", "deliverable", "check", "blocker", "failure", "interruption"];
  const usable = facts.filter((fact) => fact !== null && fact !== undefined && SEGMENT_KINDS.includes(fact.kind) && usableStatement(fact.statement));
  for (const kind of order) {
    if (groups.length >= max) break;
    const group = usable.filter((fact) => fact.kind === kind);
    if (group.length === 0) continue;
    const first = group[0];
    const times = group.map((fact) => Number(fact.updatedAt ?? fact.createdAt ?? 0)).filter((at) => at > 0);
    groups.push({
      id: `seg:${groups.length + 1}`,
      topic: String(first.statement).trim(),
      details: [],
      state: stateOfFacts(group),
      factIds: group.map((fact) => fact.id).filter((id) => typeof id === "string"),
      at: times.length > 0 ? Math.min(...times) : 0
    });
  }
  return groups;
}

/**
 * The segments a round shows: verified summary topics when they exist, the
 * round's own clean facts otherwise.
 *
 * @param {object|null} round - round with facts.
 * @param {object[]} [topics] - verified topics, when a fresh summary exists.
 * @param {object} [options] - `max` segments, default 3.
 * @returns {Array<{id: string, topic: string, details: string[], state: string, factIds: string[], at: number}>} segments.
 */
export function buildSegments(round, topics = [], options = {}) {
  const max = Number.isFinite(options.max) && options.max > 0 ? Math.floor(options.max) : 3;
  const facts = Array.isArray(round?.facts) ? round.facts.filter((fact) => fact !== null && fact !== undefined) : [];
  const fromTopics = Array.isArray(topics) ? segmentsFromTopics(topics, facts, max) : [];
  if (fromTopics.length > 0) return fromTopics;
  if (facts.length === 0) return [];
  return segmentsFromFacts(facts, max);
}
