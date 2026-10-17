import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { cx } from '../../styles/classes'
import { CITIES, CITY_IDS, useTimeseries } from '../../lib/store'
import { ndviStatus } from '../../lib/stats'
import { useApp } from '../../state/appContext'
import { Skeleton } from '../common/SectionLoader'
import { Chip } from '../ui'

/*
  City picker in the sticky nav, so the city can be changed from anywhere on
  the vegetation page (the hero's shelf at the top does the same). It calls
  the same useApp().setCity, so every section, the map included, follows.

  A button (pin, city name, chevron) opens a listbox of the cities with their
  state and greenness chip, like the shelf cards.
  - Keyboard: Enter/Space/ArrowDown open it with focus on the current city;
    Up/Down/Home/End move, Enter/Space pick, Escape closes (focus back on the
    button), Tab out closes. Touch/mouse: tap to pick; a tap outside closes.
  - Picking a city closes it and puts focus back on the button.
  - The city name is never shortened (an ellipsis made "Jaipur" and
    "Jaisalmer" both "Jai…"): the button does not shrink, and Nav.jsx makes
    room for it instead. Below 580px Nav puts it on a second row of the bar,
    where it also shows the state and the list spans the bar's width (inside
    the screen at any width); above, the list hangs under the button,
    right-aligned (the button sits right of the middle, so it fits).
  - The chips need every city's NDVI; it is requested only when the list is
    first opened (normally already cached: the hero's shelf loads the same).
*/

function PinIcon({ className }) {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M8 14.5s-4.5-4.2-4.5-7.7a4.5 4.5 0 0 1 9 0c0 3.5-4.5 7.7-4.5 7.7Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <circle cx="8" cy="6.8" r="1.6" fill="currentColor" />
    </svg>
  )
}

