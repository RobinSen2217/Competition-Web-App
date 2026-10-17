import { useEffect, useId, useRef, useState } from 'react'
import { Link, NavLink, useLocation } from 'react-router'
import { AnimatePresence, LayoutGroup, motion } from 'framer-motion'
import { cx } from '../../styles/classes'
import { INSTITUTIONS } from '../../data/contact'
import { sectionOf } from '../../hooks/useModuleTheme'
import VoiceGuide from './VoiceGuide'
import CityPicker from './CityPicker'

// Sticky top bar: the app logo with the partner institutions, the voice guide
// button, and one tab per module. The tab of the section you are on gets a
// solid accent pill, which slides from tab to tab (a shared framer-motion
// layoutId) instead of jumping. "Disaster" opens a small menu of hazards.
// On the vegetation page a city picker sits before the tabs, so the city can be
// changed from anywhere while scrolling (the disaster pages have no city).
//
// Widths (the city name is never cut: "Jaipur" and "Jaisalmer" must stay
// distinguishable, so the picker never shrinks and the rest makes room):
//   700px and up  name, partner logos, picker, tabs in one row
//   580-699px     the logos are left out (they would squeeze the name)
//   below 580px   phones: the picker moves to a second row of the bar, under
//                 the name and the tabs (one row cannot fit all three with a
//                 readable city name at 320-400px). The cards' scroll margin
//                 (scroll-mt in Card/CardSkeleton/Hero) allows for the taller bar.
//                 Why 580: the one-row bar needs ~545px with the longest name
//                 ("Jaisalmer"); below that it used to wrap on its own, with the
//                 tabs on a second row and the card scroll margin too small.
//                 The extra ~35px absorbs system fonts wider than ours.
// Keep PHONE (580) in step with the max-[580px] classes here, in CityPicker.jsx
// and in the scroll-mt classes of Card (ui/index.jsx), CardSkeleton and Hero.

// The "Listen" voice guide (VoiceGuide.jsx) is hidden for now; set to true to show it again.
const SHOW_VOICE_GUIDE = false

// Hazards listed in the Disaster menu. To add one, add it here and add its
// route under "disaster" in App.jsx.
const HAZARDS = [{ to: '/disaster/flood', label: 'Flood' }]

// Shared look of the two tabs. The active one has no background of its own:
// the sliding <ActivePill> paints it.
const tabCls = (active) =>
  cx(
    'relative inline-flex cursor-pointer items-center gap-1 rounded-full border-0 bg-transparent px-3 py-[7px] max-[481px]:px-2 max-[400px]:px-1.5 font-body text-[14px] max-[400px]:text-[13px] leading-[normal] font-medium whitespace-nowrap no-underline transition-colors duration-150',
    // The active tab keeps its accent colours on hover
    active ? 'text-on-accent' : 'text-muted hover:bg-accent-soft hover:text-ink',
  )

export default function Nav() {
  const { pathname } = useLocation()
  const showCity = sectionOf(pathname) === 'vegetation'
  return (
    // Translucent page colour with a blur, so content scrolling underneath stays faintly visible
    <nav
      className="sticky top-[env(safe-area-inset-top,0px)] z-[1000] border-b border-line bg-[color-mix(in_srgb,var(--bg)_88%,transparent)] backdrop-blur-[10px]"
      aria-label="Main"
    >
      {/* flex-wrap: on phones the picker takes a row of its own (basis-full) */}
      <div className="mx-auto flex max-w-[1180px] flex-wrap items-center gap-x-4 gap-y-1 px-5 py-2.5 max-[580px]:gap-x-2 max-[580px]:py-2 max-[380px]:px-4">
        {/* App name (no logo for now). Below 420px it wraps onto two smaller
            lines, so the tabs fit beside it down to 320px */}
        <Link
          className="font-display text-[19px] font-semibold whitespace-nowrap text-ink no-underline max-[640px]:text-[16px] max-[420px]:max-w-[86px] max-[420px]:text-[14px] max-[420px]:leading-tight max-[420px]:whitespace-normal"
          to="/"
        >
          Competition Web App
        </Link>
        {/* Partner institution logos (names as tooltip and alt text). Only from
            700px: below that they would squeeze the name and the picker. */}
        <span className="hidden items-center gap-3 border-l border-line pl-4 min-[700px]:flex">
          {INSTITUTIONS.map((i) => (
            <img key={i.short} src={i.logo} alt={i.name} title={i.name} className="h-9 w-auto" />
          ))}
        </span>
        {SHOW_VOICE_GUIDE && <VoiceGuide className="ml-auto" />}
        {/* The picker never shrinks (shrink-0 inside), so the name stays whole */}
        {showCity && <CityPicker className="ml-auto max-[580px]:order-last max-[580px]:ml-0 max-[580px]:basis-full" />}
        {/* Pushed right: always on phones (the picker is in the row below) and
            on pages without a picker */}
        <Tabs className={showCity ? 'max-[580px]:ml-auto' : 'ml-auto'} />
      </div>
    </nav>
  )
}

