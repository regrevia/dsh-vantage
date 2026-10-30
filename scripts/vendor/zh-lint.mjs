#!/usr/bin/env node
// Chinese web typography + copy lint. Deterministic, zero deps, regex tier.
// Fills the gap impeccable's 59 rules leave: they cover Latin/Web slop only.
// Usage: node zh-lint.mjs <dir-or-file> [--json] [--quiet] [--strict]
// Exit 1 when any `error` finding exists (warnings never fail).

import fs from 'node:fs';
import path from 'node:path';

const EXT = new Set(['.html', '.htm', '.vue', '.svelte', '.jsx', '.tsx', '.js', '.ts', '.css', '.scss', '.less', '.astro', '.md', '.dart', '.kt', '.swift', '.xml']);
const SKIP_DIR = new Set(['node_modules', '.git', 'dist', 'build', '.next', '.nuxt', 'coverage', '.impeccable']);

const CJK = /[\u4e00-\u9fff\u3400-\u4dbf]/;

const MARKETING = [
  '赋能', '闭环', '抓手', '沉淀', '打通', '一站式', '极致', '丝滑', '全新升级',
  '重磅', '颠覆', '解锁', '海量', '无缝', '高效协同', '数字化转型', '新范式',
  '底层逻辑', '颗粒度', '组合拳', '护城河',
];

const LATIN_ONLY = /font-family\s*:\s*([^;}]+)/g;
const CJK_FAMILY = /pingfang|hiragino|source han|noto (sans|serif) (sc|cjk|tc)|microsoft yahei|微软雅黑|苹方|思源|宋体|黑体|songti|heiti|system-ui|-apple-system|blinkmacsystemfont|monospace|consolas|menlo|sfmono\b|\bSC\b/i;

const RULES = {
  'zh-halfwidth-punct': ['error', '中文语句里用了半角标点，应为，。？！：；'],
  'zh-no-cjk-font': ['error', 'font-family 只声明了西文字族，中文会回退到系统默认，字重与西文不一致'],
  'zh-letter-spacing-negative': ['warning', '中文字面不应为负字距（负字距是西文排版手段；仅用于西文标题可豁免）'],
  'zh-tiny-font': ['error', '字号 < 12px 的中文不可读'],
  'zh-ellipsis': ['warning', '中文省略号应为 ……（六点），不是 ...'],
  'zh-dash': ['warning', '中文破折号应为 ——（两个），不是 --'],
  'zh-line-height-tight': ['warning', '中文正文行高 < 1.6 会显得拥挤（西文 1.5 够，中文不够）'],
  'zh-marketing-word': ['warning', '空转营销词，删除或换成具体事实'],
};

const TEXT_EXT = new Set(['.html', '.htm', '.vue', '.svelte', '.jsx', '.tsx', '.astro', '.md', '.js', '.ts', '.dart', '.kt', '.swift', '.xml']);

function walk(p, out = []) {
  let st;
  try { st = fs.statSync(p); } catch { return out; }
  if (st.isFile()) { if (EXT.has(path.extname(p))) out.push(p); return out; }
  for (const e of fs.readdirSync(p)) {
    if (SKIP_DIR.has(e)) continue;
    walk(path.join(p, e), out);
  }
  return out;
}

function lineOf(text, idx) {
  let n = 1;
  for (let i = 0; i < idx && i < text.length; i++) if (text.charCodeAt(i) === 10) n++;
  return n;
}

