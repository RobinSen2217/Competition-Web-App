import { useEffect, useState } from 'react'
import { AnimatePresence, MotionConfig } from 'framer-motion'
import Loader from './components/common/Loader'
import ErrorBoundary from './components/common/ErrorBoundary'

// Root shell shown from the very first frame: the loader until `appReady`
// (city list loaded + App.jsx imported, see main.jsx) resolves, then the app.
// Must stay free of data imports, like main.jsx.
// The app sits in a last-resort error boundary: if rendering fails outside
// every inner boundary (App.jsx has one per page, LazySection one per
// section), the reader gets the loader screen with a message and a Reload
// button instead of a blank page.
export default function Boot({ appReady }) {
  // Holds the App component once data and code are in. Stored as { App } since
  // useState would call a bare function component as an updater.
  const [loaded, setLoaded] = useState(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let alive = true
    appReady.then(
      (mod) => alive && setLoaded({ App: mod.default }),
      (err) => {
        console.error(err)
        if (alive) setFailed(true)
      },
    )
    return () => {
      alive = false
    }
  }, [appReady])

  const App = loaded?.App
  return (
    // "user": animations respect the device's reduce-motion setting
    // (transforms are skipped, fades stay) everywhere in the app.
    <MotionConfig reducedMotion="user">
      {App && (
        <ErrorBoundary fallback={() => <Loader failed message="Something went wrong while showing the page." />}>
          <App />
        </ErrorBoundary>
      )}
      {/* The loader sits fixed above the app and fades out once the app has
          rendered beneath it, so the two crossfade without a blank frame. */}
      <AnimatePresence>{!App && <Loader key="loader" failed={failed} />}</AnimatePresence>
    </MotionConfig>
  )
}
