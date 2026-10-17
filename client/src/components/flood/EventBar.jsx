import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { cx, selectCls } from '../../styles/classes'
import { useHazardPage } from './context'
import { RoleTag } from './bits'
import { rangeLabel } from './format'

/*
  The event picker that follows you down the page: a bar that sticks just
  under the nav (the nav's own city picker is for the vegetation page only).
  Previous / next step through the events in date order; the dropdown jumps
  to any of them. Wide screens also show the event's dates and its role in
  the model. Same selection as the cards in the intro and the map.
*/

// Height of the main nav, which differs by width (it wraps on phones), so the
// bar sticks right under it at any width.
function useNavHeight() {
  const [h, setH] = useState(58)
  useEffect(() => {
    const nav = document.querySelector('nav[aria-label="Main"]')
    if (!nav) return
    const read = () => setH(nav.offsetHeight)
    read()
    const ro = new ResizeObserver(read)
    ro.observe(nav)
    return () => ro.disconnect()
  }, [])
  return h
}

const stepBtn =
  'inline-flex size-9 flex-none cursor-pointer items-center justify-center rounded-full border-0 bg-surface2 text-ink hover:bg-accent-soft disabled:cursor-default disabled:opacity-40 disabled:hover:bg-surface2'

export default function EventBar() {
  const { events, eventId, setEventId } = useHazardPage()
  const navH = useNavHeight()
  const i = events ? events.findIndex((e) => e.id === eventId) : -1
  const ev = i >= 0 ? events[i] : null

  return (
    <div
      className="sticky z-[900] -my-3"
      // 8px of air under the nav; the safe-area inset as for the nav itself
      style={{ top: `calc(env(safe-area-inset-top, 0px) + ${navH + 8}px)` }}
    >
      <div
        role="group"
        aria-label="Selected event"
        className="flex min-h-[54px] items-center gap-2 rounded-[18px] border border-line bg-[color-mix(in_srgb,var(--surface)_90%,transparent)] px-2.5 py-2 shadow-card backdrop-blur-[10px]"
      >
        <span className="hidden pl-1.5 text-[13px] font-semibold tracking-[.05em] text-muted uppercase min-[560px]:inline">Event</span>
        <motion.button
          type="button"
          whileTap={{ scale: 0.94 }}
          className={stepBtn}
          aria-label="Previous event"
          disabled={i <= 0}
          onClick={() => setEventId(events[i - 1].id)}
        >
          <Chevron dir="left" />
        </motion.button>
        {events ? (
          <select
            aria-label="Event"
            className={cx(selectCls, 'min-w-0 flex-1 truncate')}
            value={eventId ?? ''}
            onChange={(e) => setEventId(e.target.value)}
          >
            {events.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name} ({e.country?.name || e.country?.code || '–'})
              </option>
            ))}
          </select>
        ) : (
          <span className="flex-1 text-[14px] text-muted">Loading the events…</span>
        )}
        <motion.button
          type="button"
          whileTap={{ scale: 0.94 }}
          className={stepBtn}
          aria-label="Next event"
          disabled={!events || i >= events.length - 1}
          onClick={() => setEventId(events[i + 1].id)}
        >
          <Chevron dir="right" />
        </motion.button>
        {ev && (
          <span className="hidden flex-none items-center gap-3 pr-1.5 text-[13px] whitespace-nowrap text-muted min-[900px]:flex">
            <span className="font-mono text-ink">{rangeLabel(ev.period?.start, ev.period?.end)}</span>
            <RoleTag event={ev} />
          </span>
        )}
      </div>
    </div>
  )
}

function Chevron({ dir }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path d={dir === 'left' ? 'M10 3 5 8l5 5' : 'M6 3l5 5-5 5'} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
