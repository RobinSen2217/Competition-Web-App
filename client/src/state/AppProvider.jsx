import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AppContext } from './appContext'
import { DATA, DEFAULT_CITY } from '../lib/data'
import { store } from '../lib/storage'

export default function AppProvider({ children }) {
  // The last chosen city is remembered between visits.
  const [city, setCityState] = useState(() => {
    const c = store.get('city', DEFAULT_CITY)
    return DATA.cities[c] ? c : DEFAULT_CITY
  })
  // Bumps on every pick, including re-picking the current city, so the map can
  // recentre on it (React would skip a re-render for an unchanged city).
  const [focusSeq, setFocusSeq] = useState(0)
  const setCity = useCallback((c) => {
    if (!DATA.cities[c]) return
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
        {toastMsg != null && <div className="toast">{toastMsg}</div>}
      </div>
    </AppContext.Provider>
  )
}
