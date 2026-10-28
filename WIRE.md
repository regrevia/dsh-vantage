# dsh-vantage wire contract (v1)

Host and client share exactly this file. The client never imports host code; the host never renders.

All routes are **exact Fetch routes** under `/api/dsh-vantage`, registered by the host through
`ctx.connection.fetch.register(...)`. The host answers `403 forbidden` to any peer that is not the
session owner before the handler runs. Reads are `GET`; state changes are `POST` with a JSON body.
Every response carries `cache-control: no-store`.

Failures are one small envelope, never a log tail:

```json
{ "error": { "code": "session/not-found" | "session/unavailable" | "bad-request" | "internal", "message": "<short, no secrets>" } }
```

| method | path | purpose |
| --- | --- | --- |
| GET | `/api/dsh-vantage/snapshot?session=S&revision=R` | current overview, ≤ 16 KiB |
| GET | `/api/dsh-vantage/history?session=S&cursor=C&limit=N` | archived rounds, newest first, N ≤ 20 (default 10) |
| GET | `/api/dsh-vantage/round?session=S&round=ID` | one round with its facts, open or archived |
| GET | `/api/dsh-vantage/evidence?session=S&round=ID&fact=F` | one fact plus its raw excerpts |
| POST | `/api/dsh-vantage/enable` | `{session, enabled}` → the new switch state |

`revision` is opaque. While it still matches the stored revision the snapshot answers
`{"kind":"unchanged","revision":R}` and the client redraws nothing.

## Snapshot

```jsonc
{
  "kind": "snapshot",
  "schemaVersion": 1,
  "revision": "812:S:12:open:9:3:on",   // opaque; changes when anything rendered changes
  "sessionId": "…",
  "generatedAt": 1749000030000,
  "throughSeq": 812,                    // last event folded into this answer
  "mode": "facts" | "summary",
  "coverage": {
    "coreObservedSeq": 812,
    "evidenceIndexedSeq": 812,
    "summaryCoveredSeq": 640,
    "summaryFresh": false,              // false means the lines below are rule-built
    "enabled": true,                    // the switch the header shows; the only authority
    "historyAvailable": true            // false while nothing archived is readable
  },
  "round": {                            // null before any task activity
    "roundId": "S:12",
    "startedAt": 1749000000000,
    "updatedAt": 1749000030000,
    "title": "把设置页的保存按钮改成…",   // clipped to 120 chars
    "statusLine": "正在核对相关问题",      // one short user-facing line
    "statusKey": "running",             // stable key the client maps to its own copy
    "statusTone": "neutral" | "success" | "warn" | "error",
    "elapsedMs": 30000,
    "contentAt": 1749000030000,         // when the visible lines were produced
    "roundState": "active" | "archived",
    "runtimeState": "running" | "idle" | "disconnected",
    "goalState": "none" | "active" | "paused" | "blocked" | "complete" | "unknown",
    "verificationState": "passed" | "pending" | "failed" | "recheck" | "unknown" | "na"
  },
  "brief": {
    "revision": "…",
    "generatedAt": 1749000030000,
    "mode": "facts" | "summary",
    "items": [                          // at most 3 ordinary + 3 urgent
      {
        "id": "f:…",
        "factIds": ["f:…"],             // empty means no evidence to open
        "source": "rule" | "model",
        "text": "改了 2 个文件，尚未运行测试",
        "limit": "已有新改动 需要复验",   // qualifier line, "" when none
        "detail": [{ "label": "文件", "value": "client.js" }],
        "evidence": [{ "label": "npm test", "text": "3 passing" }],  // ready to render, may be []
        "tone": "neutral" | "warn" | "error" | "success",
        "urgent": false
      }
    ]
  },
  "verification": {
    "state": "passed" | "pending" | "failed" | "recheck" | "unknown" | "na",
    "truncated": false,
    "conditions": [
      { "id": "c:…", "text": "测试尚未运行", "state": "pending", "factIds": ["f:…"] }
    ]
  },
  "outcomes": { "truncated": false, "items": [{ "text": "…", "tone": "neutral" }] },
  "history": {
    "count": 3,
    "hasMore": false,
    "items": [{ "roundId": "S:9", "title": "…", "statusLine": "…", "archivedAt": 1748999000000 }]
  },
  "notices": [{ "code": "…", "text": "…" }]   // at most 2, already user-facing
}
```

