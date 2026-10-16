import { useEffect, useState } from 'react'
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
  return (
    <span className="mt-2 block">
      Visitors: <span className="font-mono tabular-nums text-ink">{count.toLocaleString('en-IN')}</span>
    </span>
  )
}
