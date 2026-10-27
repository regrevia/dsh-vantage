# dsh-vantage wire contract (v1)

Host and client are written against this file. It is the only shared surface: the client never
imports host code, and the host never renders.

All routes are **exact Fetch routes** on the shared `/api` channel, registered by the Host through
`ctx.connection.fetch.register(...)`. The Host returns `403 forbidden` for any non-owner peer before
the handler runs. Reads are `GET`; the three actions are `POST` with a JSON body. Every response
carries `cache-control: no-store`. Every failure is a small JSON envelope, never a log tail:

```
{ "error": { "code": "session/not-found" | "session/unavailable" | "bad-request" | "lease/limit" | "internal", "message": "<operator-facing, no secrets>" } }
```

Route paths (client calls them with the leading slash stripped, exactly like the deliverables view):

| method | path | purpose |
| --- | --- | --- |
| GET | `/dsh-vantage/snapshot?sessionId=S&knownRevision=R` | current brief, ≤ 16 KiB |
| GET | `/dsh-vantage/history?sessionId=S&cursor=C&limit=N` | archived rounds, 10 per page |
| GET | `/dsh-vantage/round?sessionId=S&roundId=ID&knownRevision=R` | one round in detail |
| GET | `/dsh-vantage/evidence?sessionId=S&roundId=ID&factId=F` | one fact plus its raw refs |
| POST | `/dsh-vantage/summary/request` | `{sessionId, expectedRevision}` |
| POST | `/dsh-vantage/summary/auto` | `{sessionId, enabled}` |
| POST | `/dsh-vantage/lease` | `{sessionId, leaseId, visible}` |

`knownRevision` is an opaque string. When it still matches the stored revision the snapshot answer is
`{"kind":"unchanged","revision":R}` and the client keeps what it has.

## Snapshot

```jsonc
{
  "kind": "snapshot",
  "schemaVersion": 1,
  "revision": "12:1749",          // opaque, changes when anything rendered changes
  "sessionId": "…",
  "generatedAt": 1749000000000,
  "throughSeq": 812,                  // last event folded into this answer
  "mode": "facts" | "summary",
  "coverage": {
    "coreObservedSeq": 812,
    "evidenceIndexedSeq": 812,        // never ahead of coreObservedSeq
    "summaryCoveredSeq": 640,         // never ahead of evidenceIndexedSeq
    "summaryFresh": false,            // "有新进展待整理" when false and round advanced
    "summaryAuto": true,              // false once the user paused it
    "summaryBudgetExhausted": false,
    "historyAvailable": true          // false while a restore is still pending / too large
  },
  "round": {                          // null before any user message exists
    "roundId": "S:12",                // stable: session identity + first event seq
    "startedAt": 1749000000000,
    "updatedAt": 1749000030000,
    "title": "把设置页的保存按钮改成…", // first user message of the round, clipped to 120 chars
    "statusLine": "正在核对相关问题",    // ONE short line, already user-facing
    "roundState": "awaiting-reply" | "archived",
    "runtimeState": "running" | "idle" | "disconnected",
    "goalState": "none" | "active" | "paused" | "blocked" | "complete" | "unknown",
    "verificationState": "passed" | "pending" | "failed" | "recheck" | "unknown" | "na"
  },
  "brief": {
    "revision": "…",
    "generatedAt": 1749000030000,
    "mode": "facts" | "summary",
    "items": [                          // at most maxBriefItems (default 3)
      { "id": "f:…", "text": "改了 2 个文件，尚未运行测试", "factIds": ["f:…"], "tone": "neutral" | "warn" | "error" | "success" }
    ]
  },
  "verification": {
    "state": "passed" | "pending" | "failed" | "recheck" | "unknown" | "na",
    "truncated": false,                 // true when urgent conditions were cut
    "conditions": [                     // at most 3 on the default screen; full list on round detail
      { "id": "c:…", "text": "测试尚未运行", "state": "passed" | "pending" | "failed" | "recheck" | "unknown" | "na", "factIds": ["f:…"] }
    ]
  },
  "outcomes": {
    "truncated": false,
    "items": [                          // at most 3, most recent first
      { "id": "o:…", "kind": "deliverable" | "job" | "file" | "tool", "text": "decision.docx", "factIds": ["f:…"] }
    ]
  },
  "history": {
    "count": 4,
    "hasMore": false,
    "items": [                          // at most 5, newest first
      { "roundId": "S:80", "title": "…", "statusLine": "本轮已回复 仍有待验证", "archivedAt": 1749000030000 }
    ]
  },
  "notices": [                          // 0–2 items, each already a complete sentence
    { "code": "summary-paused", "text": "自动摘要已暂停" }
  ]
}
```

