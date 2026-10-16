// End-to-end tests for every endpoint in the API contract, run with `npm test`
// (node:test + global fetch against the real app on an ephemeral port).

const { test, before, after, describe } = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')
const { createApp } = require('../src/app')

const DATA = path.join(__dirname, '..', 'data')
const CLIENT = path.join(__dirname, '..', '..', 'client')
const climate = require(path.join(DATA, 'climate.json'))

// Expected responses are the files the website bundled before the API existed.
// Should the client copies be deleted later, fall back to the server's copies.
const original = (clientRel, serverRel) => {
  const p = path.join(CLIENT, clientRel)
  return JSON.parse(fs.readFileSync(fs.existsSync(p) ? p : path.join(DATA, serverRel), 'utf8'))
}

// Starts the app on a random free port; get() returns status, headers and JSON.
// (Kept in this file: anything under test/ is picked up by `node --test`.)
async function startServer() {
  const server = createApp().listen(0)
  await new Promise((resolve) => server.once('listening', resolve))
  const base = `http://127.0.0.1:${server.address().port}`
  const get = async (urlPath, init) => {
    const res = await fetch(base + urlPath, init)
    const text = await res.text()
    return { status: res.status, headers: res.headers, body: text ? JSON.parse(text) : null }
  }
  const close = () => new Promise((resolve) => server.close(resolve))
  return { get, close }
}
const CITY_IDS = Object.keys(climate.cities)

let srv
before(async () => {
  delete process.env.CORS_ORIGINS
  srv = await startServer()
})
after(() => srv.close())

const assertError = (res, status) => {
  assert.equal(res.status, status)
  assert.equal(res.body.error.status, status)
  assert.equal(typeof res.body.error.message, 'string')
  assert.ok(res.body.error.message.length > 0)
  assert.equal(res.headers.get('cache-control'), 'no-store')
}

describe('meta', () => {
  test('GET /api/health', async () => {
    const res = await srv.get('/api/health')
    assert.equal(res.status, 200)
    assert.equal(res.headers.get('cache-control'), 'no-store')
    assert.equal(res.body.status, 'ok')
    assert.equal(res.body.service, 'competition-web-app-api')
    assert.equal(res.body.cities, 6)
    assert.equal(res.body.months, 201)
    assert.ok(!Number.isNaN(Date.parse(res.body.dataUpdated)))
  })

  test('GET /api/parameters lists one entry per series key with metadata', async () => {
    const res = await srv.get('/api/parameters')
    assert.equal(res.status, 200)
    const keys = res.body.parameters.map((p) => p.key)
    assert.deepEqual(keys, Object.keys(climate.cities.jaipur.series))
    for (const p of res.body.parameters) {
      assert.deepEqual(Object.keys(p).sort(), ['decimals', 'group', 'isSum', 'key', 'label', 'source', 'unit'])
    }
    const by = Object.fromEntries(res.body.parameters.map((p) => [p.key, p]))
    assert.deepEqual(by.ndvi, {
      key: 'ndvi', label: 'Vegetation greenness', unit: '', decimals: 2,
      group: 'Land and surface', source: 'MODIS MOD13Q1', isSum: false,
    })
    assert.equal(by.sun.unit, 'MJ/m²/day')
    assert.equal(by.rain.isSum, true)
    assert.equal(by.tmax.unit, '°C')
    assert.equal(by.tmin.source, 'NASA POWER')
  })

  test('GET /api/climate is identical to the client bundle', async () => {
    const res = await srv.get('/api/climate')
    assert.equal(res.status, 200)
    assert.deepEqual(res.body, original('src/data/climate.json', 'climate.json'))
  })
})

describe('cities', () => {
  test('GET /api/cities in data order', async () => {
    const res = await srv.get('/api/cities')
    assert.equal(res.status, 200)
    assert.deepEqual(res.body.cities.map((c) => c.id), CITY_IDS)
    assert.deepEqual(res.body.cities[0], { id: 'jaipur', name: 'Jaipur', state: 'Rajasthan', lat: 26.9124, lon: 75.7873 })
  })

  test('GET /api/cities/:id', async () => {
    const res = await srv.get('/api/cities/delhi')
    assert.equal(res.status, 200)
    assert.equal(res.body.name, 'Delhi')
    assert.equal(res.body.state, 'NCT of Delhi')
    assert.deepEqual(res.body.parameters, Object.keys(climate.cities.delhi.series))
    assert.deepEqual(res.body.months, { first: '2010-01', last: '2026-09', count: 201 })
  })

  test('unknown city is 404 on every per-city route', async () => {
    for (const p of ['', '/series', '/boundary', '/rasters', '/pixels']) {
      assertError(await srv.get(`/api/cities/atlantis${p}`), 404)
    }
    // Inherited object keys must not count as cities.
    assertError(await srv.get('/api/cities/__proto__'), 404)
    assertError(await srv.get('/api/cities/toString/series'), 404)
  })
})

