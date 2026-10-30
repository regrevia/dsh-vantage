#!/usr/bin/env node
/**
 * style-lint — frontend-design-spec.md 判据里能机器测的部分。
 *   P1 对比度：正文/次要文字对主背景 ≥ 4.5（<3 记 error）
 *   P2 重音数：高饱和颜色色相簇 ≤ 2
 *   P4 圆角集合 ≤ 2 个数值
 *   P5 字号阶梯 ≤ 6 级，相邻级差 ≥ 2px
 *   P6 阴影档位 ≤ 2 档
 *   P9 页面不自述规模（"共 N 篇""N 大模块"这类统计）
 * P3（图表数）与 P6 的层级判断靠截图，见项目的设计规范。
 *
 * 用法：node style-lint.mjs <目录> [--quiet]
 * 退出码：有 error 时 1。
 */
import { readdirSync, statSync, readFileSync } from 'node:fs'
import { join, extname } from 'node:path'

const EXT = new Set(['.css', '.scss', '.less', '.html', '.vue', '.svelte', '.tsx', '.jsx', '.ts', '.js', '.dart', '.xml'])
const SKIP = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'out', 'coverage', '.turbo'])

const RE_TEXT_COLOR = /\bcolor\s*:\s*([^;}\n]+)/g
const RE_BG_COLOR = /\bbackground(?:-color)?\s*:\s*([^;}\n]+)/g
const RE_RADIUS = /\bborder-radius\s*:\s*([^;}\n]+)/g
const RE_FONT_SIZE = /\bfont-size\s*:\s*([^;}\n]+)/g
const RE_FONT_SIZE_JS = /\bfontSize\s*:\s*(\d*\.?\d+)\b/g
const RE_VAR_DEF = /--([\w-]+)\s*:\s*([^;}\n]+)/g
const RE_VAR = /var\(\s*--([\w-]+)/
const RE_SHADOW = /\bbox-shadow\s*:\s*([^;}\n]+)/g
const RE_HEX = /#([0-9a-fA-F]{3,8})\b/g
const RE_RGB = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)/g
const RE_PX = /(-?\d*\.?\d+)px/g

function walk(dir, out) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) walk(p, out)
    else if (EXT.has(extname(name))) out.push(p)
  }
  return out
}

function parseColor(s, depth = 0) {
  const t = s.trim().toLowerCase()
  if (depth < 4) {
    const v = RE_VAR.exec(t)
    if (v) {
      const raw = varMap.get(v[1])
      return raw ? parseColor(raw, depth + 1) : null
    }
  }
  if (t === 'inherit' || t === 'currentcolor' || t === 'transparent') return null
  RE_HEX.lastIndex = 0
  const hex = RE_HEX.exec(t)
  if (hex) {
    let h = hex[1]
    if (h.length === 3) h = h.split('').map((c) => c + c).join('')
    if (h.length !== 6) return null
    return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: 1 }
  }
  RE_RGB.lastIndex = 0
  const m = RE_RGB.exec(t)
  if (m) return { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] }
  return null
}

function lum(c) {
  const f = (v) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b)
}

function contrast(a, b) {
  const la = lum(a), lb = lum(b)
  const hi = Math.max(la, lb), lo = Math.min(la, lb)
  return (hi + 0.05) / (lo + 0.05)
}

function sat(c) {
  const r = c.r / 255, g = c.g / 255, b = c.b / 255
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b)
  if (mx === mn) return 0
  const l = (mx + mn) / 2
  return l > 0.5 ? (mx - mn) / (2 - mx - mn) : (mx - mn) / (mx + mn)
}

function hue(c) {
  const r = c.r / 255, g = c.g / 255, b = c.b / 255
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b)
  if (mx === mn) return 0
  const d = mx - mn
  let h
  if (mx === r) h = ((g - b) / d) % 6
  else if (mx === g) h = (b - r) / d + 2
  else h = (r - g) / d + 4
  h *= 60
  return h < 0 ? h + 360 : h
}