Rules the client may rely on:

- `round === null` is normal for a brand-new session; the view then shows the empty state and keeps
  polling. A blank session does not even mount the view, so nothing may assume it renders.
- `brief.items.length` may be 0 in facts mode; the client then shows no list, not a placeholder row.
- `text` fields are plain text. The client renders them as text nodes — never as HTML, markdown, or a
  link. Raw tool excerpts and file names are data, not markup.
- Unknown enum values must not throw: fall back to `unknown` / neutral tone.
- `revision` changes whenever any rendered field changes. The client may render optimistically and
  only replace its state when `kind === "snapshot"`.
- `coverage.historyAvailable === false` means "历史暂未恢复"; the client shows the notice, not an
  error.

## History / round / evidence

```jsonc
// GET history
{ "kind": "history", "sessionId": "…", "items": [ { "roundId": "…", "title": "…", "statusLine": "…", "archivedAt": 0, "revision": "…" } ], "nextCursor": "…" | null }

// GET round (knownRevision matching this round → {"kind":"unchanged","revision":R})
{
  "kind": "round",
  "revision": "…",
  "round": {
    "roundId": "…", "title": "…", "startedAt": 0, "archivedAt": 0,
    "roundState": "…", "runtimeState": "…", "goalState": "…", "verificationState": "…",
    "statusLine": "…",
    "facts": [ { "id": "f:…", "kind": "…", "statement": "…", "basis": "observed" | "reported" | "inferred", "validity": "valid" | "needsRecheck" | "unknown", "refs": [ { "seq": 12, "label": "工具结果" } ] } ],
    "verification": { "state": "…", "truncated": false, "conditions": [ … ] },
    "outcomes": { "truncated": false, "items": [ … ] }
  }
}

// GET evidence
{ "kind": "evidence", "sessionId": "…", "roundId": "…", "fact": { …fact… },
  "refs": [ { "seq": 12, "type": "tool/result", "label": "工具结果", "excerpt": "npm test … exit 1" } ] }
```

`excerpt` is a clipped plain-text excerpt of the recorded event, ≤ 600 chars. The client shows it in a
`<pre>`-like block with wrapping, or in a collapsible row. It never renders it as HTML.

## POST answers

```jsonc
// summary/request
{ "kind": "queued" }                                             // accepted, a request is pending
{ "kind": "skipped", "reason": "budget" | "fresh" | "running" | "disabled" | "no-model", "text": "自动摘要已暂停" }

// summary/auto
{ "kind": "auto", "enabled": true }

// lease
{ "kind": "lease", "leaseId": "…", "visible": true, "expiresAt": 0 }
{ "error": { "code": "lease/limit", "message": "…" } }           // too many live leases
```

## Budget and scheduling facts the client shows but never computes

- A manual request overtakes the time interval but not the rolling budget, the concurrency cap, or
  fingerprint de-duplication. The client shows the returned reason verbatim.
- The client renews its lease every 15 s while visible and stops polling when hidden. When the lease
  is lost, automatic summaries stop; the page says so via `coverage.summaryAuto` / a notice.
