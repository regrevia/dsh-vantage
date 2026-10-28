/**
 * Harness half of the task overview.
 *
 * The plugin folds one session's event log into a small, deterministic picture
 * of the current round, keeps a bounded archive of finished rounds, and serves
 * both through seven exact Fetch routes. It observes; it never steers. Nothing
 * here enqueues a message, edits a tool list, changes a system prompt, or
 * touches Goal, subagent, or team state — every one of those is read-only input.
 *
 * Two decisions worth knowing before reading:
 *
 * 1. State is rebuilt by replaying the session's own events, not by asking a
 *    projection service. A replay is deterministic, has no schema to negotiate,
 *    and restores exactly what the log still contains; the cost is one pass over
 *    the log per session, which is why the result is cached and the cache is
 *    keyed by the session header rather than by the id alone (a fork or a reuse
 *    of the id must not continue an old watermark).
 * 2. The summary is best effort by construction. When no model is reachable, or
 *    the last packet already covered this position, the page keeps the last
 *    valid topic lines. Facts mode is a complete state, not a degraded one, and
 *    there is no usage quota to spend.
 */

import { readFileSync } from "node:fs";

import { LIMITS, OverviewError, ROUTES, ROUTE_PREFIX, clip } from "./lib/schema.js";
import { PROJECTION_VERSION, apply as foldEvent, chooseStatus, evaluateVerification, initState, roundStateOf } from "./lib/rounds.js";
import { HistoryStore } from "./lib/store.js";
import { createRoutes } from "./lib/api.js";
import {
  SummaryScheduler,
  buildPacket,
  estimateTokens,
  publishVerdict,
  safeService,
  summarise,
  SUMMARY_SYSTEM_PROMPT
} from "./lib/summary.js";

/** Read once so `/health`-style reporting and log lines agree with package.json. */
const PACKAGE = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));

/** Projection/cache key; also the id used by the client to detect the Harness half. */
export const STATE_KEY = "vantage";

/** Defaults, mirroring the documented configuration. */
export const DEFAULT_CONFIG = Object.freeze({
  overview: { // ui-copy-ignore
    defaultScope: "currentReplyRound",
    maxBriefItems: 3,
    maxUrgentItems: 1,
    showPlanOnlyWhenExplicit: true,
    detailsCollapsed: true,
    eta: "evidenceOnly" // ui-copy-ignore
  },
  summary: { // ui-copy-ignore
    // Recording is per session and starts off; this switch can only forbid every
    // model call, never enable a session behind the reader's back.
    enabled: true, // ui-copy-ignore
    cadenceMs: 180000,
    firstEligibleMs: 60000,
    maxInputTokens: 2400,
    maxOutputTokens: 400,
    maxTopics: 3,
    requestDeadlineMs: 25000,
    provider: "", // ui-copy-ignore
    model: "" // ui-copy-ignore
  },
  history: { // ui-copy-ignore
    maxRoundsPerSession: 20,
    maxRoundsTotal: 200,
    maxSerializedBytes: 2097152
  }
});

/**
 * Schema handed to the storage domain. Records are already shaped by the store
 * and are re-validated field by field on restore, so the schema's only duty is
 * to let a stored row through unchanged.
 */
const STORE_SPEC = Object.freeze({ version: 2, compatibleVersions: [1] });

/** How often the scheduler wakes up to check a visible session. */
const TICK_MS = 30000;
/** How many folded sessions stay in memory before the oldest is dropped. */
const CACHE_LIMIT = 24;

/**
 * Merge user config over the defaults, one section at a time so a partial
 * section cannot wipe a sibling default.
 *
 * @param {unknown} input - raw plugin config.
 * @returns {object} effective config.
 */
export function normalizeConfig(input) {
  const source = input !== null && typeof input === "object" ? input : {};
  const merge = (base) => {
    const section = source[base] ?? {};
    const out = { ...DEFAULT_CONFIG[base] };
    for (const key of Object.keys(out)) {
      const value = section[key];
      if (value === undefined) continue;
      if (typeof value === typeof out[key]) out[key] = value;
    }
    return out;
  };
  const config = {
    overview: merge("overview"), // ui-copy-ignore
    summary: merge("summary"), // ui-copy-ignore
    history: merge("history") // ui-copy-ignore
  };
  // A view cannot raise the Harness's ceiling; it may only ask for less.
  config.history.maxRoundsPerSession = Math.min(Math.max(1, config.history.maxRoundsPerSession), 20);
  config.history.maxRoundsTotal = Math.min(Math.max(1, config.history.maxRoundsTotal), 200);
  return config;
}