A brief carries at most 3 item rows; each row owns its own short evidence, so rendering one
costs no further request. Passing checks do not become rows of their own — only failed or stale
ones do — so a quiet round may hold a single change row and a status line. When nothing can be
confirmed the host sends one `no-facts` row («尚未形成可确认的结果») with `evidence: []`; the
client renders it like any other row and adds no placeholder of its own.

## History

```jsonc
{ "kind": "history", "sessionId": "…", "items": [{ "roundId": "S:9", "title": "…", "statusLine": "…", "archivedAt": 0, "revision": "…" }], "nextCursor": "10" | null }
```

`nextCursor: null` means the last page. Cursors are opaque offsets; never build one.

## Round

`round` carries `facts` and `verification` in the same shapes as a snapshot.

```jsonc
{
  "kind": "round",
  "revision": "…",
  "round": {
    "roundId": "S:12", "title": "…", "statusLine": "…",
    "startedAt": 0, "archivedAt": 0,
    "roundState": "active" | "archived",
    "runtimeState": "running" | "idle" | "disconnected",
    "goalState": "…", "verificationState": "…",
    "facts": [{ "id": "f:…", "kind": "change", "statement": "…", "tone": "neutral", "validity": "current" | "needsRecheck", "factIds": ["f:…"] }],
    "verification": { "state": "…", "truncated": false, "conditions": [] },
    "outcomes": { "truncated": false, "items": [] }
  }
}
```

## Evidence

```jsonc
{
  "kind": "evidence",
  "sessionId": "…",
  "roundId": "S:12",
  "fact": { "id": "f:…", "statement": "…" },
  "refs": [{ "seq": 812, "type": "tool", "label": "npm test", "excerpt": "…", "time": 1749000000000 }]
}
```

At most 3 refs, each excerpt clipped to 600 chars. Unknown round or fact answers `404 bad-request`.

Brief rows no longer use this route: their `evidence` arrives inside the brief. It stays for
archived rounds, whose items are rebuilt from `facts` and only carry `factIds`; the client asks
once per row on first open and caches the answer for that view.

## Enable

Request `{ "session": "…", "enabled": true }`. The host owns the decision; the answer is written
before it returns, and every window learns the result from its next snapshot.

```jsonc
{ "kind": "enable", "enabled": true, "generation": 4, "throughSeq": 812 }
```

`throughSeq` is `-1` when switching off. The switch starts `false`: overview is opt-in per session,
and turning it off deletes nothing already recorded. The client never flips the control itself — it
posts, then redraws from the host's answer, and reverts with one notice line when the call fails.

## Client behaviour the host may rely on

- Polls `/snapshot` every 5 s while the page is visible; hidden tabs do not poll.
- Sends the last revision and treats `unchanged` as "keep what is on screen".
- One in-flight request per channel (`snapshot`, `history`, `round`, `evidence`, `enable`); a newer
  request cancels the older answer's right to paint.
- Requests give up after 8 s and surface one retry line; no automatic hammering beyond a short
  backoff, four attempts at most.
- History and round detail are read-only and never change the switch.

## Limits

`title 120`, `statusText 200`, `factStatement 240`, `factRefs 8`, `excerpt 600`, `evidenceRows 3`,
`shownConditions 3`, `historyPreview 5`, `notices 2`, `briefItems 3`, `urgentItems 3`,
`roundFacts 200`, `serializedSnapshot 16384`. Strings are clipped at the host; the client adds no
copy of its own beyond labels and state lines.
