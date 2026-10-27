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

// A domain name is an identifier, not a display name: the storage service only
// accepts `[a-z][a-z0-9_]*`, so the hyphenated package name cannot be used.
const DOMAIN_NAME = "dsh_vantage";
const TABLE_ROUNDS = "rounds";
const TABLE_SESSIONS = "sessions";

/**
 * @typedef {object} StoreOptions
 * @property {number} maxRoundsPerSession - per-session ring size.
 * @property {number} maxRoundsTotal - global ring size.
 * @property {number} maxSerializedBytes - approximate ceiling on all stored rounds.
 * @property {(message: string) => void} warn - logger for swallowed storage errors.
 */

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
   * @param {{version: number}} spec - storage spec version.
   * @returns {Promise<void>} resolves once the open attempt settles.
   */
  async open(storageDomain, spec) {
    if (storageDomain === undefined || storageDomain === null) return;
    try {
      const declaration = declareDomain(spec);
      this.domain = await storageDomain.open(declaration);
      this.persistent = true;
      await this.restore();
    } catch (error) {
      this.warn(`history store stays in memory: ${error instanceof Error ? error.message : String(error)}`);
      this.domain = null;
      this.persistent = false;
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

    const record = {
      sessionId,
      roundId: round.roundId,
      title: clip(round.title ?? "", 120),
      statusLine: clip(round.statusLine ?? "", 200),
      startedAt: Number.isFinite(round.startedAt) ? round.startedAt : 0,
      updatedAt: Number.isFinite(round.updatedAt) ? round.updatedAt : 0,
      archivedAt: Number.isFinite(round.archivedAt) ? round.archivedAt : 0,
      roundState: round.roundState ?? "archived",
      runtimeState: round.runtimeState ?? "idle",
      goalState: round.goalState ?? "none",
      verificationState: round.verificationState ?? "unknown",
      replyText: clip(round.replyText ?? "", 240),
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
   * @param {string} sessionId - session that just grew.
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
  const passthrough = { parse: (value) => value };
  return {
    name: DOMAIN_NAME, // ui-copy-ignore
    version, // ui-copy-ignore
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

