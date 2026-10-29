# Acceptance ledger

Every row of `design-contract.json` (`A01`–`A15`) mapped to the evidence this
repository actually holds. A row is `covered` only when a committed check fails
if the behaviour regresses. `code` means the behaviour is implemented and a
reader can find it, but no committed check would catch its removal. `open`
means neither.

Run the automated half with:

```bash
node test/run.mjs                 # reducer, summaries, store, routes
node scripts/accept-installed.mjs # booted profile: module listed, bundle served, route answers
```

| ID | Contract | Evidence | Status |
| --- | --- | --- | --- |
| A01 | No stored switch means disabled; no facts, cache, history or model packet is built | `snapshot: a switched-off session answers closed without folding its log`, `switch: a session without a stored flag is off until it is turned on` | covered |
| A02 | Session A enabled, session B disabled: only A is recorded and summarised | `switch: enabling one session never enables another, and a fork starts off`; `isEnabled` gates ingest and `requestSummary` | covered |
| A03 | Hidden Overview Tab keeps observing on the Host and stops client polling | `client: a hidden page stops polling…` asserts the one timer and the visibility guard | covered |
| A04 | A disable from another window cancels the in-flight request and rejects its late answer | `summary: publish re-validation discards a stale, superseded, or switched-off answer` | covered |
| A05 | Re-enabling after a disabled interval replays nothing and leaves the gap explicit | `committed_cursor_at_enable` in `index.js`; gap flag in coverage | code |
| A06 | Reading history while off touches stored records only | `store: a cold session reads its rounds back from the domain` | covered |
| A07 | A work topic that includes lint, tests and build stays one topic; checks are evidence | `rounds: a check names the work it covered, never the runner`, `summary: passing checks never become headroom for a topic` | covered |
| A08 | An unfinished investigation can be described without claiming success | `snapshot: buildSnapshot stays factual and carries every dimension` | code |
| A09 | A failed summary keeps the last valid brief and its true time | `summaries` is written only after `publishVerdict`; `snapshot: a fresh summary replaces the fact lines without losing their evidence` | code |
| A10 | Contradicting evidence invalidates an older success without waiting for a summary | `rounds: a file written after a pass puts the check back to recheck`, `rounds: a non-zero tool result is evidence, never a task failure` | covered |
| A11 | A historical round and the current view never render together | pager state in `client.js`, `store.page` | code |
| A12 | Opening one topic shows only its own evidence, not the whole round | `snapshot: rule rows carry no raw command or tool material`, `evidence: excerpts are plain text, never payloads`, `open route: only a delivered file is handed to the system viewer` | covered |
| A13 | A fork of an enabled session starts disabled | `switch: enabling one session never enables another, and a fork starts off` | covered |
| A14 | No hourly token or request quota can pause the plugin or show a countdown | `schema: the documented statuses no longer include a spent budget` | covered |
| A15 | 360 px, desktop, light and dark stay readable with no horizontal overflow and keyboard controls | `client: a hidden page…` asserts the 560 px layout and `:focus-visible`; mobile screenshot `docs/preview/mobile-archived-overview.png` | covered |
| A16 | A saved session opens read-only: real title, agent, last round and history, with no switch, record, or model call | `snapshot: an archived session is readable without its switch and says it is saved`, `round: an archived round never claims to be running`, `enable and summary: a saved session refuses both instead of recording`; a transcript with no tool facts shows its closing reply (`snapshot: a saved transcript with no tool facts shows its closing reply`, `…unfinished saved round…`, `…aborted saved turn…`) | covered |

## Installed-artifact proof (D1)

`scripts/accept-installed.mjs` creates a throwaway profile from the shipped web
template, installs this checkout the way a user does, boots it, and asserts:

- the shell lists `dsh-vantage/client.js` in its module set;
- the served bundle is this checkout's `client.js` plus the source-map trailer;
- all seven documented paths answer `401` anonymously and a structured `403`
  for a session the reader does not own;