// Strip tags/comments so text rules only see rendered-ish prose.
function proseChunks(text, ext) {
  if (!TEXT_EXT.has(ext)) return [];
  const chunks = [];
  // HTML-ish: text between tags
  const mask = (m) => m.replace(/[^\n]/g, ' ');
  const body = text
    .replace(/<script[\s\S]*?<\/script>/gi, mask)
    .replace(/<style[\s\S]*?<\/style>/gi, mask)
    .replace(/<!--[\s\S]*?-->/g, mask);
  const re = />([^<>]+)</g;
  let m;
  while ((m = re.exec(body))) {
    const s = m[1];
    if (CJK.test(s)) chunks.push({ text: s, at: m.index + 1 });
  }
  // JS/TS string literals
  if (!/\.(html?|vue|svelte|astro|md)$/i.test(ext)) {
    const sre = /(['"`])((?:(?!\1)[^\\]|\\.){4,}?)\1/g;
    while ((m = sre.exec(body))) {
      if (CJK.test(m[2])) chunks.push({ text: m[2], at: m.index + 1 });
    }
  }
  return chunks;
}

const findings = [];
function report(rule, file, text, idx, detail) {
  const meta = RULES[rule];
  if (!meta) return; // a waived rule carries no metadata
  const [sev] = meta;
  findings.push({ rule, severity: sev, file, line: lineOf(text, idx), detail, hint: RULES[rule][1] });
}

const RE = {
  lineHeight: /line-height\s*:\s*(1\.[0-5]\d*|[0-9]\.\d+)\b/g,
  letterSpacing: /letter-spacing\s*:\s*-\s*[\d.]+(?:em|px|rem)/g,
  fontSize: /font-size\s*:\s*(\d*\.?\d+)px/g,
  dartFontSize: /\bfontSize\s*:\s*(\d*\.?\d+)\b/g,
  androidTextSize: /textSize\s*=\s*"(\d*\.?\d+)(?:sp|dp)"/g,
  halfPunct: /([\u4e00-\u9fff])[,.;:?!]/g,
  ellipsis: /\.\.\./g,
  dash: /(?:^|[^-])--(?:[^->]|$)/g,
};

function forEachMatch(re, text, fn) {
  re.lastIndex = 0;
  let m;
  while ((m = re.exec(text))) {
    fn(m);
    if (m.index === re.lastIndex) re.lastIndex++;
  }
}

function checkStyles(rule, file, text) {
  forEachMatch(RE.lineHeight, text, (m) => {
    const v = parseFloat(m[1]);
    if (v > 0 && v < 1.6) report(rule('zh-line-height-tight'), file, text, m.index);
  });
  forEachMatch(RE.letterSpacing, text, (m) => report(rule('zh-letter-spacing-negative'), file, text, m.index));
  forEachMatch(RE.fontSize, text, (m) => {
    if (parseFloat(m[1]) < 12) report(rule('zh-tiny-font'), file, text, m.index);
  });
  forEachMatch(RE.dartFontSize, text, (m) => {
    if (parseFloat(m[1]) < 12) report(rule('zh-tiny-font'), file, text, m.index);
  });
  forEachMatch(RE.androidTextSize, text, (m) => {
    if (parseFloat(m[1]) < 12) report(rule('zh-tiny-font'), file, text, m.index);
  });
  forEachMatch(LATIN_ONLY, text, (m) => {
    if (!CJK_FAMILY.test(m[1])) report(rule('zh-no-cjk-font'), file, text, m.index);
  });
}

function checkProse(rule, file, ext, text) {
  for (const { text: chunk, at } of proseChunks(text, ext)) {
    // Halfwidth punctuation directly after a CJK char.
    forEachMatch(RE.halfPunct, chunk, (m) => report(rule('zh-halfwidth-punct'), file, text, at + m.index));
    forEachMatch(RE.ellipsis, chunk, (m) => report(rule('zh-ellipsis'), file, text, at + m.index));
    forEachMatch(RE.dash, chunk, (m) => report(rule('zh-dash'), file, text, at + m.index));
    for (const w of MARKETING) {
      let i = chunk.indexOf(w);
      while (i !== -1) { report(rule('zh-marketing-word'), file, text, at + i); i = chunk.indexOf(w, i + w.length); }
    }
  }
}

function main() {
  const args = process.argv.slice(2);
  const json = args.includes('--json');
  const quiet = args.includes('--quiet');
  const strict = args.includes('--strict');
  const targets = args.filter((a) => !a.startsWith('--'));
  if (!targets.length) { console.error('usage: node zh-lint.mjs <dir-or-file> [--json] [--quiet] [--strict]'); process.exitCode = 2; return }

  // Per-project waiver file, so one legacy screen doesn't block the repo.
  let ignored = new Set();
  const cfg = path.resolve(process.cwd(), '.zh-lint.json');
  if (fs.existsSync(cfg)) {
    try { ignored = new Set(JSON.parse(fs.readFileSync(cfg, 'utf8')).ignoreRules || []); } catch { /* ignore bad config */ }
  }
  const rule = (id) => (ignored.has(id) ? '__ignored__' : id);

  for (const t of targets) for (const f of walk(path.resolve(t))) {
    let text;
    try { text = fs.readFileSync(f, 'utf8'); } catch { continue; }
    if (!CJK.test(text)) continue;
    const ext = path.extname(f).toLowerCase();
    checkStyles(rule, f, text);
    checkProse(rule, f, ext, text);
  }

  const out = findings.filter((x) => x.rule !== '__ignored__');
  const errors = out.filter((x) => x.severity === 'error');
  const warns = out.filter((x) => x.severity === 'warning');

  if (json) {
    console.log(JSON.stringify({ errors: errors.length, warnings: warns.length, findings: out }, null, 2));
  } else if (quiet) {
    console.log(`zh-lint: ${errors.length} error(s), ${warns.length} warning(s).`);
  } else {
    for (const x of out) {
      console.log(`${x.file}:${x.line}  ${x.severity === 'error' ? 'error' : 'warn '}  ${x.rule}  ${x.hint}`);
    }
    console.log(`\nzh-lint: ${errors.length} error(s), ${warns.length} warning(s).`);
  }
  process.exitCode = errors.length || (strict && warns.length) ? 1 : 0;
}

main();