/**
 * Install the plugin.
 *
 * @param {object} ctx - runtime plugin context.
 * @param {object} [input] - plugin config.
 * @returns {void}
 */
export function apply(ctx, input) {
  const config = normalizeConfig(input);
  const warn = (message) => {
    try {
      ctx.logger?.warn?.(`[vantage] ${message}`);
    } catch {
      // A broken logger must not break the panel.
    }
  };
  const runtime = new Runtime(ctx, config, warn);
  install(ctx, runtime, warn);
}

/**
 * One runtime per plugin instance: the state cache, the store, the per-session
 * switches, and the scheduler that ties them together.
 */
export class Runtime {
  /**
   * @param {object} ctx - runtime plugin context.
   * @param {object} config - effective config.
   * @param {(message: string) => void} warn - logger.
   */
  constructor(ctx, config, warn) {
    this.ctx = ctx;
    /** Context that owns the injected services, once they are available. */
    this.owner = undefined;
    this.config = config;
    this.warn = warn;
    this.store = new HistoryStore({
      maxRoundsPerSession: config.history.maxRoundsPerSession,
      maxRoundsTotal: config.history.maxRoundsTotal,
      maxSerializedBytes: config.history.maxSerializedBytes,
      warn
    });
    // Cadence and single-flight only; usage never gates the work itself.
    this.scheduler = new SummaryScheduler({
      cadenceMs: config.summary.cadenceMs,
      firstEligibleMs: config.summary.firstEligibleMs
    });
    /** @type {Map<string, boolean>} session identity key -> overview enabled. */
    this.switches = new Map();
    /** @type {Map<string, number>} session identity key -> generation, bumped on every flip. */
    this.generations = new Map();
    /** @type {Map<string, {state: object, key: string, at: number}>} */
    this.cache = new Map();
    /** @type {Map<string, object>} sessionId -> last published brief. */
    this.summaries = new Map();
    /** @type {Map<string, number>} sessionId -> when a summary last completed. */
    this.lastSummaryAt = new Map();
    /** @type {Map<string, string>} sessionId -> the request still allowed to publish. */
    this.requests = new Map();
    this.requestSeq = 0;
    /** @type {Map<string, string>} sessionId -> last round handed to the store. */
    this.archived = new Map();
    this.connection = "online";
    this.now = () => Date.now();
    this.timer = null;
    this.closed = false;
  }

  /**
   * Resolve a session id, or answer the documented not-found failure.
   *
   * @param {string} sessionId - runtime session id.
   * @returns {Promise<object>} the session.
   * @throws {Error & {code?: string, status?: number}} `session/not-found`.
   */
  async session(sessionId) {
    const sessions = safeService(this.owner ?? this.ctx, "sessions");
    const session = sessions?.get?.(sessionId);
    if (session === undefined || session === null) {
      // The panel only ever reads a session this GUI has open. Anything else is
      // out of the caller's scope, not a server fault: answer 403 and let the
      // page keep showing what it already has.
      throw new OverviewError("forbidden", "本页面只读取当前打开的会话", 403);
    }
    return session;
  }

  /**
   * The folded state of one session, replaying the log once per header identity.
   *
   * @param {object} session - runtime session.
   * @returns {object|undefined} state, or undefined when the log is unreadable.
   */
  stateOf(session) {
    const key = identityOf(session);
    const cached = this.cache.get(session.id);
    const fresh = cached !== undefined && cached.key === key && cached.state.v === PROJECTION_VERSION;
    if (fresh) return cached.state;
    try {
      const state = initState(session.id);
      const events = session.ownEvents();
      for (const event of events) foldEvent(state, event);
      this.cache.set(session.id, { state, key, seen: events.length, at: this.now() });
      this.trimCache(session.id);
      return state;
    } catch (error) {
      this.warn(`cannot read the session log: ${messageOf(error)}`);
      return undefined;
    }
  }

