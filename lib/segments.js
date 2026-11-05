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

/**
 * Kinds that may stand alone when no verified topic exists. A changed file or
 * a passing check is a state of the work, not a piece of work: only something
 * that was actually delivered or actually stopped the round earns a card of
 * its own. Everything else stays in the summary and the fact rows.
 */
const FALLBACK_KINDS = Object.freeze(["blocker", "failure", "interruption", "deliverable"]);

/**
 * Statements that only describe the act of working. They are what a reader
 * complains about when a panel says "检查中" or "更新了实现" and nothing else.
 */
const EMPTY_STATEMENT = /^(?:暂无|未记录|本轮没有改动|所有检查均已通过|等待后台结果|已处理若干文件|继续工作|继续|收尾|阶段性收尾)[。.]?$/u;

/**
 * A check that merely passed says the work held, not what the work was. The
 * panel showed "用例检查通过" for a round that also changed three files, and
 * "lib 通过" as its largest headline for a run whose real work was elsewhere.
 * A test runner's name is not a subject either.
 */
const PROCESS_RESULT = /^(?=[^，。；：]{0,20}$)(?=.*(?:检查|校验|验证|测试|用例|构建|编译|类型|排印|文案|样式|lint|lib|npm|pnpm|node|tsc|jest|vitest|pytest|eslint|stylelint|build))[^，。；：]{2,20}(?:通过|成功|正常|无报错|无异常)$/iu;

/** A pass line with no subject at all: "全部通过" names nothing a reader can act on. */
const BARE_RESULT = /^(?:本轮|整体|全部|所有)?\s*(?:检查|校验|验证|测试|用例|构建|类型|lint|lib|ci)?\s*(?:全部|均|都)?\s*(?:通过|成功|正常|无报错|无异常)[。.]?$/iu;

/**
 * Whether a line is only a check's verdict rather than the work it checked.
 * @param {unknown} text - candidate statement.
 * @returns {boolean} true when the line reports a state and nothing else.
 */
export function stateOnlyTitle(text) {
  const body = String(text ?? "").trim();
  return body !== "" && (PROCESS_RESULT.test(body) || BARE_RESULT.test(body));
}

/** A command, an argument list or a bare tool name is not a work statement. */
const COMMAND_SHAPE = /^\s*(?:[$#>]\s*)?(?:grep|rg|egrep|cat|sed|awk|tail|head|ls|find|xargs|wc|du|df|stat|file|diff|sort|uniq|cut|tr|tee|touch|ln|jq|python3?|node|npm|pnpm|yarn|npx|git|gh|curl|wget|sleep|cd|echo|printf|mkdir|rmdir|rm|cp|mv|chmod|chown|brew|pip3?|uv|timeout|test|bash|sh|zsh|make|cmake|docker|ps|lsof|kill|pkill|killall|defaults|open|osascript|launchctl|swift|xcrun|xcodebuild|codesign|zip|unzip|tar|rsync|ssh|scp|ping|plutil|sips|ffmpeg)\b/iu;
const ARGUMENT_SHAPE = /^(?:-{1,2}[A-Za-z]|[A-Za-z_][A-Za-z0-9_]*=)/u;
/** Two commands chained, or a pipeline: a line that joins commands is one. */
const SHELL_OPS = /(?:&&|\|\||\$\(|(?:^|\s)\|(?=\s)|`)/u;
/** A thrown error or a crash line is output of the tools, not a statement. */
const ERROR_SHAPE = /^(?:[A-Za-z]*Error|[A-Za-z]*Exception|Traceback|FAIL(?:ED)?|fatal)\b/u;

/**
 * A failure a tool reported, in the shape it reaches the panel: the harness
 * prefix, the JavaScript error, or the blocked-write banner. The panel showed
 * such a banner as the line under a round, which is the tool's own output, not
 * a sentence about the work.
 */
const TOOL_FAILURE = /(?:^|[:：\s])(?:[A-Za-z]*Error|[A-Za-z]*Exception)\s*[:：]|\[[A-Z][A-Z0-9_]{2,}\]|\b(?:ENOENT|EACCES|EPERM|EADDRINUSE|ELIFECYCLE|ETIMEDOUT)\b/u;

/**
 * A note the harness writes about its own machinery, in English: an interrupted
 * tool call, a background subagent, a run whose outcome is unknown. The history
 * list printed such a note under a round as if it were the work.
 */
const PROCESS_NOTE_EN = /\b(?:tool calls?|tool results?|subagent|durably recorded|outcome is unknown|interrupted|interruption|no result was recorded)\b/iu;

/**
 * A folder name followed by a verdict is a check that ran on a directory, and
 * the directory is not work a reader can read. The panel showed such a line as
 * the one line under a round that had done far more than pass a check.
 */
const PATH_VERDICT = /^(?:[\w.@-]+\/){1,4}\s*(?:通过|成功|正常|失败|无报错|无异常)[。.]?$/u;

/**
 * Whether a line is a command rather than a statement about the work.
 * @param {unknown} text - candidate line.
 * @returns {boolean} true when it reads as a command.
 */
export function commandShaped(text) {
  const body = String(text ?? "").trim();
  if (body === "") return false;
  if (TOOL_FAILURE.test(body)) return true;
  if (PATH_VERDICT.test(body)) return true;
  if (PROCESS_NOTE_EN.test(body) && !/[\u4e00-\u9fff]/u.test(body)) return true;
  if (COMMAND_SHAPE.test(body)) return true;
  if (ARGUMENT_SHAPE.test(body)) return true;
  if (SHELL_OPS.test(body)) return true;
  if (ERROR_SHAPE.test(body)) return true;
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
  if (stateOnlyTitle(body)) return false;
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
 * Fold the single most concrete fact into one fallback card, and only when the
 * model wrote no verified topic. A changed file or a passing check is not a
 * piece of work a reader can act on, so those stay out; a delivered artifact
 * or a real blocker is. There is no invented conclusion here: the card keeps
 * the recorded sentence and the file it points at, and nothing else.
 *
 * @param {object[]} facts - the round's facts.
 * @param {number} max - most segments to return.
 * @returns {object[]} one segment at most, in the same shape as a topic one.
 */
function segmentsFromFacts(facts, max) {
  if (max < 1) return [];
  const usable = facts.filter((fact) => fact !== null && fact !== undefined && FALLBACK_KINDS.includes(fact.kind) && usableStatement(fact.statement));
  for (const kind of FALLBACK_KINDS) {
    const fact = usable.find((row) => row.kind === kind);
    if (fact === undefined) continue;
    const path = deliveredFileOf(facts, fact.id);
    const artifacts = kind === "deliverable" && path !== ""
      ? [{ id: `art:${fact.id}`, title: String(fact.statement).trim(), factId: fact.id, path }]
      : [];
    const at = Number(fact.updatedAt ?? fact.createdAt ?? 0);
    return [segmentOf(1, String(fact.statement).trim(), { artifacts }, stateOfFacts([fact]), [fact.id], at > 0 ? at : 0)];
  }
  return [];
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
  // No verified topic, no invented work. Only a delivered file or a recorded
  // stop is concrete enough to stand alone; everything else stays in the
  // summary and the fact rows rather than becoming a labelled empty card.
  if (facts.length === 0) return [];
  return segmentsFromFacts(facts, max);
}
