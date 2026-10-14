import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { hwLabel, planSnippet, planStats } from '../../lib/map/geometry'
import { rangeCls } from '../../styles/classes'
import { Btn, Group, GroupTitle } from '../ui'

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
    // Separated from the rail's other controls by a rule above
    <Group className="border-t border-line pt-[14px]">
      <GroupTitle>Plan a new area</GroupTitle>
      <Btn soft id="planBtn" aria-pressed={plan.on} onClick={onToggle}>
        {plan.on ? 'Stop planning' : 'Start planning'}
      </Btn>
      {/* The [hidden] rule in Tailwind's preflight (display:none !important) beats flex */}
      <div id="planBody" hidden={!plan.on} className="flex flex-col gap-2.5">
        <p className="text-[13px] text-muted">Drag the blue pin or tap the map to move it, then set the size.</p>
        <div className="flex flex-nowrap items-center gap-2">
          <span className="min-w-[70px] text-[13px] text-muted">Half-width</span>
          <input type="range" className={rangeCls} id="hw" min="0" max="100" step="1" aria-label="Half-width" value={hwSlider} onChange={(e) => onSlider(+e.target.value)} />
          <b className="min-w-[58px] text-right font-mono text-[13px] tabular-nums" id="hwOut">{hwLabel(plan.hw)}</b>
        </div>
        <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-2.5 gap-y-[3px] text-[13px]" id="planStats">
          {stats.map(([k, v]) => (
            <Fragment key={k}>
              <dt className="text-muted">{k}</dt>
              <dd className="m-0 text-right font-mono">{v}</dd>
            </Fragment>
          ))}
        </dl>
        <div className="flex items-center justify-between">
          <span className="text-[13px] text-muted">Notebook settings</span>
          {/* Smaller than a normal Btn; important so it beats Btn's own padding */}
          <Btn soft id="copyBtn" className="p-[5px_12px]!" onClick={copy}>{copyLabel}</Btn>
        </div>
        {/* leading-[1.5] comes from the original `font: 12.5px/1.5` shorthand */}
        <pre className="m-0 overflow-x-auto rounded-[10px] bg-surface2 p-2.5 font-mono text-[12.5px] leading-[1.5] font-normal select-all" id="snippet" ref={snippetRef}>{snippet}</pre>
      </div>
    </Group>
  )
}