  /**
   * Fold the events committed since the last read into the cached state.
   *
   * A cached projection used to answer every later read unchanged: the panel
   * froze at whatever it saw first. Replaying the tail keeps it current, and the
   * fold ignores an event at or below its watermark, so repeated delivery is
   * free. A shorter log or a new session header means the cache is stale, and
   * the caller gets a full replay instead.
   *
   * @param {object} session - runtime session.
   * @returns {object|undefined} state, or undefined when the log is unreadable.
   */
  noteEvent(session) {
    // A session whose overview is off has no projection, no watermark and no
    // cache: the check is one map lookup, so the global listener stays cheap.
    if (!this.isEnabled(session)) return undefined;
    const cached = this.cache.get(session.id);
    let events;
    try {
      events = session.ownEvents();
    } catch (error) {
      this.warn(`cannot read the session log: ${messageOf(error)}`);
      return undefined;
    }
    if (cached === undefined || cached.key !== identityOf(session) || cached.state.v !== PROJECTION_VERSION || events.length < cached.seen) {
      return this.stateOf(session);
    }
    try {
      for (let index = cached.seen; index < events.length; index += 1) foldEvent(cached.state, events[index]);
      cached.seen = events.length;
      cached.at = this.now();
      return cached.state;
    } catch (error) {
      this.warn(`cannot follow the session log: ${messageOf(error)}`);
      return undefined;
    }
  }

  /**
   * Keep the projection cache bounded; an idle session is re-read from its log
   * when it comes back, which is cheaper than retaining every session forever.
   *
   * @param {string} keep - session id that must survive the trim.
   * @returns {void}
   */
  trimCache(keep) {
    if (this.cache.size <= CACHE_LIMIT) return;
    const entries = [...this.cache.entries()].sort((left, right) => left[1].at - right[1].at);
    for (const [sessionId] of entries) {
      if (this.cache.size <= CACHE_LIMIT) break;
      if (sessionId === keep) continue;
      this.cache.delete(sessionId);
    }
  }

  /**
   * The last published brief for a session.
   * @param {string} sessionId - runtime session id.
   * @returns {object|undefined} brief.
   */
  briefOf(sessionId) {
    return this.summaries.get(sessionId);
  }

  /**
   * Store an archived round, once per round.
   *
   * @param {object} session - runtime session.
   * @param {object|undefined} state - folded state.
   * @returns {void}
   */
  settle(session, state) {
    const settled = state?.settled;
    if (settled === null || settled === undefined) return;
    if (this.archived.get(session.id) === settled.roundId) return;
    this.archived.set(session.id, settled.roundId);
    void this.store.insert(this.recordOf(session, state, settled));
  }

  /**
   * Render a sealed round into the flat record the archive stores.
   *
   * @param {object} session - runtime session.
   * @param {object} state - state that sealed the round.
   * @param {{roundId: string, summary: object, round: object}} settled - sealed round.
   * @returns {object} archive record.
   */
  recordOf(session, state, settled) {
    const round = settled.round;
    const verification = evaluateVerification(round);
    const status = chooseStatus(state, round, {
      verificationState: verification.state,
      summaryFresh: false,
      disconnected: false,
      now: this.now() // ui-copy-ignore
    });
    return {
      sessionId: session.id,
      roundId: round.roundId, // ui-copy-ignore
      title: round.title, // ui-copy-ignore
      statusLine: status.line,
      startedAt: round.startedAt,
      updatedAt: round.updatedAt,
      archivedAt: round.archivedAt ?? round.updatedAt,
      roundState: roundStateOf(round),
      runtimeState: "idle",
      goalState: state.goal?.state ?? "none",
      verificationState: verification.state,
      replyText: round.reply?.text ?? "",
      verification,
      outcomes: {
        truncated: round.outcomes.length > LIMITS.outcomes,
        items: round.outcomes.slice(-LIMITS.outcomes).map((outcome) => ({ id: outcome.id ?? "", kind: outcome.kind ?? "change", text: outcome.text ?? "", factIds: outcome.factIds ?? [] }))
      },
      facts: round.facts.slice(-40)
    };
  }

  /**
   * Whether one session's overview is switched on. Missing state means off: the
   * default is never "record everything, hide it later".
   *
   * @param {object} session - runtime session.
   * @returns {boolean} true when this session is being recorded.
   */
  isEnabled(session) {
    return this.switches.get(identityOf(session)) === true;
  }

