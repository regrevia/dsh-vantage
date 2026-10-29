/**
 * The pure reducer. One function of `(state, event)`, no I/O, no clocks beyond the
 * event's own `time`, no imports outside this package. It is the only place that
 * decides what happened; every other runtime module formats or stores its output.
 *
 * Two invariants matter most and are enforced here rather than downstream:
 *
 * 1. A round is opened by a user message that begins a turn, not by an internal
 *    continuation. A goal-driven turn continues the round it belongs to.
 * 2. A formal reply requires an authoritative `turn/end` with reason `completed`
 *    *and* a closing assistant message that carries visible text and no pending
 *    tool call. Everything weaker stays "awaiting reply".
 *
 * The state is plain JSON (no Map/Set/exotic values) because the session
 * projection checkpoints it with `structuredClone`.
 */

import { LIMITS, ROUND_STATES, clip, factIdOf, roundIdOf } from "./schema.js";

/* ------------------------------------------------------------------ *
 * Recognisers. Deliberately small: an unrecognised tool still produces a
 * generic fact when it failed, and nothing at all when it merely succeeded.
 * ------------------------------------------------------------------ */

/** Tool names that change the workspace, matched on the bare tool name. */
const CHANGE_TOOLS = ["write", "edit", "patch", "create_file", "str_replace", "multiedit", "apply_patch"];

/** Tool names that run a check whose outcome is evidence. */
const CHECK_COMMAND_RE =
  /\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:test|build|lint|check|typecheck|tsc)\b|\b(?:pytest|jest|vitest|mocha|tsc|cargo\s+(?:test|build|check)|go\s+(?:test|build|vet)|make|gradle|mvn|dotnet\s+(?:test|build))\b|\bnode\s+(?:--test\b|[^\s|;&]+\.(?:[cm]?[jt]s)\b)/iu;

/** Shell-ish tools whose arguments may carry a command. */
const COMMAND_TOOLS = ["bash", "shell", "terminal", "exec", "command", "run"];

/**
 * Sources the harness injects for the model's benefit. They are context, not a
 * request: they never open a round and never name one. Older logs carry no
 * source at all, so a missing kind is read as a human turn.
 */
const INJECTED_SOURCE_KINDS = new Set(["skill-catalog", "time-context", "compact-checkpoint", "system-reminder", "plugin"]);

/** How many closed rounds stay available for a result that arrives late. */
const RECENT_ROUND_LIMIT = 10;

/** Commands that only look at the workspace; they never count as a check. */
const READ_ONLY_COMMAND_RE =
  /^\s*(?:cd\b[^&|]*&&\s*)*(?:ls|cat|grep|rg|sed|head|tail|wc|find|file|stat|du|pwd|echo|printenv|git\s+(?:status|diff|log|show)|zstd|java|python3?\s+-\s*<<)/u;

/** What a recognised check runs. Kept for grouping, never shown as a title. */
const CHECK_KINDS = [
  [/lint/iu, "lint"],
  [/typecheck|\btsc\b/iu, "typecheck"],
  [/build/iu, "build"],
  [/test|jest|vitest|pytest|mocha/iu, "test"]
];

/** What to call a check that names no target, in the reader's words. */
const CHECK_KIND_LABELS = { lint: "检查", typecheck: "类型检查", build: "构建", test: "测试", check: "检查" };

/** Words that name the runner rather than the thing being checked. */
const RUNNER_WORDS = new Set([
  "npm", "pnpm", "yarn", "bun", "npx", "node", "deno", "run", "exec", "ci",
  "test", "tests", "lint", "typecheck", "tsc", "build", "check", "pytest",
  "jest", "vitest", "mocha", "make", "gradle", "mvn", "cargo", "go", "dotnet",
  "watch", "coverage"
]);

/**
 * Name the work a check touched, so a topic reads as work rather than as a tool.
 *
 * @param {string} command - command line of the check.
 * @returns {string} a path or target, or "" when the command names none.
 */
function checkTargetOf(command) {
  // Only the segment that runs the check names the work. A pager after a pipe
  // (`... | tail -12`) is instrumentation: it used to become the target, so a
  // test run read back as "tail 通过".
  const segments = String(command).split(/\|\||&&|\||;|>>?/u).map((part) => part.trim()).filter((part) => part !== "");
  const segment = segments.find((part) => CHECK_COMMAND_RE.test(part)) ?? segments[0] ?? "";
  const words = segment.split(/\s+/u).filter((word) => word !== "");
  for (let at = words.length - 1; at >= 0; at -= 1) {
    const word = words[at].replace(/^['"]+/u, "").replace(/['"]+$/u, "");
    if (word === "" || word.startsWith("-")) continue;
    if (RUNNER_WORDS.has(word.toLowerCase())) continue;
    if (!/^[A-Za-z0-9_@./:-]{3,}$/u.test(word)) continue;
    // A long absolute path is evidence, not a label: keep the file name.
    return clip(word.includes("/") && word.length > 28 ? word.split("/").pop() : word, 60);
  }
  return "";
}

/** Phrases that assert an outcome. Recorded as `reported`, never as evidence. */
const CLAIM_RE =
  /(?:已修复|已修正|已解决|修复完成|测试(?:全部)?通过|验证通过|构建成功|已完成|已经完成|成功修复|fixed|resolved|all tests? pass|tests? pass|build succeeds)/iu;

/**
 * A commit URL a command printed, so the finished change can be opened where it
 * landed instead of being listed as yet another modified file.
 *
 * @param {string} output - tool output.
 * @returns {string} one https URL, or "".
 */
function commitUrlOf(output) {
  const found = /https:\/\/github\.com\/[^\s)\]}"'<>]+\/commit\/[0-9a-f]{7,40}/iu.exec(String(output));
  return found === null ? "" : found[0];
}

/**
 * Whether one tool call actually asked git for something.
 *
 * Any command can print a commit URL (a test fixture, a log line, this plugin's
 * own tests). Only a call that ran git is evidence that a commit happened, so a
 * URL echoed by a test stays text instead of becoming a deliverable.
 *
 * @param {object|undefined} call - recorded tool call.
 * @returns {boolean} true for a git/gh invocation.
 */
function isGitCall(call) {
  let args = call?.args;
  if (typeof args === "string") {
    try {
      args = JSON.parse(args);
    } catch {
      args = null;
    }
  }
  const command = typeof args?.command === "string" ? args.command : "";
  return /(?:^|[\s;&|(])(?:git|gh)(?:[\s;&|)]|$)/u.test(command);
}

/**
 * Whether a tool name looks like a workspace mutation.
 * @param {string} name - tool name.
 * @returns {boolean} true for write-like tools.
 */
function isChangeTool(name) {
  // Only the tool itself counts. A plan or a note (todo_write, memory_save)
  // mentions changes without making one, and a substring test used to turn it
  // into "modified 1 file" with an empty file list.
  const bare = String(name).toLowerCase().split(/[.:]/u).pop().trim();
  return CHANGE_TOOLS.includes(bare);
}

/**
 * Whether a tool name looks like a command runner.
 * @param {string} name - tool name.
 * @returns {boolean} true for shell-like tools.
 */
function isCommandTool(name) {
  const lower = String(name).toLowerCase();
  return COMMAND_TOOLS.some((needle) => lower.includes(needle));
}

/**
 * Find a recognisable check in a tool call's arguments.
 *
 * The returned kind groups checks internally; the target names the work that was
 * checked. Neither the runner nor the tool kind becomes a headline, because a shell
 * line and "test" are not findings a reader can use.
 *
 * @param {unknown} args - raw tool arguments.
 * @returns {{command: string, kind: string, target: string}|null} the check, or null.
 */
function checkOf(args) {
  if (args === null || typeof args !== "object") return null;
  const candidates = [];
  for (const key of ["command", "cmd", "script"]) {
    const value = args[key];
    if (typeof value === "string") candidates.push(value);
  }
  for (const candidate of candidates) {
    if (READ_ONLY_COMMAND_RE.test(candidate)) continue;
    if (!CHECK_COMMAND_RE.test(candidate)) continue;
    const found = CHECK_KINDS.find(([pattern]) => pattern.test(candidate));
    return {
      command: clip(candidate, 160),
      kind: found === undefined ? "check" : found[1],
      target: checkTargetOf(candidate)
    };
  }
  return null;
}

/**
 * Read the exit status a tool printed at the end of its output.
 *
 * A command that exits non-zero still returns a normal tool result, so the
 * status lives in the text as `[exit code: N]`; without reading it a failed
 * test looks like a pass.
 *
 * @param {string} text - tool output.
 * @returns {number|null} exit status, or null when the output carries none.
 */
function exitCodeOf(text) {
  const match = /exit code: (-?\d+)/u.exec(String(text ?? ""));
  return match === null ? null : Number(match[1]);
}

/**
 * Whether a command was handed to a background job instead of finishing.
 * @param {string} name - tool name.
 * @param {string} output - tool output.
 * @param {number|null} exit - parsed exit status.
 * @returns {boolean} true when the command only started.
 */
function isBackgroundLaunch(name, output, exit) {
  if (exit !== null || !isCommandTool(name)) return false;
  return /后台任务已启动|已在后台运行|started in (?:the )?background|running in background|background job started/iu.test(String(output ?? ""));
}

/**
 * Concatenate the visible text blocks of a message, skipping reasoning.
 * @param {unknown} content - message content blocks.
 * @returns {string} visible text.
 */
function visibleTextOf(content) {
  if (!Array.isArray(content)) return "";
  const parts = [];
  for (const block of content) {
    if (block === null || typeof block !== "object") continue;
    if (block.type === "text" && typeof block.text === "string") parts.push(block.text);
  }
  return parts.join("\n").trim();
}

/**
 * Whether a message carries a tool call.
 * @param {unknown} content - message content blocks.
 * @returns {boolean} true when a tool-call block is present.
 */
function hasToolCall(content) {
  if (!Array.isArray(content)) return false;
  return content.some(
    (block) => block !== null && typeof block === "object" && block.type === "tool-call"
  );
}

/**
 * Bumped whenever the fold changes shape or meaning, so a cached projection
 * built by an older version is rebuilt instead of being served stale.
 */
export const PROJECTION_VERSION = 5;

/**
 * Build the empty state of one session's core projection.
 * @param {string} sessionId - runtime session id.
 * @returns {object} fresh state.
 */
