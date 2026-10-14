// Page footer: project blurb, quick links to the main sections and credits.

// Column heading, on its own line above the column's text or links.
const headCls = 'mb-1.5 block text-ink'
// Footer link: one per line, muted until hovered.
const linkCls = 'block py-0.5 text-muted no-underline hover:text-accent'

export default function Footer() {
  return (
    <footer className="mx-auto grid max-w-[1180px] grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-5 border-t border-line px-5 pt-7 pb-10 text-[14px] text-muted">
      <div>
        <b className={headCls}>Vegetation of the City</b>A satellite-based look at vegetation and climate trends, built for anyone to explore.
      </div>
      <div>
        <b className={headCls}>Explore</b>
        <a className={linkCls} href="#home">Home and city picker</a>
        <a className={linkCls} href="#plot">Plot builder</a>
        <a className={linkCls} href="#why">Why it changes</a>
        <a className={linkCls} href="#outlook">Outlook</a>
      </div>
      <div>
        <b className={headCls}>Project</b>
        <a className={linkCls} href="#intro">Introduction</a>
        <a className={linkCls} href="#science">The science</a>
        <a className={linkCls} href="#methods">Methods</a>
        <a className={linkCls} href="#sources">Data sources</a>
        <a className={linkCls} href="#faq">FAQ</a>
      </div>
      <div>
        <b className={headCls}>Note</b>© 2026. Data shown is for general information. Imagery © Esri, Maxar, Earthstar Geographics.
      </div>
    </footer>
  )
}
