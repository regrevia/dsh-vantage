#!/usr/bin/env node
/**
 * The three checks this plugin is expected to pass before a release:
 * unit tests, Chinese UI typography, design tokens, and interface copy.
 * Exit code is non-zero when any check reports an error.
 */
import { spawnSync } from 'node:child_process'

const checks = [
  ['tests', process.execPath, ['test/run.mjs']],
  ['zh-lint', process.execPath, [`${process.env.HOME}/.agents/skills/zh-ui-type-lint/scripts/zh-lint.mjs`, '.']],
  ['style-lint', process.execPath, [`${process.env.HOME}/.dsh/tools/style-lint.mjs`, '.']],
  ['ui-copy-lint', process.execPath, [`${process.env.HOME}/.dsh/skills/ui-restraint/scripts/ui-copy-lint.mjs`, '.']],
]

let failed = false
for (const [name, cmd, args] of checks) {
  const run = spawnSync(cmd, args, { encoding: 'utf8' })
  const out = `${run.stdout || ''}${run.stderr || ''}`.trim().split('\n')
  console.log(`${name}: ${out[out.length - 1] || 'no output'}`)
  if (run.status !== 0) {
    failed = true
    console.log(out.filter((line) => /error|fail/i.test(line)).slice(0, 12).join('\n'))
  }
}
process.exit(failed ? 1 : 0)
