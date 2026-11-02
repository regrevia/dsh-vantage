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
const EMPTY_STATEMENT = /^(?:暂无|未记录|本轮没有改动|所有检查均已通过|等待后台结果|已处理若干文件|继续工作|继续|收尾|阶段性收尾)[。.]?$/u;

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
 * The layers are separate on purpose: a reader opening a milestone wants the
 * conclusion first, then what it produced, and only then the source. Folding
 * them into one `details` list is what made the panel read like an index card.
 *
 * @param {number} index - position in the list.
 * @param {string} topic - the work, in a reader's words.
 * @param {object} layers - conclusion, results, artifacts, conditions, evidence.
 * @param {"blocked"|"done"|"in_progress"|"recorded"} state - how it ended.
 * @param {string[]} factIds - the facts behind it.
 * @param {number} at - earliest fact time, 0 when unknown.
 * @returns {object} a segment.
 */
function segmentOf(index, topic, layers, state, factIds, at) {
  return {
    id: `seg:${index}`,
    topic,
    conclusion: layers.conclusion ?? "",
    results: Array.isArray(layers.results) ? layers.results : [],
    artifacts: Array.isArray(layers.artifacts) ? layers.artifacts : [],
    conditions: Array.isArray(layers.conditions) ? layers.conditions : [],
    evidence: Array.isArray(layers.evidence) ? layers.evidence : [],
    details: Array.isArray(layers.details) ? layers.details : [],
    state,
    factIds,
    at
  };
}

/**
 * The file a deliverable fact produced, when the runtime can open it.
 * @param {object[]} facts - the round's facts.
 * @param {string} factId - cited deliverable id.
 * @returns {string} a path, or "" when the fact names none.
 */
function deliveredFileOf(facts, factId) {
  const fact = facts.find((row) => row.id === factId);
  if (fact === undefined || fact.kind !== "deliverable") return "";
  const files = Array.isArray(fact.files) ? fact.files : [];
  return files.find((file) => typeof file === "string" && file !== "") ?? "";
}

/**
 * How the work behind a segment ended. Only a recorded fact may close or block
 * it: the round being over says nothing, so a topic whose facts are gone keeps
 * the neutral `recorded` state instead of claiming a tick it cannot back.
 *
 * @param {object[]} facts - the facts the segment cites.
 * @returns {"blocked"|"done"|"in_progress"|"recorded"} state.
 */
function stateOfFacts(facts) {
  if (!Array.isArray(facts) || facts.length === 0) return "recorded";
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
 * @returns {object[]} segments, oldest topic first: `{ id, topic, conclusion,
 *   results, artifacts, conditions, evidence, state, factIds, at }`.
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
    const clean = (value, max) => (Array.isArray(value) ? value : [])
      .map((line) => String(line ?? "").trim())
      .filter((line) => usableStatement(line) && line !== headline && !headline.includes(line))
      .slice(0, max);
    const conclusion = typeof topic.conclusion === "string" && usableStatement(topic.conclusion.trim()) ? topic.conclusion.trim() : "";
    const artifacts = (Array.isArray(topic.artifacts) ? topic.artifacts : [])
      .map((artifact) => {
        const title = String(artifact?.title ?? "").trim();
        const factId = typeof artifact?.factId === "string" ? artifact.factId : "";
        if (title === "" || factId === "" || !ids.includes(factId)) return null;
        const row = { id: `art:${factId}`, title, factId };
        const path = deliveredFileOf(facts, factId);
        if (path !== "") row.path = path;
        return row;
      })
      .filter(Boolean)
      .slice(0, 3);
    const times = backing.map((fact) => Number(fact.updatedAt ?? fact.createdAt ?? 0)).filter((at) => at > 0);
    // The round being over says nothing about the work being finished: a
    // failed check leaves its topic open, and only a recorded result closes it.
    out.push(segmentOf(out.length + 1, headline, {
      conclusion,
      results: clean(topic.results, 3),
      artifacts,
      conditions: clean(topic.conditions, 2),
      details: clean(topic.details, 2)
    }, stateOfFacts(backing), ids, times.length > 0 ? Math.min(...times) : 0));
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
 * @returns {object[]} segments in work order: `{ id, topic, conclusion,
 *   results, artifacts, conditions, evidence, state, factIds, at }`.
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
    const factIds = group.map((fact) => fact.id).filter((id) => typeof id === "string");
    // Without a summary topic there is no stated conclusion, and inventing one
    // here would be a guess: the recorded sentence becomes the headline and the
    // deliverables it points at stay openable.
    groups.push(segmentOf(groups.length, String(first.statement).trim(), {
      artifacts: group
        .filter((fact) => fact.kind === "deliverable")
        .map((fact) => ({ id: `art:${fact.id}`, title: String(fact.statement).trim(), factId: fact.id, path: deliveredFileOf(facts, fact.id) }))
        .filter((artifact) => artifact.path !== "")
    }, stateOfFacts(group), factIds, times.length > 0 ? Math.min(...times) : 0));
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
 * @returns {Array<{id: string, topic: string, conclusion: string, results: string[], artifacts: object[], conditions: string[], evidence: object[], state: string, factIds: string[], at: number}>} segments.
 */
export function buildSegments(round, topics = [], options = {}) {
  const max = Number.isFinite(options.max) && options.max > 0 ? Math.floor(options.max) : 3;
  const facts = Array.isArray(round?.facts) ? round.facts.filter((fact) => fact !== null && fact !== undefined) : [];
  const fromTopics = Array.isArray(topics) ? segmentsFromTopics(topics, facts, max) : [];
  if (fromTopics.length > 0) return fromTopics;
  // No verified topic, no segment. Which command ran is evidence, never a
  // substitute for the work: an invented label would claim a change nobody
  // recorded, so an empty list is the honest answer here.
  if (facts.length === 0) return [];
  return segmentsFromFacts(facts, max);
}
