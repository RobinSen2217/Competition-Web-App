import { useEffect, useState } from 'react'
import { cx } from '../../styles/classes'

// Sticky top bar: logo plus in-page links. The link for the section currently
// in the middle of the viewport is highlighted (solid accent pill).

const LINKS = [
  ['home', 'Home'],
  ['glance', 'Now'],
  ['plot', 'Plot'],
  ['why', 'Why'],
  ['outlook', 'Outlook'],
  ['compare', 'Compare'],
  ['intro', 'Intro'],
  ['science', 'Science'],
  ['methods', 'Methods'],
  ['sources', 'Sources'],
  ['faq', 'FAQ'],
]

// Every section the observer watches. "where" (the map) has no link of its own,
// so while it is in view no link is highlighted, as in the original.
const SECTION_IDS = ['home', 'glance', 'where', 'plot', 'why', 'outlook', 'compare', 'intro', 'science', 'methods', 'sources', 'faq']

export default function Nav() {
  const [active, setActive] = useState(null)

  useEffect(() => {
    // The rootMargin shrinks the viewport to a thin band just above the middle
    // of the screen, so only one section intersects at a time.
    // Sections are rendered by sibling components that mount in the same commit,
    // so they already exist in the DOM when this effect runs.
    const io = new IntersectionObserver(
      (es) => {
        es.forEach((e) => {
          if (e.isIntersecting) setActive(e.target.id)
        })
      },
      { rootMargin: '-45% 0px -50% 0px' },
    )
    SECTION_IDS.forEach((id) => {
      const el = document.getElementById(id)
      if (el) io.observe(el)
    })
    return () => io.disconnect()
  }, [])

  return (
    // Translucent page colour with a blur, so content scrolling underneath stays faintly visible
    <nav
      className="sticky top-[env(safe-area-inset-top,0px)] z-[1000] border-b border-line bg-[color-mix(in_srgb,var(--bg)_88%,transparent)] backdrop-blur-[10px]"
      aria-label="Main"
    >
      <div className="mx-auto flex max-w-[1180px] items-center justify-between gap-4 px-5 py-2.5">
        <a className="flex items-center gap-2.5 font-display text-[19px] font-semibold whitespace-nowrap text-ink no-underline" href="#home">
          <svg className="flex-none" width="30" height="30" viewBox="0 0 30 30" aria-hidden="true">
            <circle cx="15" cy="15" r="14" fill="var(--accent-soft)" />
            <path d="M9 20c0-7 5-11 13-12-1 8-5 13-12 13" fill="var(--accent)" />
            <path d="M10 21c3-4 6-7 10-10" stroke="var(--surface)" strokeWidth="1.4" fill="none" strokeLinecap="round" />
          </svg>
          {/* The name hides on narrow screens so the links get the room */}
          <span className="max-[761px]:hidden">Vegetation of the City</span>
        </a>
        {/* Scrolls sideways when the links don't fit, with the scrollbar hidden */}
        <div className="flex gap-0.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" id="navlinks">
          {LINKS.map(([id, label]) => (
            <a
              key={id}
              href={'#' + id}
              className={cx(
                'rounded-full px-3 py-[7px] text-[14px] font-medium whitespace-nowrap no-underline',
                // The active link keeps its accent colours on hover
                active === id ? 'bg-accent text-on-accent' : 'text-muted hover:bg-accent-soft hover:text-ink',
              )}
            >
              {label}
            </a>
          ))}
        </div>
      </div>
    </nav>
  )
}
