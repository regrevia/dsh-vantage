#!/usr/bin/env node
/**
 * The checks this plugin is expected to pass before a release: unit tests,
 * Chinese UI typography, design tokens, and interface copy.
 *
 * The three linters ship with the repository (scripts/vendor) instead of being
 * read from one developer's HOME, so a fresh checkout reproduces the same run.
 * Exit code is non-zero when any check reports an error.
 */
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const vendor = (name) => join(root, 'scripts', 'vendor', name)

const checks = [
  ['tests', process.execPath, [join(root, 'test', 'run.mjs')]],
  ['zh-lint', process.execPath, [vendor('zh-lint.mjs'), root]],
  ['style-lint', process.execPath, [vendor('style-lint.mjs'), root]],
  ['ui-copy-lint', process.execPath, [vendor('ui-copy-lint.mjs'), root]],
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