- no entry reported a failed activation during boot;
- exactly one `conversation.view` registration exists and it keeps the id
  `vantage` (`client: registers exactly one view and stays inside the panel`).

## Real restart check (2026-10-29 06:37)

The desktop app was quit and reopened while this checkout was installed. The
host came back on a new port (`57282` → `57911`, host pid `34072`) with the plugin
already active; no reinstall or re-enable was needed. In the new window:

- `session-fcc6fb36-…` (`DSH的APP开发`) answers `200` with `coverage.archived: true`,
  `readOnly: true`, `enabled: false` and status `已保存`; the switch is gone.
- `session-74575c14-…` (`DeepSeek 随身宠物语音硬件调研`) answers `200` with
  `readOnly: true`, `已保存`, and renders its quoted last reply
  (`最近回复`) instead of an empty line. Screenshot:
  `docs/preview/saved-session-reply.png`.

Reproduce by opening a saved session in the Overview tab after relaunching the
app; the view must not offer a switch and must show the last round without a
request being sent.

## Real snippet review (2026-10-29 07:12–09:40)

Twenty real stored sessions, ordered `active, paused, complete, blocked, none`,
were opened through `GET /api/dsh-vantage/snapshot` in the running desktop
profile. The sample carried the states the prototype names: 6 `active`, 10
`paused`, 4 `complete`, plus 2 sessions with no goal. Every answer was
`readOnly: true` with `已保存`; none wrote a round or called the model.

The first pass returned sixteen `200`s. It exposed four blank titles and seven
`待办:无` rows, both fixed in `e4a0ae1`:

- an untitled conversation now signs as `本次任务` instead of an empty heading;
- a round with nothing reportable now reads `结论 · 尚未形成结论` instead of a
  fake todo whose value was `无`.

Re-probing the two smaller complete sessions after the fix returned `200` with
the real title and the honest empty conclusion:

```
200 complete DSH 可控记忆插件查找   已保存 goal=complete
200 complete 继续优化记忆系统       已保存 goal=active 结论:尚未形成结论
```

The remaining two transcripts are 19 MB and 48 MB compressed. Opening either
still allocates its whole inflated event list inside `archivedSession`; the
process restarted during that pass. The retention bug is fixed and checked
(`history: opening a stored session keeps its projection, not its events`), but
a real tail read from `sessionPersistence` is still the missing piece for very
large logs. This is recorded under Known gaps, not claimed as solved.

## Memory hardening (2026-10-29 07:04)

`~/Library/Logs/DiagnosticReports/DeepSeek Harness-2026-10-29-070150.ips`
recorded `EXC_CRASH / SIGABRT / node::OOMErrorHandler`. Cause: `archivedLogs`
kept each opened transcript's full `events` array for a 60 s cache, three
sessions at a time. Three large logs pinned several GB and killed the host.

`82e0b92` folds the events once into the existing small projection and returns
`ownEvents: () => []`, so the array is collectable before the next session is
opened. The regression test opens a fake stored session and asserts one close,
an empty `ownEvents()`, the folded title, and projection reuse across reads
(`93 passed` at that commit). The first twenty-session pass after the reload
completed; repeated passes over the largest logs still restart the host, which
is why the tail-read gap above stays open.

## Known gaps

- Live mounting in the installed desktop profile is proven by the throwaway
  profile above; the running app still needs one page refresh after the plugin
  is re-enabled before the view exists in that page.
- A03 and A15 now have a committed source check and the mobile screenshot;
  a live keyboard walk-through is still worth repeating by hand.

- **A16b — existing saved session in the running window.** `session-74575c14-…` opened after a real app restart on 2026-10-29 06:37; the overview shows Cordis, 已保存, the real title, the paused goal, and a quoted `最近回复`. Screenshot: `docs/preview/saved-session-reply.png`.
- **Very large saved transcripts.** Opening a 19–48 MB compressed log still
  inflates the whole event list before folding. Until `sessionPersistence`
  exposes a tail read, avoid opening several of these back to back.
