window.__ModuleLoader__.load({
  id: 'dsh-vantage',
  factory(load) {
    const React = load('react')
    const h = React.createElement

    const HOST_BASE = '/api/dsh-vantage'
    const VIEW_ID = 'vantage'
    const NAMESPACE = 'vantage'
    const POLL_MS = 5000
    const REQUEST_MS = 8000
    const STYLE_ID = 'dsh-vantage-style'
    const HISTORY_PAGE = 10
    // The working tree this panel was rendered for. The first snapshot fills it
    // in; every later read declares it, so a round from another project is
    // refused instead of being shown here.
    let PROJECT = null

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
        currentTab: '当前轮次', // ui-copy-ignore
        historyTab: '历史轮次', // ui-copy-ignore
        pendingLabel: '待办', // ui-copy-ignore
        goalLabel: '会话目标', // ui-copy-ignore
        milestones: '里程碑', // ui-copy-ignore
        process: '过程', // ui-copy-ignore
        artifacts: '关键产物', // ui-copy-ignore
        archived: '只读', // ui-copy-ignore
        currentRound: '本轮', // ui-copy-ignore
        lastRound: '上一轮', // ui-copy-ignore
        nothingYet: '这一轮没有留下可展示的结论', // ui-copy-ignore
        inProgress: '这一轮正在处理', // ui-copy-ignore
        roundCountLabel: '历史', // ui-copy-ignore
        none: '无', // ui-copy-ignore
        historyEmpty: '还没有更早的轮次', // ui-copy-ignore
        historyLoading: '正在读取历史', // ui-copy-ignore
        historyFailed: '历史记录没能读取', // ui-copy-ignore
        historyMore: '查看全部', // ui-copy-ignore
        unanswered: '未作答复', // ui-copy-ignore
        noSummary: '这一轮没有留下结论', // ui-copy-ignore
        noProcess: '这一轮没有记录到过程', // ui-copy-ignore
        goalDone: '已达成', // ui-copy-ignore
        goalPaused: '已暂停', // ui-copy-ignore
        goalBlocked: '受阻', // ui-copy-ignore
        askPlaceholder: '答疑', // ui-copy-ignore
        askOpen: '答疑', // ui-copy-ignore
        askSend: '发送', // ui-copy-ignore
        askBusy: '正在回答', // ui-copy-ignore
        askFailed: '没能回答这个问题', // ui-copy-ignore
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
        currentTab: 'Current round', // ui-copy-ignore
        historyTab: 'Past rounds', // ui-copy-ignore
        pendingLabel: 'Todo', // ui-copy-ignore
        goalLabel: 'Goal', // ui-copy-ignore
        milestones: 'Milestones', // ui-copy-ignore
        process: 'Process', // ui-copy-ignore
        artifacts: 'Key outputs', // ui-copy-ignore
        archived: 'Read-only', // ui-copy-ignore
        currentRound: 'This round', // ui-copy-ignore
        lastRound: 'Previous round', // ui-copy-ignore
        nothingYet: 'This round left no conclusion to show', // ui-copy-ignore
        inProgress: 'This round is in progress', // ui-copy-ignore
        roundCountLabel: 'History', // ui-copy-ignore
        none: 'None', // ui-copy-ignore
        historyEmpty: 'No earlier rounds yet', // ui-copy-ignore
        historyLoading: 'Reading history', // ui-copy-ignore
        historyFailed: 'History could not be read', // ui-copy-ignore
        historyMore: 'Show all', // ui-copy-ignore
        unanswered: 'No reply', // ui-copy-ignore
        noSummary: 'No conclusion saved for this round', // ui-copy-ignore
        noProcess: 'No process recorded for this round', // ui-copy-ignore
        goalDone: 'Achieved', // ui-copy-ignore
        goalPaused: 'Paused', // ui-copy-ignore
        goalBlocked: 'Blocked', // ui-copy-ignore
        askPlaceholder: 'Ask', // ui-copy-ignore
        askOpen: 'Ask', // ui-copy-ignore
        askSend: 'Send', // ui-copy-ignore
        askBusy: 'Answering', // ui-copy-ignore
        askFailed: 'The question was not answered', // ui-copy-ignore
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
.dsv-panel .ov-round-label { color: var(--dsw-alias-label-secondary); font-size: 13px; line-height: 20px; font-variant-numeric: tabular-nums; }
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
.dsv-panel .ov-sub { margin-top: 8px; color: var(--dsw-alias-label-secondary); font-size: 15px; line-height: 24px; }
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
.dsv-panel .ov-item-title { display: block; font-size: 15px; line-height: 24px; font-weight: 500; overflow-wrap: anywhere; }
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
  font: inherit; font-size: 15px; line-height: 24px; font-weight: 500;
  text-align: left; overflow-wrap: anywhere; cursor: pointer;
}
.dsv-panel .ov-item-link-text { text-decoration: underline; text-decoration-color: transparent; text-underline-offset: 3px; transition: text-decoration-color 120ms ease; }
.dsv-panel .ov-item-link:hover .ov-item-link-text { text-decoration-color: currentColor; }
.dsv-panel .ov-file-icon { flex: none; align-self: center; }
.dsv-panel .ov-item-link-arrow { flex: none; font-size: 15px; line-height: 26px; transition: transform 120ms ease; }
.dsv-panel .ov-item-link:hover .ov-item-link-arrow { transform: translate(1px, -1px); }
.dsv-panel .ov-item-limit { color: var(--dsw-alias-label-secondary); }
.dsv-panel .ov-item-limit[data-tone="error"] { color: var(--dsw-alias-state-error-primary); }
.dsv-panel .ov-item-limit[data-tone="warn"] { color: var(--dsw-alias-state-warn-primary); }
.dsv-panel .ov-item-body { padding: 0 0 12px; font-size: 15px; line-height: 24px; }
.dsv-panel .ov-item-body p { margin: 0 0 10px; overflow-wrap: anywhere; }
.dsv-panel .ov-item-body p:last-child { margin-bottom: 0; }
.dsv-panel .ov-rich { margin: 10px 0 0; }
.dsv-panel .ov-rich > *:first-child { margin-top: 0; }
.dsv-panel .ov-rich-p { margin: 8px 0 0; font-size: 15px; line-height: 24px; color: var(--dsw-alias-label-primary); overflow-wrap: anywhere; }
.dsv-panel .ov-rich-head { margin: 12px 0 0; font-size: 15px; line-height: 24px; font-weight: 500; color: var(--dsw-alias-label-primary); }
.dsv-panel .ov-rich-list { margin: 8px 0 0; padding-left: 20px; list-style: disc; font-size: 15px; line-height: 24px; overflow-wrap: anywhere; }
.dsv-panel .ov-rich-num { list-style: decimal; }
.dsv-panel .ov-rich-list li { margin-top: 4px; }
.dsv-panel .ov-rich code { font-family: var(--dsw-alias-font-mono, ui-monospace, monospace); font-size: 13px; }
.dsv-panel .ov-table { margin-top: 10px; }
.dsv-panel .ov-tr { display: grid; grid-auto-flow: column; grid-auto-columns: minmax(0, 1fr); gap: 12px; padding: 6px 0; border-bottom: 1px solid var(--dsw-alias-border-l1); font-size: 13px; line-height: 20px; }
.dsv-panel .ov-tr-head { color: var(--dsw-alias-label-secondary); }
.dsv-panel .ov-td { overflow-wrap: anywhere; }
.dsv-panel .ov-stop { margin-top: 12px; font-size: 13px; line-height: 20px; color: var(--dsw-alias-label-secondary); }
.dsv-panel .ov-ask {
  margin: 32px 0 0; padding-top: 20px;
  border-top: 1px solid var(--dsw-alias-border-l1);
}
.dsv-panel .ov-ask .ov-ask-label { margin: 0 0 12px; }
.dsv-panel .ov-ask-item + .ov-ask-item { margin-top: 14px; }
.dsv-panel .ov-ask-q { margin: 0; font-size: 14px; line-height: 22px; font-weight: 500; }
.dsv-panel .ov-ask-a { margin: 2px 0 0; }
.dsv-panel .ov-ask-a .ov-rich-p { color: var(--dsw-alias-label-secondary); }
.dsv-panel .ov-ask-notice { margin: 8px 0 0; font-size: 13px; line-height: 20px; color: var(--dsw-alias-label-secondary); }
.dsv-panel .ov-compose { display: flex; align-items: flex-end; gap: 8px; margin-top: 10px; padding: 8px 8px 8px 12px; background: var(--dsw-alias-bg-l2); border: 1px solid var(--dsw-alias-border-l1); border-radius: 14px; }
.dsv-panel .ov-compose:focus-within { border-color: var(--dsw-alias-brand-primary); }
.dsv-panel .ov-ask-input { flex: 1; min-width: 0; max-height: 132px; padding: 3px 0; font: inherit; line-height: 24px; color: var(--dsw-alias-label-primary); background: transparent; border: 0; resize: none; overflow-y: auto; }
.dsv-panel .ov-ask-input:focus { outline: none; }
.dsv-panel .ov-ask-input::placeholder { color: var(--dsw-alias-label-secondary); }
.dsv-panel .ov-ask-send { flex: none; display: inline-flex; align-items: center; justify-content: center; width: 30px; height: 30px; padding: 0; color: var(--dsw-alias-bg-base); background: var(--dsw-alias-brand-primary); border: 0; border-radius: 50%; cursor: pointer; }
.dsv-panel .ov-ask-send:disabled { color: var(--dsw-alias-label-secondary); background: var(--dsw-alias-bg-base); cursor: default; }
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
.dsv-panel .ov-round-body { margin-left: 2px; padding: 2px 0 18px 14px; border-left: 2px solid var(--dsw-alias-border-l1); }
/* An opened round is subordinate to the row that opened it: its work items
   step down one size from the row title, so the list keeps a single top level. */
.dsv-panel .ov-round-body .ov-sg-title { font-size: 15px; line-height: 24px; }
.dsv-panel .ov-round-body .ov-sg-conclusion,
.dsv-panel .ov-round-body .ov-sg-results { font-size: 14px; line-height: 24px; }
.dsv-panel .ov-round-body .ov-sg-details { font-size: 13px; line-height: 20px; }
.dsv-panel .ov-round-body .ov-meta { margin: 0 0 8px; }
.dsv-panel .ov-list-heading {
  margin-bottom: 4px; color: var(--dsw-alias-label-secondary);
  font-size: 13px; line-height: 20px; font-weight: 500;
}
.dsv-panel .ov-history-text { display: block; min-width: 0; }
.dsv-panel .ov-history-title {
  display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden;
  font-size: 16px; line-height: 24px; font-weight: 600; overflow-wrap: anywhere;
}
.dsv-panel .ov-history-sub {
  display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden;
  margin-top: 2px; color: var(--dsw-alias-label-secondary); font-size: 13px; line-height: 20px; overflow-wrap: anywhere;
}
.dsv-panel .ov-history-time {
  color: var(--dsw-alias-label-secondary); font-size: 13px; line-height: 20px; white-space: nowrap;
  font-variant-numeric: tabular-nums;
}
.dsv-panel .ov-history-item[data-open] .ov-row-chevron { transform: rotate(90deg); }
.dsv-panel .ov-row-chevron {
  transition: transform 120ms ease;
  display: inline-flex; align-items: center; justify-content: center; width: 16px; height: 20px;
  color: var(--dsw-alias-label-secondary); font-size: 20px; line-height: 20px;
}
.dsv-panel .ov-timeline { margin: 8px 0 0; }
.dsv-panel .ov-tl-row {
  display: flex; gap: 12px; align-items: baseline;
  padding: 8px 0; border-top: 1px solid var(--dsw-alias-border-l1);
}
.dsv-panel .ov-tl-row:first-child { border-top: 0; padding-top: 0; }
.dsv-panel .ov-tl-mark {
  flex: none; width: 12px; color: var(--dsw-alias-label-secondary);
  font-size: 13px; line-height: 22px;
}
.dsv-panel .ov-tl-time {
  flex: none; width: 44px; color: var(--dsw-alias-label-secondary);
  font-size: 13px; line-height: 22px; font-variant-numeric: tabular-nums;
}
/* One line per milestone: a command is evidence, not a paragraph. The full
   line stays in the round record behind the row. */
/* A milestone reads top-down: what it concluded, what it produced under it,
   and the basis kept folded at the bottom. */
.dsv-panel .ov-sg-body { flex: 1; min-width: 0; }
.dsv-panel .ov-sg-title { font-size: 17px; line-height: 26px; font-weight: 600; overflow-wrap: anywhere; }
.dsv-panel .ov-sg-conclusion { margin: 8px 0 0; font-size: 15px; line-height: 26px; overflow-wrap: anywhere; }
.dsv-panel .ov-sg-details { margin: 6px 0 0; font-size: 14px; line-height: 22px; color: var(--dsw-alias-text-secondary); overflow-wrap: anywhere; }
.dsv-panel .ov-sg-details p { margin: 0; }
.dsv-panel .ov-sg-results { margin: 8px 0 0; padding-left: 20px; list-style: disc; font-size: 15px; line-height: 24px; overflow-wrap: anywhere; }
.dsv-panel .ov-sg-results li { margin-top: 2px; }
.dsv-panel .ov-sg-artifacts { display: flex; flex-wrap: wrap; gap: 6px 16px; margin: 10px 0 0; font-size: 15px; line-height: 24px; }
.dsv-panel .ov-sg-artifact { overflow-wrap: anywhere; }
.dsv-panel .ov-sg-artifact-open {
  padding: 0; border: 0; background: none; color: var(--dsw-alias-brand-primary);
  font-size: 15px; line-height: 24px; text-align: left; cursor: pointer; overflow-wrap: anywhere;
  text-decoration: underline; text-decoration-color: transparent; text-underline-offset: 3px;
  transition: text-decoration-color 120ms ease;
}
.dsv-panel .ov-sg-artifact-open:hover { text-decoration-color: currentColor; }
.dsv-panel .ov-sg-conditions { margin: 10px 0 0; color: var(--dsw-alias-label-secondary); font-size: 14px; line-height: 22px; }
.dsv-panel .ov-sg-conditions p { margin: 0; overflow-wrap: anywhere; }
.dsv-panel .ov-sg-conditions p + p { margin-top: 2px; }
.dsv-panel .ov-more { display: inline-flex; margin-top: 16px; }
.dsv-panel .ov-progress {
  margin: 14px 0 0;
  color: var(--dsw-alias-label-secondary);
  font-size: 14px;
  line-height: 24px;
}
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
        const headers = Object.assign({}, options?.headers)
        if (PROJECT !== null) headers['x-dsh-vantage-project'] = PROJECT
        const init = Object.assign({}, options, { signal: controller.signal, cache: 'no-store', headers })
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

    // A reply is written in Markdown. Printing it as one paragraph turned
    // "## 本轮改动" and "1. …" into literal noise, so the excerpt is read as the
    // shape it was written in: headings become lines, markers become a list.
    function inlineNodes(text, keyPrefix) {
      const out = []
      const parts = String(text).split(/(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)\s]+\))/gu)
      parts.forEach((part, index) => {
        if (part === '') return
        const key = `${keyPrefix}:${index}`
        const bold = /^\*\*([^*]+)\*\*$/u.exec(part)
        if (bold !== null) { out.push(h('strong', { key }, bold[1])); return }
        const code = /^`([^`]+)`$/u.exec(part)
        if (code !== null) { out.push(h('code', { key, className: 'ov-code' }, code[1])); return }
        const link = /^\[([^\]]+)\]\(([^)\s]+)\)$/u.exec(part)
        if (link !== null) { out.push(h('a', { key, href: link[2], target: '_blank', rel: 'noreferrer' }, link[1])); return }
        out.push(part)
      })
      return out
    }

    // A reply sometimes arrives as one long line where the Markdown markers sit
    // mid-sentence ("## 三条通路 1. 绑定失效 2. …"). Printing that verbatim is how
    // a page becomes one wall of text, so a block marker starts a new line even
    // when the model forgot to.
    function blockLines(text) {
      const numbered = /\s(?=\d{1,2}[.、)]\s)/u
      const splitNumbered = (line) => {
        const at = line.search(numbered)
        return at < 0 ? null : [line.slice(0, at), ...line.slice(at).trim().split(numbered)]
      }
      const lined = String(text).replace(/\r/gu, '').replace(/(?<![#\n])(#{1,6}\s+)/gu, '\n$1')
      const out = []
      for (const line of lined.split('\n')) {
        const trimmed = line.trim()
        if (trimmed === '') { out.push(''); continue }
        const heading = trimmed.match(/^(#{1,6})\s+(.*)$/u)
        if (heading) {
          const mark = heading[1]
          const body = heading[2]
          // A model often writes "## 标题 1. 一 2. 二" on one line: the title keeps
          // its own line, each numbered item gets a paragraph of its own.
          const parts = splitNumbered(body)
          if (parts !== null) {
            out.push(`${mark} ${parts[0].trim()}`)
            for (const part of parts.slice(1).filter((piece) => piece.trim() !== '')) out.push(part)
            continue
          }
          // "## 标题 正文继续写在同一行" with no list: a short opening clause before
          // the first space is the title, the rest is ordinary prose.
          const gap = /\s+/u.exec(body)
          const cjk = /[\u4e00-\u9fa5]/u
          if (gap !== null && gap.index > 0 && gap.index <= 24 && cjk.test(body.slice(0, gap.index)) && cjk.test(body.slice(gap.index + gap[0].length))) {
            out.push(`${mark} ${body.slice(0, gap.index)}`)
            out.push(body.slice(gap.index + gap[0].length))
            continue
          }
          out.push(trimmed)
          continue
        }
        const parts = splitNumbered(trimmed)
        if (parts !== null && (/^\d{1,2}[.、)]\s/u.test(trimmed) || /[。；：！？]\s*$/u.test(parts[0]))) {
          for (const part of parts.filter((piece) => piece.trim() !== '')) out.push(part)
          continue
        }
        out.push(line)
      }
      return out
    }

    function richText(text, keyPrefix) {
      const lines = blockLines(text)
      const blocks = []
      let list = []
      let rows = []
      let listOrdered = false
      const flushList = () => {
        if (list.length === 0) return
        const tag = listOrdered ? 'ol' : 'ul'
        blocks.push(h(tag, { key: `${keyPrefix}-u${blocks.length}`, className: listOrdered ? 'ov-rich-list ov-rich-num' : 'ov-rich-list' }, list))
        list = []
      }
      const flushTable = () => {
        if (rows.length === 0) return
        const head = rows[0]
        const rest = rows.slice(1)
        blocks.push(h('div', { key: `${keyPrefix}-t${blocks.length}`, className: 'ov-table' }, [
          h('div', { key: 'h', className: 'ov-tr ov-tr-head' }, head.map((cell, index) => (
            h('span', { key: index, className: 'ov-td' }, inlineNodes(cell, `${keyPrefix}:th${index}`))
          ))),
          ...rest.map((row, rowIndex) => h('div', { key: rowIndex, className: 'ov-tr' }, row.map((cell, cellIndex) => (
            h('span', { key: cellIndex, className: 'ov-td' }, inlineNodes(cell, `${keyPrefix}:td${rowIndex}:${cellIndex}`))
          ))))
        ]))
        rows = []
      }
      for (const rawLine of lines) {
        const line = rawLine.trim()
        if (line === '') { flushList(); flushTable(); continue }
        const heading = /^(#{1,6})\s+(.*)$/u.exec(line)
        if (heading !== null) {
          flushList(); flushTable()
          const level = heading[1].length
          blocks.push(h('p', { key: `${keyPrefix}-h${blocks.length}`, className: 'ov-rich-head', 'data-level': level > 2 ? 2 : 1 }, inlineNodes(heading[2], `${keyPrefix}:h${blocks.length}`)))
          continue
        }
        const table = /^\|(.*)\|$/u.exec(line)
        if (table !== null) {
          const cells = table[1].split('|').map((cell) => cell.trim())
          if (cells.every((cell) => /^:?-{2,}:?$/u.test(cell))) continue
          flushList()
          rows.push(cells)
          continue
        }
        flushTable()
        const bullet = /^(?:[-*+•]|\d{1,2}[.、)])\s+(.*)$/u.exec(line)
        if (bullet !== null) {
          const ordered = /^\d/u.test(line)
          if (list.length > 0 && ordered !== listOrdered) flushList()
          listOrdered = ordered
          list.push(h('li', { key: `${keyPrefix}-l${blocks.length}-${list.length}` }, inlineNodes(bullet[1], `${keyPrefix}:l${blocks.length}:${list.length}`)))
          continue
        }
        flushList()
        blocks.push(h('p', { key: `${keyPrefix}-p${blocks.length}`, className: 'ov-rich-p' }, inlineNodes(line, `${keyPrefix}:p${blocks.length}`)))
      }
      flushList(); flushTable()
      return blocks
    }

    // The reply is the model's own account. It is worth reading, but it is not
    // the headline: it reads as prose under the result. Opening the round is the
    // only gesture — there is no second control to unfold the text.
    const flatForCompare = (value) => String(value ?? '')
      .replace(/[\s*_`>#]+/gu, '')
      .replace(/[，,。.：:；;！!？?、「」（）()"'“”—…-]+/gu, '')

    // Only whole sentences are ever compared or removed. A heading may repeat
    // the reply's first sentence, never the first half of it: cutting at the
    // heading's character count left bodies that began mid-clause.
    const TERMINAL_RE = /[。！？；;.!?…]$/u
    const CJK_RE = /[\u4e00-\u9fff]/u

    function sentencesOf(text) {
      const body = String(text ?? '').replace(/\r/gu, ' ')
      const parts = []
      let buffer = ''
      for (const character of body) {
        if (character === '\n') { buffer += ' '; continue }
        buffer += character
        if ('。！？；;'.includes(character)) {
          const piece = buffer.replace(/\s+/gu, ' ').trim()
          if (piece !== '') parts.push(piece)
          buffer = ''
        }
      }
      const tail = buffer.replace(/\s+/gu, ' ').trim()
      if (tail !== '') parts.push(tail)
      return parts
    }

    function withoutRepeatedLead(text, head) {
      const raw = typeof text === 'string' ? text.trim() : ''
      if (raw === '') return ''
      let body = raw
      let want = flatForCompare(head)
      if (want.length < 6) return raw
      // A heading may carry a marker the body does not repeat ("9.142 已经发到…"
      // over "142 已经发到…"): the claim is the same one, and the marker is not
      // allowed to hide the repeat. Both sides start at the same word.
      if (!flatForCompare(body).startsWith(want)) {
        const wantBare = want.replace(/^[\d.]+/u, '')
        const flat = flatForCompare(body)
        const bare = flat.replace(/^[\d.]+/u, '')
        if (wantBare.length < 6 || bare.length >= flat.length || !bare.startsWith(wantBare)) return raw
        let cut = 0
        let seen = 0
        while (cut < body.length && seen < flat.length - bare.length) {
          if (flatForCompare(body[cut]) !== '') seen += 1
          cut += 1
        }
        body = body.slice(cut).trim()
        want = wantBare
        if (body === '') return raw
      }
      // The heading ends where its own characters end. A separator printed
      // there introduced the claim, so the body starts right after it.
      let seen = 0
      let at = 0
      for (; at < body.length; at += 1) {
        if (flatForCompare(body[at]) === '') continue
        seen += 1
        if (seen >= want.length) break
      }
      const rest = body.slice(at + 1).replace(/^[\s、，,。.：:；;！!？?—–-]+/u, '').trim()
      if (rest !== '') return rest
      // The heading repeated a whole sentence: only complete sentences go.
      const sentences = sentencesOf(body)
      let drop = 0
      while (drop < sentences.length) {
        const flat = flatForCompare(sentences[drop])
        if (flat === '') { drop += 1; continue }
        if (!(flat.startsWith(want) || want.startsWith(flat))) break
        drop += 1
      }
      return sentences.slice(drop).join('').trim()
    }

    // A path, a URL, a file name or a code identifier is how the work was done,
    // never what came of it: a line made only of scaffolding is not a result.
    const MACHINE_RE = /(?:https?:\/\/|\/[\w.-]+\/|\b[\w-]+\.(?:kt|java|ts|js|mjs|json|jpg|jpeg|png|log|md|yml|apk)\b|[`<>|]|→|\?[A-Za-z]+=)/u

    const cleanLine = (text) => String(text ?? '')
      .replace(/（[^）]*[\/.][^）]*）/gu, '')
      .replace(/\([^)]*[\/.][^)]*\)/gu, '')
      .replace(/https?:\/\/\S+/gu, '')
      .replace(/\/[\w.\-/]+/gu, '')
      .replace(/[*_`>#]/gu, '')
      .replace(/\s+/gu, ' ')
      .trim()

    // What the card owes the reader is the result, in the model's own words and
    // always as a complete sentence. A sentence that mentions caching, an
    // interface or a log line can be the very finding the reader needs, so no
    // term list decides what is worth reading.
    // The one line a row shows when it is folded: the first whole sentence that
    // is not the heading over again.
    // The preview line a folded row shows. It takes the round's last whole
    // sentence: the body opens with the first one, so a preview of the same
    // sentence would print the round twice.
    // A sentence shown as the row's preview must not be printed again in the
    // body that opens under it.
    // A sentence that only points back at something said earlier cannot open a
    // quote: the reader has no earlier text to read it against.
    const BACK_REFERENCE_HEADS = ['说的是', '指的是', '也就是说', '上面说的', '刚才说的', '前面说的']
    const opensBackReference = (sentence) => {
      const flat = flatForCompare(sentence).replace(/^我们?/u, '')
      return BACK_REFERENCE_HEADS.some((head) => flat.startsWith(head))
    }
    // The box grows with its text up to the ceiling the stylesheet sets, then
    // scrolls: the same behaviour as the conversation's composer.
    const growBox = (node) => {
      if (node === null || node === undefined) return
      node.style.height = 'auto'
      node.style.height = `${Math.min(node.scrollHeight, 132)}px`
    }

    // A side question about one round. It answers from that round's own record,
    // one call at a time, and never writes to the conversation — the main task
    // is untouched while somebody reads and asks.
    function SideAsk(props) {
      const { sessionId, roundId, words } = props
      const [thread, setThread] = React.useState(null)
      const [draft, setDraft] = React.useState('')
      const [busy, setBusy] = React.useState(false)
      const [notice, setNotice] = React.useState('')
      const boxRef = React.useRef(null)
      // A finished answer must not be overwritten by a list request that was
      // already in flight when the question was sent.
      const answered = React.useRef(false)
      const key = `${sessionId}|${roundId}`
      React.useEffect(() => {
        let alive = true
        answered.current = false
        const query = new URLSearchParams({ session: sessionId, roundId: String(roundId) })
        void callHost(`/ask?${query.toString()}`).then((answer) => {
          if (alive !== true || answered.current === true) return
          setThread(answer !== undefined && answer.body !== null && Array.isArray(answer.body.items) ? answer.body.items : [])
        })
        return () => { alive = false }
      }, [key])
      const submit = () => {
        const question = draft.trim()
        if (question === '' || busy === true) return
        setBusy(true)
        setNotice('')
        void callHost('/ask', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ session: sessionId, roundId: String(roundId), question })
        }).then((answer) => {
          if (answer === undefined || answer.failed === true || answer.blocked === true) { setNotice(words.askFailed); return }
          const body = answer.body
          if (body !== null && Array.isArray(body.items)) { answered.current = true; setThread(body.items) }
          if (body !== null && typeof body.text === 'string' && body.text !== '') setNotice(body.text)
          if (body !== null && body.kind === 'answer') {
            setDraft('')
            if (boxRef.current !== null) boxRef.current.style.height = 'auto'
          }
        }).finally(() => setBusy(false))
      }
      const answers = Array.isArray(thread) ? thread : []
      // The field sits at the bottom of the page and the exchange grows up from
      // it, the way a conversation reads: ask underneath, answers above.
      return h('div', { className: 'ov-ask' }, [
        h('div', { key: 'l', className: 'ov-section-label ov-ask-label' }, words.askOpen),
        answers.length === 0 ? null : h('div', { key: 'th', className: 'ov-ask-thread' }, answers.map((item, index) => h('div', { key: `t${index}`, className: 'ov-ask-item' }, [
          h('p', { key: 'q', className: 'ov-ask-q' }, item.question),
          h('div', { key: 'a', className: 'ov-rich ov-ask-a' }, richText(item.answer, `ask${index}`))
        ]))),
        notice === '' ? null : h('p', { key: 'n', className: 'ov-ask-notice' }, notice),
        h('div', { key: 'i', className: 'ov-compose' }, [
          h('textarea', {
            key: 'f', ref: boxRef, className: 'ov-ask-input', rows: 1, value: draft, placeholder: words.askPlaceholder,
            'aria-label': words.askPlaceholder,
            onChange: (event) => { setDraft(event.target.value); growBox(event.target) },
            onKeyDown: (event) => {
              // Enter sends, Shift+Enter starts a new line: the same keys the
              // conversation's own composer answers to.
              if (event.key === 'Enter' && event.shiftKey !== true) { event.preventDefault(); submit() }
            }
          }),
          h('button', {
            key: 'b', type: 'button', className: 'ov-ask-send', 'aria-label': busy === true ? words.askBusy : words.askSend,
            disabled: busy === true || draft.trim() === '', onClick: submit
          }, h('svg', {
            key: 'g', viewBox: '0 0 16 16', width: 15, height: 15, fill: 'none',
            stroke: 'currentColor', strokeWidth: 1.7, 'aria-hidden': 'true'
          }, [
            h('path', { key: 's', d: 'M8 12.5V3.5' }),
            h('path', { key: 'a', d: 'M4 7.5l4-4 4 4' })
          ]))
        ])
      ])
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

    // One identity per open target, so a target that failed once is remembered
    // whichever row or round offered it.
    function linkKeyOf(link) {
      if (link === null || link === undefined) return ''
      const path = typeof link.path === 'string' ? link.path : ''
      const url = typeof link.url === 'string' ? link.url : ''
      return path !== '' ? `p:${path}` : url !== '' ? `u:${url}` : ''
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
    // A row is a progress report: the round earns its line by saying what got
    // done, never by repeating what the reader asked for.
    const work = String(row?.work ?? '').trim()
    const outcome = work !== '' ? work : String(row?.outcome ?? '').trim()
    if (outcome === '' || outcome.length < 6) return false
    // A bare acknowledgement ("可以关闭了。") answers the reader, it does not
    // report progress.
    if (/^(?:可以|好的|好|行|嗯|对|是的|没问题|收到|继续)/u.test(outcome)) return false
    // A list fragment ("含 mock 场景") or copied command is not a result.
    if (weakRowLine(outcome)) return false
    if (/^[0-9]+[.、)]/u.test(outcome)) return false
    if (/^(?:本轮|这一轮|又|继续|之前|为什么|验证了|已保存|三个|两个|一个|重读|它|这|那|其|此|因此|所以|但|而|【)/u.test(outcome)) return false
    if (/(?:硬理由|查清了原因|日志里有|原因已查|先说|先说结论)/u.test(outcome)) return false
    if (/(?:=>|[a-z]+\.[a-z]+\()/u.test(outcome)) return false
    if (!/[\u4e00-\u9fff]/u.test(outcome) && outcome.length > 12) return false
    if (/(?:没留下结论|没有部署|没有重启|只做了|只做|新增(?:了)?[0-9一二三四五六七八九十两几]*\s*(?:个)?能力|提交了|改了几个文件|跑了一遍|分两层)/u.test(outcome)) return false
    return true
  }
  const weakRowLine = (text) => /^(?:含|如|以及|包括|其中|另外|此外|同时|备注)/u.test(text)
    || /[→|`]/u.test(text)
    || /[A-Za-z]+\/[A-Za-z]+/u.test(text)
  const primaryOf = (row, sessionTitle, words) => {
      // A history row reports progress, so it names what the round got done.
      // The human's message stays in the round body; it never names the row.
      const work = String(row?.work ?? '').trim()
      if (work !== '' && !weakRowLine(work)) return work
      const outcome = String(row?.outcome ?? '').trim()
      if (outcome !== '' && !weakRowLine(outcome)) return outcome
      return outcome !== '' ? outcome : words.noSummary
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
      const limit = qualifierOf(item)
      const inline = inlineEvidenceOf(item)
      const hasInline = inline.length > 0
      const bodyChildren = []
      paragraphs.forEach((line, index) => {
        bodyChildren.push(h('p', { key: `p${index}` }, line))
      })
      // What the round did not cover belongs to the summary, not to the title:
      // a second line under a heading reads as a subtitle nobody asked for.
      if (limit !== '') bodyChildren.push(h('p', { key: 'limit', className: 'ov-item-limit', 'data-tone': tone }, limit))
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
      const rawLink = item.link !== null && typeof item.link === 'object' ? item.link : null
      const link = rawLink !== null && props.isDead(rawLink) ? null : rawLink
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
          ])
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
      const [view, setView] = React.useState({ mode: 'current', roundId: null })
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
      const deadLinkRef = React.useRef(new Set())
      const loadHolder = React.useRef(null)
      const expandedRef = React.useRef(new Set())
      // History rows each keep their own body: opening a third row must not pull
      // the first one shut, and a round that was already fetched is not asked
      // for again. Keys are 'h:<roundId>' so they never collide with brief items.
      const roundsRef = React.useRef({})
      const roundErrorRef = React.useRef(new Set())
      const roundBusyRef = React.useRef(new Set())
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
        if (typeof answer.body.project === 'string') PROJECT = answer.body.project
        if (answer.body.kind === 'unchanged') return
        revisionRef.current = answer.body.revision
        shownRoundRef.current = typeof answer.body.round?.roundId === 'string' ? answer.body.round.roundId : ''
        setSnapshot(answer.body)
      }, [claim, sessionId])

      React.useEffect(() => {
        PROJECT = null
        revisionRef.current = null
        setSnapshot(null)
        setHistory(null)
        setHistoryFailed(false)
        setHistoryLoading(false)
        setRound(null)
        setRoundFailed(false)
        evidenceOpenRef.current = {}
        expandedRef.current = new Set()
        roundsRef.current = {}
        roundErrorRef.current = new Set()
        roundBusyRef.current = new Set()
        itemRef.current = {}
        // Switching sessions invalidates every request in flight: a late answer
        // for the old session must not land in the new one's list or card.
        seqRef.current = {}
        setView({ mode: 'current', roundId: null })
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
        const rowKey = `h:${id}`
        // The current round is already in the snapshot; opening it in the
        // history list is only a fold, never another request.
        const liveId = snapshot !== null && snapshot.round !== null && snapshot.round !== undefined ? snapshot.round.roundId : ''
        if (view.mode === 'history' && view.roundId === id && expandedRef.current.has(rowKey)) {
          // The same row closes alone; nothing else takes its place open.
          setView({ mode: 'history', roundId: null, from: '' })
          expandedRef.current.delete(rowKey)
          setRound(null)
          setRoundFailed(false)
          setTick((value) => value + 1)
          return
        }
        if (id === '') {
          expandedRef.current.delete(rowKey)
          setRoundFailed(true)
          setTick((value) => value + 1)
          return
        }
        expandedRef.current.add(rowKey)
        setView({ mode: 'history', roundId: id, from: '' })
        setTick((value) => value + 1)
        // A round that was opened once is kept: reopening a row is a fold, not
        // a request. Only the row being pointed at waits.
        if (roundsRef.current[id] !== undefined || roundBusyRef.current.has(id)) return
        const fresh = claim(`round:${id}`)
        if (fresh === null) return
        roundErrorRef.current.delete(id)
        roundBusyRef.current.add(id)
        setTick((value) => value + 1)
        const query = new URLSearchParams({ session: sessionId, round: id })
        const answer = await callHost(`/round?${query.toString()}`)
        roundBusyRef.current.delete(id)
        if (fresh() !== true) return
        const answered = answer.body === null || answer.body === undefined || answer.body.round === null || answer.body.round === undefined
          ? ''
          : String(answer.body.round.roundId ?? '')
        // The card shows only the round that was asked for: an answer for some
        // other round is a failure, never a stand-in.
        if (answer.failed === true || answered !== id) {
          roundErrorRef.current.add(id)
          setRoundFailed(true)
          setTick((value) => value + 1)
          return
        }
        roundsRef.current[id] = answer.body.round
        setRound(answer.body.round)
        setRoundFailed(false)
        setTick((value) => value + 1)
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

      // A target that will not open is not offered twice: the row loses its
      // link instead of announcing a failure the reader cannot act on.
      const deadLink = (link) => {
        if (link === null || link === undefined) return true
        return deadLinkRef.current.has(linkKeyOf(link))
      }

      const openLink = async (link) => {
        if (deadLink(link)) return
        const path = typeof link.path === 'string' ? link.path : ''
        const url = typeof link.url === 'string' ? link.url : ''
        if (path === '' && url === '') return
        const answer = await callHost('/open', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(path === '' ? { session: sessionId, url } : { session: sessionId, path })
        })
        if (answer.failed === true || answer.blocked === true) {
          deadLinkRef.current.add(linkKeyOf(link))
          setTick((value) => value + 1)
        }
      }

      const publishItems = (roundId, items) => {
        for (const item of items) {
          itemRef.current[itemKeyOf(roundId, item)] = { factIds: item.factIds, roundId, inline: inlineEvidenceOf(item).length > 0 }
        }
      }

      const showHistory = () => {
        // The history page lists earlier rounds only and starts folded: the
        // round on screen is what the current tab is for.
        setView({ mode: 'history', roundId: null, from: '' })
        setRound(null)
        setRoundFailed(false)
        setTick((value) => value + 1)
        if (history === null) fetchHistory('', false)
      }

      const showCurrent = () => {
        // Back to the round on screen: no row is open, and an answer about a
        // history row still in flight must not land on the current page.
        claim('round')
        setView({ mode: 'current', roundId: null, from: '' })
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
          setView({ mode: 'current', roundId: null })
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
          const rowId = String(control.getAttribute('data-round') ?? '')
          // A row folds on its own: the other rows that are open stay open.
          if (expandedRef.current.has(`h:${rowId}`)) {
            expandedRef.current.delete(`h:${rowId}`)
            setTick((value) => value + 1)
            return
          }
          openRound(rowId)
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
        (() => {
          // One control for the two views: with any stored round the history is
          // a place the reader can go, and this is the only way in.
          const items = snapshot !== null && snapshot.history !== null && snapshot.history !== undefined && Array.isArray(snapshot.history.items) ? snapshot.history.items : []
          return items.length > 0 ? h('div', { key: 'seg', className: 'ov-seg', role: 'tablist' }, [
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
          ]) : null
        })()
      ]

      const header = h('header', { key: 'h', className: 'ov-toolbar' }, [
        h('div', { key: 'm', className: 'ov-head' }, [
          h('div', { key: 't', className: 'ov-session-title' }, sessionTitle === '' ? words.contextCurrent : sessionTitle)
        ]),
        h('div', { key: 's', className: 'ov-controls' }, controls)
      ])

      // The course of the work, not its closing paragraph. A round can run for
      // half an hour with nothing printed in the conversation; these are the
      // lines that say what it was doing during that silence.
      const stepsOf = (target) => {
        const raw = target !== null && target !== undefined && Array.isArray(target.steps) ? target.steps : []
        const steps = []
        for (const step of raw) {
          if (step === null || step === undefined) continue
          const text = typeof step.text === 'string' ? step.text.trim() : ''
          if (text === '') continue
          const at = typeof step.t === 'number' && step.t > 0 ? step.t : typeof step.time === 'number' && step.time > 0 ? step.time : 0
          steps.push({ at, text, kind: typeof step.kind === 'string' ? step.kind : '' })
        }
        return steps
      }

      const clockOf = (at) => {
        if (typeof at !== 'number' || at <= 0) return ''
        const date = new Date(at)
        return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
      }

      // What a row leads with: the last two lines of the silent stretch it
      // covers, never the closing sentence the conversation already printed.
      const stepTitleOf = (steps) => {
        const texts = steps.map((step) => step.text).filter((text) => text !== '')
        if (texts.length === 0) return ''
        if (texts.length === 1) return texts[0].length > 48 ? `${texts[0].slice(0, 47)}…` : texts[0]
        const joined = `${texts[0]}，${texts[texts.length - 1]}`
        return joined.length > 48 ? `${joined.slice(0, 47)}…` : joined
      }

      // The one line under a row: what it touched, how much it checked, and the
      // span it covered. Same-minute facts are not a span, so the range is
      // printed only when it is at least a minute wide.
      const progressOfSteps = (steps) => {
        let changes = 0
        let checks = 0
        for (const step of steps) {
          if (step.kind === 'change') changes += 1
          else if (step.kind === 'check') checks += 1
        }
        const parts = []
        if (changes > 0) parts.push(`改 ${changes} 处`)
        if (checks > 0) parts.push(`检查 ${checks} 项`)
        const times = steps.map((step) => step.at).filter((at) => at > 0)
        if (times.length > 1) {
          const first = Math.min(...times)
          const last = Math.max(...times)
          if (last - first >= 60 * 1000) parts.push(`${clockOf(first)}–${clockOf(last)}`)
        }
        return parts.join(' · ')
      }

      // What a round shows instead of its tool calls: the work segments the
      // server folded, each one a statement with the state of that work.
      const segmentsOf = (target) => {
        const raw = target !== null && target !== undefined && Array.isArray(target.segments) ? target.segments : []
        const lines = (value, limit) => Array.isArray(value)
          ? value.map((line) => (typeof line === 'string' ? line.trim() : '')).filter((line) => line !== '').slice(0, limit)
          : []
        const rows = []
        for (let index = 0; index < raw.length; index += 1) {
          const row = raw[index]
          if (row === null || row === undefined) continue
          const topic = typeof row.topic === 'string' ? row.topic.trim() : ''
          if (topic === '') continue
          const id = typeof row.id === 'string' && row.id.trim() !== '' ? row.id.trim() : `seg:${index}`
          const artifacts = Array.isArray(row.artifacts)
            ? row.artifacts.map((art) => {
              if (art === null || art === undefined) return null
              const title = typeof art.title === 'string' ? art.title.trim() : ''
              const path = typeof art.path === 'string' ? art.path.trim() : ''
              if (title === '' && path === '') return null
              return { title: title === '' ? path : title, path }
            }).filter((art) => art !== null)
            : []
          const evidence = Array.isArray(row.evidence)
            ? row.evidence.map((item) => {
              if (item === null || item === undefined) return null
              const label = item.label === undefined || item.label === null ? '' : String(item.label).trim()
              const text = item.text === undefined || item.text === null ? '' : String(item.text).trim()
              if (label === '' && text === '') return null
              return { label, text }
            }).filter((item) => item !== null)
            : []
          rows.push({
            id,
            topic,
            conclusion: typeof row.conclusion === 'string' ? row.conclusion.trim() : '',
            results: lines(row.results, 3),
            artifacts,
            conditions: lines(row.conditions, 2),
            details: lines(row.details, 2),
            evidence,
            state: typeof row.state === 'string' ? row.state : 'in_progress'
          })
        }
        return rows
      }

      // A milestone reads top-down: the conclusion first, what it produced,
      // and the basis folded at the very bottom. The same node serves a live
      // round and an archived one, so both read identically.
      // `named` is the label the row above already prints. Repeating it as the
      // first work item made one stretch of work look like two headings.
      const segmentsNode = (target, named) => {
        const skip = typeof named === 'string' ? named.trim() : ''
        const rows = segmentsOf(target).filter((row) => !(skip !== '' && row.topic.trim() === skip))
        if (rows.length === 0) return null
        const roundId = target !== null && target !== undefined && target.roundId !== undefined && target.roundId !== null ? String(target.roundId) : ''
        return h('div', { key: 'sg', className: 'ov-timeline ov-segments' }, rows.map((row) => {
          const evidenceKey = `s:${roundId}:${row.id}`
          const children = [h('div', { key: 't', className: 'ov-sg-title' }, row.topic)]
          // A conclusion is printed only when the work actually has one. A
          // sentence saying there is no conclusion is a placeholder, and a
          // milestone that carries nothing else is dropped by the server.
          if (row.conclusion !== '') children.push(h('p', { key: 'c', className: 'ov-sg-conclusion' }, row.conclusion))
          if (row.details.length > 0) {
            children.push(h('div', { key: 'd', className: 'ov-sg-details' }, row.details.map((line, lineIndex) => h('p', { key: `d${lineIndex}` }, line))))
          }
          if (row.results.length > 0) {
            children.push(h('ul', { key: 'r', className: 'ov-sg-results' }, row.results.map((line, lineIndex) => h('li', { key: `r${lineIndex}` }, line))))
          }
          if (row.artifacts.length > 0) {
            children.push(h('div', { key: 'a', className: 'ov-sg-artifacts' }, row.artifacts.map((art, artIndex) => {
              const link = art.path === '' || deadLink({ path: art.path }) ? null : { path: art.path, title: art.title }
              return link === null
                ? h('span', { key: `a${artIndex}`, className: 'ov-sg-artifact' }, art.title)
                : h('button', {
                  key: `a${artIndex}`, type: 'button', className: 'ov-sg-artifact ov-sg-artifact-open',
                  onClick: () => openLink(link)
                }, art.title)
            })))
          }
          if (row.conditions.length > 0) {
            children.push(h('div', { key: 'q', className: 'ov-sg-conditions' }, row.conditions.map((line, lineIndex) => h('p', { key: `q${lineIndex}` }, line))))
          }
          if (row.evidence.length > 0) {
            children.push(h('details', {
              key: 'e',
              className: 'ov-evidence',
              open: evidenceOpenRef.current[evidenceKey] === true,
              onToggle: (event) => applyEvidenceOpen(evidenceKey, event.currentTarget.open)
            }, [
              h('summary', { key: 's' }, words.evidence),
              h('div', { key: 'b', className: 'ov-source' }, row.evidence.map((item, itemIndex) => h('div', { key: `v${itemIndex}` }, [
                item.label === '' ? null : h('p', { key: 'l' }, item.label),
                item.text === '' ? null : h('p', { key: 'x' }, item.text)
              ])))
            ]))
          }
          // Only a blocked milestone keeps a mark: a dot or a tick on ordinary
          // work made a label read like a verdict. A block is the one state a
          // reader has to notice, so it keeps its signal.
          const children0 = [h('div', { key: 'b', className: 'ov-sg-body' }, children)]
          if (row.state === 'blocked') {
            children0.unshift(h('span', { key: 'm', className: 'ov-tl-mark', 'aria-hidden': 'true' }, '!'))
          }
          return h('div', { key: row.id, className: 'ov-tl-row ov-sg', 'data-kind': row.state }, children0)
        }))
      }

      const briefRows = (target, skip, skipTopics) => {
        const sealed = target?.brief !== null && target?.brief !== undefined && Array.isArray(target.brief.items) ? target.brief.items : []
        // A raw reply is a transcript, not a brief: the row already carries
        // the one-line outcome, and printing the whole answer here is exactly
        // the wall of prose this page exists to avoid.
        const same = (text) => String(text).replace(/[\s。！？；：，、.!?;:,]/gu, '') === String(skip).replace(/[\s。！？；：，、.!?;:,]/gu, '')
        // One piece of work appears once: a topic already stated by the work
        // segments above is not repeated as a brief row below them.
        const repeated = (text) => skipTopics !== undefined && skipTopics !== null && skipTopics.has(String(text ?? '').trim())
        const rows = sealed.filter((item) => item !== null && item !== undefined && item.id !== 'no-facts' && item.source !== 'transcript' && !(skip !== undefined && same(item.text ?? item.value ?? '')) && !repeated(item.text ?? item.value ?? ''))
        publishItems(target.roundId, rows)
        if (rows.length === 0) return null
        return h('div', { key: 'b', className: 'ov-brief' }, rows.map((item, index) => {
          const key = itemKeyOf(target.roundId, item)
          return h(BriefItem, {
            key: `${key}:${index}`, item, itemKey: key, roundId: target.roundId,
            tone: toneOfItem(item, target), open: expandedRef.current.has(key),
            evidenceOpen: evidenceOpenRef.current[key] === true,
            onToggle: applyExpanded, onEvidence: applyEvidenceOpen, onOpenLink: openLink, isDead: deadLink
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
        const source = history !== null && Array.isArray(history.items)
          ? history.items.filter(substantiveOf)
          : (snapshot !== null && snapshot.history !== null && snapshot.history !== undefined && Array.isArray(snapshot.history.items) ? snapshot.history.items : [])
        const parts = []
        // A row reads as a heading and one line under it: the heading says what
        // the round got done, the line says how it ended.
        const textNode = (titleText, subText) => h('span', { key: 't', className: 'ov-history-text' }, [
          h('span', { key: 'h', className: 'ov-history-title' }, titleText),
          subText === '' ? null : h('span', { key: 's', className: 'ov-history-sub' }, subText)
        ])
        const card = (key, titleText, subText, timeText, open, canOpen, bodyNode) => h('div', { key, className: 'ov-history-item', 'data-open': open === true ? '' : undefined }, [
          canOpen
            ? h('button', {
              key: 'row', type: 'button', className: 'ov-history-row',
              'data-action': 'open-round', 'data-round': key,
              'aria-expanded': open === true ? 'true' : 'false'
            }, [
              textNode(titleText, subText),
              timeText === '' ? null : h('span', { key: 'a', className: 'ov-history-time' }, timeText),
              h('span', { key: 'c', className: 'ov-row-chevron', 'aria-hidden': 'true' }, '›')
            ])
            : h('div', { key: 'row', className: 'ov-history-row ov-history-row-static' }, [
              textNode(titleText, subText),
              timeText === '' ? null : h('span', { key: 'a', className: 'ov-history-time' }, timeText)
            ]),
          open === false ? null : h('div', { key: 'd', className: 'ov-round-body' }, bodyNode)
        ])

        // Every row here is a stored round. Rows open on their own: each body
        // is keyed to its own round, so several rows can be read at once.
        const rows = source
        if (rows.length === 0) {
          parts.push(h('div', { key: 'e', className: 'ov-sub' }, historyLoading === true ? words.historyLoading : words.historyEmpty))
        }
        parts.push(h('div', { key: 'r', className: 'ov-history-list' }, rows.map((row, index) => {
          const primary = primaryOf(row, sessionTitle, words)
          const key = row.roundId === undefined || row.roundId === null ? `r${index}` : String(row.roundId)
          const open = expandedRef.current.has(`h:${key}`)
          // A stored round can always be asked for: its paragraph may be missing
          // while the facts behind it are on disk, and an unopenable newest row is
          // the one place a reader has no other way in.
          // A row is a door only when there is a room behind it: no empty
          // expansion, and no arrow on a row that holds nothing.
          const rowSteps = stepsOf(row)
          // A row opens onto work, not onto a reply: the reply is in the
          // conversation, and an expansion that only quotes it is the thing
          // this page was built to replace.
          const projected = rowSteps.length > 0
            || segmentsOf(row).length > 0
            || (typeof row.progress === 'string' && row.progress !== '')
          const loaded = open === true ? (roundsRef.current[key] === undefined ? null : roundsRef.current[key]) : null
          // The line under the heading is one sentence about what changed, as
          // the server wrote it. A count of edits is statistics, not a summary.
          const rowTitle = typeof row.title === 'string' ? row.title : ''
          const preview = typeof row.line === 'string' ? row.line.trim() : ''
          // A read that failed leaves nothing to show: the row stays as it read
          // in the list instead of opening onto a note about the read itself.
          const failedRead = roundErrorRef.current.has(key) === true
          const bodyNode = open === false || failedRead ? null
            : loaded === null
              ? h('div', { key: 'l', className: 'ov-sub' }, words.loading)
              : (() => {
                  // A round opens onto the work it covered: a few statements,
                  // then the things it produced. Commands were never content.
                  // A topic the segments already state is not repeated below.
                  const segTopics = new Set()
                  for (const seg of segmentsOf(loaded)) {
                    const topic = typeof seg.topic === 'string' ? seg.topic.trim() : ''
                    if (topic !== '') segTopics.add(topic)
                  }
                  const segments = segmentsNode(loaded, rowTitle)
                  const sealed = briefRows(loaded, primary, segTopics)
                  const nodes = []
                  if (segments !== null) nodes.push(segments)
                  if (sealed !== null) nodes.push(sealed)
                  // The stop reason is run state, not work content: one quiet
                  // line under the text, never the row's title.
                  if (typeof loaded.stopReason === 'string' && loaded.stopReason !== '') {
                    nodes.push(h('div', { key: 'x', className: 'ov-stop' }, loaded.stopReason))
                  }
                  return nodes.length === 0 ? null : h('div', { key: 'b', className: 'ov-card' }, nodes)
                })()
          // A chevron must not lie: a round that prints nothing behind it falls
          // back to a static row instead of an empty box under a live arrow.
          const shownOpen = open === true && bodyNode !== null
          const canOpen = open === true ? shownOpen : projected && !failedRead
          const stopped = typeof row.stopState === 'string' ? row.stopState : ''
          const stamp = [timeOf(row.archivedAt, now), stopped].filter((part) => part !== '').join(' · ')
          return card(key, rowTitle === '' ? primary : rowTitle, preview, stamp, shownOpen, canOpen, bodyNode)
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
          // A topic the segments already state below is not printed twice: the
          // statement above is the work, a row below would only echo it.
          const segTopics = new Set()
          for (const seg of segmentsOf(roundOfSnapshot)) {
            if (typeof seg.topic === 'string' && seg.topic.trim() !== '') segTopics.add(seg.topic.trim())
          }
          const items = rawItems.filter((item) => {
            if (item === null || item === undefined || item.id === 'no-facts') return false
            const raw = item.text === undefined || item.text === null ? '' : String(item.text)
            const text = raw.trim()
            return text === '' || !segTopics.has(text)
          })
          publishItems(roundOfSnapshot.roundId, items)
          const updated = timeOf(roundOfSnapshot.contentAt, now)
          const roundLabel = words.currentRound
          // The small row says which round and when; the work below speaks for
          // itself, so the round's own title is not printed a second time.
          // How long this round has been going is the thing the conversation
          // itself cannot show: it prints nothing while it works.
          const elapsedMs = typeof roundOfSnapshot.elapsedMs === 'number' ? roundOfSnapshot.elapsedMs : 0
          const elapsed = elapsedMs >= 60 * 1000 ? `${words.elapsed} ${durationOf(elapsedMs)}` : ''
          body.push(h('div', { key: 'rb', className: 'ov-roundbar' }, [
            h('span', { key: 'l', className: 'ov-round-label' }, roundLabel),
            elapsed === '' ? null : h('span', { key: 'e', className: 'ov-round-label' }, elapsed),
            updated === '' ? null : h('span', { key: 'u', className: 'ov-round-label' }, `${words.updated} ${updated}`)
          ]))
          // A Goal objective describes the whole session, not this round: printing
          // it here made an unrelated goal read as the answer to this ask.
          // A round with nothing to report prints no heading: the fallback
          // word ("本次任务") is a label, not a title.
          // The current round leads with what it has been doing, because the
          // conversation prints nothing while it works. The reply is not a
          // source here: it is the line the conversation ends with, and this
          // page exists for the stretch before it.
          // One sentence for the work as a whole, so the reader sees what is
          // happening without reading every line below it.
          const progressText = typeof roundOfSnapshot.progressText === 'string' ? roundOfSnapshot.progressText.trim() : ''
          // Per-call rows are the trail, not the work. The sentence above says
          // what the trail amounts to, and only real outcomes get a row of
          // their own, so a stretch of edits and passing checks reads as one
          // line instead of a log.
          const quiet = items.length === 0 && progressText === '' && segmentsOf(roundOfSnapshot).length === 0
          if (progressText !== '') body.push(h('p', { key: 'pg', className: 'ov-progress' }, progressText))
          // The work this round covered, folded into a few statements. The
          // commands behind them stay on the wire as evidence and never here.
          const workSegments = segmentsNode(roundOfSnapshot)
          if (workSegments !== null) body.push(workSegments)
          // A round with nothing recorded says so, instead of quoting itself.
          if (quiet) body.push(h('p', { key: 'pend', className: 'ov-quiet' }, words.noProcess))
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
                onToggle: applyExpanded, onEvidence: applyEvidenceOpen, onOpenLink: openLink, isDead: deadLink
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
              const usable = rawLink !== null && !deadLink(rawLink)
                && ((typeof rawLink.path === 'string' && rawLink.path !== '')
                  || (typeof rawLink.url === 'string' && rawLink.url !== ''))
              const link = usable ? rawLink : null
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
          // 答疑 waits at the bottom of the page: the round is read first, then a
          // question is asked about it, and the exchange grows upward from the field.
          body.push(h(SideAsk, { key: 'ask', sessionId, roundId: roundOfSnapshot.roundId, words }))
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