const varMap = new Map()
const hexOf = (c) => '#' + [c.r, c.g, c.b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('').toUpperCase()

function main() {
const dir = process.argv[2]
const quiet = process.argv.includes('--quiet')
if (!dir) {
  console.error('用法: node style-lint.mjs <目录>')
  process.exitCode = 2; return
}

let files
try {
  files = walk(dir, [])
} catch (e) {
  console.error(`style-lint: 目录不存在或不可读：${dir}`)
  process.exitCode = 2; return
}
const textColors = new Map()
const bgColors = new Map()
const radii = new Map()
const fonts = new Map()
const shadows = new Map()
let allText = ''
const gradStops = new Set()

function bump(map, key, file) {
  const cur = map.get(key)
  if (cur) cur.n++
  else map.set(key, { n: 1, file })
}

// 预扫：CSS 变量定义（token 驱动项目靠它才能测到颜色）
for (const f of files) {
  const src = readFileSync(f, 'utf8')
  RE_VAR_DEF.lastIndex = 0
  for (const m of src.matchAll(RE_VAR_DEF)) {
    if (!varMap.has(m[1])) varMap.set(m[1], m[2].trim())
  }
}

for (const f of files) {
  const src = readFileSync(f, 'utf8')
  const rel = f.startsWith(dir) ? f.slice(dir.length) || f : f
  allText += src + '\n'
  for (const m of src.matchAll(RE_TEXT_COLOR)) {
    // 渐变断点不是文字色：`background:linear-gradient(#a,#b)` 里的值会误进这里
    if (/gradient/i.test(src.slice(Math.max(0, m.index - 64), m.index))) continue

    const c = parseColor(m[1])
    if (c && c.a >= 0.6) bump(textColors, hexOf(c), rel)
  }
  for (const m of src.matchAll(RE_BG_COLOR)) {
    const c = parseColor(m[1])
    if (!c || c.a < 0.6) continue
    const onGradient = /gradient/i.test(src.slice(Math.max(0, m.index - 64), m.index))
    if (onGradient) gradStops.add(hexOf(c))
    bump(bgColors, hexOf(c), rel)
  }
  for (const m of src.matchAll(RE_RADIUS)) {
    const raw = m[1].trim().toLowerCase()
    const full = /9999?px|50%|calc\(/.test(raw) ? 'full' : raw
    bump(radii, full, rel)
  }
  for (const m of src.matchAll(RE_FONT_SIZE)) {
    RE_PX.lastIndex = 0
    const px = RE_PX.exec(m[1])
    if (px) bump(fonts, px[1] + 'px', rel)
  }
  RE_FONT_SIZE_JS.lastIndex = 0
  for (const m of src.matchAll(RE_FONT_SIZE_JS)) bump(fonts, m[1] + 'px', rel)
  for (const m of src.matchAll(RE_SHADOW)) {
    const v = m[1].trim()
    if (v !== 'none') bump(shadows, v.replace(/\s+/g, ' '), rel)
  }
}

const issues = []
const note = (sev, code, msg, detail) => issues.push({ sev, code, msg, detail })

// P1 对比度：每个文字色对最常用背景
const bgList = [...bgColors.entries()].sort((a, b) => b[1].n - a[1].n)
const baseBg = bgList.length ? parseColor(bgList[0][0]) : { r: 255, g: 255, b: 255, a: 1 }
const badContrast = []
const gradText = []
const hasGradient = /gradient\s*\(/.test(allText)
for (const [hex] of textColors) {
  const c = parseColor(hex)
  if (!c) continue
  // 文字压在渐变上时单一底色算不出真实对比度，交给截图核对
  if (gradStops.has(hex)) { gradText.push(hex); continue }
  const ratio = contrast(c, baseBg)
  if (ratio < 3) badContrast.push({ hex, ratio, sev: hasGradient ? 'warn' : 'error' })
  else if (ratio < 4.5) badContrast.push({ hex, ratio, sev: 'warn' })
}
for (const b of badContrast.sort((a, b) => a.ratio - b.ratio)) {
  const tail = b.sev === 'warn' && hasGradient ? '（文件含渐变，实际背景可能是深色，需截图核对）' : ''
  note(b.sev, 'P1', `文字 ${b.hex} 对背景 ${hexOf(baseBg)} 对比 ${b.ratio.toFixed(2)}:1${tail}`)
}

if (gradText.length) {
  note('warn', 'P1', `${gradText.length} 个文字色同时用作渐变断点（${gradText.slice(0, 3).join(' ')}），背景为渐变，对比度需看截图`)
}

// P2 重音簇
const satColors = [...textColors.keys(), ...bgColors.keys()]
  .map((h) => parseColor(h))
  .filter((c) => c && sat(c) > 0.35)
  .map((c) => hue(c))
const hues = new Set(satColors.map((h) => Math.floor(h / 30)))
if (hues.size > 2) {
  note('warn', 'P2', `高饱和颜色分属 ${hues.size} 个色相簇（≤2），检查是否多了第二个重音`)
}

// P4 圆角
const radiusSet = [...radii.keys()].filter((r) => r !== 'full')
if (radiusSet.length > 2) {
  note('warn', 'P4', `border-radius 有 ${radiusSet.length} 个取值: ${radiusSet.join(' / ')}（≤2）`)
}

// P5 字号阶梯
const fontPx = [...fonts.keys()]
  .map((k) => parseFloat(k))
  .filter((n) => !Number.isNaN(n))
  .sort((a, b) => a - b)
const fontUniq = [...new Set(fontPx)]
if (fontUniq.length > 6) {
  note('warn', 'P5', `字号阶梯 ${fontUniq.length} 级: ${fontUniq.join(' / ')}（≤6）`)
}
for (let i = 1; i < fontUniq.length; i++) {
  const d = fontUniq[i] - fontUniq[i - 1]
  if (d > 0 && d < 2) note('warn', 'P5', `字号 ${fontUniq[i - 1]}px→${fontUniq[i]}px 级差 ${d}px（≥2）`)
}

// P6 阴影档位
if (shadows.size > 2) {
  note('warn', 'P6', `box-shadow 有 ${shadows.size} 档（≤2）: ${[...shadows.keys()].slice(0, 3).join(' | ')}`)
}

// P9 自述规模：给开发者看的统计不该出现在面向访客的页面上
const RE_NUMSELF = /共\s*\d+\s*篇|\d+\s*篇已发布|\d+\s*大(?:知识)?模块|\d+\s*个(?:知识)?模块/

if (RE_NUMSELF.test(allText)) {
  const m = RE_NUMSELF.exec(allText)
  const line = allText.slice(0, m.index).split('\n').length
  note('warn', 'P9', `页面自述规模：「${m[0]}」（约第 ${line} 行）；统计只留目录页或删掉`)
}

// 空白通过：全是 var(--host-token) 或纯结构文件时算不出任何值，别报"通过"骗人
if (!textColors.size && !bgColors.size && !fonts.size) {
  note('warn', 'P1', '未检出颜色/字号字面值（token 全在外部或宿主），P1/P4/P5 需人工 + 截图核对')
}

// 报告
const errs = issues.filter((i) => i.sev === 'error')
const warns = issues.filter((i) => i.sev === 'warn')
if (!quiet) {
  console.log(`style-lint  ${dir}  ${files.length} 文件`)
  console.log(
    `  文字色 ${textColors.size} · 背景色 ${bgColors.size} · 圆角 ${radii.size} · 字号 ${fontUniq.length} · 阴影 ${shadows.size}`
  )
  for (const i of [...errs, ...warns]) console.log(`  ${i.sev === 'error' ? 'ERROR' : 'WARN '} [${i.code}] ${i.msg}`)
  if (!issues.length) console.log('  通过')
}
process.exitCode = errs.length ? 1 : 0
}

main()
