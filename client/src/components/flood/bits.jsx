import { cx } from '../../styles/classes'
import { roleOf } from './format'

// Small pieces shared by the hazard sections.

// How an event is used by the model, as a coloured dot and a short label.
// Not a status Chip: the colours tell roles apart (identity), they do not
// mean good or bad.
export function RoleTag({ event, long = false, className }) {
  const r = roleOf(event)
  return (
    <span className={cx('inline-flex items-center gap-1.5 text-[12.5px] font-semibold whitespace-nowrap text-muted', className)}>
      <span className="size-[8px] flex-none rounded-full" style={{ background: `var(${r.color})` }} aria-hidden="true" />
      {long ? r.label : r.short}
    </span>
  )
}

// A number with its label, in a small tile (as in the vegetation forecast card).
// onPanel: the tile sits on a grey panel, so it is white instead of grey.
export function Stat({ label, value, hint, onPanel = false, className }) {
  const words = typeof value === 'string' && /[a-z]{3}/.test(value)
  return (
    <div className={cx('flex min-w-[104px] flex-1 flex-col gap-0.5 rounded-xl px-3 py-2', onPanel ? 'bg-surface' : 'bg-surface2', className)}>
      <span className="text-[12.5px] text-muted">{label}</span>
      <b className={words ? 'text-[14px] font-semibold' : 'font-mono text-[18px] font-medium'}>{value}</b>
      {hint && <span className="text-[12px] text-muted">{hint}</span>}
    </div>
  )
}


// "Loading Bangkok floods…" chip over content that still shows the previous
// event (dimmed), so the card keeps its height while the next one loads.
export function StaleChip({ children }) {
  return (
    <div className="pointer-events-none absolute inset-x-0 top-[120px] z-10 flex justify-center px-4">
      <p role="status" className="rounded-full bg-surface px-3.5 py-1.5 text-[14px] text-muted shadow-card">
        {children}
      </p>
    </div>
  )
}

// Legend entry: a swatch (any element) and its text
export function Key({ swatch, children }) {
  return (
    <span className="inline-flex items-center gap-2">
      {swatch}
      {children}
    </span>
  )
}

