import { useEffect, useState } from 'react'

// Sticky top bar: logo plus in-page links. The link for the section currently
// in the middle of the viewport gets the "on" class.

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
    <nav className="nav" aria-label="Main">
      <div className="in">
        <a className="logo" href="#home">
          <svg width="30" height="30" viewBox="0 0 30 30" aria-hidden="true">
            <circle cx="15" cy="15" r="14" fill="var(--accent-soft)" />
            <path d="M9 20c0-7 5-11 13-12-1 8-5 13-12 13" fill="var(--accent)" />
            <path d="M10 21c3-4 6-7 10-10" stroke="var(--surface)" strokeWidth="1.4" fill="none" strokeLinecap="round" />
          </svg>
          <span>Vegetation of the City</span>
        </a>
        <div className="links" id="navlinks">
          {LINKS.map(([id, label]) => (
            <a key={id} href={'#' + id} className={active === id ? 'on' : undefined}>
              {label}
            </a>
          ))}
        </div>
      </div>
    </nav>
  )
}
