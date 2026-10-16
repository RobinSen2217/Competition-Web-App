// Success responses. Every 2xx body is {"data": <payload>, "meta"?: {...}} so a
// client can always find the payload in the same place, and new metadata (paging,
// provenance, units) can be added to `meta` later without changing `data`.

function ok(res, data, meta) {
  const body = { data }
  if (meta && Object.keys(meta).length) body.meta = meta
  return res.json(body)
}

// Cache policies. Data only changes when the provider reloads, so browsers and
// CDNs may reuse responses for five minutes; health checks must never be cached.
const CACHE_DATA = 'public, max-age=300'
const CACHE_NONE = 'no-store'

function cache(policy) {
  return (req, res, next) => {
    res.set('Cache-Control', policy)
    next()
  }
}

module.exports = { ok, cache, CACHE_DATA, CACHE_NONE }
