/**
 * Bounded history for archived rounds, plus the tiny persistence facade the rest
 * of the runtime uses.
 *
 * The store is deliberately dumb: it holds already-summarised rounds in a ring of
 * `maxRoundsTotal` and never re-derives anything. Two ceilings apply at once — a
 * per-session count and a global count — and the earlier of the two wins, so one
 * busy session cannot evict every other session's history.
 *
 * Durable copies go through `storageDomain` when the runtime offers it. If it does
 * not, the store still works for the lifetime of the process and reports
 * `persistent: false`; nothing above it branches on that.
 */

import { clip } from "./schema.js";

/**
 * Keep only what the archive needs to show and reopen a summary paragraph: the
 * text, the headline list with its provenance, and nothing that costs bytes.
 *
 * @param {unknown} brief - published brief.
 * @returns {object|null} bounded copy, or null.
 */
export function briefRecordOf(brief) {
  if (brief === null || typeof brief !== "object") return null;
  const topics = Array.isArray(brief.topics) ? brief.topics.slice(0, 8).map((topic) => ({
    headline: clip(topic?.headline ?? "", 120),
    qualifier: clip(topic?.qualifier ?? "", 120),
    details: Array.isArray(topic?.details) ? topic.details.slice(0, 4).map((line) => clip(line, 160)) : [],
    factIds: Array.isArray(topic?.factIds) ? topic.factIds.slice(0, 8).map((id) => clip(id, 80)) : []
  })) : [];
  const summary = clip(brief.summary ?? "", 400);
  if (summary === "" && topics.length === 0) return null;
  return {
    revision: clip(brief.revision ?? "", 120),
    generatedAt: Number.isFinite(brief.generatedAt) ? brief.generatedAt : 0,
    materialKey: clip(brief.materialKey ?? "", 600),
    summary,
    topics,
    tokens: Number.isFinite(brief.tokens) ? brief.tokens : 0
  };
}

// A domain name is an identifier, not a display name: the storage service only
// accepts `[a-z][a-z0-9_]*`, so the hyphenated package name cannot be used.
const DOMAIN_NAME = "dsh_vantage";
const TABLE_ROUNDS = "rounds";
const TABLE_SESSIONS = "sessions";
/** Key of the one row the `sessions` table stores: per-session overview switches. */
const SETTINGS_KEY = "overview-settings"; // ui-copy-ignore

/**
 * @typedef {object} StoreOptions
 * @property {number} maxRoundsPerSession - per-session ring size.
 * @property {number} maxRoundsTotal - global ring size.
 * @property {number} maxSerializedBytes - approximate ceiling on all stored rounds.
 * @property {(message: string) => void} warn - logger for swallowed storage errors.
 */

/**
 * Keep only the fields a stored row needs to explain why a turn stopped.
 * @param {unknown} reason - authoritative `turn/end` reason.
 * @returns {object|null} compact reason, or null.
 */
function storedReasonOf(reason) {
  if (reason === null || typeof reason !== "object") return null;
  const stored = {};
  if (typeof reason.kind === "string") stored.kind = clip(reason.kind, 40);
  if (typeof reason.reason?.kind === "string") stored.reason = { kind: clip(reason.reason.kind, 40) };
  if (reason.error !== null && typeof reason.error === "object") {
    stored.error = {};
    if (typeof reason.error.code === "string") stored.error.code = clip(reason.error.code, 80);
    if (typeof reason.error.message === "string") stored.error.message = clip(reason.error.message, 240);
  }
  return stored;
}

/**
 * A bounded, optionally persistent archive of archived rounds.
 */
export class HistoryStore {
  /**
   * @param {StoreOptions} options - ceilings and logger.
   */
  constructor(options) {
    this.maxRoundsPerSession = options.maxRoundsPerSession;
    this.maxRoundsTotal = Math.max(1, options.maxRoundsTotal);
    this.maxSerializedBytes = Math.max(64 * 1024, options.maxSerializedBytes);
    this.warn = options.warn;
    /** @type {Map<string, object[]>} sessionId -> rounds, newest last. */
    this.bySession = new Map();
    /** Insertion order of every stored round, used for the global ceiling. */
    this.order = [];
    this.bytes = 0;
    this.persistent = false;
    this.domain = null;
    // Set when the caller stopped waiting for a slow domain: a late answer must
    // not revive a store the runtime has already reported as memory-only.
    this.abandoned = false;
  }