export function initState(sessionId) {
  return {
    v: PROJECTION_VERSION, // ui-copy-ignore
    sessionId,
    lastSeq: -1, // ui-copy-ignore
    lastEventTime: 0,
    /** Open round, or null before any user request. */
    round: null, // ui-copy-ignore
    /** Recent closed rounds, newest first; bounded for the history preview. */
    recent: [], // ui-copy-ignore
    /** Closed rounds kept whole, so a late result still reaches its own round. */
    recentRounds: [], // ui-copy-ignore
    /** Round waiting to be handed to the store by the adapter. */
    settled: null, // ui-copy-ignore
    goal: { state: "none", objective: "", updatedAt: 0 },
    jobs: {}, // ui-copy-ignore
    approvals: {},
    todos: [], // ui-copy-ignore
    pendingTurn: null,
    pendingCalls: {},
    reply: null, // ui-copy-ignore
    /**
     * Last assistant line with visible text, kept after an aborted turn clears
     * `reply`. A saved transcript must still say what the agent last said.
     */
    lastAssistant: null, // ui-copy-ignore
    /** Best session title seen so far, reused as the heading of new rounds. */
    sessionTitle: "", // ui-copy-ignore
    /** Rank behind `sessionTitle`; a later, better source replaces it. */
    sessionTitleRank: 0, // ui-copy-ignore
    /** Counters used only to render a bounded progress line. */
    counters: { steps: 0, tools: 0, failures: 0 },
    quiet: { lastDurableAt: 0, lastSeqWithNovelty: -1 }
  };
}

/**
 * A fresh round record.
 * @param {string} sessionId - runtime session id.
 * @param {number} startSeq - sequence that opened the round.
 * @param {number} time - event time.
 * @returns {object} round record.
 */
function newRound(sessionId, startSeq, time) {
  return {
    roundId: roundIdOf(sessionId, startSeq),
    startSeq,
    startedAt: time,
    updatedAt: time,
    title: "", // ui-copy-ignore
    titleSource: "user", // ui-copy-ignore
    titleRank: 0, // ui-copy-ignore
    checksStaleAt: 0, // ui-copy-ignore
    titleSeq: -1, // ui-copy-ignore
    userMessages: 0,
    turnStartSeq: null,
    turnEndSeq: null,
    turnEndKind: null,
    turnEndReason: null, // ui-copy-ignore
    openTurn: false, // ui-copy-ignore
    archivedAt: null,
    reply: null, // ui-copy-ignore
    /** Visible assistant prose in order, newest last: what the round said it was doing. */
    notes: [], // ui-copy-ignore
    facts: [], // ui-copy-ignore
    /** factId -> index, so a repeat subject updates instead of appending. */
    factIndex: {},
    conditions: [],
    conditionIndex: {},
    outcomes: [], // ui-copy-ignore
    pendingCalls: 0,
    novelties: 0
  };
}

/**
 * A compact view of a round for the history list and the store.
 * @param {object} round - full round record.
 * @returns {object} compact summary.
 */
export function summarizeRound(round) {
  if (round === null) return null;
  const facts = Array.isArray(round.facts) ? rankFacts(round) : [];
  const replyText = typeof round.reply?.text === "string"
    ? round.reply.text
    : typeof round.replyText === "string" ? round.replyText : "";
  const outcome = outcomeOfRound(round, facts);
  const detail = outcomeDetailOf(replyText, outcome);
  const work = workTitleOf(round, "", outcome);
  return {
    roundId: round.roundId, // ui-copy-ignore
    startSeq: round.startSeq, // ui-copy-ignore
    startedAt: round.startedAt,
    updatedAt: round.updatedAt,
    archivedAt: round.archivedAt,
    title: round.title, // ui-copy-ignore
    titleSource: round.titleSource, // ui-copy-ignore
    outcome,
    work, // ui-copy-ignore
    detail,
    turnEndKind: round.turnEndKind,
    hasReply: replyText.trim() !== "",
    // A chevron promises content: a reply that renders to an empty panel is
    // a static row, not a dead expander.
    hasDetail: detail !== "" || (Array.isArray(round.facts) && round.facts.length > 0)
  };
}

/**
 * The progress statement that names a round in the list.
 *
 * A round is listed by what it got done: the published summary's first claim
 * when there is one, then the produced artifact or action-level outcome, then
 * the reply's own first claim. The human's request never becomes the row title,
 * and context injected for the model is never mistaken for progress.
 *
 * @param {object} round - round record.
 * @param {string} [summary] - published summary paragraph, when available.
 * @param {string} [outcome] - already-derived outcome line.
 * @returns {string} one short progress line, or "".
 */
