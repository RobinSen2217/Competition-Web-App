import { INSTITUTIONS } from '../../data/contact'
import VisitorCounter from './VisitorCounter'

// Page footer: project blurb, quick links to the page's sections, partner
// institutions, credits and the visitor counter.

// Column heading, on its own line above the column's text or links.
const headCls = 'mb-1.5 block text-ink'
// Footer link: one per line, muted until hovered.
const linkCls = 'block py-0.5 text-muted no-underline hover:text-accent'

export default function Footer() {
  return (
    <footer className="mx-auto grid max-w-[1180px] grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-5 border-t border-line px-5 pt-7 pb-10 text-[14px] text-muted">
      <div>
        <b className={headCls}>Competition Web App</b>A satellite-based look at vegetation and climate trends, built for anyone to explore.
      </div>
      <div>
        <b className={headCls}>Explore</b>
        <a className={linkCls} href="#glance">Overview of data</a>
        <a className={linkCls} href="#features">Data analysis</a>
        <a className={linkCls} href="#where">Map / Plot</a>
        <a className={linkCls} href="#mlforecast">Forecast</a>
      </div>
      <div>
        <b className={headCls}>Project</b>
        <a className={linkCls} href="#about">About</a>
        <a className={linkCls} href="#science">Science</a>
        <a className={linkCls} href="#faq">FAQ</a>
        <a className={linkCls} href="#contact">Contact us</a>
      </div>
      <div>
        <b className={headCls}>Partners</b>
        {INSTITUTIONS.map((i) => (
          <span key={i.short} className="flex items-center gap-2 py-1">
            <img src={i.logo} alt="" className="h-7 w-auto flex-none" />
            {i.name}
          </span>
        ))}
      </div>
      <div>
        <b className={headCls}>Note</b>© 2026. Data shown is for general information. Imagery © Esri, Maxar, Earthstar Geographics.
        <VisitorCounter />
      </div>
    </footer>
  )
}
