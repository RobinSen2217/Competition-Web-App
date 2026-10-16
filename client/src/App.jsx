import { useEffect, useRef } from 'react'
import { BrowserRouter, Navigate, Route, Routes, useLocation, useOutlet } from 'react-router'
import { AnimatePresence, MotionConfig, motion } from 'framer-motion'
import AppProvider from './state/AppProvider'
import Nav from './components/layout/Nav'
import VegetationPage from './pages/VegetationPage'
import DisasterPage from './pages/DisasterPage'
import FloodPage from './pages/FloodPage'
import useModuleTheme, { sectionOf } from './hooks/useModuleTheme'

// Pages under one nav bar:
//   /                 vegetation explorer
//   /disaster/flood   disaster module, flood hazard
// /disaster itself redirects to its only hazard for now; a new hazard gets a
// route here and an entry in HAZARDS in components/layout/Nav.jsx.
// Unknown paths go back to the vegetation page. On Vercel, client/vercel.json
// rewrites every path to index.html so /disaster/flood works when opened directly.
export default function App() {
  return (
    // reducedMotion="user": with the OS "reduce motion" setting on, framer-motion
    // drops movement (slides, scaling, layout) and keeps only opacity fades.
    <MotionConfig reducedMotion="user">
      <AppProvider>
        <BrowserRouter>
          <Routes>
            <Route element={<Layout />}>
              <Route index element={<VegetationPage />} />
              <Route path="disaster" element={<DisasterPage />}>
                <Route index element={<Navigate to="flood" replace />} />
                <Route path="flood" element={<FloodPage />} />
              </Route>
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </AppProvider>
    </MotionConfig>
  )
}

// False until the app has first appeared. The very first page shows without the
// fade so opening the app isn't delayed. This is decided per page wrapper, not
// with AnimatePresence initial={false}: that would also switch off the
// first-render animations of everything inside (the cards' scroll-in reveals).
let started = false

// Shared frame: the nav bar above whichever page is active. Switching between
// sections (Vegetation <-> Disaster) fades the old page out, then the new one
// in with a small rise. The key is the section, not the full location, so
// #anchor jumps and moves between disaster sub-pages don't replay it.
function Layout() {
  const { pathname } = useLocation()
  const section = sectionOf(pathname)
  // The routed page, captured here and passed down as children: while a section
  // fades out, AnimatePresence keeps rendering the element it last had, so the
  // old page stays in the fading wrapper instead of the new one (a plain
  // <Outlet /> inside it would already show the new route).
  const outlet = useOutlet()
  // After the first commit, every later page fades in (see `started` below).
  useEffect(() => {
    started = true
  }, [])
  useModuleTheme(pathname)
  return (
    <>
      <ScrollToTop section={section} />
      <Nav />
      <AnimatePresence
        mode="wait"
        // The new page starts at the top. Doing it here, once the old page has
        // faded out, avoids a visible jump of the old page.
        onExitComplete={() => {
          if (!window.location.hash) window.scrollTo({ top: 0, behavior: 'instant' })
        }}
      >
        <motion.div
          key={section}
          initial={started ? { opacity: 0, y: 8 } : false}
          animate={{ opacity: 1, y: 0, transition: { duration: 0.28, ease: 'easeOut' } }}
          exit={{ opacity: 0, transition: { duration: 0.15, ease: 'easeOut' } }}
          // At rest framer-motion sets transform: none, so nothing inside (the
          // Leaflet map, sticky elements) sits under a transformed ancestor.
        >
          {outlet}
        </motion.div>
      </AnimatePresence>
    </>
  )
}

// Moving within a section (e.g. /disaster -> /disaster/flood) starts the page at
// the top; between sections the AnimatePresence above does it after the fade.
// Links to a part of the page (#plot) are left alone so the browser can scroll there.
function ScrollToTop({ section }) {
  const { pathname, hash } = useLocation()
  const lastSection = useRef(section)
  useEffect(() => {
    const sameSection = lastSection.current === section
    lastSection.current = section
    if (!hash && sameSection) window.scrollTo(0, 0)
  }, [pathname, hash, section])
  return null
}