  /**
   * Generation of a session's switch. Bumped on every flip so an answer from an
   * earlier enabled period can never be published after it is switched off.
   *
   * @param {string} key - session identity key.
   * @returns {number} current generation.
   */
  generationOf(key) {
    return this.generations.get(key) ?? 0;
  }

  /**
   * Turn the overview on or off for one session. This side owns the decision: the
   * view may ask, and every window reads the same answer back. Switching off is
   * immediate — pending work is dropped, the in-flight answer is discarded, and
   * the main agent is never touched.
   *
   * @param {object} session - runtime session.
   * @param {boolean} enabled - requested state.
   * @returns {Promise<{enabled: boolean, generation: number}>} the recorded answer.
   */
  async setEnabled(session, enabled) {
    const key = identityOf(session);
    const want = enabled === true;
    const was = this.switches.get(key) === true;
    if (was === want) return { enabled: was, generation: this.generationOf(key) };
    this.switches.set(key, want);
    const generation = this.generationOf(key) + 1;
    this.generations.set(key, generation);
    if (!want) {
      this.scheduler.forget(session.id);
      this.summaries.delete(session.id);
      this.lastSummaryAt.delete(session.id);
      this.requests.delete(session.id);
      this.cache.delete(session.id);
    }
    // The switch is a runtime fact and must survive a restart in both directions.
    this.store.saveSwitches(Object.fromEntries(this.switches)).catch(() => {});
    return { enabled: want, generation };
  }

  /**
   * The goal line handed to the summariser, when the round has one.
   *
   * @param {object} state - folded session state.
   * @returns {string} goal or empty string.
   */
  goalOf(state) {
    const goal = state?.goal;
    if (goal === null || goal === undefined) return "";
    for (const value of [goal.objective, goal.text, goal.title, goal.statement]) {
      if (typeof value === "string" && value.trim() !== "") return value.trim();
    }
    return "";
  }

  /**
   * Ask for one summary. A manual request skips the cadence window and nothing
   * else; a session that is switched off never reaches the model at all.
   *
   * @param {object} session - runtime session.
   * @param {{manual: boolean}} input - who asked.
   * @returns {Promise<object>} verdict sent to the client.
   */
  async requestSummary(session, input) {
    if (!this.isEnabled(session) || !this.config.summary.enabled) {
      return { kind: "skipped", reason: "disabled", text: "概览已关闭" };
    }
    const state = this.stateOf(session);
    if (state === undefined) return { kind: "skipped", reason: "fresh", text: "本会话的记录暂不可读" };
    const round = state.round;
    if (round === null) return { kind: "skipped", reason: "fresh", text: "正在整理本轮进展" };
    const route = this.routeOf(session);
    if (route === null) return { kind: "skipped", reason: "no-model", text: "当前没有可用的模型" };
    if (this.scheduler.duplicate(session.id, round.roundId, state.lastSeq)) {
      return { kind: "skipped", reason: "fresh", text: "没有新的进展" };
    }
    if (!input.manual) {
      const verdict = this.scheduler.due(session.id, {
        lastAt: this.lastSummaryAt.get(session.id) ?? 0,
        firstAt: round.startedAt,
        now: this.now()
      });
      if (!verdict.ok) return { kind: "skipped", reason: verdict.reason, text: "正在整理" };
    }
    // The input cap covers the whole request including the instruction, so the
    // packet gets what is left after the prompt it is sent with.
    const cap = Number.isFinite(this.config.summary.maxInputTokens) ? this.config.summary.maxInputTokens : 2400;
    const room = Math.max(96, cap - estimateTokens(SUMMARY_SYSTEM_PROMPT) - 8);
    const previousTopics = this.summaries.get(session.id)?.topics?.map((topic) => topic.headline) ?? [];
    const packet = buildPacket(round, {
      goal: this.goalOf(state),
      previousTopics,
      maxFacts: 24,
      maxTokens: room
    });
    if (packet.text === "") return { kind: "skipped", reason: "fresh", text: "正在整理本轮进展" };
    const key = identityOf(session);
    const generation = this.generationOf(key);
    const roundId = round.roundId;
    const seq = state.lastSeq;
    const requestId = `${session.id}:${this.now()}:${(this.requestSeq += 1)}`;
    this.requests.set(session.id, requestId);
    this.scheduler.begin(session.id);
    try {
      const result = await summarise(this.owner ?? this.ctx, {
        sessionId: session.id,
        provider: route.provider,
        model: route.model,
        maxOutputTokens: this.config.summary.maxOutputTokens,
        deadlineMs: this.config.summary.requestDeadlineMs,
        maxTopics: this.config.summary.maxTopics,
        packet
      });
      if (result === null) return { kind: "skipped", reason: "no-model", text: "模型没有给出可用结果" };
      // A topic is only true for the state it was asked about; a newer request, a
      // switched-off session, a new round, or new facts all discard it.
      const rejected = publishVerdict({
        requestId,
        currentRequestId: this.requests.get(session.id),
        manual: input.manual,
        enabled: this.isEnabled(session),
        generation,
        expectedGeneration: this.generationOf(key),
        state: this.stateOf(session),
        roundId,
        seq
      });
      if (rejected !== null) return { kind: "skipped", reason: rejected.reason, text: rejected.text };
      this.summaries.set(session.id, {
        roundId,
        throughSeq: seq,
        revision: `${roundId}:${seq}`, // ui-copy-ignore
        generatedAt: this.now(),
        topics: result.topics, // ui-copy-ignore
        tokens: result.tokens // ui-copy-ignore
      });
      this.scheduler.remember(session.id, roundId, seq);
      this.lastSummaryAt.set(session.id, this.now());
      return { kind: "queued" };
    } finally {
      this.scheduler.end(session.id);
      if (this.requests.get(session.id) === requestId) this.requests.delete(session.id);
    }
  }

