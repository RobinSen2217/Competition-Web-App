import { useEffect, useRef, useState } from 'react'
import { animate, useInView, useReducedMotion } from 'framer-motion'
import { store } from '../../lib/storage'

// Footer line "Visitors: 1,234".
// The number is kept by Abacus (https://abacus.jsn.cam), a free public counter
// service that needs no account or database: /hit adds one and returns the new
// total, /get only reads it. A counter expires after 6 months without any
// request, so it lasts as long as the site gets visitors.
// Each browser is counted once: the first visit "hits" and stores a flag, later
// visits only read the total. Renders nothing if the service can't be reached.

const COUNTER = 'https://abacus.jasoncameron.dev'
const NAMESPACE = 'competition-web-app-black'
const KEY = 'visitors'
// Only the live site adds visitors. Local development and Vercel preview links
// just read the number, so testing never inflates it. Change this if the site
// moves to another domain.
const LIVE_HOST = 'competition-web-app-black.vercel.app'
const FLAG = 'visited'

// One request per page load, shared by every mount. StrictMode mounts effects
// twice in development; without this the first visit would be counted twice.
let pending = null

function loadCount() {
  if (!pending) {
    const add = window.location.hostname === LIVE_HOST && !store.get(FLAG, false)
    pending = fetch(`${COUNTER}/${add ? 'hit' : 'get'}/${NAMESPACE}/${KEY}`)
      .then((res) => res.json().catch(() => null))
      .then((data) => {
        const count = typeof data?.value === 'number' ? data.value : null
        // Only remember the visit once the service has actually counted it,
        // so a failed attempt is retried on the next visit.
        if (add && count != null) store.set(FLAG, true)
        return count
      })
      .catch(() => null)
  }
  return pending
}

export default function VisitorCounter() {
  const [count, setCount] = useState(null)

  useEffect(() => {
    let alive = true
    loadCount().then((n) => {
      if (alive) setCount(n)
    })
    return () => {
      alive = false
    }
  }, [])

  if (count == null) return null
  return <Count value={count} />
}

const fmt = (n) => n.toLocaleString('en-IN')

// The number counts up from 0 the first time the footer line scrolls into view.
// With reduced motion it shows the final value straight away.
function Count({ value }) {
  const ref = useRef(null)
  const inView = useInView(ref, { once: true })
  const still = useReducedMotion()
  const [shown, setShown] = useState(0)

  useEffect(() => {
    if (still || !inView) return
    const controls = animate(0, value, {
      duration: 0.8,
      ease: 'easeOut',
      onUpdate: (v) => setShown(Math.round(v)),
    })
    return () => controls.stop()
  }, [inView, still, value])

  return (
    <span ref={ref} className="mt-2 block">
      Visitors:{' '}
      {/* Mono digits plus a width reserved for the final number, so the line
          doesn't grow while counting. Screen readers get the final value only,
          not every intermediate number. */}
      <span
        className="inline-block text-left font-mono tabular-nums text-ink"
        style={{ minWidth: `${fmt(value).length}ch` }}
        aria-hidden="true"
      >
        {fmt(still ? value : shown)}
      </span>
      <span className="sr-only">{fmt(value)}</span>
    </span>
  )
}
