import { useEffect, useState } from 'react'
import { store } from '../../lib/storage'

// Footer line "Visitors: 1,234", backed by the /api/visits Vercel Function.
// Each browser is counted once: the first visit POSTs (+1) and stores a flag,
// later visits only GET the total. Renders nothing if the API is unreachable
// or not configured (local dev, or before a database is connected).

const FLAG = 'visited'

// One request per page load, shared by every mount. StrictMode mounts effects
// twice in development; without this the first visit would be counted twice.
let pending = null

function loadCount() {
  if (!pending) {
    const counted = store.get(FLAG, false)
    pending = fetch('/api/visits', { method: counted ? 'GET' : 'POST' })
      // Always read the body, even for errors (503 before a database is
      // connected); an unread body keeps the request open in the browser.
      .then((res) => res.json().catch(() => null))
      .then((data) => {
        const count = typeof data?.count === 'number' ? data.count : null
        // Only remember the visit once the server has actually counted it,
        // so a failed POST is retried on the next visit.
        if (!counted && count != null) store.set(FLAG, true)
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