  /**
   * The provider/model to summarise with: the configured pair first, else the
   * selection the session itself already recorded.
   *
   * @param {object} session - runtime session.
   * @returns {{provider: string, model: string}|null} route, or null.
   */
  routeOf(session) {
    const summary = this.config.summary;
    if (summary.provider !== "" && summary.model !== "") {
      return { provider: summary.provider, model: summary.model };
    }
    try {
      const events = session.ownEvents();
      for (let index = events.length - 1; index >= 0; index -= 1) {
        const event = events[index];
        if (event.type === "model/selection") {
          if (typeof event.data?.provider === "string" && typeof event.data?.model === "string") {
            return { provider: event.data.provider, model: event.data.model };
          }
          continue;
        }
        if (event.type !== "request/header") continue;
        const config = event.data?.header?.config;
        if (typeof config?.provider === "string" && typeof config?.model === "string") {
          return { provider: config.provider, model: config.model };
        }
      }
    } catch {
      // Fall through: no route is a supported outcome.
    }
    return null;
  }

  /**
   * Turn the automatic summaries of one session on or off.
   * @param {string} sessionId - runtime session id.
   * @param {boolean} enabled - wanted state.
   * @returns {void}
   */


  /**
   * One scheduler pass. An enabled session keeps recording and summarising even
   * while nobody is looking at the panel; the view only stops polling itself.
   *
   * @returns {Promise<void>} resolved when the pass finishes.
   */
  async tick() {
    if (this.closed) return;
    const sessions = safeService(this.owner ?? this.ctx, "sessions");
    if (sessions === undefined) return;
    const ids = new Set([...this.cache.keys(), ...this.summaries.keys()]);
    for (const sessionId of ids) {
      let session;
      try {
        session = await this.session(sessionId);
      } catch {
        continue;
      }
      if (!this.isEnabled(session)) continue;
      const state = this.stateOf(session);
      const round = state?.round;
      if (round === null || round === undefined) continue;
      if (this.scheduler.duplicate(session.id, round.roundId, state.lastSeq)) continue;
      await this.requestSummary(session, { manual: false });
    }
  }
}

/**
 * Wire the runtime into the runtime: open storage, install the listener, register
 * the routes, and start the scheduler.
 *
 * @param {object} ctx - runtime plugin context.
 * @param {Runtime} runtime - the runtime.
 * @param {(message: string) => void} warn - logger.
 * @returns {void}
 */