  /**
   * Open the durable domain when the runtime provides one.
   *
   * The storage service takes a domain *declaration* and returns an opened
   * handle; it does not provide a `defineDomain` helper to plugins, so the
   * declaration is built here. A failure is not fatal: the in-memory store
   * continues and the plugin still answers reads (the documented degraded mode).
   *
   * @param {object|undefined} storageDomain - the runtime service, if injected.
   * @param {{version: number, compatibleVersions?: number[]}} spec - storage spec version.
   * @returns {Promise<void>} resolves once the open attempt settles.
   */
  async open(storageDomain, spec) {
    if (storageDomain === undefined || storageDomain === null) return;
    try {
      const declaration = declareDomain(spec);
      const domain = await storageDomain.open(declaration);
      if (this.abandoned) {
        await domain.close?.();
        return;
      }
      this.domain = domain;
      this.persistent = true;
      await this.restore();
    } catch (error) {
      this.warn(`history store stays in memory: ${error instanceof Error ? error.message : String(error)}`);
      this.domain = null;
      this.persistent = false;
    }
  }

  /**
   * Give up on a durable domain that did not answer in time. The store keeps
   * working for this process; a late answer is closed instead of adopted.
   *
   * @returns {void}
   */
  abandon() {
    this.abandoned = true;
    this.domain = null;
    this.persistent = false;
  }

  /**
   * Read the per-session overview switches kept next to the rounds. The map is
   * Authoritative here: the view may ask for a change, but only this side decides
   * whether a session is recorded, and the answer survives a window reload.
   *
   * @returns {Promise<Record<string, boolean>|undefined>} stored switches, if any.
   */
  async loadSwitches() {
    if (this.domain === null) return undefined;
    try {
      const row = this.domain.table(TABLE_SESSIONS).get(SETTINGS_KEY);
      if (row === null || typeof row !== "object" || typeof row.switches !== "object") return undefined;
      const result = {};
      for (const [key, value] of Object.entries(row.switches)) {
        if (typeof key === "string" && typeof value === "boolean") result[key] = value;
      }
      return result;
    } catch (error) {
      this.warn(`overview switches unreadable: ${error instanceof Error ? error.message : String(error)}`);
      return undefined;
    }
  }