describe('series', () => {
  test('defaults to every parameter and the full range', async () => {
    const res = await srv.get('/api/cities/jaipur/series')
    assert.equal(res.status, 200)
    assert.equal(res.body.city, 'jaipur')
    assert.equal(res.body.from, '2010-01')
    assert.equal(res.body.to, '2026-09')
    assert.deepEqual(res.body.months, climate.months)
    assert.deepEqual(res.body.series, climate.cities.jaipur.series)
  })

  test('params and from/to slice inclusively', async () => {
    const res = await srv.get('/api/cities/jaipur/series?params=ndvi,rain&from=2015-01&to=2020-12')
    assert.equal(res.status, 200)
    assert.equal(res.body.from, '2015-01')
    assert.equal(res.body.to, '2020-12')
    assert.equal(res.body.months.length, 72)
    assert.equal(res.body.months[0], '2015-01')
    assert.equal(res.body.months.at(-1), '2020-12')
    assert.deepEqual(Object.keys(res.body.series), ['ndvi', 'rain'])
    const i = climate.months.indexOf('2015-01')
    assert.deepEqual(res.body.series.ndvi, climate.cities.jaipur.series.ndvi.slice(i, i + 72))
    assert.deepEqual(res.body.series.rain, climate.cities.jaipur.series.rain.slice(i, i + 72))
  })

  test('only from, only to, single month', async () => {
    let res = await srv.get('/api/cities/udaipur/series?params=tair&from=2026-01')
    assert.equal(res.body.months.length, 9)
    assert.equal(res.body.to, '2026-09')
    res = await srv.get('/api/cities/udaipur/series?params=tair&to=2010-03')
    assert.deepEqual(res.body.months, ['2010-01', '2010-02', '2010-03'])
    res = await srv.get('/api/cities/udaipur/series?params=tair&from=2012-06&to=2012-06')
    assert.deepEqual(res.body.months, ['2012-06'])
    assert.deepEqual(res.body.series.tair, [climate.cities.udaipur.series.tair[climate.months.indexOf('2012-06')]])
  })

  test('a range outside the data is clipped (possibly to nothing)', async () => {
    let res = await srv.get('/api/cities/jaipur/series?params=ndvi&from=2000-01&to=2010-02')
    assert.equal(res.status, 200)
    assert.deepEqual(res.body.months, ['2010-01', '2010-02'])
    res = await srv.get('/api/cities/jaipur/series?params=ndvi&from=2030-01')
    assert.equal(res.status, 200)
    assert.deepEqual(res.body.months, [])
    assert.deepEqual(res.body.series.ndvi, [])
  })

  test('null values (missing months) stay null', async () => {
    // Find a city/param with a null somewhere and request just that month.
    let hit
    for (const id of CITY_IDS) {
      for (const [k, arr] of Object.entries(climate.cities[id].series)) {
        const i = arr.indexOf(null)
        if (i !== -1) { hit = { id, k, m: climate.months[i] }; break }
      }
      if (hit) break
    }
    assert.ok(hit, 'test data should contain at least one null')
    const res = await srv.get(`/api/cities/${hit.id}/series?params=${hit.k}&from=${hit.m}&to=${hit.m}`)
    assert.deepEqual(res.body.series[hit.k], [null])
  })

  test('duplicate and spaced params are tidied', async () => {
    const res = await srv.get('/api/cities/jaipur/series?params=ndvi,%20ndvi,rain&from=2020-01&to=2020-01')
    assert.deepEqual(Object.keys(res.body.series), ['ndvi', 'rain'])
  })

  test('bad input is 400', async () => {
    const bad = [
      'params=ndvi,bogus',
      'params=',
      'params=,',
      'from=2020-13',
      'from=2020-1',
      'to=20-01',
      'to=2020-01-01',
      'from=abcd-ef',
      'from=2021-01&to=2020-12',
      'from=2020-01&from=2020-02',
    ]
    for (const q of bad) {
      const res = await srv.get(`/api/cities/jaipur/series?${q}`)
      assertError(res, 400)
    }
  })
})