function install(ctx, runtime, warn) {
  ctx.effect(() => {
    void openStore(runtime, warn);
    return () => {
      runtime.closed = true;
      if (runtime.timer !== null) clearInterval(runtime.timer);
      void runtime.store.close();
    };
  });

  ctx.effect(() => {
    const off = ctx.on?.("session/event", (session, event) => {
      if (event === undefined || session === undefined) return;
      const state = runtime.noteEvent(session);
      if (state === undefined) return;
      runtime.settle(session, state);
    });
    return () => off?.();
  });

  const mountRoutes = (owner) => {
    const connection = safeService(owner, "connection");
    const register = connection?.fetch?.register;
    if (typeof register !== "function") {
      warn("no connection service; the panel has no data");
      return () => {};
    }
    const disposers = [];
    for (const route of createRoutes(runtime)) {
      try {
        const dispose = register.call(connection.fetch, route);
        if (typeof dispose === "function") disposers.push(dispose);
      } catch (error) {
        warn(`route ${route.path} was not registered: ${messageOf(error)}`);
      }
    }
    if (runtime.timer !== null && runtime.timer !== undefined) clearInterval(runtime.timer);
    runtime.timer = setInterval(() => {
      void runtime.tick();
    }, TICK_MS);
    if (typeof runtime.timer.unref === "function") runtime.timer.unref();
    return () => {
      for (const dispose of disposers) {
        try {
          dispose();
        } catch {
          // Disposal is best effort; the connection owns the lifetime.
        }
      }
    };
  };

  // Wait for the connection service the way shipped plugins do, so ordering
  // between plugins cannot leave the panel without routes.
  if (typeof ctx.inject === "function") {
    // Wait for the session registry too: the panel reads live sessions only, and
    // a route mounted before it exists would answer 403 for every request.
    ctx.inject(["connection", "sessions"], (owner) => {
      runtime.owner = owner ?? ctx;
      return mountRoutes(owner ?? ctx);
    });
  }
  else ctx.effect(() => mountRoutes(ctx));

  try {
    ctx.logger?.info?.(`[vantage] ${PACKAGE.version} serving ${ROUTE_PREFIX}`);
  } catch {
    // Logging is optional.
  }
}

/**
 * Open the persistent store, warned and non-fatal when the profile has no
 * storage domain or the history is unreadable.
 *
 * @param {Runtime} runtime - the runtime.
 * @param {(message: string) => void} warn - logger.
 * @returns {Promise<void>} resolved when opening finished.
 */
const STORE_OPEN_TIMEOUT_MS = 5000;
const STORE_OPEN_TIMED_OUT = Symbol("store-open-timeout");

async function openStore(runtime, warn) {
  const storageDomain = safeService(runtime.ctx, "storageDomain");
  if (storageDomain === undefined) return;
  try {
    // A domain that never answers must not hold the boot path open: the store
    // falls back to memory and the panel still renders.
    let timer;
    const timeout = new Promise((resolve) => {
      timer = setTimeout(() => resolve(STORE_OPEN_TIMED_OUT), STORE_OPEN_TIMEOUT_MS);
      timer.unref?.();
    });
    const opened = await Promise.race([runtime.store.open(storageDomain, STORE_SPEC), timeout]);
    clearTimeout(timer);
    if (opened === STORE_OPEN_TIMED_OUT) {
      runtime.store.abandon();
      warn("history stays in memory: the storage domain did not answer");
      return;
    }
    const switches = await runtime.store.loadSwitches();
    if (switches !== undefined) {
      // Restored before the listener can classify a single event, so a restart
      // never records a session that was switched off when the app closed.
      for (const [key, value] of Object.entries(switches)) runtime.switches.set(key, value === true);
    }
  } catch (error) {
    warn(`history stays in memory: ${messageOf(error)}`);
  }
}

/**
 * Header identity of a session: two sessions that share an id but not this
 * string must not share a watermark.
 *
 * @param {object} session - runtime session.
 * @returns {string} identity key.
 */
function identityOf(session) {
  const header = session.header ?? {};
  return [
    session.firstLiveSeq ?? -1,
    session.inheritedEventCount ?? 0,
    header.createdAt ?? 0,
    header.cwd ?? "",
    header.formatVersion ?? "",
    header.isSeeded === true ? "seed" : "live"
  ].join("|");
}

/**
 * Message of an unknown thrown value.
 * @param {unknown} error - thrown value.
 * @returns {string} a short message.
 */
function messageOf(error) {
  if (error instanceof Error) return error.message;
  return String(error);
}

