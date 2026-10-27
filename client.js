window.__ModuleLoader__.load({
  id: 'dsh-vantage', // ui-copy-ignore
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const HOST_BASE = '/dsh-vantage' // ui-copy-ignore
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
        blocked: '这个会话只能在自己的窗口里查看', // ui-copy-ignore
        loading: '正在读取', // ui-copy-ignore
        retry: '重试', // ui-copy-ignore
        progress: '进展情况', // ui-copy-ignore
        verification: '收尾核验',
        outcomes: '本轮结果', // ui-copy-ignore
        history: '历史记录', // ui-copy-ignore
        historyAll: '查看全部',
        historyEmpty: '还没有更早的轮次',
        facts: '依据', // ui-copy-ignore
        evidenceEmpty: '没有可展开的依据',
        verify: { // ui-copy-ignore
          passed: '当前已知核验已通过', // ui-copy-ignore
          failed: '当前验证未通过', // ui-copy-ignore
          unknown: '核验状态暂不可知', // ui-copy-ignore
          pending: '验证还没有开始', // ui-copy-ignore
          none: '尚未明确' // ui-copy-ignore
        },
        roundState: {
          open: '本轮进行中', // ui-copy-ignore
          replied: '本轮已回复', // ui-copy-ignore
          archived: '本轮已归档', // ui-copy-ignore
          unknown: '本轮状态暂不可知' // ui-copy-ignore
        },
        goalState: {
          active: '目标进行中', // ui-copy-ignore
          complete: '目标已完成', // ui-copy-ignore
          none: '没有目标', // ui-copy-ignore
          unknown: '目标状态暂不可知' // ui-copy-ignore
        },
        request: '重新核对', // ui-copy-ignore
        requesting: '正在核对',
        follow: '持续跟进', // ui-copy-ignore
        following: '已开启跟进',
        skipped: { // ui-copy-ignore
          budget: '自动摘要额度已用完', // ui-copy-ignore
          fresh: '当前已是新的', // ui-copy-ignore
          running: '正在核对', // ui-copy-ignore
          disabled: '自动摘要已关闭', // ui-copy-ignore
          'no-model': '没有可用的摘要模型'
        },
        unchanged: '没有变化'
      },
      en: { // ui-copy-ignore
        label: 'Overview', // ui-copy-ignore
        emptyTitle: 'No work to summarize yet',
        emptyBody: 'Progress and checks appear here once this turn has a record.',
        blocked: 'This session can only be viewed in its own window',
        loading: 'Reading', // ui-copy-ignore
        retry: 'Retry', // ui-copy-ignore
        progress: 'Progress', // ui-copy-ignore
        verification: 'Checks',
        outcomes: 'Results', // ui-copy-ignore
        history: 'Earlier rounds', // ui-copy-ignore
        historyAll: 'Show all',
        historyEmpty: 'No earlier rounds',
        facts: 'Basis', // ui-copy-ignore
        evidenceEmpty: 'Nothing to expand',
        verify: { // ui-copy-ignore
          passed: 'Known checks pass', // ui-copy-ignore
          failed: 'Checks fail', // ui-copy-ignore
          unknown: 'Check state unavailable',
          pending: 'Checks not started',
          none: 'Not stated' // ui-copy-ignore
        },
        roundState: {
          open: 'Round in progress', // ui-copy-ignore
          replied: 'Replied', // ui-copy-ignore
          archived: 'Round archived', // ui-copy-ignore
          unknown: 'Round state unavailable'
        },
        goalState: {
          active: 'Goal active', // ui-copy-ignore
          complete: 'Goal complete', // ui-copy-ignore
          none: 'No goal', // ui-copy-ignore
          unknown: 'Goal state unavailable'
        },
        request: 'Re-check', // ui-copy-ignore
        requesting: 'Checking',
        follow: 'Keep following', // ui-copy-ignore
        following: 'Following',
        skipped: { // ui-copy-ignore
          budget: 'Summary budget used up',
          fresh: 'Already current', // ui-copy-ignore
          running: 'Already checking', // ui-copy-ignore
          disabled: 'Auto summary off', // ui-copy-ignore
          'no-model': 'No summary model'
        },
        unchanged: 'No change'
      }
    }

    const LANG = /^zh/i.test(navigator.language || '') ? 'zh' : 'en'
    const t = COPY[LANG]

    const STYLE = `
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
.dsv-notices { display: flex; flex-direction: column; gap: 4px; }
.dsv-notice {
  font-size: 12px; line-height: 20px; color: var(--dsw-alias-state-warn-primary);
}
.dsv-section { display: flex; flex-direction: column; gap: 8px; }
.dsv-section-head {
  display: flex; align-items: center; gap: 8px; min-height: 24px; font-size: 12px; line-height: 20px; color: var(--dsw-alias-label-secondary);
}
.dsv-section-head .dsv-count { font-variant-numeric: tabular-nums; }
.dsv-toggle {
  display: flex; align-items: center; gap: 6px; min-height: 44px; padding: 0; margin: 0; border: 0; background: transparent; color: var(--dsw-alias-label-secondary); font: inherit; font-size: 12px; line-height: 20px; cursor: pointer; text-align: left;
}
.dsv-toggle:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 2px; }
.dsv-rows { display: flex; flex-direction: column; }
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
  margin: 4px 0 0; font-size: 13px; line-height: 21px; white-space: pre-wrap; overflow-wrap: anywhere; color: var(--dsw-alias-label-primary);
}
.dsv-list { display: flex; flex-direction: column; }
.dsv-history-row {
  display: flex; justify-content: space-between; gap: 12px; align-items: baseline; min-height: 48px; padding: 12px 0; border-top: 1px solid var(--dsw-alias-border-l1);
}
.dsv-history-row:first-child { border-top: 0; }
.dsv-history-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsv-history-time { flex: none; font-size: 12px; line-height: 20px; color: var(--dsw-alias-label-secondary); font-variant-numeric: tabular-nums; }
.dsv-foot {
  display: flex; flex-wrap: wrap; gap: 8px; align-items: center; padding-top: 16px; border-top: 1px solid var(--dsw-alias-border-l1);
}
.dsv-button {
  min-height: 36px; padding: 0 14px; border-radius: 6px; border: 1px solid var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); font: inherit; font-size: 13px; cursor: pointer;
}
.dsv-button[aria-pressed="true"] { border-color: var(--dsw-alias-brand-primary); color: var(--dsw-alias-brand-primary); }
.dsv-button:disabled { color: var(--dsw-alias-label-secondary); cursor: default; }
.dsv-button:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 2px; }
.dsv-empty {
  display: flex; flex-direction: column; gap: 6px; padding: 48px 0; color: var(--dsw-alias-label-secondary);
}
.dsv-empty-title { font-size: 15px; line-height: 24px; color: var(--dsw-alias-label-primary); }
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
      const delta = now - at
      const minutes = Math.round(delta / 60000)
      if (minutes >= 0 && minutes < 1) return LANG === 'zh' ? '刚刚' : 'just now' // ui-copy-ignore
      if (minutes >= 0 && minutes < 60) return LANG === 'zh' ? `${minutes} 分钟前` : `${minutes} min ago`
      const date = new Date(at)
      const clock = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}` // ui-copy-ignore
      return clock
    }

    async function callHost(path, options) {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), REQUEST_MS)
      try {
        const response = await fetch(`${HOST_BASE}${path}`, { ...options, signal: controller.signal, cache: 'no-store' }) // ui-copy-ignore
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

    function Evidence(props) {
      if (props.state === 'loading') return h('div', { className: 'dsv-sub' }, t.loading)
      if (props.refs.length === 0) return h('div', { className: 'dsv-sub' }, t.evidenceEmpty)
      return h('div', { className: 'dsv-evidence' }, props.refs.map((ref) => h('div', { key: `${ref.seq}`, className: 'dsv-evidence-item' }, [
        h('div', { key: 'l', className: 'dsv-evidence-label' }, ref.label === '' ? ref.type : ref.label),
        h('pre', { key: 'x', className: 'dsv-evidence-text' }, ref.excerpt)
      ])))
    }

    function VerificationBlock(props) {
      const payload = props.verification
      const conditions = payload === null || payload === undefined ? [] : payload.conditions
      return h('div', { className: 'dsv-section' }, [
        h('div', { key: 'h', className: 'dsv-section-head' }, [
          h('span', { key: 'l' }, t.verification),
          h('span', { key: 's', className: 'dsv-count' }, t.verify[payload === null || payload === undefined ? 'unknown' : payload.state] ?? t.verify.unknown)
        ]),
        conditions.length === 0
          ? h('div', { key: 'e', className: 'dsv-sub' }, t.verify.none)
          : h('div', { key: 'r', className: 'dsv-rows' }, conditions.map((condition) => h(Row, {
              key: condition.id,
              text: condition.text,
              tone: condition.state === 'passed' ? 'success' : condition.state === 'failed' ? 'error' : 'neutral'
            })))
      ])
    }

    function View(props) {
      ensureStyle()
      const sessionId = props.sessionId
      const [snapshot, setSnapshot] = React.useState(null)
      const [blocked, setBlocked] = React.useState(false)
      const [failed, setFailed] = React.useState(false)
      const [loading, setLoading] = React.useState(true)
      const [openProgress, setOpenProgress] = React.useState(false)
      const [openHistory, setOpenHistory] = React.useState(false)
      const [history, setHistory] = React.useState(null)
      const [busy, setBusy] = React.useState(false)
      const [verdict, setVerdict] = React.useState('')
      const [evidence, setEvidence] = React.useState(null)
      const revisionRef = React.useRef(null)

      const load = React.useCallback(async (force) => {
        const query = new URLSearchParams({ session: sessionId })
        if (!force && revisionRef.current !== null) query.set('revision', revisionRef.current)
        const answer = await callHost(`/snapshot?${query.toString()}`) // ui-copy-ignore
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
      }, [sessionId])

      React.useEffect(() => {
        revisionRef.current = null
        setSnapshot(null)
        setHistory(null)
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
        setBusy(true)
        setVerdict('')
        const answer = await callHost('/summary/request', { // ui-copy-ignore
          method: 'POST',
          headers: { 'content-type': 'application/json' }, // ui-copy-ignore
          body: JSON.stringify({ session: sessionId }) // ui-copy-ignore
        })
        setBusy(false)
        if (answer.blocked === true) {
          setBlocked(true)
          return
        }
        if (answer.failed === true || answer.body === null) {
          setVerdict(t.skipped.running)
          return
        }
        if (answer.body.kind === 'skipped') setVerdict(t.skipped[answer.body.reason] ?? '') // ui-copy-ignore
        else load(true)
      }

      const toggleAuto = async () => {
        const enabled = !(snapshot !== null && snapshot.coverage.summaryAuto)
        setBusy(true)
        const answer = await callHost('/summary/auto', { // ui-copy-ignore
          method: 'POST',
          headers: { 'content-type': 'application/json' }, // ui-copy-ignore
          body: JSON.stringify({ session: sessionId, enabled }) // ui-copy-ignore
        })
        setBusy(false)
        if (answer.failed === true) return
        load(true)
      }

      const showEvidence = async (roundId, factId) => {
        if (evidence !== null && evidence.factId === factId) {
          setEvidence(null)
          return
        }
        setEvidence({ factId, state: 'loading', refs: [] }) // ui-copy-ignore
        const query = new URLSearchParams({ session: sessionId, round: roundId, fact: factId })
        const answer = await callHost(`/evidence?${query.toString()}`) // ui-copy-ignore
        if (answer.failed === true || answer.body === null) {
          setEvidence({ factId, state: 'failed', refs: [] }) // ui-copy-ignore
          return
        }
        setEvidence({ factId, state: 'ready', refs: answer.body.refs }) // ui-copy-ignore
      }

      const expandHistory = async () => {
        if (openHistory) {
          setOpenHistory(false)
          return
        }
        setOpenHistory(true)
        if (history !== null) return
        const query = new URLSearchParams({ session: sessionId, limit: '20' }) // ui-copy-ignore
        const answer = await callHost(`/history?${query.toString()}`) // ui-copy-ignore
        if (answer.failed === true || answer.body === null) return
        setHistory(answer.body.items)
      }

      if (blocked) {
        return h('div', { className: 'dsv-root' }, h('div', { className: 'dsv-panel' },
          h('div', { className: 'dsv-empty' }, h('div', { className: 'dsv-empty-title' }, t.blocked))))
      }
      if (loading && snapshot === null) {
        return h('div', { className: 'dsv-root' }, h('div', { className: 'dsv-panel' },
          h('div', { className: 'dsv-empty' }, h('div', {}, t.loading))))
      }
      if (failed && snapshot === null) {
        return h('div', { className: 'dsv-root' }, h('div', { className: 'dsv-panel' },
          h('div', { className: 'dsv-empty' }, [
            h('div', { key: 't', className: 'dsv-empty-title' }, t.emptyTitle),
            h('button', { key: 'r', type: 'button', className: 'dsv-link', onClick: () => load(true) }, t.retry)
          ])))
      }
      if (snapshot === null || snapshot.round === null) {
        return h('div', { className: 'dsv-root' }, h('div', { className: 'dsv-panel' },
          h('div', { className: 'dsv-empty' }, [
            h('div', { key: 't', className: 'dsv-empty-title' }, t.emptyTitle),
            h('div', { key: 'b' }, t.emptyBody)
          ])))
      }

      const round = snapshot.round
      const now = Date.now()
      const briefItems = snapshot.brief.items
      const outcomes = snapshot.outcomes.items
      const roundId = round.roundId

      return h('div', { className: 'dsv-root' }, h('div', { className: 'dsv-panel' }, [
        h('div', { key: 'head', className: 'dsv-head' }, [
          h('h2', { key: 't', className: 'dsv-title' }, round.title),
          h('div', { key: 's', className: 'dsv-status' }, round.statusLine),
          h('div', { key: 'm', className: 'dsv-meta' }, [
            h('span', { key: 'r' }, t.roundState[round.roundState] ?? t.roundState.unknown),
            h('span', { key: 'g' }, t.goalState[round.goalState] ?? t.goalState.unknown),
            timeOf(round.updatedAt, now) === '' ? null : h('span', { key: 'u' }, timeOf(round.updatedAt, now))
          ])
        ]),
        snapshot.notices.length === 0 ? null : h('div', { key: 'n', className: 'dsv-notices' },
          snapshot.notices.map((notice) => h('div', { key: notice.code, className: 'dsv-notice' }, notice.text))),
        h('div', { key: 'brief', className: 'dsv-section' }, [
          h('div', { key: 'h', className: 'dsv-section-head' },
            h('button', {
              key: 'toggle',
              type: 'button',
              className: 'dsv-toggle',
              'aria-expanded': openProgress,
              onClick: () => setOpenProgress((value) => !value)
            }, [h('span', { key: 'a' }, openProgress ? '▾' : '▸'), h('span', { key: 'l' }, t.progress)])),
          h('div', { key: 'r', className: 'dsv-rows' }, briefItems.map((item) => {
            const expandable = item.id !== 'status' && Array.isArray(item.factIds) && item.factIds.length > 0 // ui-copy-ignore
            const expanded = expandable && evidence !== null && evidence.factId === item.factIds[0]
            return h(Row, {
              key: item.id, // ui-copy-ignore
              text: item.text, // ui-copy-ignore
              tone: item.tone === undefined ? 'neutral' : item.tone,
              action: expandable // ui-copy-ignore
                ? {
                    label: t.facts, // ui-copy-ignore
                    expanded,
                    onClick: () => showEvidence(roundId, item.factIds[0])
                  }
                : undefined,
              extra: expanded // ui-copy-ignore
                ? h(Evidence, { key: 'ev', state: evidence.state, refs: evidence.refs })
                : undefined
            })
          }))
        ]),
        h(VerificationBlock, { key: 'verify', verification: snapshot.verification }),
        outcomes.length === 0 ? null : h('div', { key: 'out', className: 'dsv-section' }, [
          h('div', { key: 'h', className: 'dsv-section-head' }, t.outcomes),
          h('div', { key: 'r', className: 'dsv-rows' }, outcomes.map((item) => h(Row, {
            key: item.id,
            text: item.text,
            tone: item.kind === 'check' ? 'success' : 'neutral'
          })))
        ]),
        snapshot.history.count === 0 ? null : h('div', { key: 'hist', className: 'dsv-section' }, [
          h('div', { key: 'h', className: 'dsv-section-head' }, [
            h('span', { key: 'l' }, t.history),
            h('span', { key: 'c', className: 'dsv-count' }, String(snapshot.history.count)),
            h('button', { key: 'm', type: 'button', className: 'dsv-link', onClick: expandHistory, 'aria-expanded': openHistory }, t.historyAll)
          ]),
          h('div', { key: 'r', className: 'dsv-list' }, snapshot.history.items.map((item) => h('div', {
            key: item.roundId,
            className: 'dsv-history-row'
          }, [
            h('span', { key: 't', className: 'dsv-history-title' }, item.title),
            h('span', { key: 'u', className: 'dsv-history-time' }, timeOf(item.archivedAt, now))
          ]))),
          openHistory
            ? h('div', { key: 'all', className: 'dsv-list' },
                (history === null ? [] : history).map((item) => h('div', { key: item.roundId, className: 'dsv-history-row' }, [
                  h('span', { key: 't', className: 'dsv-history-title' }, item.title),
                  h('span', { key: 'u', className: 'dsv-history-time' }, timeOf(item.archivedAt, now))
                ])))
            : null
        ]),
        h('div', { key: 'foot', className: 'dsv-foot' }, [
          h('button', {
            key: 'req', // ui-copy-ignore
            type: 'button', // ui-copy-ignore
            className: 'dsv-button',
            onClick: requestSummary, // ui-copy-ignore
            disabled: busy // ui-copy-ignore
          }, busy ? t.requesting : t.request),
          h('button', {
            key: 'auto', // ui-copy-ignore
            type: 'button', // ui-copy-ignore
            className: 'dsv-button',
            'aria-pressed': snapshot.coverage.summaryAuto,
            onClick: toggleAuto, // ui-copy-ignore
            disabled: busy || snapshot.coverage.summaryBudgetExhausted
          }, snapshot.coverage.summaryAuto ? t.following : t.follow),
          verdict === '' ? null : h('span', { key: 'v', className: 'dsv-sub' }, verdict)
        ])
      ]))
    }

    return {
      inject: ['slots'], // ui-copy-ignore
      apply(ctx) {
        ctx.slots.inject('conversation.view', () => ctx.slots.register({
          name: 'conversation.view', // ui-copy-ignore
          id: VIEW_ID, // ui-copy-ignore
          order: 20, // ui-copy-ignore
          label: () => t.label // ui-copy-ignore
        }, View))
      }
    }
  }
})
