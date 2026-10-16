import { useLayoutEffect } from 'react'

// Top-level section of the app for a path: 'disaster' for /disaster and
// everything under it, 'vegetation' for the rest. Used for the colour theme
// and as the key of the page transition (so /disaster -> /disaster/flood
// doesn't replay the fade, but Vegetation <-> Disaster does).
export const sectionOf = (pathname) => (pathname === '/disaster' || pathname.startsWith('/disaster/') ? 'disaster' : 'vegetation')

// Whether the attribute has been applied once. The first application (e.g. the
// app opened directly on /disaster/flood) must not fade from green to blue.
let applied = false

// Puts data-module="disaster" on <html> while a disaster page is shown, and
// removes it elsewhere. index.css swaps the palette to blue for that attribute
// and fades between the two (see the "Module themes" section there).
//
// A layout effect, so the attribute is in place before the browser paints the
// new page: the page never shows a frame in the wrong colours.
export default function useModuleTheme(pathname) {
  const section = sectionOf(pathname)
  useLayoutEffect(() => {
    const root = document.documentElement
    const body = document.body
    const apply = () => {
      if (section === 'disaster') root.setAttribute('data-module', 'disaster')
      else root.removeAttribute('data-module')
    }
    if (applied) return apply()
    // First run: switch with the fade turned off. Reading offsetHeight forces
    // the browser to apply the new colours now, so restoring the transition
    // afterwards doesn't animate them.
    body.style.transition = 'none'
    apply()
    void body.offsetHeight
    body.style.transition = ''
    applied = true
  }, [section])
}
