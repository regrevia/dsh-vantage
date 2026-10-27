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

The Host serves `GET` snapshots and `POST` control calls under `/api/dsh-vantage`:
`snapshot`, `history`, `round`, `evidence`, `summaryRequest`, `summaryAuto`,
`lease`. Envelopes, codes, and watermarks are documented in
[WIRE.md](./WIRE.md). Every route is owner-only: a caller that is not the session
owner receives `403 forbidden`.

## Privacy

Everything is local. The plugin stores at most 20 rounds per session and 200
rounds globally, never copies the full trajectory, and sends the summariser only
a fact pack — no credentials, environment variables, or replay data. The view
never takes part in scheduling or completion decisions.

## Development

```bash
node test/run.mjs      # 51 tests: reducer, budget, storage, routes
node scripts/lint.mjs  # tests, zh-lint, style-lint, ui-copy-lint
```

The copy linter reads JS object literals as `key: value` status dumps, so a line
it flags on purpose carries the `ui-copy-ignore` marker it documents. The three
linters are vendored under `scripts/vendor/`; `scripts/lint.mjs` resolves them
from the repository, so a clean checkout needs no files outside itself.
`zh-ellipsis` is waived in `.zh-lint.json` because the rule fires on JavaScript
spread syntax, not on prose.

Design constraints live in the source: the panel uses only the 14 host theme
tokens, a single column, scoped `.dsv-` classes, and no remote fonts.

## License

MIT