export function workTitleOf(round, summary = "", outcome = "") {
  const candidates = [
    summary,
    typeof round?.summaryText === "string" ? round.summaryText : "",
    outcome,
    outcomeOfRound(round, Array.isArray(round?.facts) ? rankFacts(round) : []),
    plainOutcome(round?.reply?.text ?? round?.replyText ?? "")
  ];
  for (const raw of candidates) {
    const line = plainOutcome(String(raw ?? "").split(/(?<=[。！？!?])/u)[0] ?? "")
      .replace(/^["'“”‘’「」]/u, "")
      .trim();
    if (line.length < 6) continue;
    if (isMachineLine(line)) continue;
    if (/^(?:更新了(?:实现|文档|界面样式|素材)|已保存|这一轮没有)/u.test(line)) continue;
    // A section label ("结论", "摘要") is a heading the reply was organised
    // under, not what the round produced.
    if (/^(?:结论|摘要|总结|小结|背景|结果|完成情况)(?:$|[：:])/u.test(line)) continue;
    // A copied command line or a table fragment is evidence, not a title.
    if (/[`→|]/u.test(line) || /\s-\s/u.test(line) && /[A-Za-z]/u.test(line)) continue;
    // A clause that opens with 含 / 以及 begins mid-list; a title starts at
    // its subject.
    // A clause that opens with 我/这/该 refers back to something the reader
    // cannot see; a title has to stand on its own.
    if (/^(?:我|我们|你|您|他|她|它|这|那|该|其|此|上面|上述|刚才|先前|之前|另外|所以|但|而|并|又|再)/u.test(line)) continue;
    if (/^(?:含|如|以及|包括|其中|另外|此外|同时|备注)/u.test(line)) continue;
    // A sentence cut mid-number ("2 验收完成") or naming two code paths
    // ("未 commit/push") is a fragment of documentation, not a title.
    if (/^\d+(?:\.\d+)*\s/u.test(line) || /[A-Za-z]+\/[A-Za-z]+/u.test(line)) continue;
    // A line that opens with a tool name names the tool, not the result.
    if (/^(?:mock|npm|pnpm|node|gh|git|curl)\s/iu.test(line)) continue;
    const title = line
      .replace(/\s*(?:结论|小结)$/u, "")
      .replace(/[，,、：:；;]+$/u, "")
      .trim();
    if (title.length < 6) continue;
    return clip(title, 28);
  }
  return "";
}

/**
 * Whether a line is machine context or English prose rather than a finding.
 *
 * @param {string} text - candidate line.
 * @returns {boolean} true when it cannot name a round.
 */
function isMachineLine(text) {
  const line = String(text ?? "").trim();
  if (/^(?:Current runtime context|This snapshot supersedes|【DSH 崩溃防线】)/iu.test(line)) return true;
  if (!/[\u4e00-\u9fff]/u.test(line) && line.split(/\s+/u).length >= 4) return true;
  return false;
}

/**
 * The sentence the row came from, kept whole for the expanded row.
 *
 * A row clips its outcome to one line, so the reader who opens it wants the
 * claim that line was cut from, not the whole reply. The first paragraph is
 * that claim; the row text itself is never repeated.
 *
 * @param {string} text - assistant reply text.
 * @param {string} outcome - the one-line row text.
 * @returns {string} bounded paragraph, or "" when there is nothing new.
 */
export function outcomeDetailOf(text, outcome) {
  const body = String(text ?? "").trim();
  if (body === "") return "";
  const plain = plainOutcome(text);
  const same = plainOutcome(outcome);
  const paragraphs = body
    .split(/\n\s*\n/u)
    .map((part) => part.trim())
    .filter((part) => part !== "");
  for (const part of paragraphs) {
    const line = plainOutcome(part);
    if (line.length < 12) continue;
    if (same === "" || !line.includes(same)) return boundedDetail(line);
    // The paragraph opens with the row text, so the reader needs the next
    // claim in it: a numbered list or the sentence after the verdict.
    for (const sentence of line.split(/(?<=[。！？!?])/u)) {
      const next = sentence.trim().replace(/^\d{1,2}[.、)]\s*/u, "");
      if (next.length < 12) continue;
      if (next.includes(same)) continue;
      return boundedDetail(next);
    }
  }
  return "";
}

function boundedDetail(line) {
  // "改完了。" is the writer clearing their throat; the claim follows it.
  const body = line.replace(/^(?:改完了|完成了|搞定了|好了|处理完了|已改好|已经改好)[。.!！]\s*/u, "");
  const trimmed = body.length >= 12 ? body : line;
  return trimmed.length > 420 ? `${trimmed.slice(0, 420).replace(/[，、；：,\s]+$/u, "")}…` : trimmed;
}

/**
 * One paragraph of markdown reduced to the words a reader needs.
 *
 * @param {string} text - markdown paragraph.
 * @returns {string} plain paragraph.
 */
function plainOutcome(text) {
  return String(text ?? "")
    .split("\n")
    .map((line) => line
      .replace(/^\s*(?:```\w*|>|#{1,6}\s*|[-*+•]\s+|\d+[.、)]\s*)/u, "")
      .replace(/[*_`]/gu, "")
      .trim())
    .filter((line) => line !== "")
    .join(" ")
    .replace(/\s+/gu, " ")
    .trim();
}

/**
 * What one round did, in the reader's terms.
 *
 * A history row is not a log: a check name belongs in the round it opened, not
 * in the list of rounds. So a produced artifact or an action-level change wins,
 * and a verification collapses to its result without the command that ran.
 *
 * @param {object} round - round record.
 * @param {object[]} facts - ranked facts.
 * @returns {string} short outcome line, or an empty string.
 */
function outcomeOfRound(round, facts) {
  // A row reports what the round did. The human's message says what was asked,
  // and the list of rounds is not a list of asks: the reply's first claim names
  // the row unless a produced artifact already did.
  const headline = headlineOf(round);
  if (headline !== "") return headline;
  // How a turn stopped is not what it produced. The stop state is carried
  // separately (see stopOf) so an interrupted round still reports the work it
  // completed before it stopped.
  const deliverable = facts.find((fact) => fact?.kind === "deliverable"
    && typeof fact.statement === "string" && fact.statement !== "");
  if (deliverable !== undefined) return deliverable.statement;
  const change = facts.find((fact) => fact?.kind === "change");
  // An edit is how the work happened, not what it produced: the files stay as
  // evidence, and a round that only edited says nothing rather than "更新了实现".
  if (change !== undefined) return "";
  const checks = facts.filter((fact) => fact?.kind === "check");
  if (checks.length > 0) {
    if (evaluateVerification(round).state === "failed") return "验证未通过";
    return "只做了检查，没有改动";
  }
  // A report fact is the model's own narration. Without a headline or a
  // produced artifact it is the opening caveat ("对 DSH 插件来说") far more
  // often than a result, so the row says nothing rather than something vague.
  return "";
}

/**
 * The run state of a round that stopped before it produced a result.
 *
 * Work content and run state are stored separately: this describes whether the
 * round is still running and why it stopped, never what it got done. An
 * interruption therefore updates the run state only, and the last trustworthy
 * progress report keeps naming the round.
 *
 * @param {object} round - round record.
 * @returns {{state: string, reason: string, note: string}|null} stop state, or null.
 */
export function stopOf(round) {
  const kind = round?.turnEndKind;
  if (kind !== "interrupted" && kind !== "aborted" && kind !== "error"
    && kind !== "blocked" && kind !== "disposed") return null;
  const reason = round?.turnEndReason;
  let line = "原因未记录";
  let note = "执行停止，原因未记录。";
  if (kind === "aborted") {
    const cause = reason?.reason?.kind;
    if (cause === "user") { line = "你手动停止"; note = "你终止了这一轮。"; }
    else if (cause === "parent") { line = "上游终止"; note = "上游终止了这一轮。"; }
    else if (cause === "disposed") { line = "桌面端关闭"; note = "桌面端关闭，执行停止。"; }
    else if (cause === "hook") { line = "自动流程终止"; note = "自动流程终止了这一轮。"; }
  } else if (kind === "error") {
    const error = reason?.error ?? null;
    const text = `${typeof error?.code === "string" ? error.code : ""} ${typeof error?.message === "string" ? error.message : ""}`.toLowerCase();
    if (/timeout|timed out|deadline|etimedout|超时/u.test(text)) { line = "上游请求超时"; note = "上游请求超时，执行停止。"; }
    else if (/rate.?limit|too many requests|429|限流/u.test(text)) { line = "上游限流"; note = "上游限流，执行停止。"; }
    else { line = "执行出错"; note = "执行出错，已停止。"; }
  } else if (kind === "blocked") {
    line = "达到目标上限";
    note = "达到目标上限，已停止。";
  } else if (kind === "disposed") {
    line = "桌面端关闭";
    note = "桌面端关闭，执行停止。";
  }
  return { state: "已停止", reason: line, note };
}

/**
 * Strip the markup a reply uses, keeping link labels and line boundaries.
 *
 * @param {string} raw - reply text.
 * @returns {string} plain text.
 */
function plainReplyOf(raw) {
  return raw
    .replace(/<[^>]*>/gu, " ")
    .replace(/!\[([^\]]*)\]\([^)]*\)/gu, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/gu, "$1")
    .replace(/[`*_#]+/gu, " ")
    .replace(/[ \t]+/gu, " ");
}

/**
 * Remove process words from a clause, so a row says what changed and not what
 * the turn did with it: pushed, tested, green.
 *
 * @param {string} text - clause.
 * @returns {string} clause without process tails.
 */
function dropProcessTail(text) {
  return text
    .replace(/(?:[，,、；;]\s*)?(?:测试(?:全部)?通过|全部测试通过|测试全过|门禁全绿|全部推送|已推送|并推送|已提交|并提交|全部提交|全绿|已落地|并落地|已合并|已发版)[^。！？!?]*$/gu, "")
    .trim();
}

/**
 * Whether a line carries only round bookkeeping: a round number, "result",
 * completion and push status, but no actual change.
 *
 * @param {string} line - one reply line.
 * @returns {boolean} true when the line is meta only.
 */
function isRoundMetaLine(line) {
  const text = line
    .replace(/^(?:结果|结论|汇报|总结|更新)\s*[：:]?\s*/u, "")
    .replace(/^(?:第\s*\d+\s*轮|Round\s*\d+|本轮|这一轮|这轮|这次)\s*[：:]?\s*/iu, "")
    .replace(/（[^）]*）/gu, " ")
    .replace(/[（(][^）)]*[）)]/gu, " ")
    .trim();
  if (text === "") return true;
  if (/^(?:已完成|完成|做完|收工|已推送|已提交|全部推送|全绿|门禁全绿)[。！？!?，,\s]*$/u.test(text)) return true;
  if (/^(?:对[^，。]{1,14}来说|关于[^，。]{1,14}[，,])[。！？!?]?$/u.test(text)) return true;
  if (/^(?:能|可以|是的|对|好|行)[，,].{0,10}$/u.test(text)) return true;
  return /^[一二三四五六七八九十]+、.{0,30}(?:指的是|是指|就是|意味着)/u.test(text);
}

/**
 * A bullet lead: the label before the colon, or the first sentence. This is
 * where a reply names the capability it added instead of saying "three items".
 *
 * @param {string} content - bullet text without its marker.
 * @returns {string} cleaned lead, possibly "".
 */
function bulletLeadOf(content) {
  let text = content
    .replace(/^\*\*([^*]{1,24})\*\*\s*[：:]?\s*/u, "$1：")
    .replace(/（[^）]*）/gu, " ")
    .replace(/\([^)]*\)/gu, " ")
    .replace(/(?:[A-Za-z0-9_.~/-]*\/)?[A-Za-z0-9_.-]+\.(?:html?|md|png|jpe?g|gif|webp|pdf|js|mjs|cjs|ts|tsx|jsx|css|py|sh|zsh|json|ya?ml|toml|txt|log|zip)\b/giu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  const colon = text.search(/[：:]/u);
  if (colon >= 3 && colon <= 32 && !/\d[：:]\d/u.test(text)) text = text.slice(0, colon);
  else text = text.split(/[。！？!?]/u)[0];
  // "我先前…" or "这上面…" points back at something the row cannot show.
  if (/^(?:我|我们|你|您|他|她|它)(?:先前|刚才|之前|上面|上述|前面)/u.test(text)) return "";
  text = dropProcessTail(text)
    .replace(/^(?:[-*\s]+)/u, "")
    .replace(/^(?:这一轮|本轮|这次|现在|刚才|其实|然后|所以|不过|另外|还有|总之|简单说|是我把|我把|我们|我)+/u, "")
    .replace(/^(?:本轮|这一轮)?改动[：:]\s*/u, "")
    .replace(/^(?:新增|添加|实现|提交|补齐|完成|做了|落地|修了|更新)(?:了)?\s*(?:[0-9一二三四五六七八九十两几]+\s*(?:项|个|处|条)?\s*)?(?:能力|功能|改动|提交|项|处|问题)?\s*$/u, "")
    .replace(/[。！？!?：:，,、；;（(\s]+$/u, "")
    .trim();
  return text;
}

/**
 * Whether a line only counts work ("two capabilities", "four commits") without
 * naming any of it.
 *
 * @param {string} line - plain line.
 * @returns {boolean} true for a count without content.
 */
function isCountOnly(line) {
  const text = line.replace(/[。！？!?：:，,、；;\s]+$/u, "").trim();
  if (text.length > 18) return false;
  return /(?:新增|添加|实现|提交|补齐|完成|做了|落地|修了|更新|又)\s*(?:[0-9一二三四五六七八九十两几]+\s*(?:项|个|处|条)?\s*)?(?:能力|功能|改动|提交|项|处|问题)?\s*(?:[（(][^）)]*[）)]\s*)?$/u.test(text)
    || /^[0-9一二三四五六七八九十两几]+\s*(?:项|个|处|条)\s*(?:能力|功能|改动|提交|项|处)?\s*(?:[（(][^）)]*[）)]\s*)?$/u.test(text);
}

/**
 * What one round did, in the reader's terms.
 *
 * A row must name the change, not the ceremony around it. A reply usually opens
 * with a status line ("Round 40 done and pushed") and then lists the actual
 * work as bullets; reading only the first sentence therefore produced rows that
 * said "three capabilities" and never said which. So bullets win over prose, and
 * their labels are joined while the row fits.
 *
 * @param {object} round - round carrying a sealed reply or its stored text.
 * @returns {string} a short headline, or "" when there is none.
 */
/**
 * A clause that stops on a function word is a cut, not a sentence: "能跑了，
 * 真机 Windows 已经" tells the reader less than nothing. Such a candidate is
 * dropped rather than shown with a broken tail.
 *
 * @param {string} text - candidate headline.
 * @returns {boolean} whether it ends mid-thought.
 */
function isDangling(text) {
  return /(?:已经|并且|而且|但是|但|所以|因为|如果|然后|接着|以及|还有|并|的|在|和|与|或|而|把|被|对|将|让|给|就|也|还|都|很|太|更|最|这|那|其|该|从|向|到|为|以|由|比|等|地|得)$/u.test(String(text ?? ""));
}

function headlineOf(round) {
  const raw = typeof round?.reply?.text === "string"
    ? round.reply.text
    : typeof round?.replyText === "string" ? round.replyText : "";
  if (raw === "") return "";
  const plain = plainReplyOf(raw);
  const MAX = 28;
  const lines = plain.split(/\n/u).map((line) => line.trim()).filter((line) => line !== "");
  const bullets = [];
  const prose = [];
  for (const line of lines) {
    const marker = /^\s*(?:[-*+•]|\d{1,2}[.、)])\s+(.+)$/u.exec(line);
    if (marker === null) {
      prose.push(line);
      continue;
    }
    const lead = bulletLeadOf(marker[1]);
    if (lead === "" || lead.length < 4 || isRoundMetaLine(lead) || isCountOnly(lead)) continue;
    if (!/[\u4e00-\u9fff]/u.test(lead) && !/[A-Za-z]{3,}/u.test(lead)) continue;
    if (!bullets.includes(lead)) bullets.push(lead);
  }
  const opening = prose[0] ?? "";
  const preferBullets = bullets.length > 1
    || (bullets.length > 0 && (isCountOnly(opening) || isRoundMetaLine(opening)));
  if (preferBullets) {
    const picked = [];
    for (const lead of bullets) {
      if (picked.length >= 3) break;
      const next = [...picked, lead].join("、");
      if (next.length > MAX) break;
      picked.push(lead);
    }
    if (picked.length > 0) return picked.join("、");
  }
  // No usable list: read the prose, skipping a status paragraph and any
  // back-reference that only points at the previous turn.
  for (const line of prose) {
    if (isRoundMetaLine(line)) continue;
    const sentences = line.split(/(?<=[。！？!?])|(?<=[：:])(?!\d)/u);
    for (const sentence of sentences) {
      if (sentence.trim() === "") continue;
      // "能，但要分清是哪一层" and "对 DSH 插件来说，…" are answers to the
      // previous turn, not results of this one.
      if (/^(?:能|可以|对[^，。]{1,16}来说)[，,]/u.test(sentence.trim())) continue;
      const picked = [];
      for (const clause of sentence.split(/[，,]/u)) {
        let part = bulletLeadOf(clause);
        if (part === "" || isRoundMetaLine(part)) continue;
        const meta = /^(?:改完|已在|已经(?:在|看|试|跑|验证|确认)|历史行|概览直接)/u.test(part)
          || /(?:看过|看了|说过|说了|放在一起说|一起说了)$/u.test(part);
        if (meta) {
          if (picked.length === 0) continue;
          break;
        }
        if (picked.length > 0 && [...picked, part].join("，").length > MAX) break;
        picked.push(part);
      }
      let text = picked.join("，");
      if (/^(?:但|而|所以|因为|如果|然后|而且|并且)/u.test(text)) continue;
      if (/[\u4e00-\u9fff]/u.test(text) === false) continue;
      if (text.length < 4) continue;
      if (/^(?:已完成|已更新|已交付|原型已更新|原型已交付|已接入)/u.test(text)) continue;
      if (/^\d{1,2}[.、)]/u.test(text)) continue;
      if (/^已提交\s+[0-9a-f]{7,40}$/u.test(text)) continue;
      // A parenthesis cut off by the prose reader is an unfinished aside, and
      // an operation id in brackets is bookkeeping, not a result.
      text = text
        .replace(/[（(][^（()）]*$/u, "")
        .replace(/[（(]\s*[0-9a-f]{7,40}\s*$/u, "")
        .replace(/[（(]\s*$/u, "")
        .replace(/(?<=[\u4e00-\u9fff])\s+(?=[\u4e00-\u9fff])/gu, "，")
        .replace(/[，、；：,]+$/u, "")
        .trim();
      if (text.length < 4) continue;
      if (isDangling(text)) continue;
      if (/=>|[a-z]+\.[a-z]+\(/u.test(text)) continue;
      if (text.length > MAX) text = `${text.slice(0, MAX).replace(/[，、；：,\s]+$/u, "")}…`;
      if (isDangling(text.replace(/…$/u, ""))) continue;
      return text;
    }
  }
  if (bullets.length > 0) {
    const lead = bullets[0];
    if (/=>|[a-z]+\.[a-z]+\(/u.test(lead)) return "";
    return lead.length > MAX ? `${lead.slice(0, MAX)}…` : lead;
  }
  return "";
}

/* ------------------------------------------------------------------ *
 * Fact and condition insertion. Both merge by stable subject so a repeated
 * observation refreshes one row instead of appending a log line.
 * ------------------------------------------------------------------ */

/**
 * Insert or refresh one fact on a round.
 *
 * @param {object} round - owning round.
 * @param {object} input - fact fields.
 * @param {string} input.kind - recogniser kind.
 * @param {string} input.subject - merge subject inside the kind.
 * @param {string} input.statement - short statement.
 * @param {"observed"|"reported"|"inferred"} input.basis - evidence strength.
 * @param {object} [input.ref] - one evidence reference.
 * @param {boolean} [input.urgent] - whether the fact belongs to the urgent budget.
 * @returns {object} the stored fact (new or updated).
 */
/**
 * Drop the open failure of one tool because a later call of the same tool
 * succeeded. A retried failure is history, not an unresolved problem.
 *
 * @param {object} round - open round.
 * @param {string} subject - tool name.
 * @returns {void}
 */
function resolveFailures(round, subject) {
  if (subject === "") return;
  const doomed = new Set();
  for (const fact of round.facts) {
    if (fact.kind === "failure" && fact.subject === subject) doomed.add(fact.id);
  }
  if (doomed.size === 0) return;
  round.facts = round.facts.filter((fact) => !doomed.has(fact.id));
  round.factIndex = {};
  round.facts.forEach((fact, index) => {
    round.factIndex[fact.id] = index;
  });
}

function putFact(round, input) {
  const id = factIdOf(round.roundId, input.kind, input.subject);
  const existingIndex = round.factIndex[id];
  if (existingIndex !== undefined) {
    const fact = round.facts[existingIndex];
    fact.statement = clip(input.statement, LIMITS.factStatement);
    fact.basis = input.basis;
    fact.validity = input.validity ?? "valid";
    fact.refs = pushRef(fact.refs, input.ref);
    fact.urgent = fact.urgent || input.urgent === true;
    if (Array.isArray(input.files) && input.files.length > 0) fact.files = input.files.slice();
    if (typeof input.url === "string" && /^https:\/\//u.test(input.url)) fact.url = input.url;
    fact.updatedAt = input.time ?? fact.updatedAt;
    round.updatedAt = Math.max(round.updatedAt, fact.updatedAt);
    return fact;
  }
  const fact = {
    id,
    kind: input.kind, // ui-copy-ignore
    subject: input.subject, // ui-copy-ignore
    statement: clip(input.statement, LIMITS.factStatement),
    basis: input.basis, // ui-copy-ignore
    validity: input.validity ?? "valid",
    refs: pushRef([], input.ref),
    urgent: input.urgent === true,
    files: Array.isArray(input.files) && input.files.length > 0 ? input.files.slice() : [],
    url: typeof input.url === "string" && /^https:\/\//u.test(input.url) ? input.url : "",
    createdAt: input.time ?? round.updatedAt,
    updatedAt: input.time ?? round.updatedAt
  };
  round.facts.push(fact);
  round.factIndex[id] = round.facts.length - 1;
  round.updatedAt = Math.max(round.updatedAt, fact.createdAt);
  round.novelties += 1;
  evictFacts(round);
  return fact;
}

/**
 * Forget a fact the round itself has overtaken (a permission that was given).
 * Keeping it would leave the panel claiming the turn is still waiting.
 * @param {object} round - round record.
 * @param {string} kind - fact kind.
 * @param {string} subject - fact subject, already namespaced.
 * @returns {void}
 */
function dropFact(round, kind, subject) {
  const id = factIdOf(round.roundId, kind, subject);
  const index = round.factIndex[id];
  if (index === undefined) return;
  round.facts.splice(index, 1);
  round.factIndex = {};
  round.facts.forEach((fact, position) => {
    round.factIndex[fact.id] = position;
  });
  round.novelties += 1;
}

/**
 * Forget the conditions a newer plan or decision replaced, so the expanded
 * round never lists something the user already resolved.
 * @param {object} round - round record.
 * @param {(condition: object) => boolean} stale - which conditions are gone.
 * @returns {void}
 */
function dropConditions(round, stale) {
  const kept = round.conditions.filter((condition) => !stale(condition));
  if (kept.length === round.conditions.length) return;
  round.conditions = kept;
  round.conditionIndex = {};
  round.conditions.forEach((condition, position) => {
    round.conditionIndex[condition.subject] = position;
  });
  round.novelties += 1;
}

/**
 * Append an evidence reference, de-duplicated by seq and bounded.
 * @param {object[]} refs - current references.
 * @param {object|undefined} ref - candidate reference.
 * @returns {object[]} the updated list (a new array when it changed).
 */
function pushRef(refs, ref) {
  if (ref === undefined || ref === null || typeof ref.seq !== "number") return refs;
  if (refs.some((existing) => existing.seq === ref.seq)) return refs;
  const next = [...refs, ref];
  return next.length > LIMITS.factRefs ? next.slice(next.length - LIMITS.factRefs) : next;
}

/**
 * Keep the fact list inside its bounds without dropping unsolved blockers.
 *
 * Ordinary facts come off the front (oldest first). Urgent facts are capped
 * separately and only dropped when an older urgent fact exists, so a live
 * blocker survives a long round.
 *
 * @param {object} round - owning round.
 * @returns {void}
 */
function evictFacts(round) {
  if (round.facts.length <= LIMITS.roundFacts) return;
  const urgent = round.facts.filter((fact) => fact.urgent);
  const ordinary = round.facts.filter((fact) => !fact.urgent);
  const keepUrgent = urgent.slice(Math.max(0, urgent.length - LIMITS.urgentFacts));
  const room = Math.max(0, LIMITS.roundFacts - keepUrgent.length);
  const keepOrdinary = ordinary.slice(Math.max(0, ordinary.length - room));
  round.facts = [...keepOrdinary, ...keepUrgent];
  round.factIndex = {};
  round.facts.forEach((fact, index) => {
    round.factIndex[fact.id] = index;
  });
}

/**
 * Insert or refresh one completion condition.
 *
 * @param {object} round - owning round.
 * @param {object} input - condition fields.
 * @param {string} input.subject - stable merge subject.
 * @param {string} input.text - short requirement text.
 * @param {string} input.state - one of the verification states.
 * @param {object} [input.ref] - evidence reference.
 * @returns {object} the stored condition.
 */
function putCondition(round, input) {
  const existing = round.conditionIndex[input.subject];
  if (existing !== undefined) {
    const condition = round.conditions[existing];
    condition.text = clip(input.text, LIMITS.factStatement);
    condition.state = input.state;
    condition.refs = pushRef(condition.refs, input.ref);
    condition.updatedAt = input.time ?? condition.updatedAt;
    return condition;
  }
  const condition = {
    id: `c:${round.roundId}:${input.subject}`,
    subject: input.subject,
    text: clip(input.text, LIMITS.factStatement),
    state: input.state,
    refs: pushRef([], input.ref),
    createdAt: input.time ?? round.updatedAt,
    updatedAt: input.time ?? round.updatedAt
  };
  round.conditions.push(condition);
  round.conditionIndex[input.subject] = round.conditions.length - 1;
  round.novelties += 1;
  if (round.conditions.length > LIMITS.verificationConditions) {
    // Never drop a failing or unknown condition: those are the ones that keep
    // the verdict honest. Trim the oldest satisfied condition instead.
    const index = round.conditions.findIndex((item) => item.state === "passed" || item.state === "na");
    if (index >= 0) round.conditions.splice(index, 1);
    round.conditionIndex = {};
    round.conditions.forEach((item, position) => {
      round.conditionIndex[item.subject] = position;
    });
  }
  return condition;
}

/**
 * Insert one outcome row, de-duplicated by stable subject.
 * @param {object} round - owning round.
 * @param {object} input - outcome fields.
 * @returns {void}
 */
function putOutcome(round, input) {
  const subject = input.subject;
  const text = clip(input.text, LIMITS.factStatement).trim();
  // An outcome is a claim the reader can check; an empty one is no outcome.
  if (text === "") return;
  if (round.outcomes.some((item) => item.subject === subject)) return;
  round.outcomes.push({
    id: `o:${round.roundId}:${subject}`,
    subject,
    kind: input.kind,
    text,
    factIds: input.factId === undefined ? [] : [input.factId],
    createdAt: input.time ?? round.updatedAt
  });
  round.novelties += 1;
  if (round.outcomes.length > 16) round.outcomes = round.outcomes.slice(round.outcomes.length - 16);
}

/* ------------------------------------------------------------------ *
 * Per-event handlers.
 * ------------------------------------------------------------------ */

/**
 * Close the open round and queue it for the store.
 * @param {object} state - projection state.
 * @param {number} time - closing time.
 * @returns {void}
 */
function sealRound(state, time) {
  const round = state.round;
  if (round === null) return;
  round.archivedAt = round.archivedAt ?? time;
  const summary = summarizeRound(round);
  state.settled = { roundId: round.roundId, summary, round };
  state.recent = [summary, ...state.recent].slice(0, LIMITS.historyPreview);
  state.recentRounds = [round, ...state.recentRounds].slice(0, RECENT_ROUND_LIMIT);
  state.round = null;
  state.reply = null;
  state.counters = { steps: 0, tools: 0, failures: 0 };
}

/**
 * Prefer the most trustworthy title available.
 *
 * Rank 3 is the goal the human set, 2 the title the harness generated (or the
 * human typed), 1 the opening request, 0 nothing. A weaker source never replaces
 * a stronger one, so a checkpoint or an injected reminder cannot rename the round.
 *
 * @param {object} state - projection state.
 * @param {string} text - candidate title.
 * @param {number} rank - trust rank of the candidate.
 * @param {number} seq - sequence the title came from.
 * @returns {void}
 */
/** Strip machine markup: a tag the human never read is not a heading. */
export function readableTitle(value) {
  const plain = String(value ?? "")
    .replace(/<[^<>\n]{0,80}>/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  if (plain === "" || /[<>]/u.test(plain)) return "";
  return plain;
}

/**
 * A fingerprint of what a progress summary would talk about: the facts and the
 * closing report. A new event that changes neither does not make an existing
 * summary wrong, so it must not erase it.
 *
 * @param {object} round - round to fingerprint.
 * @returns {string} stable key.
 */
export function materialKeyOf(round) {
  if (round === null || round === undefined) return "";
  const facts = round.facts instanceof Map ? [...round.facts.values()] : Array.isArray(round.facts) ? round.facts : [];
  // Only what the summary would say differently counts: a fact's subject and
  // statement, what a change actually wrote, and the round's own prose. Clock
  // fields move on every ordinary tool result, and a timestamp in this key used
  // to throw away a finished summary while nothing had changed in it.
  const seen = facts.map((fact) => `${fact.id}:${fact.kind ?? ""}:${fact.statement ?? ""}:${Array.isArray(fact.changes) ? fact.changes.length : 0}`).sort();
  const notes = (Array.isArray(round.notes) ? round.notes : []).map((note) => note?.text ?? "").join("\u0001");
  return `${round.roundId}|${seen.length}|${seen.join(",")}|${notes.length}:${notes}|${String(round.reply?.text ?? "").length}`;
}

/**
 * Whether a user-role message is context the harness injected for the model.
 * An English runtime snapshot is not a working title, so it must never name a
 * round, and translating it would not make it one.
 *
 * @param {string} text - message text.
 * @returns {boolean} true when it is machine context.
 */
function isInjectedText(text) {
  const head = String(text ?? "").trim();
  if (head === "") return false;
  if (/^Current runtime context\b/iu.test(head)) return true;
  if (/^This snapshot supersedes\b/iu.test(head)) return true;
  if (/^【DSH 崩溃防线】/u.test(head)) return true;
  return false;
}

function setTitle(state, text, rank, seq) {
  const round = state.round;
  const clean = clip(readableTitle(text), LIMITS.title);
  if (round === null || clean === "" || rank <= (round.titleRank ?? 0)) return;
  round.title = clean;
  round.titleRank = rank;
  round.titleSeq = seq;
}

/**
 * The opening sentence of a request, for use as a fallback title.
 * @param {string} text - request text.
 * @returns {string} one short sentence.
 */
/**
 * Whether a string is usable as a heading: no path, no file reference, short.
 * @param {unknown} value - candidate title.
 * @returns {boolean} true when it reads like a title.
 */
function safeTitle(value) {
  if (typeof value !== "string") return false;
  const text = value.trim();
  if (text.length < 2 || text.length > 40) return false;
  if (text.includes("\n") || text.startsWith("@") || text.includes("/") || text.includes("\\")) return false;
  return !/^(?:system|developer|assistant)\b/iu.test(text);
}

function firstSentenceOf(text) {
  const line = String(text).split("\n").find((candidate) => candidate.trim() !== "") ?? "";
  const sentence = line.split(/(?<=[。！？!?])/u)[0] ?? line;
  return clip(sentence.replace(/https?:\/\/\S+/gu, "").trim(), 40);
}

/**
 * Handle a user message: open a round, or record a supplement inside one.
 * @param {object} state - projection state.
 * @param {object} event - committed session event.
 * @returns {void}
 */
function onUserMessage(state, event) {
  const source = event.data?.source;
  const kind = source !== null && typeof source === "object" && typeof source.kind === "string" ? source.kind : "unknown";
  const text = visibleTextOf(event.data?.content);

  // Context can also arrive without a usable source kind, and its opening line
  // is recognisable: it is documentation for the model, never a request.
  if (INJECTED_SOURCE_KINDS.has(kind) || kind.startsWith("plugin:") || isInjectedText(text)) {
    // Context the harness injected for the model (reminders, skill catalogues,
    // time snapshots, compaction checkpoints) is never a user request: it opens
    // no round and never becomes a title.
    state.quiet.lastDurableAt = Math.max(state.quiet.lastDurableAt, event.time);
    return;
  }

  if (kind === "goal") {
    // A goal continuation belongs to the round that is still open. Once that
    // round has been archived, the continuation is new work and opens a round.
    state.pendingTurn = null;
    if (state.round === null) {
      state.round = newRound(state.sessionId, event.seq, event.time);
      if (text !== "" && !isInjectedText(text)) setTitle(state, firstSentenceOf(text), 1, event.seq);
    }
    state.round.userMessages += 1;
    state.round.updatedAt = Math.max(state.round.updatedAt, event.time);
    state.quiet.lastDurableAt = Math.max(state.quiet.lastDurableAt, event.time);
    return;
  }

  if (state.round === null) {
    const startSeq = state.pendingTurn?.seq ?? event.seq;
    const startedAt = state.pendingTurn?.time ?? event.time;
    state.round = newRound(state.sessionId, startSeq, startedAt);
  } else if (state.pendingTurn !== null) {
    // A new turn after a closed one is a new user request, so it starts a round.
    sealRound(state, state.pendingTurn.time);
    state.round = newRound(state.sessionId, state.pendingTurn.seq, state.pendingTurn.time);
  }

  const round = state.round;
  state.pendingTurn = null;
  round.userMessages += 1;
  round.updatedAt = Math.max(round.updatedAt, event.time);
  round.openTurn = true;
  round.turnStartSeq = round.turnStartSeq ?? event.seq;
  // What the round is about is what the person asked in this round. A session
  // title (「插件开发」) or a Goal names the whole session, so neither may stand
  // in for this request.
  if (text !== "") setTitle(state, firstSentenceOf(text), 3, event.seq);
  state.quiet.lastDurableAt = Math.max(state.quiet.lastDurableAt, event.time);
}

/**
 * Handle a formal-reply candidate.
 * @param {object} state - projection state.
 * @param {object} event - committed session event.
 * @returns {void}
 */
function onAssistantMessage(state, event) {
  const round = state.round;
  if (round === null) return;
  const content = event.data?.message?.content;
  const text = visibleTextOf(content);
  const call = hasToolCall(content);
  round.updatedAt = Math.max(round.updatedAt, event.time);
  state.quiet.lastDurableAt = Math.max(state.quiet.lastDurableAt, event.time);

  // Only a message with visible text can close a round; a pure tool-call message
  // never does, and neither does an interrupted one.
  const interrupted = event.data?.interrupted === true;
  if (text !== "") state.lastAssistant = { seq: event.seq, text: clip(text, LIMITS.factStatement), time: event.time }; // ui-copy-ignore
  // Progress prose is the round's own account of what it is doing. It is the
  // only place a pivot or a scope narrowing appears before the formal reply, so
  // it is kept for the summariser in order, bounded, without repeats.
  const note = text === "" ? "" : clip(text.replace(/\s+/gu, " ").trim(), 300);
  if (note !== "" && round.notes[round.notes.length - 1]?.text !== note) {
    round.notes.push({ seq: event.seq, text: note, time: event.time });
    if (round.notes.length > 12) round.notes.shift();
  }
  state.reply = {
    seq: event.seq, // ui-copy-ignore
    turn: event.data?.turn, // ui-copy-ignore
    step: event.data?.step, // ui-copy-ignore
    text,
    hasToolCall: call,
    interrupted,
    time: event.time // ui-copy-ignore
  };

  if (text !== "" && !call && !interrupted && CLAIM_RE.test(text)) {
    const fact = putFact(round, {
      kind: "report", // ui-copy-ignore
      subject: "claim", // ui-copy-ignore
      statement: clip(text, LIMITS.factStatement),
      basis: "reported", // ui-copy-ignore
      validity: "needsRecheck", // ui-copy-ignore
      ref: { seq: event.seq, label: "回复" },
      time: event.time // ui-copy-ignore
    });
    // A claim is reported, not observed: it can never satisfy a condition by
    // itself, it only shows up as something still to confirm.
    putCondition(round, {
      subject: "claim:" + fact.id, // ui-copy-ignore
      text: clip(text, LIMITS.factStatement),
      state: "recheck", // ui-copy-ignore
      ref: { seq: event.seq, label: "回复" },
      time: event.time // ui-copy-ignore
    });
  }
}

/**
 * Tool arguments reach the session as the model's raw JSON text, so they must be
 * decoded before recognisers can look inside. Invalid JSON stays a string: it is
 * the model's own text and never a place to guess.
 *
 * @param {unknown} raw - `tool/call` arguments field.
 * @returns {object|string} parsed object when possible, otherwise the raw text.
 */
function toolArgsOf(raw) {
  if (typeof raw !== "string" || raw.trim() === "") return raw ?? {};
  try {
    const parsed = JSON.parse(raw);
    return parsed !== null && typeof parsed === "object" ? parsed : {};
  } catch {
    return raw;
  }
}

/**
 * Handle a tool call, remembering it so its result can be paired.
 * @param {object} state - projection state.
 * @param {object} event - committed session event.
 * @returns {void}
 */
function onToolCall(state, event) {
  const round = state.round;
  if (round === null) return;
  const callId = event.data?.callId;
  if (typeof callId !== "string") return;
  state.counters.tools += 1;
  state.pendingCalls[callId] = {
    name: typeof event.data?.name === "string" ? event.data.name : "",
    args: toolArgsOf(event.data?.arguments),
    seq: event.seq, // ui-copy-ignore
    time: event.time, // ui-copy-ignore
    turn: event.data?.turn, // ui-copy-ignore
    step: event.data?.step // ui-copy-ignore
  };
  round.pendingCalls += 1;
}

/**
 * Handle a tool result: recognise checks, failures, and workspace changes.
 * @param {object} state - projection state.
 * @param {object} event - committed session event.
 * @returns {void}
 */
function onToolResult(state, event) {
  const round = state.round;
  if (round === null) return;
  const callId = event.data?.message?.toolCallId ?? event.data?.callId;
  const call = typeof callId === "string" ? state.pendingCalls[callId] : undefined;
  if (typeof callId === "string" && call !== undefined) {
    delete state.pendingCalls[callId];
    round.pendingCalls = Math.max(0, round.pendingCalls - 1);
  }

  const name = call?.name ?? "";
  const failed = event.data?.error !== undefined || event.data?.message?.isError === true;
  const output = visibleTextOf(event.data?.message?.content);
  const ref = { seq: event.seq, label: "工具结果" };
  const time = event.time;
  round.updatedAt = Math.max(round.updatedAt, time);
  state.quiet.lastDurableAt = Math.max(state.quiet.lastDurableAt, time);

  const check = call === undefined ? null : checkOf(call.args);

  if (check !== null) {
    const exit = exitCodeOf(output);
    // The brief talks about the work a check covered, never about the runner.
    const label = check.target === "" ? CHECK_KIND_LABELS[check.kind] ?? "检查" : check.target;
    const wait = `check:${check.kind}:${check.target}`;
    if (isBackgroundLaunch(name, output, exit)) {
      // A long verification was handed to a background job. Starting it is not
      // a result: the condition stays open until the job settles.
      putCondition(round, {
        subject: wait, // ui-copy-ignore
        text: label, // ui-copy-ignore
        state: "pending", // ui-copy-ignore
        ref,
        time
      });
      state.quiet.lastSeqWithNovelty = event.seq;
      return;
    }
    const passed = failed ? false : exit === null ? true : exit === 0;
    const verdict = passed ? "passed" : "failed";
    const fact = putFact(round, {
      kind: "check", // ui-copy-ignore
      subject: `topic:${check.kind}:${check.target}`, // ui-copy-ignore
      statement: `${label}${/[A-Za-z0-9_@./:-]$/u.test(label) ? " " : ""}${passed ? "通过" : "未通过"}`,
      basis: "observed", // ui-copy-ignore
      validity: "valid", // ui-copy-ignore
      ref,
      time
    });
    putCondition(round, {
      subject: wait, // ui-copy-ignore
      text: label, // ui-copy-ignore
      state: verdict, // ui-copy-ignore
      ref,
      time
    });
    if (passed) {
      round.checksStaleAt = 0;
      putOutcome(round, { subject: wait, kind: "tool", text: fact.statement, factId: fact.id, time });
    }
    state.quiet.lastSeqWithNovelty = event.seq;
    return;
  }

  if (!failed && isGitCall(call)) {
    const commit = commitUrlOf(output);
    if (commit !== "") {
      const sha = commit.split("/").pop() ?? "";
      putFact(round, {
        kind: "deliverable", // ui-copy-ignore
        subject: `commit:${commit}`, // ui-copy-ignore
        statement: `提交 ${sha.slice(0, 7)}`,
        basis: "observed", // ui-copy-ignore
        validity: "valid", // ui-copy-ignore
        ref,
        url: commit, // ui-copy-ignore
        time // ui-copy-ignore
      });
      state.quiet.lastSeqWithNovelty = event.seq;
    }
  }

  if (failed) {
    // A non-zero exit is not a task failure. A plain read, search, or one-off
    // command that exits non-zero only says that command did not produce a
    // result; it stays as evidence and never becomes a red item. Only a failed
    // change or a failed check can change what the round still needs.
    const affectsGoal = isChangeTool(name);
    if (!affectsGoal) {
      putFact(round, {
        kind: "note", // ui-copy-ignore
        subject: name !== "" ? name : "tool",
        statement: clip(output !== "" ? output : `${name} 没有返回结果`, 160),
        basis: "observed", // ui-copy-ignore
        validity: "valid", // ui-copy-ignore
        ref,
        time
      });
      return;
    }
    // A guard that asks the caller to read the file first is tool mechanics,
    // not a result: nothing was lost and the same call succeeds on retry. It is
    // evidence, so it never paints the round red.
    if (/file has not been read/iu.test(output)) {
      putFact(round, {
        kind: "note", // ui-copy-ignore
        subject: name !== "" ? name : "tool",
        statement: clip(output, 160),
        basis: "observed", // ui-copy-ignore
        validity: "valid", // ui-copy-ignore
        ref,
        time
      });
      return;
    }
    state.counters.failures += 1;
    const summary = clip(output !== "" ? output : name !== "" ? name : "工具调用失败", 160);
    putFact(round, {
      kind: "failure", // ui-copy-ignore
      subject: name !== "" ? name : "tool",
      statement: `失败：${summary}`,
      basis: "observed", // ui-copy-ignore
      validity: "valid", // ui-copy-ignore
      ref,
      urgent: true, // ui-copy-ignore
      time
    });
    state.quiet.lastSeqWithNovelty = event.seq;
    return;
  }

  if (isChangeTool(name)) {
    const file = fileOf(call?.args);
    const existing = round.facts[round.factIndex[factIdOf(round.roundId, "change", "workspace")] ?? -1];
    const files = new Set(existing?.files ?? []);
    if (file !== "") files.add(file);
    const fact = putFact(round, {
      kind: "change", // ui-copy-ignore
      subject: "workspace", // ui-copy-ignore
      statement: "",
      basis: "observed", // ui-copy-ignore
      validity: "valid", // ui-copy-ignore
      ref,
      time
    });
    fact.files = [...files].slice(-8);
    // The file name is how the change was made; the before/after text is what
    // changed. Only the summariser reads it, so a clipped pair is enough.
    const detail = changeDetailOf(call?.args);
    if (detail !== null) fact.changes = [...(existing?.changes ?? []), detail].slice(-6);
    // The same tool failing and then working again is a retry, not an open
    // problem: the earlier failure stops being shown.
    resolveFailures(round, name);
    if (!String(file).startsWith("/tmp/")) markChecksStale(round, time);
    state.quiet.lastSeqWithNovelty = event.seq;
  }
}

/**
 * Keep a finished check as history but stop calling it current evidence.
 *
 * A file written after a test does not undo the test; it only means the test no
 * longer describes the working tree, so the check is flagged for re-running
 * immediately instead of waiting for the next summary.
 *
 * @param {object} round - owning round.
 * @param {number} time - change time.
 * @returns {void}
 */
function markChecksStale(round, time) {
  round.checksStaleAt = time;
  for (const fact of round.facts) {
    if (fact.kind === "check" && fact.validity === "valid") {
      fact.validity = "needsRecheck"; // ui-copy-ignore
      fact.updatedAt = time;
    }
  }
  for (const condition of round.conditions) {
    if (condition.subject.startsWith("check:") && condition.state === "passed") {
      condition.state = "recheck"; // ui-copy-ignore
      condition.updatedAt = time;
    }
  }
}

/**
 * Pull a workspace path out of tool arguments.
 * @param {unknown} args - raw tool arguments.
 * @returns {string} a short path, or "".
 */
function fileOf(args) {
  if (args === null || typeof args !== "object") return "";
  for (const key of ["path", "file_path", "filePath", "target", "filename"]) {
    const value = args[key];
    if (typeof value === "string" && value !== "") return clip(value, 80);
  }
  return "";
}

/**
 * The concrete content of one write, when the tool arguments carry it. A patch
 * pair or a whole new body is the change itself, which the file list cannot say.
 *
 * @param {unknown} args - raw tool arguments.
 * @returns {{before: string, after: string}|null} clipped pair, or null.
 */
function changeDetailOf(args) {
  if (args === null || typeof args !== "object") return null;
  const squash = (value) => clip(String(value).replace(/\s+/gu, " ").trim(), 100);
  for (const [beforeKey, afterKey] of [["old_string", "new_string"], ["old_str", "new_str"], ["old_text", "new_text"], ["old_content", "new_content"], ["before", "after"]]) {
    const before = typeof args[beforeKey] === "string" ? args[beforeKey] : "";
    const after = typeof args[afterKey] === "string" ? args[afterKey] : "";
    if (before === "" && after === "") continue;
    return { before: squash(before), after: squash(after) };
  }
  for (const key of ["content", "new_content", "contents"]) {
    if (typeof args[key] === "string" && args[key].trim() !== "") return { before: "", after: squash(args[key]) };
  }
  return null;
}

/**
 * Handle a turn boundary, including the formal-reply decision.
 * @param {object} state - projection state.
 * @param {object} event - committed session event.
 * @returns {void}
 */
function onTurnEnd(state, event) {
  const round = state.round;
  if (round === null) return;
  const reason = event.data?.reason;
  const kind = reason !== null && typeof reason === "object" ? reason.kind : "error";
  round.openTurn = false;
  round.turnEndSeq = event.seq;
  round.turnEndKind = kind;
  round.turnEndReason = reason !== null && typeof reason === "object" ? reason : null;
  round.updatedAt = Math.max(round.updatedAt, event.time);

  const candidate = state.reply;
  const formal =
    kind === "completed" &&
    candidate !== null &&
    candidate.turn === event.data?.turn &&
    candidate.text !== "" &&
    !candidate.hasToolCall &&
    !candidate.interrupted;

  if (formal) {
    // A formal reply closes the round: it enters the history now, not when the
    // next request arrives.
    round.reply = { seq: candidate.seq, text: clip(candidate.text, LIMITS.factStatement), time: candidate.time };
    round.archivedAt = event.time;
    state.reply = null;
    sealRound(state, event.time);
    return;
  }
  if (kind === "error" || kind === "blocked") round.reply = null;
  state.reply = null;
}

/**
 * Whether a background job runs a verification command, and under which topic.
 *
 * Only these jobs become verification conditions. Reading a file or grepping a
 * symbol is evidence, not a check, and a raw command line is never page text.
 *
 * @param {string} label - command line of the job.
 * @returns {string} topic, or "" when the job is not a verification.
 */
function checkTopicOf(label) {
  if (label === "" || READ_ONLY_COMMAND_RE.test(label) || !CHECK_COMMAND_RE.test(label)) return "";
  return checkTargetOf(label) || "检查";
}

/**
 * Record job registration as an outstanding wait.
 * @param {object} state - projection state.
 * @param {object} event - committed session event.
 * @returns {void}
 */
function onJobRegistered(state, event) {
  const data = event.data;
  if (data === null || typeof data !== "object" || typeof data.jobId !== "string") return;
  state.jobs[data.jobId] = {
    jobId: data.jobId,
    kind: typeof data.kind === "string" ? data.kind : "job",
    label: typeof data.label === "string" ? clip(data.label, 80) : "",
    status: "running", // ui-copy-ignore
    startedAt: typeof data.startedAt === "number" ? data.startedAt : event.time,
    startedAtRound: state.round?.roundId ?? null, // ui-copy-ignore
    finishedAt: null
  };
  const round = state.round;
  const topic = checkTopicOf(state.jobs[data.jobId].label);
  if (round !== null && topic !== "") {
    putCondition(round, {
      subject: `check:${topic}`, // ui-copy-ignore
      text: topic, // ui-copy-ignore
      state: "pending", // ui-copy-ignore
      ref: { seq: event.seq, label: "后台任务" },
      time: event.time // ui-copy-ignore
    });
  }
}

/**
 * The round a background job belongs to.
 * @param {object} state - projection state.
 * @param {string|null|undefined} roundId - round that started the job.
 * @returns {object|null} owning round.
 */
function roundForJob(state, roundId) {
  if (typeof roundId !== "string") return state.round;
  if (state.round !== null && state.round.roundId === roundId) return state.round;
  return state.recentRounds.find((round) => round.roundId === roundId) ?? state.round;
}

/**
 * Record job settlement, clearing its wait and publishing an outcome.
 * @param {object} state - projection state.
 * @param {object} event - committed session event.
 * @returns {void}
 */
function onJobSettled(state, event) {
  const data = event.data;
  if (data === null || typeof data !== "object" || typeof data.jobId !== "string") return;
  const job = state.jobs[data.jobId];
  if (job !== undefined) {
    job.status = typeof data.status === "string" ? data.status : "completed";
    job.finishedAt = typeof data.finishedAt === "number" ? data.finishedAt : event.time;
  }
  const status = job?.status ?? "completed";
  // A result belongs to the round that started the job. When the reply already
  // closed that round, the result is a supplement to it, never an item of the
  // round the human is reading now.
  const round = roundForJob(state, job?.startedAtRound);
  if (round === null) return;
  const late = round !== state.round;
  const prefix = late ? "回复后补充：" : "";
  const label = job?.label || job?.kind || "后台任务";
  const topic = checkTopicOf(label);
  const detailExit = exitCodeOf(String(data.detail ?? ""));
  const verdict =
    status !== "completed" ? (status === "killed" ? "unknown" : "failed") : detailExit === null ? "unknown" : detailExit === 0 ? "passed" : "failed";
  // One verification owns one condition, whichever path reported it. A second
  // row for the same check would read as two separate results.
  if (topic !== "") {
    putCondition(round, {
      subject: `check:${topic}`, // ui-copy-ignore
      text: topic, // ui-copy-ignore
      state: verdict, // ui-copy-ignore
      ref: { seq: event.seq, label: "后台任务" },
      time: event.time // ui-copy-ignore
    });
  }
  if (status === "completed" && !late) {
    putOutcome(round, { subject: `job:${data.jobId}`, kind: "job", text: label, time: event.time });
    return;
  }
  if (status === "completed" && late) {
    putFact(round, {
      kind: "late", // ui-copy-ignore
      subject: `job:${data.jobId}`, // ui-copy-ignore
      statement: clip(`${prefix}${label}`, LIMITS.factStatement),
      basis: "observed", // ui-copy-ignore
      validity: "valid", // ui-copy-ignore
      ref: { seq: event.seq, label: "后台任务" },
      time: event.time // ui-copy-ignore
    });
    return;
  }
  if (topic !== "") {
    // A cancelled or ended verification never turns into a failure; it only says
    // what is still missing, and only when the round was waiting on it.
    putFact(round, {
      kind: "interruption", // ui-copy-ignore
      subject: `job:${data.jobId}`, // ui-copy-ignore
      statement: "本次验证被中止，尚未获得结果",
      basis: "observed", // ui-copy-ignore
      validity: "valid", // ui-copy-ignore
      ref: { seq: event.seq, label: "后台任务" },
      time: event.time // ui-copy-ignore
    });
    state.quiet.lastSeqWithNovelty = event.seq;
    return;
  }
  // Any other ended background job stays out of the brief: it is not a failure
  // and it does not change what the round still needs. Its record remains as
  // evidence through the job condition written above.
  state.quiet.lastSeqWithNovelty = event.seq;
}

/**
 * Fold a goal change into the four-dimensional state.
 * @param {object} state - projection state.
 * @param {object} event - committed session event.
 * @returns {void}
 */
function onGoalChange(state, event) {
  const data = event.data;
  if (data === null || typeof data !== "object") return;
  const operation = data.operation;
  if (operation === "clear") {
    state.goal = { state: "none", objective: "", updatedAt: event.time };
    return;
  }
  const goal = data.goal;
  if (goal === null || typeof goal !== "object") return;
  const phase = typeof goal.phase === "string" ? goal.phase : "unknown";
  // A goal objective is a standing aim, not what this round is doing. It gets
  // its own line and never replaces the round heading taken from the request.
  state.goal = {
    state: ["active", "paused", "blocked", "complete"].includes(phase) ? phase : "unknown",
    objective: typeof goal.objective === "string" ? clip(goal.objective, LIMITS.title) : "",
    updatedAt: event.time
  };
}

/**
 * Record a full todo replacement. Position is never identity, so the display id
 * is a hash of the normalised text.
 * @param {object} state - projection state.
 * @param {object} event - committed session event.
 * @returns {void}
 */
function onTodoWrite(state, event) {
  const todos = Array.isArray(event.data?.todos) ? event.data.todos : [];
  state.todos = todos.slice(0, 40).map((todo, index) => {
    const text = clip(typeof todo?.text === "string" ? todo.text : String(todo?.content ?? ""), 160);
    return {
      key: hashKey(text) || `todo-${index}`,
      text,
      status: typeof todo?.status === "string" ? todo.status : "pending"
    };
  });
  const round = state.round;
  if (round === null) return;
  // A new plan replaces the old one: a condition for a step that is no longer
  // in the list would keep the round looking blocked on work nobody does.
  const planned = new Set(state.todos.map((todo) => `todo:${todo.key}`));
  dropConditions(round, (condition) => condition.subject.startsWith("todo:") && !planned.has(condition.subject));
  for (const todo of state.todos) {
    if (todo.text === "") continue;
    const done = todo.status === "completed";
    putCondition(round, {
      subject: `todo:${todo.key}`, // ui-copy-ignore
      text: todo.text, // ui-copy-ignore
      // A checked box is a report, not proof: it still needs independent evidence.
      state: done ? "recheck" : "pending",
      ref: { seq: event.seq, label: "计划" },
      time: event.time // ui-copy-ignore
    });
  }
}

/**
 * Record a permission request and its decision.
 * @param {object} state - projection state.
 * @param {object} event - committed session event.
 * @param {boolean} decided - false while it is still pending.
 * @returns {void}
 */
function onApproval(state, event, decided) {
  const data = event.data;
  const key =
    typeof data?.callId === "string"
      ? data.callId
      : typeof data?.id === "string"
        ? data.id
        : typeof data?.requestId === "string"
          ? data.requestId
          : null;
  const round = state.round;
  if (key === null) return;
  state.approvals[key] = { decided, at: event.time };
  if (round === null) return;
  if (decided) {
    // The answer arrived: the request and its "waiting" claim are both history,
    // and leaving either on screen would state a condition that no longer holds.
    dropFact(round, "blocker", `approval:${key}`);
    dropConditions(round, (condition) => condition.subject === `approval:${key}`);
    return;
  }
  putCondition(round, {
    subject: `approval:${key}`, // ui-copy-ignore
    text: "等待授权", // ui-copy-ignore
    state: decided ? "recheck" : "pending",
    ref: { seq: event.seq, label: decided ? "授权结果" : "授权请求" },
    time: event.time // ui-copy-ignore
  });
  if (!decided) {
    putFact(round, {
      kind: "blocker", // ui-copy-ignore
      subject: `approval:${key}`, // ui-copy-ignore
      statement: "等待授权后继续",
      basis: "observed", // ui-copy-ignore
      validity: "valid", // ui-copy-ignore
      ref: { seq: event.seq, label: "授权请求" },
      urgent: true, // ui-copy-ignore
      time: event.time // ui-copy-ignore
    });
    state.quiet.lastSeqWithNovelty = event.seq;
  }
}

/**
 * Record a presented deliverable.
 * @param {object} state - projection state.
 * @param {object} event - committed session event.
 * @returns {void}
 */
function onDeliverables(state, event) {
  const round = state.round;
  if (round === null) return;
  const files = Array.isArray(event.data?.files) ? event.data.files : [];
  for (const file of files) {
    const name = typeof file?.name === "string" ? file.name : typeof file?.path === "string" ? file.path : "";
    if (name === "") continue;
    // The row names the artifact, not its absolute location: the directory is
    // the same for every deliverable and the path stays in the evidence.
    const shown = name.replace(/\\/gu, "/").split("/").filter((part) => part !== "").pop() ?? name;
    const path = typeof file?.path === "string" && file.path !== "" ? file.path : "";
    const url = typeof file?.url === "string" && /^https:\/\//u.test(file.url) ? file.url : "";
    const fact = putFact(round, {
      kind: "deliverable", // ui-copy-ignore
      subject: name, // ui-copy-ignore
      statement: `已生成：${shown}`,
      basis: "observed", // ui-copy-ignore
      validity: "valid", // ui-copy-ignore
      ref: { seq: event.seq, label: "成果" },
      files: path === "" ? [] : [path],
      url, // ui-copy-ignore
      time: event.time // ui-copy-ignore
    });
    putOutcome(round, { subject: `deliverable:${name}`, kind: "deliverable", text: name, factId: fact.id, time: event.time });
    state.quiet.lastSeqWithNovelty = event.seq;
  }
}

/**
 * Normalise a string into a short stable key.
 * @param {string} text - source text.
 * @returns {string} key, or "" for blank input.
 */
function hashKey(text) {
  if (typeof text !== "string" || text === "") return "";
  let hash = 0;
  const lower = text.toLowerCase().replace(/\s+/gu, " ").trim();
  for (let index = 0; index < lower.length; index += 1) {
    hash = (hash * 31 + lower.charCodeAt(index)) | 0;
  }
  return `h${(hash >>> 0).toString(36)}`;
}

/* ------------------------------------------------------------------ *
 * The reducer itself.
 * ------------------------------------------------------------------ */

const INTERESTING = new Set([
  "user/message",
  "turn/start",
  "turn/end",
  "step/start",
  "step/end",
  "assistant/message",
  "tool/call",
  "tool/result",
  "job/registered",
  "job/settled",
  "goal/change",
  "todo/write",
  "approval/asked",
  "approval/decided",
  "deliverables/presented",
  "session/title"
]);

/**
 * Apply one committed session event.
 *
 * Returns the same reference when the event cannot change anything, so an
 * unrelated event costs one `Set.has` and no allocation.
 *
 * @param {object} state - current projection state.
 * @param {object} event - committed session event with `seq`, `time`, `type`, `data`.
 * @returns {object} the next state.
 */
export function apply(state, event) {
  if (event === null || typeof event !== "object" || typeof event.type !== "string") return state;
  if (typeof event.seq === "number" && event.seq <= state.lastSeq) return state;
  if (!INTERESTING.has(event.type)) {
    if (typeof event.seq === "number") state.lastSeq = event.seq;
    if (typeof event.time === "number") state.lastEventTime = Math.max(state.lastEventTime, event.time);
    return state;
  }

  switch (event.type) {
    case "user/message":
      onUserMessage(state, event);
      break;
    case "turn/start":
      state.pendingTurn = { seq: event.seq, time: event.time };
      if (state.round !== null) {
        state.round.openTurn = true;
        state.round.turnStartSeq = state.round.turnStartSeq ?? event.seq;
        state.round.updatedAt = Math.max(state.round.updatedAt, event.time);
      }
      break;
    case "turn/end":
      onTurnEnd(state, event);
      break;
    case "step/start":
      state.counters.steps += 1;
      break;
    case "step/end":
      break;
    case "assistant/message":
      onAssistantMessage(state, event);
      break;
    case "tool/call":
      onToolCall(state, event);
      break;
    case "tool/result":
      onToolResult(state, event);
      break;
    case "job/registered":
      onJobRegistered(state, event);
      break;
    case "job/settled":
      onJobSettled(state, event);
      break;
    case "goal/change":
      onGoalChange(state, event);
      break;
    case "todo/write":
      onTodoWrite(state, event);
      break;
    case "approval/asked":
      onApproval(state, event, false);
      break;
    case "approval/decided":
      onApproval(state, event, true);
      break;
    case "deliverables/presented":
      onDeliverables(state, event);
      break;
    case "session/title": {
      // A hand-written session title is the best heading a session can offer,
      // and a generated one is only usable when it reads like a title — the
      // provider often emits a path or an "@file" reference instead.
      const title = event.data?.title;
      const human = event.data?.source?.kind === "user";
      const generated = event.data?.source?.kind === "provider"; // ui-copy-ignore
      const rank = human ? 3 : generated ? 2 : 1;
      if (safeTitle(title) && rank > (state.sessionTitleRank ?? 0)) {
        state.sessionTitle = title;
        state.sessionTitleRank = rank;
      }
      if (human && safeTitle(title)) {
        setTitle(state, title, 2, event.seq);
        if (state.round !== null && state.round.titleSeq === event.seq) {
          state.round.titleSource = "session"; // ui-copy-ignore
        }
      } else if (!human && state.round !== null && state.round.titleRank === 0 && safeTitle(title)) {
        setTitle(state, title, 1, event.seq);
        if (state.round !== null && state.round.titleSeq === event.seq) {
          state.round.titleSource = "generated"; // ui-copy-ignore
        }
      }
      break;
    }
    default:
      break;
  }

  state.lastSeq = typeof event.seq === "number" ? event.seq : state.lastSeq;
  if (typeof event.time === "number") state.lastEventTime = Math.max(state.lastEventTime, event.time);
  return state;
}

/* ------------------------------------------------------------------ *
 * Derived verdicts. Pure functions of the state: no I/O, no clock reads
 * unless the caller supplies one.
 * ------------------------------------------------------------------ */

/**
 * Evaluate the completion conditions into one verification verdict.
 *
 * An empty condition list is *not* a pass — it means nothing is known yet.
 *
 * @param {object} round - round record, or null.
 * @param {{truncated?: boolean, coverageGap?: boolean}} [context] - degradation inputs.
 * @returns {{state: string, truncated: boolean, conditions: object[]}} verdict.
 */
export function evaluateVerification(round, context = {}) {
  if (round === null) {
    return { state: "unknown", truncated: false, conditions: [] };
  }
  const conditions = round.conditions.map((condition) => ({
    id: condition.id, // ui-copy-ignore
    text: condition.text, // ui-copy-ignore
    state: condition.state, // ui-copy-ignore
    factIds: [] // ui-copy-ignore
  }));
  const truncated = context.truncated === true;
  if (context.coverageGap === true) {
    // A restore gap or an unavailable source can hide a failing condition, so
    // the honest verdict is "unknown" rather than "passed".
    return { state: "unknown", truncated, conditions };
  }
  if (conditions.length === 0) return { state: "unknown", truncated, conditions };

  let failed = 0;
  let pending = 0;
  let recheck = 0;
  let unknown = 0;
  let passed = 0;
  let na = 0;
  for (const condition of conditions) {
    switch (condition.state) {
      case "failed":
        failed += 1;
        break;
      case "pending":
        pending += 1;
        break;
      case "recheck":
        recheck += 1;
        break;
      case "passed":
        passed += 1;
        break;
      case "na":
        na += 1;
        break;
      default:
        unknown += 1;
        break;
    }
  }
  let state = "unknown";
  if (failed > 0) state = "failed";
  else if (unknown > 0) state = "unknown";
  else if (pending > 0) state = "pending";
  else if (recheck > 0) state = "recheck";
  else if (passed > 0) state = "passed";
  else if (na > 0) state = "na";
  return { state, truncated, conditions };
}

/**
 * Whether the round is still open for a reply.
 * @param {object} round - round record, or null.
 * @returns {"awaiting-reply"|"archived"} the round state.
 */
export function roundStateOf(round) {
  if (round === null) return ROUND_STATES[0];
  return round.reply === null ? "awaiting-reply" : "archived";
}

/**
 * Count outstanding asks that need the user.
 * @param {object} state - projection state.
 * @returns {number} number of pending approvals.
 */
export function pendingApprovals(state) {
  let count = 0;
  for (const key of Object.keys(state.approvals)) {
    if (!state.approvals[key].decided) count += 1;
  }
  return count;
}

/**
 * Count background jobs that have not settled.
 * @param {object} state - projection state.
 * @returns {number} number of running jobs.
 */
export function runningJobs(state) {
  let count = 0;
  for (const key of Object.keys(state.jobs)) {
    if (state.jobs[key].status === "running") count += 1;
  }
  return count;
}

/**
 * Choose the single status line, honouring the documented precedence.
 *
 * Precedence is fixed so the page never flips between two equally true
 * sentences: lost connection outranks everything, then a request for the user,
 * then a failure, then the answered/unanswered verdict, then a wait, then
 * coverage degradation.
 *
 * @param {object} state - projection state.
 * @param {object} round - round record, or null.
 * @param {{verificationState: string, summaryFresh: boolean, disconnected: boolean, now: number}} input - derived inputs.
 * @returns {{key: string, line: string}} status key and fallback text.
 */
export function chooseStatus(state, round, input) {
  if (input.disconnected) return { key: "disconnected", line: "连接已断开", tone: "error" };
  if (pendingApprovals(state) > 0) return { key: "needs-input", line: "需要你处理", tone: "warn" };
  if (input.verificationState === "failed") return { key: "failing", line: "当前验证未通过", tone: "error" };

  const archived = round !== null && round.reply !== null;
  if (archived) {
    if (input.verificationState === "passed") return { key: "verified", line: "本轮已回复 核验通过", tone: "success" };
    return { key: "answered-unverified", line: "本轮已回复 仍有待验证", tone: "warn" };
  }
  if (round !== null && round.openTurn === true) {
    if (runningJobs(state) > 0) return { key: "waiting", line: "等待后台结果", tone: "neutral" };
    return { key: "running", line: "正在处理", tone: "info" };
  }

  if (runningJobs(state) > 0) return { key: "waiting", line: "等待后台结果", tone: "neutral" };
  const quietFor = round === null ? 0 : input.now - round.updatedAt;
  if (round !== null && quietFor > 10 * 60 * 1000) return { key: "no-news", line: "暂无新进展", tone: "neutral" };
  return { key: "checking", line: "正在核对相关问题", tone: "info" };
}

/**
 * Rank facts for the brief: what needs the user first, then failing checks, then
 * results, then the most recent finding. Never ranked by call count or duration.
 *
 * @param {object} round - round record.
 * @returns {object[]} ordered facts.
 */
export function rankFacts(round) {
  if (round === null) return [];
  const weight = (fact) => {
    if (fact.kind === "blocker") return 0;
    if (fact.kind === "failure") return 1;
    if (fact.kind === "deliverable") return 2;
    if (fact.kind === "check") return 3;
    if (fact.kind === "change") return 4;
    if (fact.kind === "report") return 6;
    return 5;
  };
  return [...round.facts].sort((left, right) => {
    const delta = weight(left) - weight(right);
    if (delta !== 0) return delta;
    return right.updatedAt - left.updatedAt;
  });
}
