import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { AppContext } from './appContext'
import { CITIES, CITY_IDS, DEFAULT_CITY } from '../lib/store'
import { store } from '../lib/storage'

export default function AppProvider({ children }) {
  // The last chosen city is remembered between visits.
  // The city list comes from the bootstrap; a remembered city the server no
  // longer lists falls back to the default (or the first city if that is gone too).
  const [city, setCityState] = useState(() => {
    const c = store.get('city', DEFAULT_CITY)
    return CITIES[c] ? c : CITIES[DEFAULT_CITY] ? DEFAULT_CITY : CITY_IDS[0]
  })
  // Bumps on every pick, including re-picking the current city, so the map can
  // recentre on it (React would skip a re-render for an unchanged city).
  const [focusSeq, setFocusSeq] = useState(0)
  const setCity = useCallback((c) => {
    if (!CITIES[c]) return
    setCityState(c)
    setFocusSeq((n) => n + 1)
    store.set('city', c)
  }, [])

  // One toast at a time; a new message replaces the old one and restarts the timer.
  const [toastMsg, setToastMsg] = useState(null)
  const timer = useRef(null)
  const toast = useCallback((t) => {
    setToastMsg(t)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setToastMsg(null), 2600)
  }, [])
  useEffect(() => () => clearTimeout(timer.current), [])

  const value = useMemo(() => ({ city, setCity, focusSeq, toast }), [city, setCity, focusSeq, toast])

  return (
    <AppContext.Provider value={value}>
      {children}
      {/* The live region is always in the document so screen readers announce
          the message when it appears; only the visible toast comes and goes. */}
      <div role="status" aria-live="polite">
        {/* Slides up and fades in, then back down on its way out. A new message
            while one is showing just swaps the text in place (no key change),
            so quick repeats don't stack or flicker. The centring uses the CSS
            `translate` property (Tailwind v4) and the motion uses `transform`,
            so the two don't overwrite each other. */}
        <AnimatePresence>
          {toastMsg != null && (
            <motion.div
              key="toast"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0, transition: { duration: 0.25, ease: 'easeOut' } }}
              exit={{ opacity: 0, y: 12, transition: { duration: 0.2, ease: 'easeIn' } }}
              className="fixed bottom-6 left-1/2 z-[2000] -translate-x-1/2 rounded-full bg-ink px-[18px] py-2.5 text-[14px] text-page shadow-card"
            >
              {toastMsg}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </AppContext.Provider>
  )
}