  /**
   * Persist the per-session overview switches. Only on/off is stored: never a
   * cursor, never a summary, so a reload cannot replay a disabled period.
   *
   * @param {Record<string, boolean>} switches - session identity key -> enabled.
   * @returns {Promise<void>} resolves once the write attempt settles.
   */
  async saveSwitches(switches) {
    if (this.domain === null) return;
    try {
      await this.domain.table(TABLE_SESSIONS).put(SETTINGS_KEY, { version: 2, switches, at: Date.now() });
    } catch (error) {
      this.warn(`overview switches not saved: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Reload the rounds that survived a restart.
   * @returns {Promise<void>} resolves when the table has been read.
   */
  async restore() {
    if (this.domain === null) return;
    try {
      const table = this.domain.table(TABLE_ROUNDS);
      for (const [key, row] of table.entries()) {
        if (row === null || typeof row !== "object" || typeof row.roundId !== "string") continue;
        // A durable copy whose key no longer matches its own identity belongs
        // to no session this build can address; drop it instead of guessing.
        if (storageKeyOf(row.sessionId, row.roundId) !== key) continue;
        this.insert(row, { persist: false });
      }
      // Restored records count against the same ceilings as fresh ones.
      this.trim(this.bySession.keys().next().value ?? "");
    } catch (error) {
      this.warn(`history restore failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Store one archived round, replacing an existing copy of the same id.
   *
   * @param {object} round - compact round summary plus its rendered fields.
   * @param {{persist?: boolean}} [options] - skip the durable write during restore.
   * @returns {void}
   */
  insert(round, options = {}) {
    const sessionId = round.sessionId;
    if (typeof sessionId !== "string" || typeof round.roundId !== "string") return;

    const list = this.bySession.get(sessionId) ?? [];
    const existing = list.findIndex((item) => item.roundId === round.roundId);
    if (existing >= 0) {
      this.bytes -= sizeOf(list[existing]);
      list.splice(existing, 1);
      this.order = this.order.filter((entry) => entry.roundId !== round.roundId);
    }

    const brief = briefRecordOf(round.brief ?? null);
    const record = {
      sessionId,
      roundId: round.roundId,
      title: clip(round.title ?? "", 120),
      // The paragraph the reader saw is part of the record: without it the
      // archive falls back to facts while the live card shows prose, and the
      // round cannot be opened at all.
      summaryText: clip(round.summaryText ?? brief?.summary ?? "", 400),
      brief,
      statusLine: clip(round.statusLine ?? "", 200),
      startedAt: Number.isFinite(round.startedAt) ? round.startedAt : 0,
      updatedAt: Number.isFinite(round.updatedAt) ? round.updatedAt : 0,
      archivedAt: Number.isFinite(round.archivedAt) ? round.archivedAt : 0,
      roundState: round.roundState ?? "archived",
      runtimeState: round.runtimeState ?? "idle",
      goalState: round.goalState ?? "none",
      verificationState: round.verificationState ?? "unknown",
      turnEndKind: round.turnEndKind ?? null,
      turnEndReason: storedReasonOf(round.turnEndReason),
      // A history row can be opened, so the reply is kept whole enough to read.
      replyText: clip(round.reply?.text ?? round.replyText ?? "", 6000),
      verification: round.verification ?? { state: "unknown", truncated: false, conditions: [] },
      outcomes: round.outcomes ?? { truncated: false, items: [] },
      facts: Array.isArray(round.facts) ? round.facts.slice(0, 40) : []
    };

    list.push(record);
    this.bySession.set(sessionId, list);
    this.order.push({ sessionId, roundId: record.roundId });
    this.bytes += sizeOf(record);
    this.trim(sessionId);

    if (options.persist !== false && this.domain !== null) {
      void this.persist(record);
    }
  }

  /**
   * Attach a later result to an archived round: the wrap-up summary is written
   * after the record already exists, and rewriting the whole record would need
   * the round that sealed it. Missing ids and empty patches do nothing.
   *
   * @param {string} sessionId - runtime session id.
   * @param {string} roundId - archived round id.
   * @param {object} fields - fields to replace.
   * @returns {boolean} true when a record was updated.
   */
  patch(sessionId, roundId, fields) {
    const list = this.bySession.get(sessionId);
    if (!Array.isArray(list) || fields === null || typeof fields !== "object") return false;
    const index = list.findIndex((item) => item.roundId === roundId);
    if (index < 0) return false;
    const merged = { ...list[index], ...fields };
    if (fields.brief !== undefined) merged.brief = briefRecordOf(fields.brief);
    if (fields.summaryText !== undefined) merged.summaryText = clip(fields.summaryText, 400);
    this.bytes -= sizeOf(list[index]);
    list[index] = merged;
    this.bytes += sizeOf(merged);
    if (this.domain !== null) void this.persist(merged);
    return true;
  }

  /**
   * Write one record through to the durable domain, swallowing failures.
   * @param {object} record - the stored round.
   * @returns {Promise<void>} resolves when the write settled.
   */
  async persist(record) {
    try {
      const table = this.domain.table(TABLE_ROUNDS);
      await table.put(storageKeyOf(record.sessionId, record.roundId), record);
    } catch (error) {
      this.warn(`history write failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Remove evicted records from the durable copy.
   *
   * Keeping memory and disk under one ceiling is the point: an eviction that
   * only forgets the in-memory entry makes the archive grow without bound on
   * disk and come back on the next restart.
   *
   * @param {object[]} dropped - records that no longer fit.
   * @returns {void}
   */
  evict(dropped) {
    if (this.domain === null || dropped.length === 0) return;
    void (async () => {
      const table = this.domain.table(TABLE_ROUNDS);
      for (const record of dropped) {
        try {
          await table.delete(storageKeyOf(record.sessionId, record.roundId));
        } catch (error) {
          this.warn(`history eviction failed: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    })();
  }

  /**
   * Enforce the per-session, global, and byte ceilings, oldest first.
   * @param {string} sessionId - owning session id.
   * @returns {void}
   */
  trim(sessionId) {
    const dropped = [];
    const list = this.bySession.get(sessionId) ?? [];
    while (list.length > this.maxRoundsPerSession) {
      const gone = list.shift();
      this.bytes -= sizeOf(gone);
      dropped.push(gone);
      this.order = this.order.filter(
        (entry) => !(entry.sessionId === sessionId && entry.roundId === gone.roundId)
      );
    }
    while (this.order.length > this.maxRoundsTotal || this.bytes > this.maxSerializedBytes) {
      const oldest = this.order.shift();
      if (oldest === undefined) break;
      const bucket = this.bySession.get(oldest.sessionId) ?? [];
      const index = bucket.findIndex((item) => item.roundId === oldest.roundId);
      if (index >= 0) {
        this.bytes -= sizeOf(bucket[index]);
        dropped.push(bucket[index]);
        bucket.splice(index, 1);
      }
      this.bySession.set(oldest.sessionId, bucket);
    }
    this.evict(dropped);
  }

  /**
   * Read rounds of one session, newest first.
   *
   * @param {string} sessionId - runtime session id.
   * @param {{cursor?: string, limit?: number}} [options] - paging.
   * @returns {{items: object[], nextCursor: string|null}} one page.
   */
  page(sessionId, options = {}) {
    const list = [...(this.bySession.get(sessionId) ?? [])].reverse();
    const limit = Math.max(1, Math.min(20, options.limit ?? 10));
    const offset = decodeCursor(options.cursor);
    const items = list.slice(offset, offset + limit).map((record) => ({
      roundId: record.roundId, // ui-copy-ignore
      title: record.title, // ui-copy-ignore
      statusLine: record.statusLine,
      archivedAt: record.archivedAt,
      revision: revisionOf(record) // ui-copy-ignore
    }));
    const next = offset + items.length;
    return { items, nextCursor: next < list.length ? String(next) : null };
  }

  /**
   * Look one round up.
   * @param {string} sessionId - runtime session id.
   * @param {string} roundId - round id.
   * @returns {object|undefined} the stored record.
   */
  get(sessionId, roundId) {
    return (this.bySession.get(sessionId) ?? []).find((item) => item.roundId === roundId);
  }

  /**
   * Count archived rounds of one session.
   * @param {string} sessionId - runtime session id.
   * @returns {number} archived round count.
   */
  count(sessionId) {
    return (this.bySession.get(sessionId) ?? []).length;
  }

  /**
   * Newest archived rounds of one session.
   * @param {string} sessionId - runtime session id.
   * @param {number} limit - how many.
   * @returns {object[]} compact rows for the snapshot preview.
   */
  recent(sessionId, limit) {
    return [...(this.bySession.get(sessionId) ?? [])]
      .reverse()
      .slice(0, limit)
      .map((record) => ({
        roundId: record.roundId,
        title: record.title,
        statusLine: record.statusLine,
        archivedAt: record.archivedAt
      }));
  }

  /**
   * Forget everything one session owned.
   * @param {string} sessionId - runtime session id.
   * @returns {void}
   */
  forget(sessionId) {
    const dropped = this.bySession.get(sessionId) ?? [];
    for (const record of dropped) this.bytes -= sizeOf(record);
    this.bySession.delete(sessionId);
    this.order = this.order.filter((entry) => entry.sessionId !== sessionId);
    this.evict(dropped);
  }

  /**
   * Close the durable domain.
   * @returns {Promise<void>} resolves when closed.
   */
  async close() {
    const domain = this.domain;
    this.domain = null;
    if (domain === null) return;
    try {
      await domain.close();
    } catch {
      // A failed close is not actionable at shutdown.
    }
  }
}

/**
 * Approximate the retained size of one record. Exactness is not required; the
 * value only drives eviction.
 * @param {object} record - stored round.
 * @returns {number} approximate bytes.
 */
function sizeOf(record) {
  if (record === null || typeof record !== "object") return 0;
  try {
    // UTF-8, not string length: one CJK character costs three bytes, and the
    // ceiling is a real byte budget.
    return new TextEncoder().encode(JSON.stringify(record)).length;
  } catch {
    return 0;
  }
}

/**
 * The storage key of one round. It carries the full session id, so two sessions
 * that share a short id prefix can never overwrite each other's archive.
 *
 * @param {string} sessionId - runtime session id.
 * @param {string} roundId - round id.
 * @returns {string} durable key.
 */
export function storageKeyOf(sessionId, roundId) {
  return `${encodeURIComponent(String(sessionId))}|${encodeURIComponent(String(roundId))}`;
}

/**
 * Build the domain declaration the storage service expects.
 *
 * Records round-trip as opaque JSON and are validated by this store's own
 * clipping, so the per-table schema is a passthrough. The declaration is
 * validated here because the storage package's helper is not a plugin
 * dependency.
 *
 * @param {{version: number}} spec - storage spec version.
 * @returns {object} domain declaration.
 */
function declareDomain(spec) {
  if (!/^[a-z][a-z0-9_]*$/u.test(DOMAIN_NAME)) throw new Error(`invalid domain name ${DOMAIN_NAME}`);
  const version = Number.isInteger(spec?.version) ? spec.version : 1;
  if (version < 0) throw new Error("domain version must not be negative");
  const compatibleVersions = Array.isArray(spec?.compatibleVersions)
    ? spec.compatibleVersions.filter((item) => Number.isInteger(item) && item >= 0 && item < version)
    : [];
  const passthrough = { parse: (value) => value };
  return {
    name: DOMAIN_NAME, // ui-copy-ignore
    version, // ui-copy-ignore
    compatibleVersions,
    layout: "per-record",
    invalidRecords: "backup-and-skip",
    tables: { // ui-copy-ignore
      [TABLE_ROUNDS]: { valueSchema: passthrough },
      [TABLE_SESSIONS]: { valueSchema: passthrough }
    }
  };
}

/**
 * A stable revision string for a stored round.
 * @param {object} record - stored round.
 * @returns {string} revision.
 */
export function revisionOf(record) {
  return `${record.archivedAt}:${record.updatedAt}:${record.roundState}`;
}

/**
 * Decode a paging cursor to an offset.
 * @param {string|undefined} cursor - opaque cursor.
 * @returns {number} offset.
 */
function decodeCursor(cursor) {
  if (typeof cursor !== "string" || cursor === "") return 0;
  const value = Number.parseInt(cursor, 10);
  return Number.isSafeInteger(value) && value > 0 ? value : 0;
}