function Tabs({ className }) {
  const { pathname } = useLocation()
  const section = sectionOf(pathname)
  return (
    // LayoutGroup scopes the layoutId to this nav, so the pill animates between these tabs only
    <LayoutGroup id="main-tabs">
      <div className={cx('flex shrink-0 gap-0.5', className)}>
        {/* "end" so the Vegetation tab ("/") isn't also active on /disaster */}
        <NavLink to="/" end className={tabCls(section === 'vegetation')}>
          {section === 'vegetation' && <ActivePill />}
          <span className="relative">Vegetation</span>
        </NavLink>
        <DisasterMenu active={section === 'disaster'} pathname={pathname} />
      </div>
    </LayoutGroup>
  )
}

// The accent pill behind the active tab. Both tabs render it with the same
// layoutId, so when the active tab changes framer-motion animates it from the
// old tab's box to the new one. With "reduce motion" on it just moves.
function ActivePill() {
  return (
    <motion.span
      layoutId="nav-active"
      className="absolute inset-0 rounded-full bg-accent"
      transition={{ type: 'spring', stiffness: 520, damping: 40, mass: 0.8 }}
      aria-hidden="true"
    />
  )
}

// "Disaster" tab: a disclosure button that shows a list of hazard links.
// Opens on click or tap (Enter/Space from the keyboard; ArrowDown also opens it
// and moves into the list, arrows move between the links). Closes on Escape
// (focus returns to the button), a click outside, focus leaving the menu, or
// navigating anywhere.
function DisasterMenu({ active, pathname }) {
  const menuId = useId()
  const wrap = useRef(null)
  const button = useRef(null)
  // The menu remembers the path it was opened on, so any navigation closes it
  // without an extra effect.
  const [openedAt, setOpenedAt] = useState(null)
  const open = openedAt === pathname
  const close = () => setOpenedAt(null)

  // While open: a click/tap outside closes it (pointerdown, so touch works too),
  // and so does Escape wherever focus is (Safari doesn't focus buttons on
  // click). Escape puts focus back on the button so keyboard users keep their place.
  useEffect(() => {
    if (!open) return
    const onDown = (e) => {
      if (!wrap.current?.contains(e.target)) setOpenedAt(null)
    }
    const onKey = (e) => {
      if (e.key !== 'Escape') return
      setOpenedAt(null)
      button.current?.focus()
    }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const focusFirstLink = () => requestAnimationFrame(() => wrap.current?.querySelector('a')?.focus())

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      // Arrow keys move between the button and the hazard links
      const items = [...wrap.current.querySelectorAll('a')]
      if (!items.length && e.key === 'ArrowDown') {
        e.preventDefault()
        setOpenedAt(pathname)
        focusFirstLink()
        return
      }
      const i = items.indexOf(document.activeElement)
      if (i === -1 && e.key === 'ArrowUp') return
      e.preventDefault()
      const next = e.key === 'ArrowDown' ? Math.min(i + 1, items.length - 1) : i - 1
      if (next < 0) button.current?.focus()
      else items[next].focus()
    }
  }

  // Tabbing out of the menu closes it (relatedTarget is where focus went)
  const onBlur = (e) => {
    if (open && !wrap.current?.contains(e.relatedTarget)) close()
  }

  return (
    <div ref={wrap} className="relative" onKeyDown={onKeyDown} onBlur={onBlur}>
      <button
        ref={button}
        type="button"
        className={tabCls(active)}
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpenedAt(open ? null : pathname)}
      >
        {active && <ActivePill />}
        <span className="relative">Disaster</span>
        {active && <span className="sr-only"> (current section)</span>}
        <svg
          className={cx('relative -mr-0.5 transition-transform duration-200 ease-out', open && 'rotate-180')}
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
            key="menu"
            id={menuId}
            // Drops in from just under the tab: fade, small slide and scale from the top right corner
            initial={{ opacity: 0, y: -4, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1, transition: { duration: 0.16, ease: 'easeOut' } }}
            exit={{ opacity: 0, y: -4, scale: 0.97, transition: { duration: 0.12, ease: 'easeOut' } }}
            style={{ transformOrigin: 'top right' }}
            // Right-aligned with the tab, so at 400px it stays inside the screen
            className="absolute top-full right-0 mt-2 w-[200px] max-w-[calc(100vw-40px)] rounded-[16px] border border-line bg-surface p-1.5 shadow-card"
          >
            <ul aria-label="Disaster types">
              {HAZARDS.map((h) => (
                <li key={h.to}>
                  <NavLink
                    to={h.to}
                    onClick={close}
                    className={({ isActive }) =>
                      cx(
                        'flex items-center justify-between gap-2 rounded-[10px] px-2.5 py-2 text-[14px] font-medium no-underline transition-colors duration-150',
                        isActive ? 'bg-accent-soft text-accent' : 'text-ink hover:bg-surface2',
                      )
                    }
                  >
                    {h.label}
                  </NavLink>
                </li>
              ))}
            </ul>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