export default function CityPicker({ className }) {
  const { city, setCity } = useApp()
  const listId = useId()
  const labelId = useId()
  const wrap = useRef(null)
  const button = useRef(null)
  const [open, setOpen] = useState(false)
  // Set at the first opening and kept, so the NDVI request is made once and the
  // chips are ready on later openings.
  const [armed, setArmed] = useState(false)
  const { data, status } = useTimeseries({ areas: armed ? CITY_IDS : null, parameters: ['ndvi'] })
  // Same chip as the shelf card: latest NDVI against the usual value for that month
  const chips = useMemo(
    () => (data ? Object.fromEntries(CITY_IDS.map((c) => [c, data[c]?.ndvi ? ndviStatus(data[c].ndvi).chip : null])) : null),
    [data],
  )

  const options = () => [...(wrap.current?.querySelectorAll('[role="option"]') || [])]
  // Focus an option after the list has rendered (it mounts on open)
  const focusOption = (pick) =>
    requestAnimationFrame(() => {
      const list = options()
      pick(list)?.focus()
    })

  const show = (focus = 'current') => {
    setArmed(true)
    setOpen(true)
    focusOption((list) => (focus === 'last' ? list.at(-1) : list.find((o) => o.dataset.city === city) || list[0]))
  }
  const hide = (refocus) => {
    setOpen(false)
    if (refocus) button.current?.focus()
  }
  const pick = (c) => {
    setCity(c)
    hide(true)
  }

  // While open: a tap/click outside closes it (pointerdown covers touch), and
  // Escape closes from anywhere (Safari doesn't focus buttons on click).
  useEffect(() => {
    if (!open) return
    const onDown = (e) => {
      if (!wrap.current?.contains(e.target)) setOpen(false)
    }
    const onKey = (e) => {
      if (e.key !== 'Escape') return
      setOpen(false)
      button.current?.focus()
    }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const onButtonKey = (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      show(e.key === 'ArrowUp' ? 'last' : 'current')
    }
  }

  const onListKey = (e) => {
    const list = options()
    const i = list.indexOf(document.activeElement)
    let next = null
    if (e.key === 'ArrowDown') next = list[Math.min(i + 1, list.length - 1)]
    else if (e.key === 'ArrowUp') next = list[Math.max(i - 1, 0)]
    else if (e.key === 'Home') next = list[0]
    else if (e.key === 'End') next = list.at(-1)
    else if ((e.key === 'Enter' || e.key === ' ') && i >= 0) {
      e.preventDefault()
      pick(list[i].dataset.city)
      return
    } else return
    e.preventDefault()
    next?.focus()
  }

  // Tabbing out closes it (relatedTarget is where focus went)
  const onBlur = (e) => {
    if (open && !wrap.current?.contains(e.relatedTarget)) setOpen(false)
  }

  const cur = CITIES[city]

  return (
    // Phones: static, so the list is placed against the nav bar (see below)
    <div ref={wrap} className={cx('relative shrink-0 max-[580px]:static', className)} onBlur={onBlur}>
      <span id={labelId} className="sr-only">
        City
      </span>
      <button
        ref={button}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-labelledby={`${labelId} ${listId}-value`}
        onClick={() => (open ? hide(false) : show())}
        onKeyDown={onButtonKey}
        className={cx(
          'inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-[6px] font-body text-[14px] leading-[normal] font-medium whitespace-nowrap text-ink transition-colors duration-150 hover:bg-accent-soft',
          // Phones (own row): a little slimmer so the bar stays low
          'max-[580px]:py-[5px]',
          open && 'bg-accent-soft',
        )}
      >
        <PinIcon className="shrink-0 text-accent" />
        <span id={`${listId}-value`}>{cur.name}</span>
        {/* Phones have the room on their own row: the state too */}
        <span className="hidden font-normal text-muted max-[580px]:inline" aria-hidden="true">
          · {cur.state}
        </span>
        <svg
          className={cx('-mr-0.5 shrink-0 transition-transform duration-200 ease-out', open && 'rotate-180')}
          width="12"
          height="12"
          viewBox="0 0 12 12"
          aria-hidden="true"
        >
          <path d="M3 4.5 6 7.5 9 4.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            key="list"
            // Drops in from under the button, like the Disaster menu
            initial={{ opacity: 0, y: -4, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1, transition: { duration: 0.16, ease: 'easeOut' } }}
            exit={{ opacity: 0, y: -4, scale: 0.97, transition: { duration: 0.12, ease: 'easeOut' } }}
            style={{ transformOrigin: 'top right' }}
            // Desktop: under the button, right-aligned. Phones: the wrapper is
            // static, so this is placed against the nav bar (the nearest
            // positioned box: it is sticky) and spans its width minus the gutters.
            className="absolute top-full right-0 z-10 mt-2 w-[280px] rounded-[16px] border border-line bg-surface p-1.5 shadow-card max-[580px]:right-4 max-[580px]:left-4 max-[580px]:mt-1 max-[580px]:w-auto"
          >
            <ul id={listId} role="listbox" aria-label="Choose a city" aria-busy={status === 'loading'} onKeyDown={onListKey} className="flex flex-col gap-0.5">
              {CITY_IDS.map((c) => {
                const d = CITIES[c], selected = c === city, chip = chips?.[c]
                return (
                  <li
                    key={c}
                    role="option"
                    aria-selected={selected}
                    tabIndex={-1}
                    data-city={c}
                    onClick={() => pick(c)}
                    className={cx(
                      'flex cursor-pointer items-center justify-between gap-2 rounded-[10px] px-2.5 py-2 outline-offset-[-2px] transition-colors duration-150',
                      selected ? 'bg-accent-soft' : 'hover:bg-surface2 focus:bg-surface2',
                    )}
                  >
                    <span className="flex min-w-0 flex-col">
                      <span className={cx('text-[14px] font-semibold', selected ? 'text-accent' : 'text-ink')}>{d.name}</span>
                      <span className="truncate text-[12.5px] text-muted">{d.state}</span>
                    </span>
                    {chip ? (
                      <Chip tone={chip[0]}>{chip[1]}</Chip>
                    ) : status === 'loading' ? (
                      <Skeleton className="h-[23px] w-[96px] shrink-0 rounded-full" />
                    ) : null}
                  </li>
                )
              })}
            </ul>
            {status === 'loading' && (
              <span role="status" className="sr-only">
                Loading each city's greenness…
              </span>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
