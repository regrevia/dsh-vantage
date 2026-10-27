window.__ModuleLoader__.load({
  id: 'dsh-vantage', // ui-copy-ignore
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const HOST_BASE = '/api/dsh-vantage' // ui-copy-ignore
    const VIEW_ID = 'vantage' // ui-copy-ignore
    const POLL_MS = 5000 // ui-copy-ignore
    const LEASE_MS = 15000 // ui-copy-ignore
    const REQUEST_MS = 8000 // ui-copy-ignore
    const LEASE_STORAGE = 'dsh-vantage.lease' // ui-copy-ignore
    const STYLE_ID = 'dsh-vantage-style' // ui-copy-ignore

    const COPY = {
      zh: { // ui-copy-ignore
        label: '概览', // ui-copy-ignore
        emptyTitle: '还没有可概览的工作',
        emptyBody: '这一轮有记录之后，这里会显示进展和核验结果。',
        failedTitle: '概览没能显示', // ui-copy-ignore
        blocked: '这个会话只能在自己的窗口里查看', // ui-copy-ignore
        loading: '正在读取', // ui-copy-ignore
        retry: '重试', // ui-copy-ignore
        elapsed: '本轮历时', // ui-copy-ignore
        updated: '摘要更新于', // ui-copy-ignore
        factsUpdated: '依据更新于',
        summaryIdle: '摘要未更新',
        unverified: '尚未验证',
        justNow: '刚刚', // ui-copy-ignore
        underMinute: '不到 1 分钟',
        minuteUnit: '分钟前',
        minutesUnit: '分钟',
        hourUnit: '小时', // ui-copy-ignore
        shortMinuteUnit: '分',
        status: { // ui-copy-ignore
          checking: '正在核对相关工作', // ui-copy-ignore
          running: '正在处理', // ui-copy-ignore
          waiting: '等待后台结果', // ui-copy-ignore
          'needs-input': '需要你处理', // ui-copy-ignore
          failing: '当前验证未通过', // ui-copy-ignore
          'no-news': '暂无新进展', // ui-copy-ignore
          disconnected: '连接已断开', // ui-copy-ignore
          'summary-paused': '摘要已暂停', // ui-copy-ignore
          'answered-unverified': '本轮已回复，仍有待验证', // ui-copy-ignore
          verified: '本轮已回复，核验通过', // ui-copy-ignore
          unknown: '本轮状态暂不可知' // ui-copy-ignore
        },
        notices: { // ui-copy-ignore
          'no-data': '尚未收到本会话的记录', // ui-copy-ignore
          disconnected: '连接已断开', // ui-copy-ignore
          'goal-unknown': '目标状态暂不可知', // ui-copy-ignore
          'summary-paused': '摘要额度已用完 一小时后恢复' // ui-copy-ignore
        },
        verify: { // ui-copy-ignore
          passed: '核验已通过', // ui-copy-ignore
          failed: '验证未通过', // ui-copy-ignore
          recheck: '需要重新核对', // ui-copy-ignore
          pending: '验证还没有开始', // ui-copy-ignore
          unknown: '核验状态暂不可知', // ui-copy-ignore
          na: '没有可核验项' // ui-copy-ignore
        },
        roundState: { // ui-copy-ignore
          'awaiting-reply': '等待回复', // ui-copy-ignore
          archived: '本轮已归档', // ui-copy-ignore
          unknown: '本轮状态暂不可知' // ui-copy-ignore
        },
        goalState: { // ui-copy-ignore
          active: '目标进行中', // ui-copy-ignore
          complete: '目标已完成', // ui-copy-ignore
          none: '没有目标', // ui-copy-ignore
          unknown: '目标状态暂不可知' // ui-copy-ignore
        },
        history: '历史', // ui-copy-ignore
        historyAll: '查看全部', // ui-copy-ignore
        historyEmpty: '还没有更早的轮次',
        historyViewing: '正在查看历史', // ui-copy-ignore
        historyBack: '返回当前', // ui-copy-ignore
        historyFailed: '历史记录没能读取', // ui-copy-ignore
        facts: '查看依据', // ui-copy-ignore
        evidenceEmpty: '没有可展开的依据',
        evidenceUnreadable: '这一项依据当前不可读', // ui-copy-ignore
        request: '重新核对', // ui-copy-ignore
        requesting: '正在核对',
        follow: '持续跟进', // ui-copy-ignore
        following: '已开启跟进',
        skipped: { // ui-copy-ignore
          budget: '自动摘要额度已用完', // ui-copy-ignore
          fresh: '当前已是新的', // ui-copy-ignore
          running: '正在核对', // ui-copy-ignore
          disabled: '自动摘要已关闭', // ui-copy-ignore
          'no-model': '没有可用的摘要模型' // ui-copy-ignore
        },
        unchanged: '没有变化'
      },
      en: { // ui-copy-ignore
        label: 'Overview', // ui-copy-ignore
        emptyTitle: 'No work to summarize yet',
        emptyBody: 'Progress and checks appear here once this turn has a record.',
        failedTitle: 'The overview did not load', // ui-copy-ignore
        blocked: 'This session can only be viewed in its own window',
        loading: 'Reading', // ui-copy-ignore
        retry: 'Retry', // ui-copy-ignore
        elapsed: 'Elapsed', // ui-copy-ignore
        updated: 'Summary updated', // ui-copy-ignore
        factsUpdated: 'Evidence updated',
        summaryIdle: 'Summary not updated',
        unverified: 'Not verified',
        justNow: 'just now', // ui-copy-ignore
        underMinute: 'under a minute',
        minuteUnit: 'min ago',
        minutesUnit: 'min',
        hourUnit: 'h', // ui-copy-ignore
        shortMinuteUnit: 'min',
        status: { // ui-copy-ignore
          checking: 'Checking related work', // ui-copy-ignore
          running: 'Working', // ui-copy-ignore
          waiting: 'Waiting for background results', // ui-copy-ignore
          'needs-input': 'Needs you', // ui-copy-ignore
          failing: 'Checks fail', // ui-copy-ignore
          'no-news': 'No new progress', // ui-copy-ignore
          disconnected: 'Connection lost', // ui-copy-ignore
          'summary-paused': 'Summary paused', // ui-copy-ignore
          'answered-unverified': 'Replied, not verified', // ui-copy-ignore
          verified: 'Replied, checks pass', // ui-copy-ignore
          unknown: 'Round state unavailable' // ui-copy-ignore
        },
        notices: { // ui-copy-ignore
          'no-data': 'No records for this session yet', // ui-copy-ignore
          disconnected: 'Connection lost', // ui-copy-ignore
          'goal-unknown': 'Goal state unavailable', // ui-copy-ignore
          'summary-paused': 'Summary budget spent, back within the hour' // ui-copy-ignore
        },
        verify: { // ui-copy-ignore
          passed: 'Checks pass', // ui-copy-ignore
          failed: 'Checks fail', // ui-copy-ignore
          recheck: 'Needs a re-check', // ui-copy-ignore
          pending: 'Checks not started', // ui-copy-ignore
          unknown: 'Check state unavailable', // ui-copy-ignore
          na: 'Nothing to check' // ui-copy-ignore
        },
        roundState: { // ui-copy-ignore
          'awaiting-reply': 'Waiting for reply', // ui-copy-ignore
          archived: 'Round archived', // ui-copy-ignore
          unknown: 'Round state unavailable' // ui-copy-ignore
        },
        goalState: { // ui-copy-ignore
          active: 'Goal active', // ui-copy-ignore
          complete: 'Goal complete', // ui-copy-ignore
          none: 'No goal', // ui-copy-ignore
          unknown: 'Goal state unavailable' // ui-copy-ignore
        },
        history: 'Earlier rounds', // ui-copy-ignore
        historyAll: 'Show all', // ui-copy-ignore
        historyEmpty: 'No earlier rounds',
        historyViewing: 'Viewing history', // ui-copy-ignore
        historyBack: 'Back to now', // ui-copy-ignore
        historyFailed: 'History did not load', // ui-copy-ignore
        facts: 'View evidence', // ui-copy-ignore
        evidenceEmpty: 'Nothing to expand',
        evidenceUnreadable: 'This evidence is unreadable right now', // ui-copy-ignore
        request: 'Re-check', // ui-copy-ignore
        requesting: 'Checking',
        follow: 'Keep following', // ui-copy-ignore
        following: 'Following',
        skipped: { // ui-copy-ignore
          budget: 'Summary budget used up', // ui-copy-ignore
          fresh: 'Already current', // ui-copy-ignore
          running: 'Already checking', // ui-copy-ignore
          disabled: 'Auto summary off', // ui-copy-ignore
          'no-model': 'No summary model' // ui-copy-ignore
        },
        unchanged: 'No change'
      }
    }

    /** Host locale decides the copy; Chinese is the default. */ // ui-copy-ignore
    const langOf = (ctx) => {
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
    let LANG = 'zh' // ui-copy-ignore
    try {
      LANG = /^en/i.test(navigator.language || '') ? 'en' : 'zh' // ui-copy-ignore
    } catch (error) {}
    const copy = () => COPY[LANG]

    // Language changed: every open overview re-reads COPY.
    const localeListeners = new Set() // ui-copy-ignore
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
.dsv-root {
  container-type: inline-size; display: flex; justify-content: center; width: 100%; padding: 28px 32px 40px; box-sizing: border-box; color: var(--dsw-alias-label-primary); font-size: 14px; line-height: 22px; font-family: ui-sans-serif, system-ui, "PingFang SC", "Noto Sans SC", "Microsoft YaHei", sans-serif;
}
.dsv-panel {
  width: 100%; max-width: 760px; min-width: 0; display: flex; flex-direction: column; gap: 24px;
}
.dsv-head { display: flex; flex-direction: column; gap: 6px; }
.dsv-title {
  margin: 0; font-size: 20px; line-height: 28px; font-weight: 600; overflow-wrap: anywhere; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}
.dsv-status { font-size: 14px; line-height: 22px; color: var(--dsw-alias-label-primary); }
.dsv-meta {
  display: flex; flex-wrap: wrap; gap: 12px; font-size: 12px; line-height: 20px; color: var(--dsw-alias-label-secondary); font-variant-numeric: tabular-nums;
}
.dsv-head-row { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; min-height: 24px; }
.dsv-head-state { display: flex; align-items: center; gap: 8px; min-width: 0; }
.dsv-dot { width: 8px; height: 8px; flex: none; border-radius: 50%; background: var(--dsw-alias-label-secondary); }
.dsv-dot[data-tone="info"] { background: var(--dsw-alias-brand-primary); }
.dsv-dot[data-tone="success"] { background: var(--dsw-alias-state-success-primary); }
.dsv-dot[data-tone="warn"] { background: var(--dsw-alias-state-warn-primary); }
.dsv-dot[data-tone="error"] { background: var(--dsw-alias-state-error-primary); }
.dsv-brief { display: flex; flex-direction: column; }
.dsv-brief-item { border-top: 1px solid var(--dsw-alias-border-l1); }
.dsv-brief-item:first-child { border-top: 0; }
.dsv-brief-head {
  display: grid; grid-template-columns: 16px minmax(0, 1fr) auto 12px; gap: 10px; align-items: start; width: 100%; min-height: 48px; padding: 12px 0; margin: 0; border: 0; background: transparent; color: inherit; font: inherit; text-align: left; cursor: pointer;
}
.dsv-brief-head:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 2px; }
.dsv-brief-text { overflow-wrap: anywhere; }
.dsv-qual { align-self: start; padding: 0 8px; border-radius: 6px; border: 1px solid var(--dsw-alias-border-l2); color: var(--dsw-alias-state-warn-primary); font-size: 12px; line-height: 20px; white-space: nowrap; }
.dsv-chevron { color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 22px; }
.dsv-detail { display: flex; flex-direction: column; gap: 8px; padding: 0 0 16px 26px; }
.dsv-detail-row { display: flex; gap: 8px; min-width: 0; font-size: 14px; line-height: 22px; }
.dsv-detail-label { flex: none; color: var(--dsw-alias-label-secondary); }
.dsv-detail-value { min-width: 0; overflow-wrap: anywhere; }
.dsv-notices { display: flex; flex-direction: column; gap: 4px; }
.dsv-notice {
  font-size: 12px; line-height: 20px; color: var(--dsw-alias-state-warn-primary);
}
.dsv-section { display: flex; flex-direction: column; gap: 8px; }
.dsv-section-head {
  display: flex; align-items: center; gap: 8px; min-height: 24px; font-size: 12px; line-height: 20px; color: var(--dsw-alias-label-secondary);
}
.dsv-row {
  display: grid; grid-template-columns: 16px minmax(0, 1fr); gap: 10px; align-items: start; min-height: 48px; padding: 12px 0; border-top: 1px solid var(--dsw-alias-border-l1); box-sizing: border-box;
}
.dsv-rows > .dsv-row:first-child { border-top: 0; }
.dsv-glyph {
  width: 16px; height: 16px; margin-top: 3px; border-radius: 50%; border: 1px solid var(--dsw-alias-border-l2); box-sizing: border-box;
}
.dsv-glyph[data-tone="warn"] { border-color: var(--dsw-alias-state-warn-primary); background: var(--dsw-alias-state-warn-primary); }
.dsv-glyph[data-tone="error"] { border-color: var(--dsw-alias-state-error-primary); background: var(--dsw-alias-state-error-primary); }
.dsv-glyph[data-tone="success"] { border-color: var(--dsw-alias-state-success-primary); background: var(--dsw-alias-state-success-primary); }
.dsv-row-body { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.dsv-text { overflow-wrap: anywhere; }
.dsv-sub { font-size: 12px; line-height: 20px; color: var(--dsw-alias-label-secondary); }
.dsv-link {
  align-self: flex-start; min-height: 32px; padding: 4px 0; border: 0; background: transparent; color: var(--dsw-alias-brand-primary); font: inherit; font-size: 12px; line-height: 20px; cursor: pointer;
}
.dsv-link:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 2px; }
.dsv-evidence { display: flex; flex-direction: column; gap: 8px; }
.dsv-evidence-item {
  padding: 10px 12px; border-radius: 6px; background: var(--dsw-alias-bg-layer-1); border: 1px solid var(--dsw-alias-border-l1);
}
.dsv-evidence-label { font-size: 12px; line-height: 20px; color: var(--dsw-alias-label-secondary); }
.dsv-evidence-text {
  margin: 4px 0 0; font-size: 14px; line-height: 22px; white-space: pre-wrap; overflow-wrap: anywhere; color: var(--dsw-alias-label-primary);
}
.dsv-list { display: flex; flex-direction: column; }
.dsv-history-row {
  display: flex; justify-content: space-between; gap: 12px; align-items: baseline; width: 100%; min-height: 48px; padding: 12px 0; margin: 0; border: 0; border-top: 1px solid var(--dsw-alias-border-l1); background: transparent; color: inherit; font: inherit; text-align: left; cursor: pointer;
}
.dsv-history-row:first-child { border-top: 0; }
.dsv-history-row:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 2px; }
.dsv-history-row[aria-current="true"] .dsv-history-title { color: var(--dsw-alias-brand-primary); }
.dsv-history-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsv-history-time { flex: none; font-size: 12px; line-height: 20px; color: var(--dsw-alias-label-secondary); font-variant-numeric: tabular-nums; }
.dsv-viewing {
  display: flex; flex-direction: column; gap: 12px; padding: 16px 0 20px; border-top: 2px solid var(--dsw-alias-border-l1); border-bottom: 1px solid var(--dsw-alias-border-l1);
}
.dsv-viewing-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.dsv-foot {
  display: flex; flex-wrap: wrap; gap: 8px; align-items: center; padding-top: 16px; border-top: 1px solid var(--dsw-alias-border-l1);
}
.dsv-button {
  min-height: 36px; padding: 0 14px; border-radius: 6px; border: 1px solid var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); font: inherit; font-size: 14px; cursor: pointer;
}
.dsv-button[aria-pressed="true"] { border-color: var(--dsw-alias-brand-primary); color: var(--dsw-alias-brand-primary); }
.dsv-button:disabled { color: var(--dsw-alias-label-secondary); cursor: default; }
.dsv-button:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 2px; }
.dsv-empty {
  display: flex; flex-direction: column; gap: 6px; padding: 48px 0; color: var(--dsw-alias-label-secondary);
}
.dsv-empty-title { font-size: 16px; line-height: 24px; color: var(--dsw-alias-label-primary); }
@container (max-width: 560px) {
  .dsv-root { padding: 16px 16px 32px; }
}
`

    function ensureStyle() {
      if (typeof document === 'undefined') return
      if (document.getElementById(STYLE_ID) !== null) return
      const node = document.createElement('style')
      node.id = STYLE_ID
      node.textContent = STYLE
      document.head.appendChild(node)
    }

    function timeOf(at, now) {
      if (typeof at !== 'number' || at <= 0) return ''
      const words = copy()
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
        const response = await fetch(`${HOST_BASE}${path}`, init) // ui-copy-ignore
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

    function leaseIdOf(sessionId) {
      try {
        const key = `${LEASE_STORAGE}.${sessionId}` // ui-copy-ignore
        const kept = window.sessionStorage.getItem(key)
        if (typeof kept === 'string' && kept !== '') return kept
        const created = `${sessionId.slice(0, 6)}-${Math.random().toString(36).slice(2, 10)}` // ui-copy-ignore
        window.sessionStorage.setItem(key, created)
        return created
      } catch (error) {
        return `anon-${Math.random().toString(36).slice(2, 10)}` // ui-copy-ignore
      }
    }

    // Colour follows the result, never the kind of fact that carries it.
    function toneOfCondition(state) {
      if (state === 'failed') return 'error'
      if (state === 'recheck' || state === 'unknown') return 'warn'
      if (state === 'pending') return 'neutral'
      if (state === 'passed') return 'success'
      return 'neutral'
    }

    function conditionMatches(text, condition) {
      const topic = condition === null || condition === undefined ? '' : String(condition.text ?? '')
      return topic !== '' && text.indexOf(topic) !== -1
    }

    // A line the server painted green is re-checked against the verification
    // state of the condition it names, so a failed check can never read as passed.
    function toneOfItem(item, conditions) {
      const tone = item === null || item === undefined || item.tone === undefined ? 'neutral' : item.tone
      if (tone !== 'success' || !Array.isArray(conditions)) return tone
      const text = String(item.text ?? '')
      for (const condition of conditions) {
        if (!conditionMatches(text, condition)) continue
        if (condition.state === 'failed') return 'error'
        if (condition.state === 'recheck' || condition.state === 'unknown') return 'warn'
      }
      return tone
    }

    // Archived facts carry a kind, not a tone; the kind decides the colour only
    // until a verification condition for the same topic says otherwise.
    function toneOfFact(fact, conditions) {
      if (fact === null || fact === undefined) return 'neutral'
      const text = String(fact.statement ?? '')
      if (Array.isArray(conditions)) {
        for (const condition of conditions) {
          if (!conditionMatches(text, condition)) continue
          if (condition.state === 'failed') return 'error'
          if (condition.state === 'recheck' || condition.state === 'unknown') return 'warn'
        }
      }
      if (fact.kind === 'failure') return 'error' // ui-copy-ignore
      if (fact.kind === 'blocker') return 'warn' // ui-copy-ignore
      if (fact.validity === 'needsRecheck') return 'warn' // ui-copy-ignore
      if (fact.kind === 'deliverable' || fact.kind === 'check') return 'success' // ui-copy-ignore
      return 'neutral'
    }

    function toneOfStatus(round) {
      if (round !== null && round !== undefined && round.verificationState === 'failed') return 'error'
      const tone = round === null || round === undefined ? undefined : round.statusTone
      if (tone === 'error' || tone === 'warn' || tone === 'success' || tone === 'info') return tone
      return 'neutral'
    }

    // The runtime owns the decision; the client owns the words for every key it can send.
    function statusTextOf(round) {
      if (round === null || round === undefined) return copy().status.unknown
      const status = copy().status
      if (typeof round.statusKey === 'string' && status[round.statusKey] !== undefined) return status[round.statusKey]
      const roundState = copy().roundState
      if (typeof round.roundState === 'string' && roundState[round.roundState] !== undefined) return roundState[round.roundState]
      return typeof round.statusLine === 'string' && round.statusLine !== '' ? round.statusLine : copy().status.unknown
    }

    function verifyTextOf(round) {
      const verify = copy().verify
      const state = round === null || round === undefined ? undefined : round.verificationState
      if (state !== undefined && verify[state] !== undefined) return verify[state]
      return verify.unknown
    }

    function Row(props) {
      const tone = props.tone === undefined ? 'neutral' : props.tone
      return h('div', { className: 'dsv-row' }, [
        h('span', { key: 'g', className: 'dsv-glyph', 'data-tone': tone, 'aria-hidden': 'true' }),
        h('div', { key: 'b', className: 'dsv-row-body' }, [
          h('span', { key: 't', className: 'dsv-text' }, props.text),
          props.sub === undefined ? null : h('span', { key: 's', className: 'dsv-sub' }, props.sub),
          props.action === undefined ? null : h('button', {
            key: 'a',
            type: 'button',
            className: 'dsv-link',
            onClick: props.action.onClick,
            'aria-expanded': props.action.expanded
          }, props.action.label),
          props.extra === undefined ? null : props.extra
        ])
      ])
    }

    // One line telling a reader where a trace came from and when it happened.
    function evidenceStampOf(now, ref) {
      const name = ref.label === '' || ref.label === undefined ? ref.type : ref.label // ui-copy-ignore
      const stamp = timeOf(ref.time, now === undefined ? Date.now() : now)
      return stamp === '' ? name : `${name} · ${stamp}`
    }

    function Evidence(props) {
      if (props.state === 'loading') return h('div', { className: 'dsv-sub' }, copy().loading)
      if (props.state === 'unreadable') {
        return h('div', { className: 'dsv-evidence' }, [
          h('div', { key: 'm', className: 'dsv-sub' }, copy().evidenceUnreadable),
          h('button', { key: 'r', type: 'button', className: 'dsv-link', onClick: props.onRetry }, copy().retry)
        ])
      }
      if (!Array.isArray(props.refs) || props.refs.length === 0) return h('div', { className: 'dsv-sub' }, copy().evidenceEmpty)
      return h('div', { className: 'dsv-evidence' }, props.refs.map((ref) => h('div', { key: `${ref.seq}`, className: 'dsv-evidence-item' }, [
        h('div', { key: 'l', className: 'dsv-evidence-label' }, evidenceStampOf(props.now, ref)),
        h('pre', { key: 'x', className: 'dsv-evidence-text' }, ref.excerpt)
      ])))
    }

    const CONCLUDING_KINDS = new Set(['blocker', 'failure', 'deliverable', 'check', 'change', 'interruption'])

    // The archived round the reader opened from history, shown above the live one.
    function ArchivedRound(props) {
      const viewing = props.viewing
      const now = props.now
      const round = viewing.round
      const head = h('div', { key: 'h', className: 'dsv-viewing-head' }, [
        h('span', { key: 'm', className: 'dsv-sub' }, copy().historyViewing),
        h('button', { key: 'b', type: 'button', className: 'dsv-link', onClick: props.onBack }, copy().historyBack)
      ])
      if (viewing.state === 'loading') {
        return h('section', { className: 'dsv-viewing' }, [head, h('div', { key: 'l', className: 'dsv-sub' }, copy().loading)])
      }
      if (viewing.state !== 'ready' || round === null || round === undefined) {
        return h('section', { className: 'dsv-viewing' }, [
          head,
          h('div', { key: 'f', className: 'dsv-sub' }, copy().historyFailed),
          h('button', { key: 'r', type: 'button', className: 'dsv-link', onClick: props.onRetry }, copy().retry)
        ])
      }
      const conditions = round.verification !== null && round.verification !== undefined && Array.isArray(round.verification.conditions)
        ? round.verification.conditions
        : []
      // A sealed round is read as conclusions. Command output and error text stay
      // in the evidence for that fact instead of becoming bullets.
      const facts = (Array.isArray(round.facts) ? round.facts : []).filter((fact) => CONCLUDING_KINDS.has(fact.kind))
      const at = typeof round.archivedAt === 'number' && round.archivedAt > 0 ? round.archivedAt : round.startedAt
      return h('section', { className: 'dsv-viewing' }, [
        head,
        h('h2', { key: 't', className: 'dsv-title' }, round.title),
        h('div', { key: 'm', className: 'dsv-meta' }, [
          h('span', { key: 's' }, statusTextOf(round)),
          h('span', { key: 'v' }, verifyTextOf(round)),
          h('span', { key: 'a' }, timeOf(at, now))
        ]),
        facts.length === 0
          ? h('div', { key: 'e', className: 'dsv-sub' }, copy().evidenceEmpty)
          : h('div', { key: 'f', className: 'dsv-rows' }, facts.map((fact) => h(Row, {
            key: fact.id === undefined ? fact.statement : fact.id,
            tone: toneOfFact(fact, conditions),
            text: fact.statement
          })))
      ])
    }

    function View(props) {
      ensureStyle()
      React.useEffect(() => {
        const root = document.documentElement
        root.setAttribute('data-dsv-overview', '')
        return () => {
          root.removeAttribute('data-dsv-overview')
        }
      }, [])
      const sessionId = props.sessionId
      const [snapshot, setSnapshot] = React.useState(null)
      const [blocked, setBlocked] = React.useState(false)
      const [failed, setFailed] = React.useState(false)
      const [loading, setLoading] = React.useState(true)
      const [openItem, setOpenItem] = React.useState(null) // ui-copy-ignore
      const [openHistory, setOpenHistory] = React.useState(false)
      const [history, setHistory] = React.useState(null)
      const [historyFailed, setHistoryFailed] = React.useState(false)
      const [viewing, setViewing] = React.useState(null)
      const [busy, setBusy] = React.useState(false)
      const [verdict, setVerdict] = React.useState('')
      const [evidence, setEvidence] = React.useState(null)
      const [, setLocaleTick] = React.useState(0)
      const revisionRef = React.useRef(null)
      const aliveRef = React.useRef(true)
      const seqRef = React.useRef({})

      // One monotonic counter per channel: a late answer to an older question
      // must never overwrite a newer one, and nothing lands after unmount.
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
          setLocaleTick((tick) => tick + 1)
        })
      }, [])

      const load = React.useCallback(async (force) => {
        const fresh = claim('snapshot')
        if (fresh === null) return
        const query = new URLSearchParams({ session: sessionId })
        if (!force && revisionRef.current !== null) query.set('revision', revisionRef.current)
        const answer = await callHost(`/snapshot?${query.toString()}`) // ui-copy-ignore
        if (fresh() !== true) return
        if (answer.blocked === true) {
          setBlocked(true)
          setLoading(false)
          return
        }
        if (answer.failed === true || answer.body === null) {
          setFailed(true)
          setLoading(false)
          return
        }
        setBlocked(false)
        setFailed(false)
        setLoading(false)
        if (answer.body.kind === 'unchanged') return // ui-copy-ignore
        revisionRef.current = answer.body.revision
        setSnapshot(answer.body)
      }, [claim, sessionId])

      React.useEffect(() => {
        revisionRef.current = null
        setSnapshot(null)
        setHistory(null)
        setHistoryFailed(false)
        setViewing(null)
        setEvidence(null)
        setOpenHistory(false)
        load(true)
      }, [load])

      React.useEffect(() => {
        const leaseId = leaseIdOf(sessionId)
        let disposed = false
        const beat = async (visible) => {
          if (disposed) return
          await callHost('/lease', { // ui-copy-ignore
            method: 'POST',
            headers: { 'content-type': 'application/json' }, // ui-copy-ignore
            body: JSON.stringify({ session: sessionId, leaseId, visible }) // ui-copy-ignore
          })
        }
        beat(true)
        const tick = () => {
          if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return
          load(false)
        }
        const poll = setInterval(tick, POLL_MS)
        const lease = setInterval(() => {
          if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return
          beat(true)
        }, LEASE_MS)
        const onVisibility = () => {
          if (document.visibilityState === 'visible') {
            load(false)
            beat(true)
          } else {
            beat(false)
          }
        }
        document.addEventListener('visibilitychange', onVisibility)
        return () => {
          disposed = true
          clearInterval(poll)
          clearInterval(lease)
          document.removeEventListener('visibilitychange', onVisibility)
        }
      }, [load, sessionId])

      const requestSummary = async () => {
        const fresh = claim('action')
        if (fresh === null) return
        setBusy(true)
        setVerdict('')
        const answer = await callHost('/summary/request', { // ui-copy-ignore
          method: 'POST',
          headers: { 'content-type': 'application/json' }, // ui-copy-ignore
          body: JSON.stringify({ session: sessionId }) // ui-copy-ignore
        })
        if (fresh() !== true) return
        setBusy(false)
        if (answer.blocked === true) {
          setBlocked(true)
          return
        }
        if (answer.failed === true || answer.body === null) {
          setVerdict(copy().skipped.running)
          return
        }
        if (answer.body.kind === 'skipped') setVerdict(copy().skipped[answer.body.reason] ?? '') // ui-copy-ignore
        else load(true)
      }

      const toggleAuto = async () => {
        const fresh = claim('action')
        if (fresh === null) return
        const enabled = !(snapshot !== null && snapshot.coverage.summaryAuto)
        setBusy(true)
        const answer = await callHost('/summary/auto', { // ui-copy-ignore
          method: 'POST',
          headers: { 'content-type': 'application/json' }, // ui-copy-ignore
          body: JSON.stringify({ session: sessionId, enabled }) // ui-copy-ignore
        })
        if (fresh() !== true) return
        setBusy(false)
        if (answer.failed === true) return
        load(true)
      }

      const showEvidence = async (roundId, factId, force) => {
        if (force !== true && evidence !== null && evidence.factId === factId) {
          setEvidence(null)
          return
        }
        const fresh = claim('evidence')
        if (fresh === null) return
        setEvidence({ factId, state: 'loading', refs: [] }) // ui-copy-ignore
        const query = new URLSearchParams({ session: sessionId, round: roundId, fact: factId })
        const answer = await callHost(`/evidence?${query.toString()}`) // ui-copy-ignore
        if (fresh() !== true) return
        if (answer.failed === true || answer.body === null || !Array.isArray(answer.body.refs)) {
          setEvidence({ factId, state: 'unreadable', refs: [] }) // ui-copy-ignore
          return
        }
        setEvidence({ factId, state: 'ready', refs: answer.body.refs }) // ui-copy-ignore
      }

      const openRound = async (roundId) => {
        const fresh = claim('round')
        if (fresh === null) return
        setViewing({ state: 'loading', roundId, round: null }) // ui-copy-ignore
        const query = new URLSearchParams({ session: sessionId, round: roundId })
        const answer = await callHost(`/round?${query.toString()}`) // ui-copy-ignore
        if (fresh() !== true) return
        if (answer.failed === true || answer.body === null || answer.body.round === null || answer.body.round === undefined) {
          setViewing({ state: 'unreadable', roundId, round: null }) // ui-copy-ignore
          return
        }
        setViewing({ state: 'ready', roundId, round: answer.body.round }) // ui-copy-ignore
      }

      const fetchHistory = async (cursor) => {
        const fresh = claim('history')
        if (fresh === null) return
        const first = typeof cursor !== 'string' || cursor === ''
        if (first) setHistoryFailed(false)
        const query = new URLSearchParams({ session: sessionId, limit: '20' }) // ui-copy-ignore
        if (!first) query.set('cursor', cursor)
        const answer = await callHost(`/history?${query.toString()}`) // ui-copy-ignore
        if (fresh() !== true) return
        if (answer.failed === true || answer.body === null || !Array.isArray(answer.body.items)) {
          setHistoryFailed(true)
          return
        }
        const items = answer.body.items
        const next = answer.body.nextCursor === undefined ? null : answer.body.nextCursor
        setHistory((prev) => {
          if (first || prev === null) return { items, nextCursor: next }
          return { items: prev.items.concat(items), nextCursor: next }
        })
      }

      const expandHistory = async () => {
        if (openHistory) {
          setOpenHistory(false)
          return
        }
        setOpenHistory(true)
        if (history !== null) return
        await fetchHistory('')
      }

      if (blocked) {
        return h('div', { className: 'dsv-root' }, h('div', { className: 'dsv-panel' },
          h('div', { className: 'dsv-empty' }, h('div', { className: 'dsv-empty-title' }, copy().blocked))))
      }
      if (loading && snapshot === null) {
        return h('div', { className: 'dsv-root' }, h('div', { className: 'dsv-panel' },
          h('div', { className: 'dsv-empty' }, h('div', {}, copy().loading))))
      }
      if (failed && snapshot === null) {
        return h('div', { className: 'dsv-root' }, h('div', { className: 'dsv-panel' },
          h('div', { className: 'dsv-empty' }, [
            h('div', { key: 't', className: 'dsv-empty-title' }, copy().failedTitle),
            h('button', { key: 'r', type: 'button', className: 'dsv-link', onClick: () => load(true) }, copy().retry)
          ])))
      }
      if (snapshot === null || snapshot.round === null) {
        return h('div', { className: 'dsv-root' }, h('div', { className: 'dsv-panel' },
          h('div', { className: 'dsv-empty' }, [
            h('div', { key: 't', className: 'dsv-empty-title' }, copy().emptyTitle),
            h('div', { key: 'b' }, copy().emptyBody)
          ])))
      }

      const round = snapshot.round
      const now = Date.now()
      const items = snapshot.brief.items
      const roundId = round.roundId
      const conditions = snapshot.verification.conditions ?? []
      const unverified = conditions.filter((condition) => condition.state !== 'passed')
      const hasFacts = items.some((item) => item.id !== 'no-facts')
      const updated = timeOf(round.contentAt, now)
      const meta = snapshot.mode === 'summary' && updated !== ''
        ? `${copy().updated} ${updated}`
        : hasFacts && updated !== '' ? `${copy().factsUpdated} ${updated}` : copy().summaryIdle
      const historyItems = history === null ? snapshot.history.items : history.items
      const historyMore = history === null
        ? snapshot.history.hasMore === true
        : history.nextCursor !== null && history.nextCursor !== undefined
      const archived = viewing === null ? null : h(ArchivedRound, {
        key: 'archived',
        viewing,
        now,
        onBack: () => setViewing(null),
        onRetry: () => openRound(viewing.roundId)
      })

      return h('div', { className: 'dsv-root' }, h('div', { className: 'dsv-panel' }, [
        archived,
        h('div', { key: 'head', className: 'dsv-head' }, [
          h('div', { key: 'row', className: 'dsv-head-row' }, [
            h('div', { key: 's', className: 'dsv-head-state' }, [
              h('span', { key: 'd', className: 'dsv-dot', 'data-tone': toneOfStatus(round), 'aria-hidden': 'true' }),
              h('span', { key: 't', className: 'dsv-status' }, statusTextOf(round))
            ]),
            snapshot.history.count === 0 ? null : h('button', {
              key: 'h', type: 'button', className: 'dsv-link', onClick: expandHistory, 'aria-expanded': openHistory
            }, `${copy().history} ${snapshot.history.count}`)
          ]),
          h('h2', { key: 't', className: 'dsv-title' }, round.title),
          h('div', { key: 'm', className: 'dsv-meta' }, [
            h('span', { key: 'e' }, `${copy().elapsed} ${durationOf(round.elapsedMs)}`),
            h('span', { key: 'u' }, meta)
          ])
        ]),
        snapshot.notices.length === 0 ? null : h('div', { key: 'n', className: 'dsv-notices' },
          snapshot.notices.map((notice) => h('div', { key: notice.code, className: 'dsv-notice' }, copy().notices[notice.code] ?? notice.text))),
        h('div', { key: 'brief', className: 'dsv-brief' }, items.map((item) => {
          const detail = Array.isArray(item.detail) ? item.detail : []
          const facts = Array.isArray(item.factIds) ? item.factIds : []
          const open = openItem !== null && openItem === item.id
          const shown = open && evidence !== null && facts.length > 0 && evidence.factId === facts[0]
          return h('div', { key: item.id, className: 'dsv-brief-item' }, [
            h('button', {
              key: 'b',
              type: 'button',
              className: 'dsv-brief-head',
              'aria-expanded': open,
              onClick: () => setOpenItem(open ? null : item.id)
            }, [
              h('span', { key: 'g', className: 'dsv-glyph', 'data-tone': toneOfItem(item, conditions), 'aria-hidden': 'true' }),
              h('span', { key: 't', className: 'dsv-brief-text' }, item.text),
              item.limit === '' || item.limit === undefined ? null : h('span', { key: 'q', className: 'dsv-qual' }, item.limit),
              h('span', { key: 'c', className: 'dsv-chevron', 'aria-hidden': 'true' }, open ? '▾' : '▸')
            ]),
            open ? h('div', { key: 'x', className: 'dsv-detail' }, [
              ...detail.map((line, index) => h('div', { key: `d${index}`, className: 'dsv-detail-row' }, [
                h('span', { key: 'l', className: 'dsv-detail-label' }, line.label),
                h('span', { key: 'v', className: 'dsv-detail-value' }, line.value)
              ])),
              unverified.length === 0 ? null : h('div', { key: 'v', className: 'dsv-sub' },
                `${copy().unverified} · ${unverified.map((condition) => condition.text).join(' · ')}`),
              facts.length === 0 ? null : h('button', {
                key: 'e', // ui-copy-ignore
                type: 'button', // ui-copy-ignore
                className: 'dsv-link',
                onClick: () => showEvidence(roundId, facts[0], false),
                'aria-expanded': shown
              }, copy().facts),
              shown ? h(Evidence, { key: 'ev', state: evidence.state, refs: evidence.refs, now, onRetry: () => showEvidence(roundId, facts[0], true) }) : null
            ]) : null
          ])
        })),
        openHistory ? h('div', { key: 'hist', className: 'dsv-section' }, [
          h('div', { key: 'h', className: 'dsv-section-head' }, copy().history),
          historyItems.length === 0
            ? h('div', { key: 'e', className: 'dsv-sub' }, copy().historyEmpty)
            : h('div', { key: 'r', className: 'dsv-list' }, historyItems.map((item) => h('button', {
              key: item.roundId,
              type: 'button',
              className: 'dsv-history-row',
              'aria-current': viewing !== null && viewing.roundId === item.roundId ? 'true' : undefined,
              onClick: () => openRound(item.roundId)
            }, [
              h('span', { key: 't', className: 'dsv-history-title' }, item.title),
              h('span', { key: 'u', className: 'dsv-history-time' }, timeOf(item.archivedAt, now))
            ]))),
          historyFailed ? h('div', { key: 'f', className: 'dsv-sub' }, copy().historyFailed) : null,
          historyMore ? h('button', {
            key: 'all', type: 'button', className: 'dsv-link',
            onClick: () => fetchHistory(history === null ? '' : history.nextCursor)
          }, copy().historyAll) : null
        ]) : null,
        h('div', { key: 'foot', className: 'dsv-foot' }, [
          h('button', { key: 'req', type: 'button', className: 'dsv-link', onClick: requestSummary, disabled: busy },
            busy ? copy().requesting : copy().request),
          h('button', {
            key: 'auto', type: 'button', className: 'dsv-link', 'aria-pressed': snapshot.coverage.summaryAuto,
            onClick: toggleAuto, disabled: busy || snapshot.coverage.summaryBudgetExhausted
          }, snapshot.coverage.summaryAuto ? copy().following : copy().follow),
          verdict === '' ? null : h('span', { key: 'v', className: 'dsv-sub' }, verdict)
        ])
      ]))
    }

    return {
      inject: ['slots', 'locale'], // ui-copy-ignore
      apply(ctx) {
        LANG = langOf(ctx) // ui-copy-ignore
        const locale = ctx === null || ctx === undefined ? undefined : ctx.locale
        if (locale !== null && locale !== undefined && typeof locale.subscribe === 'function') {
          const onLocale = () => {
            LANG = langOf(ctx) // ui-copy-ignore
            notifyLocale()
          }
          if (typeof ctx.effect === 'function') {
            ctx.effect(() => locale.subscribe(onLocale), 'vantage-locale') // ui-copy-ignore
          } else {
            try {
              locale.subscribe(onLocale)
            } catch (error) {}
          }
        }
        ctx.slots.inject('conversation.view', () => ctx.slots.register({
          name: 'conversation.view', // ui-copy-ignore
          id: VIEW_ID, // ui-copy-ignore
          order: 20, // ui-copy-ignore
          label: () => copy().label, // ui-copy-ignore
          inject: (sessionId) => ({ sessionId }) // ui-copy-ignore
        }, View))
      }
    }
  }
})
