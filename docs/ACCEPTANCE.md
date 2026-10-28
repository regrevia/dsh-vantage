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
| A03 | Hidden Overview Tab keeps observing on the Host and stops client polling | client `POLL_MS` timer in `client.js`; no committed check | code |
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
| A15 | 360 px, desktop, light and dark stay readable with no horizontal overflow and keyboard controls | `.ov-` styles and `@media (max-width:560px)` in `client.js`; no committed check | code |
| A16 | A saved session opens read-only: real title, agent, last round and history, with no switch, record, or model call | `snapshot: an archived session is readable without its switch and says it is saved`, `round: an archived round never claims to be running`, `enable and summary: a saved session refuses both instead of recording` | covered |

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

## Known gaps

- Live mounting in the installed desktop profile is proven by the throwaway
  profile above; the running app still needs one page refresh after the plugin
  is re-enabled before the view exists in that page.
- A15 and A03 have no machine check; a future screenshot pass has to supply
  them.
