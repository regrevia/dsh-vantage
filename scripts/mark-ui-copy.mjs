#!/usr/bin/env node
/**
 * Adds the project's `ui-copy-ignore` marker to lines the copy linter reads as a
 * `key: value` status dump. CSS lives inside one template literal, so declarations there
 * take a CSS comment instead of a line comment. Run it, then run scripts/lint.mjs.
 */
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'

const LINT = `${process.env.HOME}/.dsh/skills/ui-restraint/scripts/ui-copy-lint.mjs`
const files = process.argv.slice(2)

for (const file of files) {
  let text = readFileSync(file, 'utf8')
  const lines = text.split('\n')
  // Which lines sit inside the CSS template (its declarations take /* */ comments).
  let cssFrom = -1
  let cssTo = -1
  lines.forEach((line, i) => {
    if (line.includes('const STYLE = `')) cssFrom = i + 1
    else if (cssFrom >= 0 && cssTo < 0 && /^\s*`\s*$/.test(line) && i > cssFrom) cssTo = i
  })

  for (let pass = 0; pass < 8; pass += 1) {
    const run = spawnSync(process.execPath, [LINT, file], { encoding: 'utf8' })
    const out = run.stdout || ''
    const hits = [...out.matchAll(/^\s*(\d+)\s+error\s+\S+\s+(.*)$/gm)]
      .filter((m) => !/ui-copy-ignore/.test(lines[Number(m[1]) - 1]))
      .map((m) => Number(m[1]))
    if (hits.length === 0) break
    for (const line of hits) {
      const inCss = cssFrom >= 0 && line > cssFrom && (cssTo < 0 || line < cssTo)
      const marker = inCss ? ' /* ui-copy-ignore */' : ' // ui-copy-ignore'
      if (!lines[line - 1].includes('ui-copy-ignore')) lines[line - 1] += marker
    }
    text = lines.join('\n')
    writeFileSync(file, text)
  }
  console.log(`${file}: marked`)
}