describe('map data', () => {
  test('GET /api/cities/:id/boundary', async () => {
    const res = await srv.get('/api/cities/jaipur/boundary')
    assert.equal(res.status, 200)
    assert.deepEqual(res.body, require(path.join(DATA, 'boundaries.json')).jaipur)
    assert.ok(['Polygon', 'MultiPolygon'].includes(res.body.type))
  })

  test('GET /api/boundaries', async () => {
    const res = await srv.get('/api/boundaries')
    assert.deepEqual(res.body, original('src/data/boundaries.json', 'boundaries.json'))
  })

  test('GET /api/map/mosaics equals mapmeta.json', async () => {
    const res = await srv.get('/api/map/mosaics')
    assert.equal(res.status, 200)
    assert.deepEqual(res.body, original('src/data/mapmeta.json', 'mapmeta.json'))
  })

  test('raster metadata swaps "values" for an API "pixels" link', async () => {
    const src = original('src/data/rasters.json', 'rasters.json')
    const all = await srv.get('/api/map/rasters')
    assert.equal(all.status, 200)
    assert.deepEqual(Object.keys(all.body), Object.keys(src))
    for (const id of Object.keys(src)) {
      const { values, ...rest } = src[id]
      assert.ok(values)
      assert.deepEqual(all.body[id], { ...rest, pixels: `/api/cities/${id}/pixels` })
      const one = await srv.get(`/api/cities/${id}/rasters`)
      assert.deepEqual(one.body, all.body[id])
    }
    assert.equal(all.body.jaipur.years['2010'], '/map/raster/jaipur/ndvi-2010.png')
  })

  test('every raster "pixels" link resolves to the city values', async () => {
    const all = await srv.get('/api/map/rasters')
    for (const [id, r] of Object.entries(all.body)) {
      const res = await srv.get(r.pixels)
      assert.equal(res.status, 200)
      assert.deepEqual(res.body, original(`public/map/raster/${id}/values.json`, `pixels/${id}.json`))
      assert.equal(res.body.changeVals.length, 41)
      assert.equal(res.body.changeVals[0].length, 41)
      assert.equal(res.body.lstDayVals.length, 11)
      assert.equal(res.body.yearVals['2010'].length, 41)
    }
  })
})

describe('http behaviour', () => {
  test('data endpoints are cacheable for five minutes', async () => {
    for (const p of ['/api/parameters', '/api/cities', '/api/cities/jaipur', '/api/cities/jaipur/series',
      '/api/cities/jaipur/boundary', '/api/cities/jaipur/rasters', '/api/cities/jaipur/pixels',
      '/api/climate', '/api/boundaries', '/api/map/mosaics', '/api/map/rasters']) {
      const res = await srv.get(p)
      assert.equal(res.status, 200, p)
      assert.equal(res.headers.get('cache-control'), 'public, max-age=300', p)
      assert.match(res.headers.get('content-type'), /application\/json/, p)
    }
  })

  test('CORS allows any origin by default', async () => {
    const res = await srv.get('/api/cities', { headers: { Origin: 'https://example.com' } })
    assert.equal(res.headers.get('access-control-allow-origin'), '*')
  })

  test('unknown routes are 404 JSON', async () => {
    assertError(await srv.get('/api/nope'), 404)
    assertError(await srv.get('/api/hello'), 404)
    assertError(await srv.get('/api/map'), 404)
    assertError(await srv.get('/'), 404)
  })

  test('non-GET methods are 404 JSON', async () => {
    const res = await srv.get('/api/cities', { method: 'POST', body: '{}', headers: { 'content-type': 'application/json' } })
    assertError(res, 404)
  })
})

describe('CORS_ORIGINS', () => {
  let restricted
  before(async () => {
    process.env.CORS_ORIGINS = 'http://localhost:5173, https://site.example'
    restricted = await startServer()
    delete process.env.CORS_ORIGINS
  })
  after(() => restricted.close())

  test('listed origins are echoed back, others get no CORS header', async () => {
    let res = await restricted.get('/api/health', { headers: { Origin: 'https://site.example' } })
    assert.equal(res.headers.get('access-control-allow-origin'), 'https://site.example')
    res = await restricted.get('/api/health', { headers: { Origin: 'https://evil.example' } })
    assert.equal(res.headers.get('access-control-allow-origin'), null)
  })
})
