import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { hwLabel, planSnippet, planStats } from '../../lib/map/geometry'

/*
  "Plan a new area" panel at the bottom of the map rail. The pin and square on
  the map are managed by useAreaPlanner; this renders the toggle, the size
  slider, the area statistics and the notebook settings to copy.
*/
export default function AreaPlanner({ plan, hwSlider, onToggle, onSlider }) {
  const stats = useMemo(() => planStats(plan), [plan])
  const snippet = planSnippet(plan)
  const snippetRef = useRef(null)
  const [copyLabel, setCopyLabel] = useState('Copy')
  const resetTimer = useRef(null)
  useEffect(() => () => clearTimeout(resetTimer.current), [])

  // Show feedback on the button, then restore "Copy"
  const flash = (label, ms) => {
    setCopyLabel(label)
    clearTimeout(resetTimer.current)
    resetTimer.current = setTimeout(() => setCopyLabel('Copy'), ms)
  }

  // The Clipboard API can be missing or refused (insecure context, permissions);
  // then select the text so the user can copy it by hand.
  const copy = () => {
    const select = () => {
      const r = document.createRange()
      r.selectNodeContents(snippetRef.current)
      const s = getSelection()
      s.removeAllRanges()
      s.addRange(r)
      flash('Selected', 2000)
    }
    try {
      navigator.clipboard.writeText(snippet).then(() => flash('Copied', 1500), select)
    } catch {
      select()
    }
  }

  return (
    <div className="grp plan">
      <span className="t">Plan a new area</span>
      <button type="button" className="btn soft" id="planBtn" aria-pressed={plan.on} onClick={onToggle}>
        {plan.on ? 'Stop planning' : 'Start planning'}
      </button>
      {/* The global [hidden] rule (display:none !important) beats the inline flex */}
      <div id="planBody" hidden={!plan.on} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <p className="xs muted">Drag the blue pin or tap the map to move it, then set the size.</p>
        <div className="rowc" style={{ flexWrap: 'nowrap' }}>
          <span className="xs muted" style={{ minWidth: 70 }}>Half-width</span>
          <input type="range" id="hw" min="0" max="100" step="1" aria-label="Half-width" value={hwSlider} onChange={(e) => onSlider(+e.target.value)} />
          <b className="mono xs" id="hwOut" style={{ minWidth: 58, textAlign: 'right' }}>{hwLabel(plan.hw)}</b>
        </div>
        <dl className="kv" id="planStats">
          {stats.map(([k, v]) => (
            <Fragment key={k}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </Fragment>
          ))}
        </dl>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span className="xs muted">Notebook settings</span>
          <button type="button" className="btn soft" id="copyBtn" style={{ padding: '5px 12px' }} onClick={copy}>{copyLabel}</button>
        </div>
        <pre className="code" id="snippet" ref={snippetRef}>{snippet}</pre>
      </div>
    </div>
  )
}
