// Vercel Function: the site's visitor count, kept in Upstash Redis.
//   GET  /api/visits -> { count }  read the current total (0 if never set)
//   POST /api/visits -> { count }  add one visitor and return the new total
// Talks to Upstash's REST API with plain fetch, so no npm dependency is needed.
// Not configured (no database connected) -> 503 { count: null }, and the
// client simply hides the counter.

const KEY = 'competition-web-app:visitors'
const NO_STORE = { 'Cache-Control': 'no-store' }

// Vercel's Upstash integration names the variables KV_REST_API_* or
// UPSTASH_REDIS_REST_*, depending on how the database was connected.
function config() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN
  return url && token ? { url: url.replace(/\/+$/, ''), token } : null
}

function reply(body, status = 200) {
  return Response.json(body, { status, headers: NO_STORE })
}

// Run one Redis command, e.g. ['INCR', KEY]; resolves to its `result`.
async function redis(cfg, command) {
  const res = await fetch(cfg.url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${cfg.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(command),
  })
  const data = await res.json().catch(() => null)
  if (!res.ok || !data || data.error) throw new Error(data?.error || `Upstash HTTP ${res.status}`)
  return data.result
}

async function handle(command) {
  const cfg = config()
  if (!cfg) return reply({ count: null, error: 'not configured' }, 503)
  try {
    // GET returns the stored string (or null); INCR returns a number.
    const result = await redis(cfg, command)
    return reply({ count: Number(result) || 0 })
  } catch (err) {
    console.error('visits:', err)
    return reply({ count: null, error: 'upstream error' }, 502)
  }
}

export function GET() {
  return handle(['GET', KEY])
}

export function POST() {
  return handle(['INCR', KEY])
}
