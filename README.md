# dsh-vantage

A read-only **task overview** view for DeepSeek Harness. It sits next to the
conversation and answers one question: where does this task actually stand?

Nothing in this view schedules, stops, or completes work. It observes session
events that already happened and renders them: the current round, the facts seen
so far, what still needs checking, and a bounded history of answered rounds.

## What it shows

- **Task line** — the round's opening request, a short status, and when it last changed.
- **Progress** — facts folded from the session log: commands run, files touched, jobs, approvals.
- **Outcomes** — at most three settled results, each linked to the event that produced it.
- **Verification** — the closing check and its state: passed, failed, or not yet stated.
- **History** — the last few rounds that ended with a real reply, newest first.

The overview is a reading surface, so the message composer stays out of the
way: while this view is mounted the plugin hides the composer seat, and it
returns the moment you switch back to the conversation. That is a scoped
attribute plus one CSS rule on the host’s own seat, not a DOM rewrite — the
host keeps ownership of its chrome.

### When the first read fails

The view reads one `GET /snapshot` when it mounts and then polls. A cold plugin
load, a Host route that is still mounting, or a dropped request used to leave the
panel on 「正在读取」 until someone pressed the retry button — that is the
intermittent blank panel users hit after a refresh. The client now retries by
itself: four attempts at 400 ms, 1.6 s, 3.6 s and 6.4 s, reset on the first
success and on a session switch, and cleaned up when the view unmounts. After the
fourth failure it stays on the manual retry state instead of spinning forever.

Buttons follow the host's own button language rather than bare browser defaults:
28 px tall pills (`border-radius: 999px`), a 1 px `--dsw-alias-border-l1` hairline
on the secondary and a filled `--dsw-alias-brand-primary` with
`--dsw-alias-bg-base` text on the primary, 120 ms colour transitions, an
`aria-pressed` outline state for the follow toggle, and a visible focus ring. All
four values come from host tokens, so dark mode needs no separate rule.

A round is a product-level unit, not a turn or a step. A reply closes a round, but
"replied" never means "verified". An empty verification list reads 「尚未明确」 and
never passes by default.

## Install

The plugin is a single package; a Host half (`index.js`) folds session events and
serves seven exact routes, and a client half (`client.js`) registers the
`vantage` view in the conversation's view switcher.

Install the folder with the plugin manager (`install_bundle`), which links it
into your profile and asks Cordis to apply its bundle patch. Applying the patch
inserts one id, `dsh-vantage`; no existing entry is modified. The view appears
after the next plugin reload — press the refresh button, or restart the app once.

To wire it by hand, add the checkout to your profile's `dependencies` and put
`dsh-vantage` at the end of `dsh.profile.bundles`.

Requires DSH `>=0.2.1-rc.3`.

## Configuration

All options are optional. The defaults are deliberately quiet.

| key | default | meaning |
| --- | --- | --- |
| `enabled` | `true` | fold events and serve snapshots at all |
| `summary.maxRequestsPerRollingHour` | `2` | model summaries allowed per rolling hour, manual and automatic together |
| `summary.maxTokensPerRollingHour` | `2500` | token ceiling for those summaries; the next request is reserved before it is sent |
| `summary.maxInputTokens` | `1000` | cap on the whole request, system prompt included |
| `summary.maxOutputTokens` | `250` | cap on the answer |
| `summary.minIntervalMs` | `1800000` | minimum gap between automatic summaries |
| `summary.checkIntervalMs` | `300000` | how often the summariser may look at a quiet session |

Without a model configured, the view degrades to a factual summary built from the
folded facts. Budget exhausted, no model, or paused summaries are shown as such;
they never drop a qualifier to look better.

## Wire

The Host serves four `GET` reads and three `POST` control calls under
`/api/dsh-vantage`: `snapshot`, `history`, `round`, `evidence`; then
`summaryRequest`, `summaryAuto`, and `lease`. Envelopes, codes, and watermarks are documented in
[WIRE.md](./WIRE.md). Every route is owner-only: a caller that is not the session
owner receives `403 forbidden`; a request without the Harness auth cookie is
rejected with `401` before the plugin runs. The split is the same one WIRE.md lists per route.

## Privacy

Everything is local. The plugin stores at most 20 rounds per session and 200
rounds globally, never copies the full trajectory, and sends the summariser only
a fact pack — no credentials, environment variables, or replay data. The view
never takes part in scheduling or completion decisions.

## Development

```bash
node test/run.mjs      # 58 tests: reducer, budget, storage, routes
node scripts/lint.mjs  # tests, zh-lint, style-lint, ui-copy-lint
```

The copy linter reads JS object literals as `key: value` status dumps, so a line
it flags on purpose carries the `ui-copy-ignore` marker it documents. The three
linters are vendored under `scripts/vendor/`; `scripts/lint.mjs` resolves them
from the repository, so a clean checkout needs no files outside itself.
`zh-ellipsis` is waived in `.zh-lint.json` because the rule fires on JavaScript
spread syntax, not on prose.

Design constraints live in the source: the panel uses only host `--dsw-*`
tokens, a single column (760 px, 28–32 px padding), scoped `.dsv-` classes, no
remote fonts, at most two radii (`999px` and `0`), no shadows, and no gradients.

## License

MIT
