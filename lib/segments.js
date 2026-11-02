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

/**
 * A check that merely passed says the work held, not what the work was. The
 * panel showed "用例检查通过" for a round that also changed three files.
 */
const PROCESS_RESULT = /^(?=[^，。；：]{0,16}?)(?=.*(?:检查|验证|测试|用例|构建|类型|排印|文案|lint|Lint))[^，。；：]{2,16}(?:通过|成功|正常)$/u;

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
  if (PROCESS_RESULT.test(body)) return false;
  return true;
}

/**
 * One segment, in the one shape every builder here produces.
 *
 * @param {number} index - position in the list.
 * @param {string} topic - the work, in a reader's words.
 * @param {string[]} details - supporting statements.
 * @param {"blocked"|"done"|"in_progress"} state - how it ended.
 * @param {string[]} factIds - the facts behind it.
 * @param {number} at - earliest fact time, 0 when unknown.
 * @returns {object} a segment.
 */
function segmentOf(index, topic, details, state, factIds, at) {
  return { id: `seg:${index}`, topic, details, state, factIds, at };
}

/**
 * The work a command belongs to. A check that ran is 用例检查，一次 lint 是
 * 文案与排版检查：真正敲下去的那串字符不会出现在页面上。
 */
const JOB_LABELS = Object.freeze([
  [/\btest\b|run\.mjs\b/u, "用例检查"],
  [/lint|zh-lint|style-lint|ui-copy-lint/u, "文案与排版检查"],
  [/node\s+--check/u, "语法检查"],
  [/git\s+commit/u, "提交改动"],
  [/git\s+push/u, "推送改动"],
  [/python3?\s+-|\bperl\b/u, "改写文件"],
  [/curl|wget/u, "线上数据核对"],
  [/plugin_manager|npm\s+install|pnpm\s+(?:add|install)/u, "安装与发布"]
]);

/**
 * @param {unknown} text - a recorded command.
 * @returns {string} the work it belongs to, or "" for a read-only call.
 */
export function jobLabelOf(text) {
  const body = String(text ?? "");
  if (commandShaped(body) !== true) return "";
  if (/^(?:\s*[$#>]\s*)?(?:grep|rg|cat|sed|awk|tail|head|ls|find|sleep|cd|echo)\b/u.test(body)) return "";
  for (const [pattern, label] of JOB_LABELS) if (pattern.test(body)) return label;
  return "";
}

/**
 * Fold recorded commands into the few kinds of work they add up to, one
 * segment per kind, in the order the work first appeared.
 *
 * @param {object[]} facts - the round's command facts.
 * @param {number} max - most segments to return.
 * @param {"done"|"in_progress"} quietState - state of a topic with no live fact behind it.
 * @returns {object[]} segments.
 */
function segmentsFromJobs(facts, max) {
  const voices = new Map();
  for (const fact of facts) {
    if (fact.kind !== "job") continue;
    const label = jobLabelOf(fact.statement);
    if (label === "") continue;
    const seen = voices.get(label);
    if (seen === undefined) voices.set(label, { facts: [fact] });
    else seen.facts.push(fact);
  }
  const out = [];
  for (const [label, group] of voices) {
    if (out.length >= max) break;
    const factIds = group.facts.map((fact) => fact.id).filter((id) => typeof id === "string");
    out.push(segmentOf(out.length + 1, label, [], "done", factIds, 0));
  }
  return out;
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
 * @param {"done"|"in_progress"} quietState - state of a topic with no live fact behind it.
 * @returns {object[]} segments, oldest topic first.
 */
/**
 * A segment's state, with the round's own age taken into account.
 *
 * A settled round is not still working: only a blocker keeps a statement open,
 * and everything else it touched is finished work. A live round keeps whatever
 * its facts claim, so a change in flight still reads as in progress.
 *
 * @param {object[]} backing - facts behind the topic.
 * @param {"done"|"in_progress"} quietState - state for a topic with no fact.
 * @returns {"blocked"|"done"|"in_progress"} state of the segment.
 */
function settledState(backing, quietState) {
  const claimed = backing.length > 0 ? stateOfFacts(backing) : quietState;
  if (quietState === "in_progress") return claimed;
  return claimed === "blocked" ? "blocked" : "done";
}

function segmentsFromTopics(topics, facts, max, quietState) {
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
      state: settledState(backing, quietState),
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
 * @param {"done"|"in_progress"} quietState - state of a topic with no live fact behind it.
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
  const quietState = options.quietState === "done" ? "done" : "in_progress";
  const max = Number.isFinite(options.max) && options.max > 0 ? Math.floor(options.max) : 3;
  const facts = Array.isArray(round?.facts) ? round.facts.filter((fact) => fact !== null && fact !== undefined) : [];
  const fromTopics = Array.isArray(topics) ? segmentsFromTopics(topics, facts, max, quietState) : [];
  if (fromTopics.length > 0) return fromTopics;
  if (facts.length === 0) return [];
  const fromFacts = segmentsFromFacts(facts, max);
  if (fromFacts.length > 0) return fromFacts;
  return segmentsFromJobs(facts, max);
}
