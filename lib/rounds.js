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

import { LIMITS, ROUND_STATES, clip, factIdOf } from "./schema.js";

/* ------------------------------------------------------------------ *
 * Recognisers. Deliberately small: an unrecognised tool still produces a
 * generic fact when it failed, and nothing at all when it merely succeeded.
 * ------------------------------------------------------------------ */

/** Tool names that change the workspace. Matched as a substring of the tool name. */
const CHANGE_TOOLS = ["write", "edit", "patch", "create_file", "str_replace"];

/** Tool names that run a check whose outcome is evidence. */
const CHECK_COMMAND_RE =
  /\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:test|build|lint|check|typecheck|tsc)\b|\b(?:pytest|jest|vitest|mocha|tsc|cargo\s+(?:test|build|check)|go\s+(?:test|build|vet)|make|gradle|mvn|dotnet\s+(?:test|build))\b/iu;

/** Shell-ish tools whose arguments may carry a command. */
const COMMAND_TOOLS = ["bash", "shell", "terminal", "exec", "command", "run"];

/** Phrases that assert an outcome. Recorded as `reported`, never as evidence. */
const CLAIM_RE =
  /(?:已修复|已修正|已解决|修复完成|测试(?:全部)?通过|验证通过|构建成功|已完成|已经完成|成功修复|fixed|resolved|all tests? pass|tests? pass|build succeeds)/iu;

/**
 * Whether a tool name looks like a workspace mutation.
 * @param {string} name - tool name.
 * @returns {boolean} true for write-like tools.
 */
