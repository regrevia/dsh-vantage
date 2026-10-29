window.__ModuleLoader__.load({
  id: 'dsh-vantage',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const HOST_BASE = '/api/dsh-vantage'
    const VIEW_ID = 'vantage'
    const NAMESPACE = 'vantage'
    const POLL_MS = 5000
    const REQUEST_MS = 8000
    const STYLE_ID = 'dsh-vantage-style'
    const HISTORY_PAGE = 10

    // One dictionary per language, handed to the locale service and mirrored
    // in locale/*.json so a missing registration still renders.
    const COPY = {
      zh: {
        overview: '概览', // ui-copy-ignore
        switchLabel: '本会话概览', // ui-copy-ignore
        contextCurrent: '本会话概览', // ui-copy-ignore
        contextDisabled: '概览已关闭', // ui-copy-ignore
        contextResumed: '本会话 · 已开启', // ui-copy-ignore
        contextHistory: '历史记录', // ui-copy-ignore
        history: '历史', // ui-copy-ignore
        historyHeading: '历史', // ui-copy-ignore
        currentTab: '当前轮次', // ui-copy-ignore
        historyTab: '历史轮次', // ui-copy-ignore
        pendingLabel: '待办', // ui-copy-ignore
        goalLabel: '会话目标', // ui-copy-ignore
        milestones: '里程碑', // ui-copy-ignore
        artifacts: '关键产物', // ui-copy-ignore
        archived: '只读', // ui-copy-ignore
        currentRound: '本轮', // ui-copy-ignore
        lastRound: '上一轮', // ui-copy-ignore
        nothingYet: '这一轮没有留下可展示的结论', // ui-copy-ignore
        inProgress: '这一轮正在处理', // ui-copy-ignore
        roundCountLabel: '历史', // ui-copy-ignore
        roundUnit: '轮', // ui-copy-ignore
        none: '无', // ui-copy-ignore
        historyEmpty: '还没有更早的轮次', // ui-copy-ignore
        historyLoading: '正在读取历史', // ui-copy-ignore
        historyFailed: '历史记录没能读取', // ui-copy-ignore
        historyMore: '查看全部', // ui-copy-ignore
        unanswered: '未作答复', // ui-copy-ignore
        noSummary: '这一轮没有留下结论', // ui-copy-ignore
        goalDone: '已达成', // ui-copy-ignore
        goalPaused: '已暂停', // ui-copy-ignore
        goalBlocked: '受阻', // ui-copy-ignore
        detailFailed: '这一轮的记录没能读取', // ui-copy-ignore
        back: '返回当前', // ui-copy-ignore
        loading: '正在读取', // ui-copy-ignore
        failed: '概览没能显示', // ui-copy-ignore
        retry: '重试', // ui-copy-ignore
        blocked: '这个会话只能在自己的窗口里查看', // ui-copy-ignore
        disabledTitle: '概览已关闭', // ui-copy-ignore
        disabledBody: '开启后从现在开始记录', // ui-copy-ignore
        evidence: '查看依据', // ui-copy-ignore
        openFailed: '没能打开这个文件', // ui-copy-ignore
        switchFailed: '没能切换概览，已回到原来的状态', // ui-copy-ignore
        elapsed: '已运行', // ui-copy-ignore
        updated: '更新于', // ui-copy-ignore
        untitled: '本次任务', // ui-copy-ignore
        justNow: '刚刚', // ui-copy-ignore
        minuteUnit: '分钟前', // ui-copy-ignore
        underMinute: '不到 1 分钟', // ui-copy-ignore
        minutesUnit: '分钟', // ui-copy-ignore
        hourUnit: '小时', // ui-copy-ignore
        shortMinuteUnit: '分', // ui-copy-ignore
        status: {
          checking: '核对中', // ui-copy-ignore
          running: '进行中', // ui-copy-ignore
          waiting: '等待结果', // ui-copy-ignore
          'needs-input': '需要你处理', // ui-copy-ignore
          failing: '验证未通过', // ui-copy-ignore
          'no-news': '暂无新进展', // ui-copy-ignore
          disconnected: '已断开', // ui-copy-ignore
          'answered-unverified': '待核验', // ui-copy-ignore
          verified: '已完成', // ui-copy-ignore
          archived: '只读', // ui-copy-ignore
          unknown: '' // ui-copy-ignore
        },
        verify: {
          passed: '已核验', // ui-copy-ignore
          failed: '核验未通过', // ui-copy-ignore
          recheck: '待重新核验', // ui-copy-ignore
          pending: '待核验', // ui-copy-ignore
          unknown: '', // ui-copy-ignore
          na: '' // ui-copy-ignore
        }
      },
      en: {
        overview: 'Overview', // ui-copy-ignore
        switchLabel: 'Session overview', // ui-copy-ignore
        contextCurrent: 'Session overview', // ui-copy-ignore
        contextDisabled: 'Overview off', // ui-copy-ignore
        contextResumed: 'This session · on', // ui-copy-ignore
        contextHistory: 'History', // ui-copy-ignore
        history: 'History', // ui-copy-ignore
        historyHeading: 'History', // ui-copy-ignore
        currentTab: 'Current round', // ui-copy-ignore
        historyTab: 'Past rounds', // ui-copy-ignore
        pendingLabel: 'Todo', // ui-copy-ignore
        goalLabel: 'Goal', // ui-copy-ignore
        milestones: 'Milestones', // ui-copy-ignore
        artifacts: 'Key outputs', // ui-copy-ignore
        archived: 'Read-only', // ui-copy-ignore
        currentRound: 'This round', // ui-copy-ignore
        lastRound: 'Previous round', // ui-copy-ignore
        nothingYet: 'This round left no conclusion to show', // ui-copy-ignore
        inProgress: 'This round is in progress', // ui-copy-ignore
        roundCountLabel: 'History', // ui-copy-ignore
        roundUnit: 'rounds', // ui-copy-ignore
        none: 'None', // ui-copy-ignore
        historyEmpty: 'No earlier rounds yet', // ui-copy-ignore
        historyLoading: 'Reading history', // ui-copy-ignore
        historyFailed: 'History could not be read', // ui-copy-ignore
        historyMore: 'Show all', // ui-copy-ignore
        unanswered: 'No reply', // ui-copy-ignore
        noSummary: 'No conclusion saved for this round', // ui-copy-ignore
        goalDone: 'Achieved', // ui-copy-ignore
        goalPaused: 'Paused', // ui-copy-ignore
        goalBlocked: 'Blocked', // ui-copy-ignore
        detailFailed: 'This round could not be read', // ui-copy-ignore
        back: 'Back to current', // ui-copy-ignore
        loading: 'Reading', // ui-copy-ignore
        failed: 'Overview could not be shown', // ui-copy-ignore
        retry: 'Retry', // ui-copy-ignore
        blocked: 'This session can only be viewed in its own window', // ui-copy-ignore
        disabledTitle: 'Overview off', // ui-copy-ignore
        disabledBody: 'Recording starts from now', // ui-copy-ignore
        evidence: 'Show basis', // ui-copy-ignore
        switchFailed: 'The overview did not switch and is back where it was', // ui-copy-ignore
        elapsed: 'Running for', // ui-copy-ignore
        updated: 'Updated', // ui-copy-ignore
        untitled: 'Current task', // ui-copy-ignore
        justNow: 'just now', // ui-copy-ignore
        minuteUnit: 'min ago', // ui-copy-ignore
        underMinute: 'under 1 min', // ui-copy-ignore
        minutesUnit: 'min', // ui-copy-ignore
        hourUnit: 'h', // ui-copy-ignore
        shortMinuteUnit: 'min', // ui-copy-ignore
        status: {
          checking: 'Checking', // ui-copy-ignore
          running: 'In progress', // ui-copy-ignore
          waiting: 'Waiting', // ui-copy-ignore
          'needs-input': 'Needs your input', // ui-copy-ignore
          failing: 'Checks fail', // ui-copy-ignore
          'no-news': 'No new progress', // ui-copy-ignore
          disconnected: 'Disconnected', // ui-copy-ignore
          'answered-unverified': 'Unverified', // ui-copy-ignore
          verified: 'Done', // ui-copy-ignore
          archived: 'Read-only', // ui-copy-ignore
          unknown: '' // ui-copy-ignore
        },
        verify: {
          passed: 'Verified', // ui-copy-ignore
          failed: 'Check failed', // ui-copy-ignore
          recheck: 'Re-check needed', // ui-copy-ignore
          pending: 'Not verified', // ui-copy-ignore
          unknown: '', // ui-copy-ignore
          na: '' // ui-copy-ignore
        }
      }
    }

    function langOf(ctx) {
      try {
        const locale = ctx === null || ctx === undefined ? undefined : ctx.locale
        const snapshot = locale === null || locale === undefined || typeof locale.getSnapshot !== 'function' ? undefined : locale.getSnapshot()
        const active = snapshot === null || snapshot === undefined ? undefined : snapshot.active
        if (active === 'zh' || active === 'en') return active
      } catch (error) {}
      try {
        return /^en/i.test(navigator.language || '') ? 'en' : 'zh'
      } catch (error) {
        return 'zh'
      }
    }

    let LANG = 'zh'
    try {
      LANG = /^en/i.test(navigator.language || '') ? 'en' : 'zh'
    } catch (error) {}
    const copy = () => (LANG === 'en' ? COPY.en : COPY.zh)

    // Every mounted overview re-reads its dictionary when the language changes.
    const localeListeners = new Set()
    function subscribeLocale(listener) {
      localeListeners.add(listener)
      return () => {
        localeListeners.delete(listener)
      }
    }
    function notifyLocale() {
      localeListeners.forEach((listener) => {
        try {
          listener()
        } catch (error) {}
      })
    }

    const STYLE = `
html[data-dsv-overview] [data-composer-seat] { display: none; }
.dsv-panel {
  display: block; width: 100%; box-sizing: border-box; padding: 32px 32px 48px;
  background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary);
  font-size: 15px; line-height: 24px; -webkit-font-smoothing: antialiased;
}
.dsv-panel button,
.dsv-panel summary {
  -webkit-appearance: none; appearance: none; margin: 0; border: 0; border-radius: 0;
  background: transparent; color: inherit; font: inherit; text-align: left; cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
.dsv-panel :focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 4px; border-radius: 4px; }
.dsv-panel summary { list-style: none; }
.dsv-panel summary::-webkit-details-marker { display: none; }
.dsv-panel .ov-panel { width: 100%; max-width: 720px; margin-inline: auto; }
.dsv-panel .ov-toolbar {
  display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-bottom: 16px;
}
.dsv-panel .ov-head { min-width: 0; }
.dsv-panel .ov-context {
  color: var(--dsw-alias-label-secondary); font-size: 13px; line-height: 20px; white-space: nowrap;
}
.dsv-panel .ov-state {
  display: inline-flex; align-items: center; gap: 6px; min-height: 24px; padding: 0 8px;
  border-radius: 6px; background: var(--dsw-alias-bg-l2); color: var(--dsw-alias-label-secondary);
  font-size: 12px; line-height: 18px; white-space: nowrap;
}
.dsv-panel .ov-state::before {
  content: ''; width: 6px; height: 6px; border-radius: 50%; background: currentColor; opacity: 0.7;
}
.dsv-panel .ov-state[data-tone="active"] { color: var(--dsw-alias-brand-primary); }
.dsv-panel .ov-state[data-tone="warn"] { color: var(--dsw-alias-state-warn-primary); }
.dsv-panel .ov-state[data-tone="error"] { color: var(--dsw-alias-state-error-primary); }
.dsv-panel .ov-session-title {
  margin-top: 0; font-size: 20px; line-height: 32px; font-weight: 600; overflow-wrap: anywhere;
}
.dsv-panel .ov-roundbar {
  display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-top: 24px;
}
.dsv-panel .ov-round-label { color: var(--dsw-alias-label-secondary); font-size: 13px; line-height: 20px; }
.dsv-panel .ov-round-label:last-child { font-variant-numeric: tabular-nums; }
.dsv-panel .ov-goal {
  display: flex; align-items: baseline; justify-content: space-between; gap: 20px; margin-top: 10px;
  font-size: 14px; line-height: 24px;
}
.dsv-panel .ov-goal-label { flex: none; color: var(--dsw-alias-label-secondary); }
.dsv-panel .ov-goal-text {
  min-width: 0; overflow-wrap: anywhere;
  display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; flex: 1;
}
.dsv-panel .ov-goal-state { flex: none; color: var(--dsw-alias-label-secondary); font-size: 13px; }
.dsv-panel .ov-headline { margin-top: 14px; font-size: 22px; line-height: 30px; font-weight: 600; letter-spacing: 0; }
.dsv-panel .ov-summary { margin-top: 10px; font-size: 15px; line-height: 26px; overflow-wrap: anywhere; }
.dsv-panel .ov-summary-text { margin: 10px 0 0; font-size: 14px; line-height: 24px; color: var(--dsw-alias-label-primary); overflow-wrap: anywhere; }
.dsv-panel .ov-seg { display: inline-flex; align-items: center; gap: 2px; padding: 2px; border-radius: 8px; background: var(--dsw-alias-bg-l2); }
.dsv-panel .ov-seg-item {
  min-height: 28px; padding: 0 10px; border: 0; border-radius: 6px; background: transparent;
  font-size: 13px; line-height: 20px; color: var(--dsw-alias-label-secondary); white-space: nowrap;
}
.dsv-panel .ov-seg-item[aria-selected="true"] { background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); font-weight: 500; }
.dsv-panel .ov-seg-item:hover { color: var(--dsw-alias-label-primary); }
.dsv-panel .ov-section-label {
  margin: 24px 0 2px; color: var(--dsw-alias-label-secondary); font-size: 13px; line-height: 20px;
}
.dsv-panel .ov-section-label + .ov-brief { margin-top: 0; }
.dsv-panel .ov-brief > .ov-output-row { border-bottom: 1px solid var(--dsw-alias-border-l1); }
.dsv-panel .ov-brief > .ov-output-row:last-child { border-bottom: 0; }
.dsv-panel .ov-output-row {
  display: flex; align-items: baseline; gap: 10px; width: 100%; padding: 12px 0;
  text-align: left; font-size: 15px; line-height: 23px;
}
.dsv-panel button.ov-output-row:hover { background: var(--dsw-alias-interactive-bg-hover); }
.dsv-panel .ov-output-text { min-width: 0; overflow-wrap: anywhere; }
.dsv-panel .ov-output-arrow { margin-left: auto; flex: none; color: var(--dsw-alias-label-secondary); }
.dsv-panel .ov-controls { display: flex; align-items: center; gap: 18px; }
.dsv-panel .ov-switch {
  display: inline-flex; align-items: center; gap: 8px; min-height: 32px; padding: 0;
  font-size: 13px; line-height: 20px; color: var(--dsw-alias-label-secondary); white-space: nowrap;
}
.dsv-panel .ov-switch-track {
  display: inline-block; position: relative; width: 30px; height: 18px; flex: none; border-radius: 10px;
  background: var(--dsw-alias-border-l1); transition: background 120ms ease;
}
.dsv-panel .ov-switch-knob {
  position: absolute; top: 3px; left: 3px; width: 12px; height: 12px; border-radius: 50%;
  background: var(--dsw-alias-bg-base); transition: transform 120ms ease;
}
.dsv-panel .ov-switch[aria-checked="true"] .ov-switch-track { background: var(--dsw-alias-brand-primary); }
.dsv-panel .ov-switch[aria-checked="true"] .ov-switch-knob { transform: translateX(12px); }
.dsv-panel .ov-switch[disabled] { opacity: 0.5; cursor: default; }
.dsv-panel .ov-control-link {
  min-height: 32px; padding: 0; font-size: 13px; line-height: 20px;
  color: var(--dsw-alias-label-secondary); white-space: nowrap;
}
.dsv-panel .ov-control-link:hover { color: var(--dsw-alias-label-primary); }
.dsv-panel .ov-control-link:disabled { color: var(--dsw-alias-label-secondary); opacity: 0.45; cursor: default; }
.dsv-panel .ov-back { display: inline-flex; margin-bottom: 12px; }
.dsv-panel h1 {
  margin: 0; font-size: 24px; line-height: 32px; font-weight: 600; overflow-wrap: anywhere;
}
.dsv-panel .ov-meta {
  margin-top: 8px; color: var(--dsw-alias-label-secondary); font-size: 13px; line-height: 20px;
  font-variant-numeric: tabular-nums;
}
.dsv-panel .ov-notice {
  margin-top: 16px; color: var(--dsw-alias-state-warn-primary); font-size: 13px; line-height: 20px;
}
.dsv-panel .ov-sub { margin-top: 8px; color: var(--dsw-alias-label-secondary); font-size: 14px; line-height: 24px; }
.dsv-panel .ov-brief { margin-top: 0; }
.dsv-panel .ov-item { border-bottom: 1px solid var(--dsw-alias-border-l1); }
.dsv-panel .ov-item:last-child { border-bottom: 0; }
.dsv-panel .ov-item > summary {
  display: grid; grid-template-columns: minmax(0, 1fr) 17px; gap: 12px; align-items: start;
  width: 100%; padding: 12px 0;
}
.dsv-panel .ov-item > summary:hover { background: var(--dsw-alias-interactive-bg-hover); }
.dsv-panel .ov-chevron {
  display: inline-flex; align-items: center; justify-content: center; width: 17px; height: 23px;
  color: var(--dsw-alias-label-secondary); font-size: 15px;
  font-weight: 400; line-height: 23px; transform-origin: 50% 50%;
}
.dsv-panel .ov-item[open] > summary .ov-chevron { transform: rotate(90deg); }
.dsv-panel .ov-item-title { display: block; font-size: 15px; line-height: 23px; font-weight: 500; overflow-wrap: anywhere; }
.dsv-panel .ov-item-static > .ov-item-static-title { display: block; padding: 12px 0; }
.dsv-panel .ov-item-flat { padding: 12px 0; }
.dsv-panel .ov-fact {
  display: flex; align-items: baseline; gap: 16px; padding: 12px 0;
  border-bottom: 1px solid var(--dsw-alias-border-l1);
}
.dsv-panel .ov-fact-label { flex: none; min-width: 48px; color: var(--dsw-alias-label-secondary); font-size: 14px; line-height: 26px; }
.dsv-panel .ov-fact-value { font-size: 15px; line-height: 26px; }
.dsv-panel .ov-item-link {
  display: inline-flex; align-items: baseline; gap: 8px; max-width: 100%;
  padding: 0; border: 0; background: none; color: var(--dsw-alias-brand-primary);
  font: inherit; font-size: 17px; line-height: 26px; font-weight: 500;
  text-align: left; overflow-wrap: anywhere; cursor: pointer;
}
.dsv-panel .ov-item-link-text { text-decoration: underline; text-decoration-color: transparent; text-underline-offset: 3px; transition: text-decoration-color 120ms ease; }
.dsv-panel .ov-item-link:hover .ov-item-link-text { text-decoration-color: currentColor; }
.dsv-panel .ov-file-icon { flex: none; align-self: center; }
.dsv-panel .ov-item-link-arrow { flex: none; font-size: 15px; line-height: 26px; transition: transform 120ms ease; }
.dsv-panel .ov-item-link:hover .ov-item-link-arrow { transform: translate(1px, -1px); }
.dsv-panel .ov-item-qualifier {
  display: block; margin-top: 4px; color: var(--dsw-alias-label-secondary); font-size: 13px;
  line-height: 20px; font-weight: 400; overflow-wrap: anywhere;
}
.dsv-panel .ov-item-qualifier[data-tone="error"] { color: var(--dsw-alias-state-error-primary); }
.dsv-panel .ov-item-qualifier[data-tone="warn"] { color: var(--dsw-alias-state-warn-primary); }
.dsv-panel .ov-item-body { padding: 0 0 12px 29px; font-size: 15px; line-height: 24px; }
.dsv-panel .ov-item-body p { margin: 0 0 10px; overflow-wrap: anywhere; }
.dsv-panel .ov-item-body p:last-child { margin-bottom: 0; }
.dsv-panel .ov-evidence { margin-top: 14px; }
.dsv-panel .ov-evidence > summary {
  display: inline-flex; align-items: center; min-height: 28px; padding: 0;
  color: var(--dsw-alias-brand-primary); font-size: 14px; line-height: 22px;
}
.dsv-panel .ov-evidence > summary { text-decoration: underline; text-decoration-color: transparent; text-underline-offset: 3px; }
.dsv-panel .ov-evidence > summary:hover { text-decoration-color: currentColor; }
.dsv-panel .ov-evidence > summary::after { content: '›'; margin-left: 6px; transform: rotate(0deg); }
.dsv-panel .ov-evidence[open] > summary::after { transform: rotate(90deg); }
.dsv-panel .ov-source { margin-top: 10px; padding-left: 12px; border-left: 2px solid var(--dsw-alias-border-l1); }
.dsv-panel .ov-source p {
  margin-bottom: 6px; color: var(--dsw-alias-label-secondary); font-size: 13px; line-height: 21px;
  overflow-wrap: anywhere;
}
.dsv-panel .ov-source pre {
  margin: 6px 0 0; color: var(--dsw-alias-label-secondary);
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: 12px; line-height: 20px;
  white-space: pre-wrap; overflow-wrap: anywhere;
}
.dsv-panel .ov-history-list { margin-top: 16px; }
.dsv-panel .ov-recent { margin-top: 18px; border-top: 1px solid var(--dsw-alias-border-l1); }
.dsv-panel .ov-history-detail { margin: 0; font-size: 13px; line-height: 1.7; color: var(--dsw-alias-label-secondary); }
.dsv-panel .ov-recent-row { padding: 10px 0; }
.dsv-panel .ov-recent .ov-history-row:last-child { border-bottom: 0; }
.dsv-panel .ov-history-item { border-bottom: 1px solid var(--dsw-alias-border-l1); }
.dsv-panel .ov-history-item:last-child { border-bottom: 0; }
.dsv-panel .ov-history-row {
  display: grid; grid-template-columns: minmax(0, 1fr) auto 16px; align-items: baseline; gap: 16px;
  width: 100%; padding: 12px 0;
}
.dsv-panel .ov-history-row:hover { background: var(--dsw-alias-interactive-bg-hover); }
.dsv-panel .ov-history-row-static { cursor: default; }
.dsv-panel .ov-history-row-static:hover { background: transparent; }
.dsv-panel .ov-history-row > span:first-child { min-width: 0; }
.dsv-panel .ov-history-item[data-open] .ov-row-chevron { transform: rotate(90deg); }
.dsv-panel .ov-round-body { padding-bottom: 16px; }
.dsv-panel .ov-round-body .ov-meta { margin: 0 0 8px; }
.dsv-panel .ov-list-heading {
  margin-bottom: 4px; color: var(--dsw-alias-label-secondary);
  font-size: 13px; line-height: 20px; font-weight: 500;
}
.dsv-panel .ov-history-title {
  display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 1; overflow: hidden;
  font-size: 15px; line-height: 23px; font-weight: 500; overflow-wrap: anywhere;
}
.dsv-panel .ov-history-more {
  display: inline-flex; align-items: center; gap: 6px; margin-top: 24px; padding: 0;
  color: var(--dsw-alias-brand-primary); font-size: 13px; line-height: 20px;
}
.dsv-panel .ov-history-more:hover { text-decoration: underline; text-underline-offset: 3px; }
.dsv-panel .ov-history-sub { display: block; margin-top: 4px; color: var(--dsw-alias-label-secondary); font-size: 13px; line-height: 20px; }
.dsv-panel .ov-history-time {
  color: var(--dsw-alias-label-secondary); font-size: 13px; line-height: 25px; white-space: nowrap;
  font-variant-numeric: tabular-nums;
}
.dsv-panel .ov-row-chevron {
  display: inline-flex; align-items: center; justify-content: center; width: 16px; height: 25px;
  color: var(--dsw-alias-label-secondary); font-size: 20px; line-height: 25px;
}
.dsv-panel .ov-more { display: inline-flex; margin-top: 16px; }
.dsv-panel .ov-quiet { padding-top: 24px; }
.dsv-panel .ov-quiet .ov-quiet-title { font-size: 17px; line-height: 26px; font-weight: 600; }
.dsv-panel .ov-quiet p { margin: 8px 0 0; color: var(--dsw-alias-label-secondary); font-size: 14px; line-height: 24px; }
@media (max-width: 560px) {
  .dsv-panel { padding: 24px 20px 36px; }
  .dsv-panel .ov-toolbar { align-items: flex-start; flex-wrap: wrap; gap: 8px 16px; }
  .dsv-panel .ov-controls { gap: 16px; }
  .dsv-panel .ov-switch,
  .dsv-panel .ov-control-link { min-height: 44px; }
  .dsv-panel h1 { font-size: 24px; line-height: 32px; }
  .dsv-panel .ov-item > summary { gap: 12px; }
  .dsv-panel .ov-item-body { padding-left: 28px; }
  .dsv-panel .ov-history-row { grid-template-columns: minmax(0, 1fr); gap: 4px; }
}
@media (prefers-reduced-motion: reduce) {
  .dsv-panel .ov-switch-track,
  .dsv-panel .ov-switch-knob { transition: none; }
}
`

    // The stylesheet follows the code: a newer build replaces stale rules
    // instead of leaving the old sheet in the head for the rest of the session.
    function ensureStyle() {
      if (typeof document === 'undefined') return
      const head = document.head
      if (head === null || head === undefined) return
      let node = document.getElementById(STYLE_ID)
      if (node === null || node === undefined) {
        node = document.createElement('style')
        node.id = STYLE_ID
        head.appendChild(node)
      }
      if (node.textContent !== STYLE) node.textContent = STYLE
    }

    function timeOf(at, now) {
      const words = copy()
      if (typeof at !== 'number' || at <= 0) return ''
      const delta = now - at
      const minutes = Math.round(delta / 60000)
      if (minutes >= 0 && minutes < 1) return words.justNow
      if (minutes >= 0 && minutes < 60) return `${minutes} ${words.minuteUnit}`
      const date = new Date(at)
      return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
    }

    function durationOf(ms) {
      const words = copy()
      if (typeof ms !== 'number' || ms < 60000) return words.underMinute
      const minutes = Math.floor(ms / 60000)
      if (minutes < 60) return `${minutes} ${words.minutesUnit}`
      const hours = Math.floor(minutes / 60)
      return `${hours} ${words.hourUnit} ${minutes % 60} ${words.shortMinuteUnit}`
    }

    async function callHost(path, options) {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), REQUEST_MS)
      try {
        const init = Object.assign({}, options, { signal: controller.signal, cache: 'no-store' })
        const response = await fetch(`${HOST_BASE}${path}`, init)
        if (response.status === 403) return { blocked: true }
        let body = null
        try {
          body = await response.json()
        } catch (error) {
          body = null
        }
        if (!response.ok) return { failed: true, status: response.status, body }
        return { body }
      } catch (error) {
        return { failed: true, status: 0, body: null }
      } finally {
        clearTimeout(timer)
      }
    }

    function statusTextOf(round) {
      const words = copy()
      if (round === null || round === undefined) return words.status.unknown
      const key = round.statusKey
      if (typeof key === 'string' && Object.prototype.hasOwnProperty.call(words.status, key)) return words.status[key]
      const line = round.statusLine
      return typeof line === 'string' && line !== '' ? line : words.status.unknown
    }

    // State pill colour follows the chosen status, not the elapsed time.
    function toneOfStatus(key) {
      if (key === 'running' || key === 'checking' || key === 'waiting') return 'active'
      if (key === 'needs-input' || key === 'failing') return 'warn'
      if (key === 'disconnected') return 'error'
      return 'neutral'
    }

    function verifyTextOf(round) {
      const words = copy()
      const state = round === null || round === undefined ? undefined : round.verificationState
      if (typeof state === 'string' && Object.prototype.hasOwnProperty.call(words.verify, state)) return words.verify[state]
      return words.verify.unknown
    }

    // Colour follows the result, never the kind of work that carried it.
    function toneOfItem(item, source) {
      const tone = item === null || item === undefined ? undefined : item.tone
      const allowed = tone === 'error' || tone === 'warn' || tone === 'success' ? tone : 'neutral'
      if (allowed !== 'success') return allowed
      const round = source === null || source === undefined ? undefined : source.round !== undefined ? source.round : source
      const verificationState = round === null || round === undefined ? undefined : round.verificationState
      if (verificationState !== 'failed') return allowed
      const verification = source === null || source === undefined ? undefined : source.verification
      const conditions = verification !== null && verification !== undefined && Array.isArray(verification.conditions)
        ? verification.conditions
        : []
      const text = String(item.text === undefined || item.text === null ? '' : item.text)
      for (const condition of conditions) {
        const topic = String(condition.text === undefined || condition.text === null ? '' : condition.text)
        if (condition.state === 'failed' && topic !== '' && text.indexOf(topic) !== -1) return 'error'
      }
      return allowed
    }

    function qualifierOf(item) {
      const limit = item.limit
      if (typeof limit !== 'string' || limit === '') return ''
      return limit
    }

    // Evidence that arrived with the item itself: no request, no second opinion.
    function inlineEvidenceOf(item) {
      const rows = item === null || item === undefined || !Array.isArray(item.evidence) ? [] : item.evidence
      const out = []
      for (const row of rows) {
        if (row === null || row === undefined) continue
        const label = row.label === undefined || row.label === null ? '' : String(row.label)
        const value = row.text === undefined || row.text === null ? '' : String(row.text)
        if (label === '' && value === '') continue
        out.push({ label, text: value })
      }
      return out
    }

    function paragraphsOf(item) {
      const detail = Array.isArray(item.detail) ? item.detail : []
      const lines = []
      for (const row of detail) {
        if (row === null || row === undefined) continue
        const value = row.value === undefined || row.value === null ? '' : String(row.value)
        const label = row.label === undefined || row.label === null ? '' : String(row.label)
        if (value === '' && label === '') continue
        lines.push(label === '' ? value : `${label}：${value}`)
      }
      return lines
    }

    function itemKeyOf(roundId, item) {
      const id = item === null || item === undefined || item.id === undefined || item.id === null ? String(item.title) : String(item.id)
      const round = roundId === undefined || roundId === null ? '' : String(roundId)
      return `${round}:${id}`
    }

    // A title is checked again here so one missed path can never put
    // `<goal_round>` on screen.
    const emptyWordOf = (round, words) => round !== null && round !== undefined && round.roundState !== 'archived' ? words.inProgress : words.nothingYet

    // One line per round, shared by the history list and the preview on the
    // current page so both always say the same thing about the same round.
    // A row earns its place by naming a result. Rounds whose only line is a
  // count, a caveat or a status repeat the ceremony the reader is trying to
  // skip, so the list leaves them out instead of printing filler.
  const substantiveOf = (row) => {
    // A round the reader asked for is a row on its own: the request is the
    // thing they will look for, and the body carries what came of it.
    if (row?.titleSource === 'user') return titleOf(row) !== copy().untitled
    const outcome = String(row?.outcome ?? '').trim()
    if (outcome === '' || outcome.length < 8) return false
    if (/^[0-9]+[.、)]/u.test(outcome)) return false
    if (/^(?:本轮|这一轮|又|继续|之前|为什么|验证了|已保存|三个|两个|一个|重读|它|这|那|其|此|因此|所以|但|而|【)/u.test(outcome)) return false
    if (/(?:硬理由|查清了原因|日志里有|原因已查|先说|先说结论)/u.test(outcome)) return false
    if (/(?:=>|[a-z]+\.[a-z]+\()/u.test(outcome)) return false
    if (!/[\u4e00-\u9fff]/u.test(outcome) && outcome.length > 12) return false
    if (/(?:没留下结论|没有部署|没有重启|只做了|只做|新增(?:了)?[0-9一二三四五六七八九十两几]*\s*(?:个)?能力|提交了|改了几个文件|跑了一遍|分两层)/u.test(outcome)) return false
    return true
  }
  const primaryOf = (row, sessionTitle, words) => {
      // A history row answers "what did I ask here", because that is the only
      // thing the reader can match against their own memory. The result lives
      // inside the row. Older saved rounds carry no request, so they keep the
      // rule-derived outcome rather than a reply sentence pretending to be one.
      const asked = row?.titleSource === 'user' ? titleOf(row) : ''
      if (asked !== '' && asked !== sessionTitle && asked !== copy().untitled) return asked
      const outcome = String(row?.outcome ?? '')
      if (outcome !== '') return outcome
      if (row?.hasReply === false) return words.unanswered
      return primaryTitleOf(row, sessionTitle) === sessionTitle ? words.noSummary : primaryTitleOf(row, sessionTitle)
    }

    const primaryTitleOf = (row, sessionTitle) => {
      const own = titleOf(row)
      return own === sessionTitle ? sessionTitle : own
    }

    function titleOf(round) {
      const title = round === null || round === undefined ? undefined : round.title
      const raw = typeof title === 'string' ? title : ''
      const text = raw.replace(/<[^<>\n]{0,80}>/gu, ' ').replace(/\s+/gu, ' ').trim()
      const clean = /[<>]/u.test(text) ? '' : text
      return clean === '' ? copy().untitled : clean
    }

    function metaOf(round, now) {
      const words = copy()
      if (round === null || round === undefined) return []
      const parts = []
      const status = statusTextOf(round)
      if (status !== '') parts.push(status)
      if (typeof round.elapsedMs === 'number') parts.push(`${words.elapsed} ${durationOf(round.elapsedMs)}`)
      const at = typeof round.contentAt === 'number' && round.contentAt > 0
        ? round.contentAt
        : typeof round.archivedAt === 'number' && round.archivedAt > 0 ? round.archivedAt : 0
      if (at > 0) parts.push(`${words.updated} ${timeOf(at, now)}`)
      const verify = round.roundState === 'archived' && round.verificationState === 'recheck'
        ? ''
        : verifyTextOf(round)
      if (verify !== '') parts.push(verify)
      return parts
    }

    function BriefItem(props) {
      const words = copy()
      const item = props.item
      const tone = props.tone
      const label = typeof item.label === 'string' ? item.label.trim() : ''
      const value = typeof item.value === 'string' ? item.value : ''
      if (label !== '') {
        return h('div', { className: 'ov-item ov-fact', 'data-item-key': props.itemKey }, [
          h('span', { key: 'l', className: 'ov-fact-label' }, label),
          h('span', { key: 'v', className: 'ov-fact-value' }, value)
        ])
      }
      const paragraphs = paragraphsOf(item)
      const qualifier = qualifierOf(item)
      const inline = inlineEvidenceOf(item)
      const hasInline = inline.length > 0
      const bodyChildren = []
      paragraphs.forEach((line, index) => {
        bodyChildren.push(h('p', { key: `p${index}` }, line))
      })
      if (hasInline) {
        bodyChildren.push(h('details', {
          key: 'ev',
          className: 'ov-evidence',
          open: props.evidenceOpen === true,
          onToggle: (event) => props.onEvidence(props.itemKey, event.currentTarget.open)
        }, [
          h('summary', { key: 's' }, words.evidence),
          h('div', { key: 'b', className: 'ov-source' }, inline.map((row, index) => h('div', { key: `r${index}` }, [
            row.label === '' ? null : h('p', { key: 'l' }, row.label),
            row.text === '' ? null : h('p', { key: 'x' }, row.text)
          ])))
        ]))
      }
      const link = item.link !== null && typeof item.link === 'object' ? item.link : null
      const fileIcon = h('svg', {
        key: 'i', className: 'ov-file-icon', viewBox: '0 0 16 16', width: 16, height: 16,
        fill: 'none', stroke: 'currentColor', strokeWidth: 1.4, 'aria-hidden': 'true'
      }, [
        h('path', { key: 'p', d: 'M4 1.75h5L13 5.75v8.5H4z' }),
        h('path', { key: 'f', d: 'M9 1.75v4h4' })
      ])
      const title = h('span', { key: 't' }, [
        link === null
          ? h('span', { key: 'h', className: 'ov-item-title' }, item.text)
          : h('button', { key: 'h', className: 'ov-item-link', type: 'button', onClick: () => props.onOpenLink(link) }, [
            fileIcon,
            h('span', { key: 'x', className: 'ov-item-link-text' }, item.text),
            h('span', { key: 'a', className: 'ov-item-link-arrow', 'aria-hidden': 'true' }, '↗')
          ]),
        qualifier === '' ? null : h('span', { key: 'q', className: 'ov-item-qualifier', 'data-tone': tone }, qualifier)
      ])
      if (bodyChildren.length === 0 && link !== null) {
        // A row that opens a delivered file is a control, not a disclosure.
        return h('div', { className: 'ov-item ov-item-flat', 'data-item-key': props.itemKey }, title)
      }
      if (bodyChildren.length === 0) {
        // A conclusion with nothing under it states itself and promises no more.
        return h('div', { className: 'ov-item ov-item-static', 'data-item-key': props.itemKey }, [
          h('span', { key: 's', className: 'ov-item-static-title' }, title)
        ])
      }
      return h('details', {
        className: 'ov-item',
        'data-item-key': props.itemKey,
        open: props.open === true,
        onToggle: (event) => props.onToggle(props.itemKey, event.currentTarget.open)
      }, [
        h('summary', { key: 's' }, [
          title,
          h('span', { key: 'c', className: 'ov-chevron', 'aria-hidden': 'true' }, '›')
        ]),
        h('div', { key: 'b', className: 'ov-item-body' }, bodyChildren)
      ])
    }

    function Notice(props) {
      const text = props.text
      if (typeof text !== 'string' || text === '') return null
      return h('p', { className: 'ov-notice' }, text)
    }

    function View(props) {
      ensureStyle()
      const sessionId = props.sessionId

      React.useEffect(() => {
        const root = document.documentElement
        root.setAttribute('data-dsv-overview', '')
        return () => {
          root.removeAttribute('data-dsv-overview')
        }
      }, [])

      const [snapshot, setSnapshot] = React.useState(null)
      const [blocked, setBlocked] = React.useState(false)
      const [failed, setFailed] = React.useState(false)
      const [loading, setLoading] = React.useState(true)
      const [view, setView] = React.useState({ mode: 'current', roundId: '' })
      const [history, setHistory] = React.useState(null)
      const [historyFailed, setHistoryFailed] = React.useState(false)
      const [historyLoading, setHistoryLoading] = React.useState(false)
      const [round, setRound] = React.useState(null)
      const [roundFailed, setRoundFailed] = React.useState(false)
      const [pending, setPending] = React.useState(false)
      const [notice, setNotice] = React.useState('')
      const [, setTick] = React.useState(0)

      const revisionRef = React.useRef(null)
      const aliveRef = React.useRef(true)
      const seqRef = React.useRef({})
      const retryRef = React.useRef(0)
      const retryTimer = React.useRef(null)
      const loadHolder = React.useRef(null)
      const expandedRef = React.useRef(new Set())
      const evidenceOpenRef = React.useRef({})
      const itemRef = React.useRef({})
      const rootRef = React.useRef(null)
      const listScrollRef = React.useRef(0)
      // 历史 means the rounds before the one on screen, so the shown round is
      // asked out of every page, including pages loaded later.
      const shownRoundRef = React.useRef('')

      // One monotonic counter per channel: an answer to an older question must
      // never overwrite a newer one, and nothing lands after unmount.
      const claim = React.useCallback((channel) => {
        if (aliveRef.current !== true) return null
        const next = (seqRef.current[channel] === undefined ? 0 : seqRef.current[channel]) + 1
        seqRef.current[channel] = next
        return () => aliveRef.current === true && seqRef.current[channel] === next
      }, [])

      React.useEffect(() => {
        return () => {
          aliveRef.current = false
        }
      }, [])

      React.useEffect(() => {
        return subscribeLocale(() => {
          setTick((value) => value + 1)
        })
      }, [])

      const scheduleRetry = () => {
        if (retryRef.current >= 4) return
        retryRef.current += 1
        if (retryTimer.current !== null) clearTimeout(retryTimer.current)
        retryTimer.current = setTimeout(() => {
          retryTimer.current = null
          if (aliveRef.current !== true) return
          const again = loadHolder.current
          if (typeof again === 'function') again(true)
        }, 400 * retryRef.current * retryRef.current)
      }

      const load = React.useCallback(async (force) => {
        const fresh = claim('snapshot')
        if (fresh === null) return
        if (typeof sessionId !== 'string' || sessionId === '') {
          setLoading(true)
          setFailed(false)
          scheduleRetry()
          return
        }
        const query = new URLSearchParams({ session: sessionId })
        if (!force && revisionRef.current !== null) query.set('revision', revisionRef.current)
        const answer = await callHost(`/snapshot?${query.toString()}`)
        if (fresh() !== true) return
        if (answer.blocked === true) {
          setBlocked(true)
          setLoading(false)
          return
        }
        if (answer.failed === true || answer.body === null) {
          setFailed(true)
          setLoading(false)
          scheduleRetry()
          return
        }
        if (retryTimer.current !== null) clearTimeout(retryTimer.current)
        retryTimer.current = null
        retryRef.current = 0
        setBlocked(false)
        setFailed(false)
        setLoading(false)
        if (answer.body.kind === 'unchanged') return
        revisionRef.current = answer.body.revision
        shownRoundRef.current = typeof answer.body.round?.roundId === 'string' ? answer.body.round.roundId : ''
        setSnapshot(answer.body)
      }, [claim, sessionId])

      React.useEffect(() => {
        revisionRef.current = null
        setSnapshot(null)
        setHistory(null)
        setHistoryFailed(false)
        setHistoryLoading(false)
        setRound(null)
        setRoundFailed(false)
        evidenceOpenRef.current = {}
        expandedRef.current = new Set()
        itemRef.current = {}
        setView({ mode: 'current', roundId: '' })
        setNotice('')
        setPending(false)
        retryRef.current = 0
        if (retryTimer.current !== null) clearTimeout(retryTimer.current)
        retryTimer.current = null
        load(true)
      }, [load])

      React.useEffect(() => {
        loadHolder.current = load
        return () => {
          if (retryTimer.current !== null) clearTimeout(retryTimer.current)
          retryTimer.current = null
        }
      }, [load])

      React.useEffect(() => {
        const tickOnce = () => {
          if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return
          load(false)
        }
        const poll = setInterval(tickOnce, POLL_MS)
        const onVisibility = () => {
          if (document.visibilityState === 'visible') load(false)
        }
        document.addEventListener('visibilitychange', onVisibility)
        return () => {
          clearInterval(poll)
          document.removeEventListener('visibilitychange', onVisibility)
        }
      }, [load])

      const coverageEnabled = snapshot !== null && snapshot.coverage !== null && snapshot.coverage !== undefined
        ? snapshot.coverage.enabled === true
        : false

      const scrollHost = () => {
        let node = rootRef.current
        while (node !== null && node !== undefined && node !== document.body) {
          const overflow = getComputedStyle(node).overflowY
          if (overflow === 'auto' || overflow === 'scroll') return node
          node = node.parentElement
        }
        return document.scrollingElement
      }

      const openRound = async (roundId) => {
        const id = String(roundId === null || roundId === undefined ? '' : roundId)
        // The current round is already in the snapshot; opening it in the
        // history list is only a fold, never another request.
        const liveId = snapshot !== null && snapshot.round !== null && snapshot.round !== undefined ? snapshot.round.roundId : ''
        if (id !== '' && id === liveId) {
          setView({ mode: view.mode, roundId: view.roundId === id ? '' : id, from: '' })
          return
        }
        if (view.mode === 'history' && view.roundId === id) {
          setView({ mode: 'history', roundId: '', from: '' })
          setRound(null)
          setRoundFailed(false)
          return
        }
        setView({ mode: 'history', roundId: id, from: '' })
        setRound(null)
        setRoundFailed(false)
        const fresh = claim('round')
        if (fresh === null) return
        if (id === '') {
          setRoundFailed(true)
          return
        }
        const query = new URLSearchParams({ session: sessionId, round: id })
        const answer = await callHost(`/round?${query.toString()}`)
        if (fresh() !== true) return
        if (answer.failed === true || answer.body === null || answer.body.round === null || answer.body.round === undefined) {
          setRoundFailed(true)
          return
        }
        setRound(answer.body.round)
      }

      const fetchHistory = async (cursor, append) => {
        const fresh = claim('history')
        if (fresh === null) return
        setHistoryLoading(true)
        setHistoryFailed(false)
        const query = new URLSearchParams({ session: sessionId, limit: String(HISTORY_PAGE) })
        if (typeof cursor === 'string' && cursor !== '') query.set('cursor', cursor)
        if (shownRoundRef.current !== '') query.set('exclude', shownRoundRef.current)
        const answer = await callHost(`/history?${query.toString()}`)
        if (fresh() !== true) return
        setHistoryLoading(false)
        if (answer.failed === true || answer.body === null || !Array.isArray(answer.body.items)) {
          setHistoryFailed(true)
          return
        }
        const nextCursor = typeof answer.body.nextCursor === 'string' ? answer.body.nextCursor : ''
        const seen = new Set()
        const items = []
        for (const item of (append === true && history !== null ? history.items : []).concat(answer.body.items)) {
          const key = item !== null && item !== undefined && item.roundId !== undefined && item.roundId !== null ? String(item.roundId) : ''
          if (key !== '' && seen.has(key)) continue
          if (key !== '') seen.add(key)
          items.push(item)
        }
        setHistory({ items, nextCursor })
        return { items, nextCursor }
      }

      // Scrolling up in the history list asks for the previous page; the list
      // starts with the newest rounds already on screen, so no button is needed.
      React.useEffect(() => {
        if (view.mode !== 'history') return undefined
        const node = scrollHost()
        if (node === null || node === undefined) return undefined
        const onScroll = () => {
          if (node.scrollTop > 12) return
          if (historyLoading === true || history === null) return
          const cursor = typeof history.nextCursor === 'string' ? history.nextCursor : ''
          if (cursor === '') return
          fetchHistory(cursor, true)
        }
        node.addEventListener('scroll', onScroll, { passive: true })
        onScroll()
        return () => node.removeEventListener('scroll', onScroll)
      }, [view.mode, history, historyLoading])

      const applyExpanded = (itemKey, open) => {
        if (open === true) expandedRef.current.add(itemKey)
        else expandedRef.current.delete(itemKey)
      }

      const applyEvidenceOpen = (itemKey, open) => {
        // Whether a reader opened one basis survives redraws; the rows themselves
        // arrive with the brief, so there is nothing else to keep.
        evidenceOpenRef.current[itemKey] = open === true
        setTick((value) => value + 1)
      }

      const openLink = async (link) => {
        if (link === null || link === undefined) return
        const path = typeof link.path === 'string' ? link.path : ''
        const url = typeof link.url === 'string' ? link.url : ''
        if (path === '' && url === '') return
        const answer = await callHost('/open', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(path === '' ? { session: sessionId, url } : { session: sessionId, path })
        })
        if (answer.failed === true || answer.blocked === true) setNotice(copy().openFailed)
      }

      const publishItems = (roundId, items) => {
        for (const item of items) {
          itemRef.current[itemKeyOf(roundId, item)] = { factIds: item.factIds, roundId, inline: inlineEvidenceOf(item).length > 0 }
        }
      }

      const showHistory = () => {
        // The round on screen stays first and open; older rounds page in below
        // it, so switching tabs never loses where the reader was.
        const liveId = snapshot !== null && snapshot.round !== null && snapshot.round !== undefined ? snapshot.round.roundId : ''
        setView({ mode: 'history', roundId: liveId, from: '' })
        setRound(null)
        setRoundFailed(false)
        setTick((value) => value + 1)
        if (history === null) fetchHistory('', false)
      }

      const showCurrent = () => {
        setView({ mode: 'current', roundId: '', from: '' })
        setRound(null)
        setRoundFailed(false)
      }

      const toggleSwitch = async () => {
        if (pending === true || snapshot === null) return
        const wanted = coverageEnabled !== true
        setPending(true)
        setNotice('')
        const answer = await callHost('/enable', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ session: sessionId, enabled: wanted })
        })
        setPending(false)
        if (answer.blocked === true) {
          setNotice(copy().blocked)
          return
        }
        if (answer.failed === true) {
          // The visual never moved: the answer from the server is the truth.
          setNotice(copy().switchFailed)
          load(true)
          return
        }
        if (answer.body !== null && answer.body !== undefined && answer.body.enabled === wanted) {
          setView({ mode: 'current', roundId: '' })
          load(true)
          return
        }
        setNotice(copy().switchFailed)
        load(true)
      }

      const onPanelClick = (event) => {
        const target = event.target
        if (target === null || target === undefined || typeof target.closest !== 'function') return
        const control = target.closest('[data-action]')
        if (control === null || control === undefined) return
        const action = control.getAttribute('data-action')
        if (action === 'toggle-switch') {
          event.preventDefault()
          toggleSwitch()
          return
        }
        if (action === 'history') {
          event.preventDefault()
          showHistory()
          return
        }
        if (action === 'current') {
          event.preventDefault()
          showCurrent()
          return
        }
        if (action === 'open-round') {
          event.preventDefault()
          openRound(control.getAttribute('data-round'))
          return
        }
        if (action === 'open-recent') {
          event.preventDefault()
          showHistory()
          openRound(control.getAttribute('data-round'))
          return
        }
        if (action === 'history-more') {
          event.preventDefault()
          if (history !== null && typeof history.nextCursor === 'string' && history.nextCursor !== '') {
            fetchHistory(history.nextCursor, true)
          }
          return
        }
        if (action === 'open-path') {
          event.preventDefault()
          openLink({ path: control.getAttribute('data-path') })
          return
        }
        if (action === 'open-url') {
          event.preventDefault()
          openLink({ url: control.getAttribute('data-url') })
          return
        }
        if (action === 'retry') {
          event.preventDefault()
          setFailed(false)
          setLoading(true)
          retryRef.current = 0
          load(true)
        }
      }

      // ---- render ----------------------------------------------------------
      const now = Date.now()
      const words = copy()
      const mode = view.mode

      const coverage = snapshot !== null && snapshot.coverage !== null && snapshot.coverage !== undefined ? snapshot.coverage : null
      const readOnly = coverage !== null && coverage.readOnly === true
      const archived = coverage !== null && coverage.archived === true
      const sessionTitle = snapshot !== null && typeof snapshot.sessionTitle === 'string' ? snapshot.sessionTitle : ''
      const liveRound = snapshot !== null && snapshot.round !== null && snapshot.round !== undefined ? snapshot.round : null
      const pill = archived === true
        ? { text: words.archived, tone: 'neutral' }
        : coverageEnabled === true && mode === 'current' && liveRound !== null
          ? { text: statusTextOf(liveRound), tone: toneOfStatus(liveRound.statusKey) }
          : { text: '', tone: 'neutral' }

      const controls = [
        pill.text === '' ? null : h('span', { key: 'p', className: 'ov-state', 'data-tone': pill.tone }, pill.text),
        archived === true ? null : h('button', {
          key: 'switch', type: 'button', role: 'switch', className: 'ov-switch',
          'aria-checked': coverageEnabled === true ? 'true' : 'false', 'aria-label': words.switchLabel,
          'data-action': 'toggle-switch', disabled: pending === true || snapshot === null
        }, [
          h('span', { key: 'l' }, words.switchLabel),
          h('span', { key: 't', className: 'ov-switch-track', 'aria-hidden': 'true' }, [
            h('span', { key: 'k', className: 'ov-switch-knob' })
          ])
        ]),
        h('div', { key: 'seg', className: 'ov-seg', role: 'tablist' }, [
          h('button', {
            key: 'c', type: 'button', role: 'tab', className: 'ov-seg-item',
            'aria-selected': mode === 'current' ? 'true' : 'false',
            'data-action': 'current'
          }, words.currentTab),
          h('button', {
            key: 'h', type: 'button', role: 'tab', className: 'ov-seg-item',
            'aria-selected': mode === 'history' ? 'true' : 'false',
            'data-action': 'history'
          }, words.historyTab)
        ])
      ]

      const header = h('header', { key: 'h', className: 'ov-toolbar' }, [
        h('div', { key: 'm', className: 'ov-head' }, [
          h('div', { key: 't', className: 'ov-session-title' }, sessionTitle === '' ? words.contextCurrent : sessionTitle)
        ]),
        h('div', { key: 's', className: 'ov-controls' }, controls)
      ])

      const briefRows = (target, skip) => {
        const sealed = target?.brief !== null && target?.brief !== undefined && Array.isArray(target.brief.items) ? target.brief.items : []
        // A raw reply is a transcript, not a brief: the row already carries
        // the one-line outcome, and printing the whole answer here is exactly
        // the wall of prose this page exists to avoid.
        const same = (text) => String(text).replace(/[\s。！？；：，、.!?;:,]/gu, '') === String(skip).replace(/[\s。！？；：，、.!?;:,]/gu, '')
        const rows = sealed.filter((item) => item !== null && item !== undefined && item.id !== 'no-facts' && item.source !== 'transcript' && !(skip !== undefined && same(item.text ?? item.value ?? '')))
        publishItems(target.roundId, rows)
        if (rows.length === 0) return null
        return h('div', { key: 'b', className: 'ov-brief' }, rows.map((item, index) => {
          const key = itemKeyOf(target.roundId, item)
          return h(BriefItem, {
            key: `${key}:${index}`, item, itemKey: key, roundId: target.roundId,
            tone: toneOfItem(item, target), open: expandedRef.current.has(key),
            evidenceOpen: evidenceOpenRef.current[key] === true,
            onToggle: applyExpanded, onEvidence: applyEvidenceOpen, onOpenLink: openLink
          })
        }))
      }

      const main = []

      if (blocked === true) {
        main.push(h('div', { key: 'q', className: 'ov-quiet' }, [
          h('div', { key: 't', className: 'ov-quiet-title' }, words.blocked)
        ]))
      } else if (mode === 'current' && failed === true && snapshot === null) {
        main.push(h('div', { key: 'q', className: 'ov-quiet' }, [
          h('div', { key: 't', className: 'ov-quiet-title' }, words.failed),
          h('button', { key: 'r', type: 'button', className: 'ov-control-link ov-back', 'data-action': 'retry' }, words.retry)
        ]))
      } else if (mode === 'history') {
        const live = snapshot !== null && snapshot.round !== null && snapshot.round !== undefined ? snapshot.round : null
        const liveId = live === null ? '' : String(live.roundId)
        const source = history !== null && Array.isArray(history.items)
          ? history.items.filter(substantiveOf)
          : (snapshot !== null && snapshot.history !== null && snapshot.history !== undefined && Array.isArray(snapshot.history.items) ? snapshot.history.items : [])
        const parts = []
        const card = (key, titleText, timeText, open, canOpen, bodyNode) => h('div', { key, className: 'ov-history-item', 'data-open': open === true ? '' : undefined }, [
          canOpen
            ? h('button', {
              key: 'row', type: 'button', className: 'ov-history-row',
              'data-action': 'open-round', 'data-round': key,
              'aria-expanded': open === true ? 'true' : 'false'
            }, [
              h('span', { key: 't', className: 'ov-history-title' }, titleText),
              timeText === '' ? null : h('span', { key: 'a', className: 'ov-history-time' }, timeText),
              h('span', { key: 'c', className: 'ov-row-chevron', 'aria-hidden': 'true' }, '›')
            ])
            : h('div', { key: 'row', className: 'ov-history-row ov-history-row-static' }, [
              h('span', { key: 't', className: 'ov-history-title' }, titleText),
              timeText === '' ? null : h('span', { key: 'a', className: 'ov-history-time' }, timeText)
            ]),
          open === false ? null : h('div', { key: 'd', className: 'ov-round-body' }, bodyNode)
        ])

        // The round being read leads the list and starts open: switching tabs
        // must not make the reader hunt for the card they just left.
        if (live !== null) {
          const open = view.roundId === '' || view.roundId === liveId
          const summaryText = snapshot !== null && typeof snapshot.summaryText === 'string' ? snapshot.summaryText.trim() : ''
          const sealed = open === true ? briefRows(live, '') : null
          const bodyNode = sealed !== null
            ? h('div', { key: 'c', className: 'ov-card' }, [
              summaryText === '' ? null : h('p', { key: 's', className: 'ov-summary-text' }, summaryText),
              sealed
            ])
            : summaryText === ''
              ? null
              : h('p', { key: 's', className: 'ov-summary-text' }, summaryText)
          const bodyOpen = bodyNode !== null
          parts.push(card(liveId, titleOf(live) || words.currentTab, timeOf(live.updatedAt, now), bodyOpen && open, bodyOpen, bodyNode))
        }

        const rows = source.filter((row) => row !== null && row !== undefined && String(row.roundId) !== liveId)
        if (rows.length === 0 && live === null) {
          parts.push(h('div', { key: 'e', className: 'ov-sub' }, historyLoading === true ? words.historyLoading : words.historyEmpty))
        }
        parts.push(h('div', { key: 'r', className: 'ov-history-list' }, rows.map((row, index) => {
          const primary = primaryOf(row, sessionTitle, words)
          const key = row.roundId === undefined || row.roundId === null ? `r${index}` : String(row.roundId)
          const open = view.roundId === key
          const detail = typeof row.detail === 'string' ? row.detail.trim() : ''
          const canOpen = detail !== '' || (row.hasDetail !== false && row.hasReply === true)
          const loaded = open === true ? round : null
          const bodyNode = open === false ? null
            : roundFailed === true
              ? h('div', { key: 'f', className: 'ov-sub' }, words.detailFailed)
              : loaded === null
                ? h('div', { key: 'l', className: 'ov-sub' }, words.loading)
                : (() => {
                  const summaryText = typeof loaded.summaryText === 'string' ? loaded.summaryText.trim() : ''
                  const sealed = briefRows(loaded, primary)
                  if (sealed !== null) {
                    return h('div', { key: 'b', className: 'ov-card' }, [
                      summaryText === '' ? null : h('p', { key: 's', className: 'ov-summary-text' }, summaryText),
                      sealed
                    ])
                  }
                  return detail === '' ? null : h('div', { key: 'b', className: 'ov-brief' }, h('p', { key: 'p', className: 'ov-history-detail' }, detail))
                })()
          return card(key, primary, timeOf(row.archivedAt, now), open, canOpen, bodyNode)
        })))
        if (historyLoading === true && source.length > 0) parts.push(h('div', { key: 'l', className: 'ov-sub' }, words.historyLoading))
        if (historyFailed === true) parts.push(h('div', { key: 'f', className: 'ov-sub' }, words.historyFailed))
        main.push(h('div', { key: 'body' }, parts))
      } else if (loading === true && snapshot === null) {
        main.push(h('div', { key: 'q', className: 'ov-quiet' }, [h('p', { key: 'p' }, words.loading)]))
      } else if (coverageEnabled !== true && !(snapshot !== null && snapshot.round !== null && snapshot.round !== undefined)) {
        main.push(h('div', { key: 'q', className: 'ov-quiet' }, [
          h('div', { key: 't', className: 'ov-quiet-title' }, words.disabledTitle),
          h('p', { key: 'b' }, words.disabledBody)
        ]))
      } else {
        const roundOfSnapshot = snapshot !== null && snapshot.round !== undefined ? snapshot.round : null
        const goal = snapshot !== null && snapshot.goal !== null && snapshot.goal !== undefined ? snapshot.goal : null
        const past = snapshot !== null && snapshot.history !== null && snapshot.history !== undefined ? snapshot.history : null
        const pastCount = past !== null && typeof past.count === 'number' ? past.count : 0
        const body = []
        if (roundOfSnapshot === null) {
          body.push(h('h1', { key: 't', className: 'ov-headline' }, words.untitled))
          body.push(h('div', { key: 'e', className: 'ov-summary' }, emptyWordOf(roundOfSnapshot, words)))
        } else {
          const brief = snapshot.brief !== null && snapshot.brief !== undefined ? snapshot.brief : null
          const rawItems = brief !== null && Array.isArray(brief.items) ? brief.items : []
          const items = rawItems.filter((item) => item !== null && item !== undefined && item.id !== 'no-facts')
          publishItems(roundOfSnapshot.roundId, items)
          const updated = timeOf(roundOfSnapshot.contentAt, now)
          const ownTitle = typeof roundOfSnapshot.ownTitle === 'string' ? roundOfSnapshot.ownTitle.trim() : ''
          const roundLabel = words.currentRound
          // A heading that only repeats the conversation title tells the reader
          // nothing, so the label stands on its own instead.
          const named = ownTitle !== '' && ownTitle !== sessionTitle
          body.push(h('div', { key: 'rb', className: 'ov-roundbar' }, [
            h('span', { key: 'l', className: 'ov-round-label' }, named ? `${roundLabel} · ${ownTitle}` : roundLabel),
            updated === '' ? null : h('span', { key: 'u', className: 'ov-round-label' }, `${words.updated} ${updated}`)
          ]))
          // A Goal objective describes the whole session, not this round: printing
          // it here made an unrelated goal read as the answer to this ask.
          const roundTitle = titleOf(roundOfSnapshot)
          if (roundTitle !== sessionTitle) body.push(h('h1', { key: 't', className: 'ov-headline' }, roundTitle))
          const summaryText = typeof snapshot.summaryText === 'string' ? snapshot.summaryText.trim() : ''
          if (summaryText !== '') body.push(h('p', { key: 'sm', className: 'ov-summary-text' }, summaryText))
          const notices = Array.isArray(snapshot.notices) ? snapshot.notices : []
          notices.forEach((entry, index) => {
            body.push(h(Notice, { key: `n${index}`, text: entry === null || entry === undefined ? '' : entry.text }))
          })
          if (items.length > 0) {
            const conclusionOnly = items.every((item) => item !== null && item !== undefined && item.source === 'transcript')
            // A quoted reply labels itself; a section heading above it would read
            // as two headings for one line.
            if (!conclusionOnly) body.push(h('div', { key: 'ml', className: 'ov-section-label' }, words.milestones))
            body.push(h('div', { key: 'b', className: 'ov-brief' }, items.map((item, index) => {
              const key = itemKeyOf(roundOfSnapshot.roundId, item)
              return h(BriefItem, {
                key: `${key}:${index}`, item, itemKey: key, roundId: roundOfSnapshot.roundId,
                tone: toneOfItem(item, snapshot), open: expandedRef.current.has(key),
                evidenceOpen: evidenceOpenRef.current[key] === true,
                onToggle: applyExpanded, onEvidence: applyEvidenceOpen, onOpenLink: openLink
              })
            })))
          }
          const seen = new Set(items.map((item) => String(item.text === undefined || item.text === null ? '' : item.text)))
          const outputs = snapshot.outcomes !== null && snapshot.outcomes !== undefined && Array.isArray(snapshot.outcomes.items)
            ? snapshot.outcomes.items.filter((item) => {
              if (item === null || item === undefined) return false
              const text = String(item.text ?? '')
              if (text === '' || seen.has(text)) return false
              seen.add(text)
              return true
            })
            : []
          if (outputs.length > 0) {
            body.push(h('div', { key: 'al', className: 'ov-section-label' }, words.artifacts))
            body.push(h('div', { key: 'o', className: 'ov-brief' }, outputs.map((item, index) => {
              const text = String(item.text)
              const rawLink = item.link !== null && item.link !== undefined ? item.link : null
              const link = rawLink !== null && typeof rawLink.path === 'string' && rawLink.path !== ''
                ? rawLink
                : rawLink !== null && typeof rawLink.url === 'string' && rawLink.url !== '' ? rawLink : null
              return h(link === null ? 'div' : 'button', {
                key: `out:${index}`,
                type: link === null ? undefined : 'button',
                className: 'ov-output-row',
                'data-action': link === null ? undefined : typeof link.path === 'string' ? 'open-path' : 'open-url',
                'data-path': link === null || typeof link.path !== 'string' ? undefined : link.path,
                'data-url': link === null || typeof link.url !== 'string' ? undefined : link.url
              }, [
                h('span', { key: 't', className: 'ov-output-text' }, text),
                link === null ? null : h('span', { key: 'a', className: 'ov-output-arrow', 'aria-hidden': 'true' }, '›')
              ])
            })))
          }
          // Past rounds live behind their own tab; the current tab shows this
          // round alone so the two controls never present the same list twice.
          if (pastCount > 0) {
            body.push(h('button', { key: 'h', type: 'button', className: 'ov-history-more', 'data-action': 'history' }, [
              h('span', { key: 't' }, `${words.historyHeading} · ${pastCount} ${words.roundUnit}`),
              h('span', { key: 'a', className: 'ov-output-arrow', 'aria-hidden': 'true' }, '›')
            ]))
          }
        }
        main.push(h('div', { key: 'body' }, body))
      }
      if (notice !== '') main.push(h(Notice, { key: 'notice', text: notice }))

      return h('section', { className: 'dsv-panel', onClick: onPanelClick, ref: rootRef }, [
        h('div', { key: 'p', className: 'ov-panel' }, [header, h('main', { key: 'm' }, main)])
      ])
    }

    function registerLocale(ctx) {
      const locale = ctx === null || ctx === undefined ? undefined : ctx.locale
      if (locale === null || locale === undefined || typeof locale.register !== 'function') return
      try {
        locale.register(NAMESPACE, { zh: COPY.zh, en: COPY.en })
      } catch (error) {}
    }

    // The Cordis context proxy throws on a property that the plugin did not
    // declare in `inject`, and `effect` is a built-in, not an injectable
    // service. Probe it defensively: reading it is what throws.
    function contextEffect(ctx) {
      try {
        const effect = ctx === null || ctx === undefined ? undefined : ctx.effect
        return typeof effect === 'function' ? effect : null
      } catch (error) {
        return null
      }
    }

    function apply(ctx) {
      registerLocale(ctx)
      LANG = langOf(ctx)
      const locale = ctx === null || ctx === undefined ? undefined : ctx.locale
      const effect = contextEffect(ctx)
      if (locale !== null && locale !== undefined && typeof locale.subscribe === 'function' && effect !== null) {
        try {
          effect.call(ctx, () => locale.subscribe(() => {
            LANG = langOf(ctx)
            notifyLocale()
          }), 'dsh-vantage-locale')
        } catch (error) {}
      }
      LANG = langOf(ctx)
      // `conversation.view` passes `sessionId` as a standard prop, so the View
      // reads it directly. Registration is declared through `slots.inject` so
      // the loader's entry graph accepts this plugin as a contributor.
      ctx.slots.inject('conversation.view', () => ctx.slots.register({
        name: 'conversation.view',
        id: VIEW_ID, order: 20,
        label: () => copy().overview
      }, View))
      return { inject: ['slots', 'locale'] }
    }

    return { apply, inject: ['slots', 'locale'] }
  }
})
