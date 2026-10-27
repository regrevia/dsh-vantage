#!/usr/bin/env node
/**
 * ui-copy-lint — flag defensive, explanatory and implementation-detail UI copy.
 *
 *   node scripts/ui-copy-lint.mjs [path ...] [--max-prose=24] [--json]
 *
 * A smell detector, not a parser: it reads source lines, so keep hits honest by
 * reading the line. Add `ui-copy-ignore` to any line you have deliberately kept.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { extname, join, relative, resolve } from 'node:path'

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'out', '.next', '.nuxt', '.svelte-kit',
  'coverage', '.turbo', 'vendor', '.venv', 'venv', 'target', '.cache',
])
const EXTS = new Set(['.js', '.jsx', '.ts', '.tsx', '.vue', '.svelte', '.html', '.htm', '.astro', '.mdx'])

const RULES = [
  {
    id: 'auto-detail',
    sev: 'error',
    re: /(自动补|自动填|会自动|自动识别|自动切换)/,
    msg: '实现细节：系统替你做的事不必写出来，直接做。',
  },
  {
    id: 'clause-conclusion',
    sev: 'error',
    re: /(即可|就行了|就好|也能用)/,
    msg: '从句结论：把结论变成标签或默认值，不要藏在半句话里。',
  },
  {
    id: 'leave-blank',
    sev: 'error',
    re: /(留空|不填则|不填即|默认为空)/,
    msg: '别教用户“留空”：展示已存值，再加一个“更换”。',
  },
  {
    id: 'status-value',
    sev: 'error',
    re: /(（未设置）|\(未设置\)|（未授权）|\(未授权\)|：未设置|: 未设置|：未授权|: 未授权|：未配置|: 未配置)/,
    msg: '状态倾倒：换成一句人话状态 + 一个修复动作。',
  },
  {
    id: 'dev-term',
    sev: 'error',
    re: /(whisper|常驻\s*worker|\bworker\b|热态|宿主|\bHost\b|\bport\b|端口|\btoken\b|\bdp\b|API\s*地址)/i,
    msg: '底层术语泄漏：用户不需要知道实现。',
  },
  {
    id: 'enum-leak',
    sev: 'error',
    re: /音色\s*[:：]\s*[a-z][a-z0-9_-]*/,
    msg: '枚举值直出：显示人类可读名称，选择交给控件。',
  },
  {
    id: 'defensive-prefix',
    sev: 'warn',
    re: /(注意[:：]|提示[:：]|说明[:：]|建议您|请确保|如需|如果.*(请|则)|此时|否则)/,
    msg: '防御性前缀：提示只在出错时出现，且只说怎么修。',
  },
  {
    id: 'meta-label',
    sev: 'warn',
    re: /(^|["'>\s])更多($|["'<\s])/,
    msg: '“更多”是无意义分组：要么直接列出，要么删掉。',
  },
  {
    id: 'english-hedge',
    sev: 'warn',
    re: /\b(please note|note that|simply|just|make sure|in order to|automatically|will be)\b/i,
    msg: 'English hedging：说动作，删安慰。',
  },
]

const STATUS_LINE = /^\s*["'`{]*[\u4e00-\u9fa5A-Za-z][\u4e00-\u9fa5A-Za-z0-9]{0,7}\s*[:：]\s*[^，。；]{0,18}\s*["'`,}]*$/

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) {
      if (!SKIP_DIRS.has(name) && !name.startsWith('.')) walk(p, out)
    } else if (EXTS.has(extname(name))) {
      out.push(p)
    }
  }
  return out
}

function cjkLen(s) {
  return (s.match(/[\u4e00-\u9fff]/g) || []).length
}

const argv = process.argv.slice(2)
let maxProse = 24
let json = false
const roots = []
for (const a of argv) {
  if (a === '--json') json = true
  else if (a.startsWith('--max-prose=')) maxProse = Number(a.split('=')[1]) || 24
  else roots.push(a)
}
if (roots.length === 0) roots.push('.')

const files = []
for (const r of roots) {
  const abs = resolve(r)
  const st = statSync(abs)
  if (st.isDirectory()) walk(abs, files)
  else files.push(abs)
}

const results = []
let errors = 0
let warnings = 0

for (const file of files) {
  const text = readFileSync(file, 'utf8')
  const lines = text.split(/\r?\n/)
  const hits = []

  lines.forEach((raw, i) => {
    if (raw.includes('ui-copy-ignore')) return
    for (const rule of RULES) {
      if (rule.re.test(raw)) {
        hits.push({ line: i + 1, sev: rule.sev, id: rule.id, text: raw.trim().slice(0, 120), msg: rule.msg })
      }
    }
    if (cjkLen(raw) >= maxProse && /[，。；]/.test(raw)) {
      hits.push({
        line: i + 1,
        sev: 'warn',
        id: 'long-prose',
        text: raw.trim().slice(0, 120),
        msg: `长句（${cjkLen(raw)} 字）：界面里不该有段落，删或拆成字段。`,
      })
    }
  })

  // Status dump: three or more `key：value` lines inside a ten-line window.
  const statusAt = []
  lines.forEach((raw, i) => {
    if (raw.includes('ui-copy-ignore')) return
    const bare = raw.replace(/<[^>]+>/g, '').replace(/["'`{}];?$/g, '').trim()
    if (STATUS_LINE.test(bare)) statusAt.push(i + 1)
  })
  const dumped = new Set()
  for (let k = 0; k < statusAt.length; k++) {
    const window = statusAt.filter((n) => n >= statusAt[k] && n <= statusAt[k] + 9)
    if (window.length >= 3) {
      for (const n of window) dumped.add(n)
    }
  }
  for (const line of dumped) {
    hits.push({
      line,
      sev: 'error',
      id: 'status-dump',
      text: lines[line - 1].trim().slice(0, 120),
      msg: '连续键值对状态：合成一行状态句，修复动作放同一行。',
    })
  }

  if (hits.length) {
    hits.sort((a, b) => a.line - b.line)
    results.push({ file: relative(process.cwd(), file) || file, hits })
    for (const h of hits) h.sev === 'error' ? errors++ : warnings++
  }
}

if (json) {
  console.log(JSON.stringify({ errors, warnings, results }, null, 2))
} else if (results.length === 0) {
  console.log('ui-copy-lint: clean.')
} else {
  for (const { file, hits } of results) {
    console.log(`\n${file}`)
    for (const h of hits) {
      console.log(`  ${String(h.line).padStart(4)}  ${h.sev.padEnd(5)}  ${h.id.padEnd(17)} ${h.text}`)
      console.log(`        → ${h.msg}`)
    }
  }
  console.log(`\nui-copy-lint: ${errors} error(s), ${warnings} warning(s) in ${results.length} file(s).`)
}

process.exit(errors > 0 ? 1 : 0)