function isChangeTool(name) {
  const lower = String(name).toLowerCase();
  return CHANGE_TOOLS.some((needle) => lower.includes(needle));
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
 * @param {unknown} args - raw tool arguments.
 * @returns {string} the command text, or "" when nothing matches.
 */
function checkCommandOf(args) {
  if (args === null || typeof args !== "object") return "";
  const candidates = [];
  for (const key of ["command", "cmd", "script", "args", "input"]) {
    const value = args[key];
    if (typeof value === "string") candidates.push(value);
    else if (Array.isArray(value)) {
      for (const part of value) if (typeof part === "string") candidates.push(part);
    }
  }
  for (const candidate of candidates) {
    if (CHECK_COMMAND_RE.test(candidate)) return clip(candidate, 160);
  }
  return "";
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
 * Build the empty state of one session's core projection.
 * @param {string} sessionId - runtime session id.
 * @returns {object} fresh state.
 */
export function initState(sessionId) {
  return {
    v: 1, // ui-copy-ignore
    sessionId,
    lastSeq: -1, // ui-copy-ignore
    lastEventTime: 0,
    /** Open round, or null before any user request. */
    round: null, // ui-copy-ignore
    /** Recent closed rounds, newest first; bounded for the history preview. */
    recent: [], // ui-copy-ignore
    /** Round waiting to be handed to the store by the adapter. */
    settled: null, // ui-copy-ignore
    goal: { state: "none", objective: "", updatedAt: 0 },
    jobs: {}, // ui-copy-ignore
    approvals: {},
    todos: [], // ui-copy-ignore
    pendingTurn: null,
    pendingCalls: {},
    reply: null, // ui-copy-ignore
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
    roundId: `${String(sessionId).slice(0, 8)}:${startSeq}`,
    startSeq,
    startedAt: time,
    updatedAt: time,
    title: "", // ui-copy-ignore
    titleSeq: -1, // ui-copy-ignore
    userMessages: 0,
    turnStartSeq: null,
    turnEndSeq: null,
    turnEndKind: null,
    openTurn: false, // ui-copy-ignore
    archivedAt: null,
    reply: null, // ui-copy-ignore
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
  return {
    roundId: round.roundId, // ui-copy-ignore
    startSeq: round.startSeq, // ui-copy-ignore
    startedAt: round.startedAt,
    updatedAt: round.updatedAt,
    archivedAt: round.archivedAt,
    title: round.title, // ui-copy-ignore
    turnEndKind: round.turnEndKind,
    hasReply: round.reply !== null
  };
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
  if (round.outcomes.some((item) => item.subject === subject)) return;
  round.outcomes.push({
    id: `o:${round.roundId}:${subject}`,
    subject,
    kind: input.kind,
    text: clip(input.text, LIMITS.factStatement),
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
  state.round = null;
  state.reply = null;
  state.counters = { steps: 0, tools: 0, failures: 0 };
}

/**
 * Handle a user message: open a round, or record a supplement inside one.
 * @param {object} state - projection state.
 * @param {object} event - committed session event.
 * @returns {void}
 */
function onUserMessage(state, event) {
  const source = event.data?.source;
  const fromGoal = source !== null && typeof source === "object" && source.kind === "goal";
  const text = visibleTextOf(event.data?.content);

  if (fromGoal) {
    // A goal continuation turn belongs to the round that is already open.
    state.pendingTurn = null;
    if (state.round !== null) {
      state.round.userMessages += 1;
      state.round.updatedAt = Math.max(state.round.updatedAt, event.time);
    }
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
  if (round.title === "" && text !== "") {
    round.title = clip(text, LIMITS.title);
    round.titleSeq = event.seq;
  }
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

  const command = call === undefined ? "" : checkCommandOf(call.args);

  if (command !== "") {
    const state_ = failed ? "failed" : "passed";
    const fact = putFact(round, {
      kind: "check", // ui-copy-ignore
      subject: command, // ui-copy-ignore
      statement: `${failed ? "未通过" : "已通过"}：${command}`,
      basis: "observed", // ui-copy-ignore
      validity: "valid", // ui-copy-ignore
      ref,
      time
    });
    putCondition(round, {
      subject: `check:${command}`, // ui-copy-ignore
      text: command, // ui-copy-ignore
      state: state_, // ui-copy-ignore
      ref,
      time
    });
    if (!failed) putOutcome(round, { subject: `check:${command}`, kind: "tool", text: command, factId: fact.id, time });
    state.quiet.lastSeqWithNovelty = event.seq;
    return;
  }

  if (failed) {
    state.counters.failures += 1;
    const summary = clip(output !== "" ? output : name !== "" ? name : "工具调用失败", 160);
    putFact(round, {
      kind: "failure", // ui-copy-ignore
      subject: name !== "" ? name : "tool",
      statement: `失败：${summary}`,
      basis: "observed", // ui-copy-ignore
      validity: "valid", // ui-copy-ignore
      ref,
      urgent: false, // ui-copy-ignore
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
      statement: `已修改 ${files.size || 1} 个文件${file !== "" ? `，包含 ${file}` : ""}`,
      basis: "observed", // ui-copy-ignore
      validity: "valid", // ui-copy-ignore
      ref,
      time
    });
    fact.files = [...files].slice(-8);
    putOutcome(round, {
      subject: "changes", // ui-copy-ignore
      kind: "file", // ui-copy-ignore
      text: `已修改 ${fact.files.length || 1} 个文件`,
      factId: fact.id, // ui-copy-ignore
      time
    });
    state.quiet.lastSeqWithNovelty = event.seq;
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
    round.reply = { seq: candidate.seq, text: clip(candidate.text, LIMITS.factStatement), time: candidate.time };
    round.archivedAt = event.time;
  } else if (kind === "error" || kind === "blocked") {
    round.reply = null;
  }
  state.reply = null;
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
    finishedAt: null
  };
  const round = state.round;
  if (round !== null) {
    putCondition(round, {
      subject: `job:${data.jobId}`, // ui-copy-ignore
      text: `等待：${state.jobs[data.jobId].label || state.jobs[data.jobId].kind}`,
      state: "pending", // ui-copy-ignore
      ref: { seq: event.seq, label: "后台任务" },
      time: event.time // ui-copy-ignore
    });
  }
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
  const round = state.round;
  if (round === null) return;
  const label = job?.label || job?.kind || "后台任务";
  putCondition(round, {
    subject: `job:${data.jobId}`, // ui-copy-ignore
    text: `等待：${label}`, // ui-copy-ignore
    state: status === "completed" ? "passed" : status === "killed" ? "unknown" : "failed",
    ref: { seq: event.seq, label: "后台任务" },
    time: event.time // ui-copy-ignore
  });
  if (status === "completed") {
    putOutcome(round, { subject: `job:${data.jobId}`, kind: "job", text: label, time: event.time });
  } else {
    putFact(round, {
      kind: "failure", // ui-copy-ignore
      subject: `job:${data.jobId}`, // ui-copy-ignore
      statement: `后台任务${status === "killed" ? "已终止" : "失败"}：${label}`,
      basis: "observed", // ui-copy-ignore
      validity: "valid", // ui-copy-ignore
      ref: { seq: event.seq, label: "后台任务" },
      time: event.time // ui-copy-ignore
    });
  }
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
    const fact = putFact(round, {
      kind: "deliverable", // ui-copy-ignore
      subject: name, // ui-copy-ignore
      statement: `已生成：${name}`,
      basis: "observed", // ui-copy-ignore
      validity: "valid", // ui-copy-ignore
      ref: { seq: event.seq, label: "成果" },
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
    case "session/title":
      if (state.round !== null && state.round.title === "") {
        const title = event.data?.title;
        if (typeof title === "string" && title !== "") state.round.title = clip(title, LIMITS.title);
      }
      break;
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
 * @param {{verificationState: string, summaryFresh: boolean, summaryBudgetExhausted: boolean, disconnected: boolean, now: number}} input - derived inputs.
 * @returns {{key: string, line: string}} status key and fallback text.
 */
export function chooseStatus(state, round, input) {
  if (input.disconnected) return { key: "disconnected", line: "连接已断开" };
  if (pendingApprovals(state) > 0) return { key: "needs-input", line: "需要处理" };
  if (input.verificationState === "failed") return { key: "failing", line: "当前验证未通过" };

  const archived = round !== null && round.reply !== null;
  if (archived) {
    if (input.verificationState === "passed") return { key: "verified", line: "当前已知核验已通过" };
    return { key: "answered-unverified", line: "本轮已回复 仍有待验证" };
  }

  if (runningJobs(state) > 0) return { key: "waiting", line: "等待后台结果" };
  if (input.summaryBudgetExhausted && !input.summaryFresh) {
    return { key: "summary-paused", line: "自动摘要已暂停" };
  }
  const quietFor = input.now - round?.updatedAt ? input.now - (round?.updatedAt ?? input.now) : 0;
  if (round !== null && quietFor > 10 * 60 * 1000) return { key: "no-news", line: "暂未形成新结论" };
  return { key: "checking", line: "正在核对相关问题" };
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
