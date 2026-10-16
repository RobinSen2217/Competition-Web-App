// HTTP behaviour shared by every endpoint: cache headers, content type,
// CORS (default and CORS_ORIGINS), 404/405 handling and the removal of the
// old unversioned endpoints.

const { test, before, after, describe } = require('node:test')
const assert = require('node:assert/strict')
const { startServer, assertError } = require('./support/server')
const { loadConfig } = require('../src/config')

const DATA_PATHS = [
  '/api/v1/parameters', '/api/v1/parameters/rain', '/api/v1/areas', '/api/v1/areas/jaipur',
  '/api/v1/areas/jaipur/boundary', '/api/v1/timeseries?areas=jaipur', '/api/v1/areas/jaipur/timeseries',
  '/api/v1/areas/jaipur/layers', '/api/v1/areas/jaipur/layers/ndvi-peak',
  '/api/v1/areas/jaipur/layers/ndvi-peak/values?time=2010', '/api/v1/basemap',
]

let srv
before(async () => {
  srv = await startServer({ config: loadConfig({}) })
})
after(() => srv.close())

describe('headers', () => {
  test('data endpoints are JSON and cacheable for five minutes', async () => {
    for (const p of DATA_PATHS) {
      const res = await srv.get(p)
      assert.equal(res.status, 200, p)
      assert.equal(res.headers.get('cache-control'), 'public, max-age=300', p)
      assert.match(res.headers.get('content-type'), /application\/json/, p)
    }
  })

  test('health and errors are never cached', async () => {
    assert.equal((await srv.get('/api/v1/health')).headers.get('cache-control'), 'no-store')
    assert.equal((await srv.get('/api/v1/areas/nope')).headers.get('cache-control'), 'no-store')
  })

  test('CORS allows any origin by default', async () => {
    const res = await srv.get('/api/v1/areas', { headers: { Origin: 'https://example.com' } })
    assert.equal(res.headers.get('access-control-allow-origin'), '*')
  })

  test('HEAD is answered like GET, without a body', async () => {
    const res = await fetch(`${srv.base}/api/v1/areas`, { method: 'HEAD' })
    assert.equal(res.status, 200)
    assert.equal(await res.text(), '')
  })
})

describe('routing errors', () => {
  test('unknown routes are 404 not_found', async () => {
    for (const p of ['/api/v1/nope', '/api/v1', '/api/v2/areas', '/', '/api/v1/areas/jaipur/nope']) {
      assertError(await srv.get(p), 404, 'not_found')
    }
  })

  test('the old unversioned endpoints are gone', async () => {
    for (const p of ['/api/health', '/api/climate', '/api/cities', '/api/cities/jaipur/series',
      '/api/boundaries', '/api/map/mosaics', '/api/map/rasters', '/api/cities/jaipur/pixels']) {
      assertError(await srv.get(p), 404, 'not_found')
    }
  })

  test('other methods on a known path are 405 method_not_allowed', async () => {
    for (const [method, p] of [['POST', '/api/v1/areas'], ['DELETE', '/api/v1/areas/jaipur'], ['PUT', '/api/v1/timeseries']]) {
      const res = await srv.get(p, { method, body: method === 'DELETE' ? undefined : '{}', headers: { 'content-type': 'application/json' } })
      assertError(res, 405, 'method_not_allowed')
      assert.equal(res.headers.get('allow'), 'GET, HEAD')
      assert.deepEqual(res.body.error.details.allowed, ['GET', 'HEAD'])
    }
    assertError(await srv.get('/api/v1/nope', { method: 'POST' }), 404, 'not_found')
  })

  test('a malformed URL is a 400 JSON error, not a crash', async () => {
    const res = await srv.get('/api/v1/areas/%E0%A4%A')
    assert.equal(res.status, 400)
    assert.equal(res.body.error.status, 400)
    assert.equal(typeof res.body.error.code, 'string')
  })

  test('unknown query parameters are ignored', async () => {
    const res = await srv.get('/api/v1/areas/jaipur?foo=bar&params=ndvi')
    assert.equal(res.status, 200)
  })
})

describe('internal errors', () => {
  test('a provider failure is 500 internal_error without leaking details', async () => {
    const broken = { name: 'broken', listAreas: async () => { throw new Error('secret path /etc/x') } }
    const s = await startServer({ config: loadConfig({}), provider: broken })
    const original = console.error
    console.error = () => {}
    try {
      const res = await s.get('/api/v1/areas')
      assertError(res, 500, 'internal_error')
      assert.equal(res.body.error.message, 'Internal server error')
      assert.equal(res.body.error.details, undefined)
    } finally {
      console.error = original
      await s.close()
    }
  })
})

describe('timeseries size limit', () => {
  // 6 areas x 16 parameters x 201 months = 19,296 values; a small limit makes
  // the default data big enough to hit it.
  let small
  before(async () => {
    small = await startServer({ config: loadConfig({ TIMESERIES_MAX_VALUES: '1000' }) })
  })
  after(() => small.close())

  test('over the limit is 400 invalid_query with limit and requested', async () => {
    let res = await small.get('/api/v1/timeseries?areas=*&parameters=*')
    assertError(res, 400, 'invalid_query')
    assert.deepEqual(res.body.error.details, { limit: 1000, requested: 6 * 16 * 201 })
    // The count uses the clipped range: 2 areas x 2 parameters x 12 months.
    res = await small.get('/api/v1/timeseries?areas=jaipur,delhi&parameters=ndvi,rain&from=2020-01&to=2020-12')
    assert.equal(res.status, 200)
    // A range reaching outside the data counts only the months that exist.
    res = await small.get('/api/v1/areas/jaipur/timeseries?parameters=ndvi&from=1900-01&to=2100-12')
    assert.equal(res.status, 200)
    assert.equal(res.body.data.times.length, 201)
    // 1 area x 16 parameters x 201 months = 3,216 > 1000.
    res = await small.get('/api/v1/areas/jaipur/timeseries')
    assertError(res, 400, 'invalid_query')
    assert.deepEqual(res.body.error.details, { limit: 1000, requested: 16 * 201 })
  })

  test('the default limit (500,000) admits the full dataset', async () => {
    const res = await srv.get('/api/v1/timeseries?areas=*&parameters=*')
    assert.equal(res.status, 200)
  })
})

describe('CORS_ORIGINS', () => {
  let restricted
  before(async () => {
    restricted = await startServer({ config: loadConfig({ CORS_ORIGINS: 'http://localhost:5173, https://site.example' }) })
  })
  after(() => restricted.close())

  test('listed origins are echoed back, others get no CORS header', async () => {
    let res = await restricted.get('/api/v1/health', { headers: { Origin: 'https://site.example' } })
    assert.equal(res.headers.get('access-control-allow-origin'), 'https://site.example')
    res = await restricted.get('/api/v1/health', { headers: { Origin: 'https://evil.example' } })
    assert.equal(res.headers.get('access-control-allow-origin'), null)
  })

  test('config parsing', () => {
    assert.equal(loadConfig({}).corsOrigins, '*')
    assert.equal(loadConfig({ CORS_ORIGINS: 'a.example,*' }).corsOrigins, '*')
    assert.equal(loadConfig({}).port, 5050)
    assert.equal(loadConfig({ PORT: '6000' }).port, 6000)
    assert.equal(loadConfig({}).dataProvider, 'files')
    assert.equal(loadConfig({}).timeseriesMaxValues, 500000)
    assert.equal(loadConfig({ TIMESERIES_MAX_VALUES: '1000' }).timeseriesMaxValues, 1000)
  })
})
