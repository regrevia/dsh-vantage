# dsh-vantage

A read-only **task overview** view for DeepSeek Harness. It sits next to the
conversation and answers one question: where does this task actually stand?

Nothing in this view schedules, stops, or completes work. It observes session
events that already happened and renders them: the current round's work topics,
the evidence behind each one, and a bounded history of earlier rounds.

## What it shows

- **One to three work topics** — what changed, what is still being checked, what
  blocks the task. A topic is a unit of work, never a tool name, and never a
  test/lint/build list.
- **Evidence** — each topic expands to its own explanation and the facts behind
  it: plan, report, or observation. Raw command output stays collapsed inside
  that row and is fetched only when opened.
- **Verification** — whether the closing check passed, failed, or is still open.
  A passing check is evidence, not a topic.
- **History** — earlier rounds that ended with a real reply, newest first. The
  list and the round detail never appear at the same time.
- **Per-session switch** — off by default. While it is off the plugin neither
  folds events, nor builds snapshots, nor sends anything to a model. Turning it
  on starts recording from that moment; saved rounds stay readable in history.

The overview is a reading surface, so the message composer stays out of the way:
while this view is mounted the plugin hides the composer seat, and it returns the
moment you switch back to the conversation. That is a scoped attribute plus one
CSS rule on the host's own seat, not a DOM rewrite — the host keeps ownership of
its chrome.

### When the first read fails

The view reads one `GET /snapshot` when it mounts and then polls. A cold plugin
load, a Host route that is still mounting, or a dropped request used to leave the
panel on 「正在读取」 until someone pressed the retry button. The client now retries
by itself: four attempts at 400 ms, 1.6 s, 3.6 s and 6.4 s, reset on the first
success and on a session switch, and cleaned up when the view unmounts. After the
fourth failure it stays on the manual retry state instead of spinning forever.

Controls follow the prototype's text language rather than browser defaults: one
32 px-tall switch with a 30×18 track and a 12 px knob, text links with a 32 px
hit area, one 2 px focus ring from `--dsw-focus-ring-*`, and no filled pill
buttons. The panel takes its colors from host `--dsw-*` tokens, so light, dark
and narrow layouts need no separate rules.

A round is a product-level unit, not a turn or a step. A reply closes a round, but
"replied" never means "verified". An empty verification list reads 「尚未明确」 and
never passes by default.

## Install

The plugin is a single package; a Host half (`index.js`) folds session events and
serves six exact routes, and a client half (`client.js`) registers the `vantage`
view in the conversation's view switcher.

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
| `enabled` | `true` | serve snapshots at all; the per-session switch still starts off |
| `summary.enabled` | `true` | allow model summaries for sessions whose switch is on |
| `summary.cadenceMs` | `180000` | minimum gap between summaries, floored at 60 s |
| `summary.firstEligibleMs` | `60000` | earliest first summary after a round starts |
| `summary.maxInputTokens` | `2400` | cap on the whole request, system prompt included |
| `summary.maxOutputTokens` | `400` | cap on the answer |
| `summary.maxTopics` | `3` | topics a summary may return |
| `summary.requestDeadlineMs` | `25000` | hard deadline for one summariser call |
| `summary.provider` | `""` | model provider; empty uses the session default |
| `summary.model` | `""` | model name; empty uses the session default |

Without a model configured, the view degrades to a factual summary built from the
folded facts. A failed summary keeps the last valid one and its real update time;
it never falls back to a checklist of commands.

## Wire

The Host serves four `GET` reads and two `POST` control calls under
`/api/dsh-vantage`: `snapshot`, `history`, `round`, `evidence`; then
`summaryRequest` and `enable`. Envelopes, codes, watermarks and the switch state
are documented in [WIRE.md](./WIRE.md). Every route is owner-only: a caller that
is not the session owner receives `403 forbidden`; a request without the Harness
auth cookie is rejected with `401` before the plugin runs.

## Privacy

Everything is local. The plugin stores at most 20 rounds per session and 200
rounds globally, never copies the full trajectory, and sends the summariser only
a bounded fact pack — no credentials, environment variables, or replay data. The
view never takes part in scheduling or completion decisions, and a disabled
session causes no model call and no stored round.

## Development

```bash
node test/run.mjs      # 73 tests: reducer, summaries, storage, routes
node scripts/lint.mjs  # tests, zh-lint, style-lint, ui-copy-lint

# Boot a throwaway profile with this checkout installed, then check that the
# Host lists and serves the client module and that its route answers.
node scripts/accept-installed.mjs
```

The copy linter reads JS object literals as `key: value` status dumps, so a line
it flags on purpose carries the `ui-copy-ignore` marker it documents. The three
linters are vendored under `scripts/vendor/`; `scripts/lint.mjs` resolves them
from the repository, so a clean checkout needs no files outside itself.
`zh-ellipsis` is waived in `.zh-lint.json` because the rule fires on JavaScript
spread syntax, not on prose.

Design constraints live in the source: the panel uses only host `--dsw-*`
tokens, a single 720 px column (32/32/48 px desktop padding, 24/20/36 px under
560 px), scoped `.ov-` classes, no remote fonts, at most two radii, no shadows,
and no gradients.

## License

MIT
