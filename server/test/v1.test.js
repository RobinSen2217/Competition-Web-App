// End-to-end tests of every /api/v1 endpoint (node:test + global fetch against
// the real app on an ephemeral port): envelopes, filters, query conventions,
// includes and layer values. Error codes and HTTP behaviour: http.test.js.
// Proof that the data is unchanged: equivalence.test.js.

const { test, before, after, describe } = require('node:test')
const assert = require('node:assert/strict')
const { startServer, assertError, assertOk, readData } = require('./support/server')
const { PARAMETERS } = require('../src/catalog/parameters')
const pkg = require('../package.json')

const climate = readData('climate.json')
const rasters = readData('rasters.json')
const CITY_IDS = Object.keys(climate.cities)
const KEYS = Object.keys(climate.cities.jaipur.series)
const LAYER_IDS = ['ndvi-peak', 'ndvi-change', 'lst-day-summer', 'lst-night-summer']
const S2_IDS = ['s2-ndvi', 's2-ndwi', 's2-ndbi']

// Runs fn with catalog parameter `key` temporarily offered at `intervals`
// only. The catalog is read per request, so the running server sees it; the
// entry is restored even when fn throws.
async function withIntervals(key, intervals, fn) {
  const entry = PARAMETERS.find((p) => p.key === key)
  const had = Object.hasOwn(entry, 'intervals'), before = entry.intervals
  entry.intervals = intervals
  try {
    await fn()
  } finally {
    if (had) entry.intervals = before
    else delete entry.intervals
  }
}

let srv
before(async () => {
  srv = await startServer({ config: { corsOrigins: '*', dataProvider: 'files' } })
})
after(() => srv.close())

describe('health', () => {
  test('GET /api/v1/health', async () => {
    const res = await srv.get('/api/v1/health')
    const data = assertOk(res)
    assert.equal(res.headers.get('cache-control'), 'no-store')
    assert.equal(data.status, 'ok')
    assert.equal(data.service, 'competition-web-app-api')
    assert.equal(data.version, pkg.version)
    assert.equal(data.apiVersion, 'v1')
    assert.ok(!Number.isNaN(Date.parse(data.dataUpdated)))
  })
})

describe('parameters', () => {
  test('GET /api/v1/parameters lists every series key with metadata', async () => {
    const res = await srv.get('/api/v1/parameters')
    const data = assertOk(res)
    assert.deepEqual(data.map((p) => p.key), KEYS)
    assert.equal(res.body.meta.count, KEYS.length)
    for (const p of data) {
      for (const f of ['key', 'label', 'unit', 'decimals', 'group', 'source', 'aggregation', 'intervals']) assert.ok(f in p, `${p.key}.${f}`)
      assert.ok(['mean', 'sum', 'max'].includes(p.aggregation))
      assert.deepEqual(p.intervals, ['monthly'])
    }
    const by = Object.fromEntries(data.map((p) => [p.key, p]))
    assert.equal(by.ndvi.aggregation, 'max')
    assert.equal(by.rain.aggregation, 'sum')
    assert.equal(by.tair.aggregation, 'mean')
    assert.equal(by.sun.unit, 'MJ/m²/day')
    assert.equal(by.tmax.unit, '°C')
    assert.equal(by.tmin.source, 'NASA POWER')
  })

  test('GET /api/v1/parameters/:key', async () => {
    const data = assertOk(await srv.get('/api/v1/parameters/ndvi'))
    assert.equal(data.key, 'ndvi')
    assert.equal(data.label, 'Vegetation greenness')
    assert.equal(data.decimals, 2)
    assertError(await srv.get('/api/v1/parameters/bogus'), 404, 'not_found')
    assertError(await srv.get('/api/v1/parameters/__proto__'), 404, 'not_found')
  })
})

describe('areas', () => {
  test('GET /api/v1/areas lists every city in data order', async () => {
    const res = await srv.get('/api/v1/areas')
    const data = assertOk(res)
    assert.deepEqual(data.map((a) => a.id), CITY_IDS)
    assert.deepEqual(res.body.meta, { count: CITY_IDS.length })
    assert.deepEqual(data[0], {
      id: 'jaipur', type: 'city', name: 'Jaipur', region: { state: 'Rajasthan', country: 'IN' },
      center: { lat: 26.9124, lon: 75.7873 },
      coverage: { intervals: ['monthly'], from: '2010-01', to: '2026-09', parameters: KEYS },
    })
    for (const a of data) {
      assert.equal(a.boundary, undefined)
      assert.equal(a.layers, undefined)
    }
  })

  test('type filter', async () => {
    assert.equal(assertOk(await srv.get('/api/v1/areas?type=city')).length, 6)
    assert.equal(assertOk(await srv.get('/api/v1/areas?type=*')).length, 6)
    assert.deepEqual(assertOk(await srv.get('/api/v1/areas?type=custom')), [])
  })

  test('include=boundary,layers embeds both; "*" means both', async () => {
    for (const q of ['include=boundary,layers', 'include=boundary&include=layers', 'include=*']) {
      const data = assertOk(await srv.get(`/api/v1/areas?${q}`))
      for (const a of data) {
        assert.deepEqual(a.boundary, readData('boundaries.json')[a.id], q)
        assert.ok(Array.isArray(a.layers))
      }
    }
    const one = assertOk(await srv.get('/api/v1/areas/jaisalmer?include=layers'))
    assert.equal(one.boundary, undefined)
    assert.deepEqual(one.layers.map((l) => l.id), [...LAYER_IDS, ...S2_IDS])
  })

  test('unknown include is 400 invalid_query', async () => {
    assertError(await srv.get('/api/v1/areas?include=boundary,nope'), 400, 'invalid_query')
    assertError(await srv.get('/api/v1/areas/jaipur?include=forecast'), 400, 'invalid_query')
  })

  test('GET /api/v1/areas/:areaId', async () => {
    const data = assertOk(await srv.get('/api/v1/areas/delhi'))
    assert.equal(data.name, 'Delhi')
    assert.equal(data.region.state, 'NCT of Delhi')
    assert.deepEqual(data.coverage.parameters, KEYS)
  })

  test('GET /api/v1/areas/:areaId/boundary is a GeoJSON Feature', async () => {
    const data = assertOk(await srv.get('/api/v1/areas/jaipur/boundary'))
    assert.equal(data.type, 'Feature')
    assert.deepEqual(data.properties, { areaId: 'jaipur', name: 'Jaipur', level: 'district' })
    assert.ok(['Polygon', 'MultiPolygon'].includes(data.geometry.type))
  })

  test('unknown area is 404 not_found on every per-area route', async () => {
    for (const p of ['', '/boundary', '/timeseries', '/layers', '/layers/ndvi-peak', '/layers/ndvi-peak/values']) {
      assertError(await srv.get(`/api/v1/areas/atlantis${p}`), 404, 'not_found')
    }
    // Inherited object keys must not count as areas.
    assertError(await srv.get('/api/v1/areas/__proto__'), 404, 'not_found')
    assertError(await srv.get('/api/v1/areas/toString/timeseries'), 404, 'not_found')
  })
})

describe('timeseries', () => {
  test('several areas and parameters, inclusive range', async () => {
    const res = await srv.get('/api/v1/timeseries?areas=jaipur,delhi&parameters=ndvi,rain&from=2015-01&to=2020-12&interval=monthly')
    const data = assertOk(res)
    assert.equal(data.interval, 'monthly')
    assert.equal(data.times.length, 72)
    assert.equal(data.times[0], '2015-01')
    assert.equal(data.times.at(-1), '2020-12')
    assert.deepEqual(Object.keys(data.areas), ['jaipur', 'delhi'])
    const i = climate.months.indexOf('2015-01')
    for (const id of ['jaipur', 'delhi']) {
      assert.deepEqual(Object.keys(data.areas[id]), ['ndvi', 'rain'])
      for (const k of ['ndvi', 'rain']) assert.deepEqual(data.areas[id][k], climate.cities[id].series[k].slice(i, i + 72))
    }
    assert.deepEqual(res.body.meta, {
      from: '2015-01', to: '2020-12', count: 72, parameters: ['ndvi', 'rain'], units: { ndvi: '', rain: 'mm' },
      requested: { from: '2015-01', to: '2020-12' },
    })
  })

  test('parameters default to all; areas=* means every area', async () => {
    const res = await srv.get('/api/v1/timeseries?areas=*&from=2020-01&to=2020-01')
    const data = assertOk(res)
    assert.deepEqual(Object.keys(data.areas), CITY_IDS)
    assert.deepEqual(Object.keys(data.areas.jaipur), KEYS)
    assert.deepEqual(res.body.meta.parameters, KEYS)
    assert.equal(res.body.meta.units.sun, 'MJ/m²/day')
    // "*" inside a list still means all.
    assert.deepEqual(Object.keys(assertOk(await srv.get('/api/v1/timeseries?areas=jaipur,*&parameters=rain,*')).areas), CITY_IDS)
  })

  test('repeated keys are merged, duplicates and spaces tidied', async () => {
    const data = assertOk(await srv.get('/api/v1/timeseries?areas=jaipur&areas=delhi,%20jaipur&parameters=ndvi&parameters=rain,ndvi&from=2020-01&to=2020-01'))
    assert.deepEqual(Object.keys(data.areas), ['jaipur', 'delhi'])
    assert.deepEqual(Object.keys(data.areas.jaipur), ['ndvi', 'rain'])
    // A single value repeated identically is fine.
    assert.deepEqual(assertOk(await srv.get('/api/v1/timeseries?areas=jaipur&parameters=rain&from=2020-01&from=2020-01&to=2020-01')).times, ['2020-01'])
  })

  test('only from, only to', async () => {
    let res = await srv.get('/api/v1/areas/udaipur/timeseries?parameters=tair&from=2026-01')
    assert.equal(assertOk(res).times.length, 9)
    assert.equal(res.body.meta.to, '2026-09')
    res = await srv.get('/api/v1/areas/udaipur/timeseries?parameters=tair&to=2010-03')
    assert.deepEqual(assertOk(res).times, ['2010-01', '2010-02', '2010-03'])
    assert.deepEqual(res.body.meta.requested, { from: null, to: '2010-03' })
  })

  test('a range outside the data is clipped (possibly to nothing)', async () => {
    let res = await srv.get('/api/v1/timeseries?areas=jaipur&parameters=ndvi&from=2000-01&to=2010-02')
    assert.deepEqual(assertOk(res).times, ['2010-01', '2010-02'])
    assert.equal(res.body.meta.from, '2010-01')
    assert.equal(res.body.meta.count, 2)
    res = await srv.get('/api/v1/timeseries?areas=jaipur&parameters=ndvi&from=2030-01')
    const data = assertOk(res)
    assert.deepEqual(data.times, [])
    assert.deepEqual(data.areas.jaipur.ndvi, [])
    assert.equal(res.body.meta.count, 0)
    assert.equal(res.body.meta.from, null)
  })

  test('type filters areas=* like on /areas', async () => {
    let res = await srv.get('/api/v1/timeseries?areas=*&type=city&parameters=ndvi&from=2020-01&to=2020-01')
    assert.deepEqual(Object.keys(assertOk(res).areas), CITY_IDS)
    for (const q of ['type=custom', 'type=custom,other']) {
      res = await srv.get(`/api/v1/timeseries?areas=*&${q}&parameters=ndvi&from=2020-01&to=2020-01`)
      const data = assertOk(res)
      assert.deepEqual(data.areas, {}, q)
      assert.deepEqual(data.times, ['2020-01'], q)
    }
    assert.deepEqual(Object.keys(assertOk(await srv.get('/api/v1/timeseries?areas=*&type=*&parameters=ndvi&to=2010-01')).areas), CITY_IDS)
    // Areas named in the list are returned as asked, whatever their type.
    assert.deepEqual(Object.keys(assertOk(await srv.get('/api/v1/timeseries?areas=jaipur&type=custom&parameters=ndvi&to=2010-01')).areas), ['jaipur'])
    assertError(await srv.get('/api/v1/timeseries?areas=*&type='), 400, 'invalid_query')
  })

  test('a parameter not offered at the interval is 400 unsupported_interval', async () => {
    await withIntervals('rain', ['daily'], async () => {
      const res = await srv.get('/api/v1/timeseries?areas=jaipur&parameters=ndvi,rain&interval=monthly')
      assertError(res, 400, 'unsupported_interval')
      assert.deepEqual(res.body.error.details, { interval: 'monthly', parameter: 'rain', supported: ['daily'] })
      assertError(await srv.get('/api/v1/areas/jaipur/timeseries?parameters=rain'), 400, 'unsupported_interval')
      // "*" means every parameter offered at the interval, so rain is left out.
      const all = await srv.get('/api/v1/timeseries?areas=jaipur&from=2020-01&to=2020-01')
      assert.deepEqual(Object.keys(assertOk(all).areas.jaipur), KEYS.filter((k) => k !== 'rain'))
      assert.deepEqual(all.body.meta.parameters, KEYS.filter((k) => k !== 'rain'))
      // /parameters reports the narrowed intervals too.
      assert.deepEqual(assertOk(await srv.get('/api/v1/parameters/rain')).intervals, ['daily'])
    })
    assert.deepEqual(assertOk(await srv.get('/api/v1/parameters/rain')).intervals, ['monthly'])
  })

  test('yearly is a layer interval only, not a timeseries one', async () => {
    const res = await srv.get('/api/v1/timeseries?areas=jaipur&interval=yearly')
    assertError(res, 400, 'unsupported_interval')
    assert.deepEqual(res.body.error.details.supported, ['monthly'])
  })

  test('null values (missing months) stay null', async () => {
    let hit
    for (const id of CITY_IDS) {
      for (const [k, arr] of Object.entries(climate.cities[id].series)) {
        const i = arr.indexOf(null)
        if (i !== -1) { hit = { id, k, m: climate.months[i] }; break }
      }
      if (hit) break
    }
    assert.ok(hit, 'test data should contain at least one null')
    const data = assertOk(await srv.get(`/api/v1/areas/${hit.id}/timeseries?parameters=${hit.k}&from=${hit.m}&to=${hit.m}`))
    assert.deepEqual(data.series[hit.k], [null])
  })

  test('GET /api/v1/areas/:areaId/timeseries returns one series object', async () => {
    const res = await srv.get('/api/v1/areas/jaipur/timeseries?parameters=ndvi,rain&from=2026-07&to=2026-09&areas=delhi')
    const data = assertOk(res)
    assert.deepEqual(Object.keys(data), ['interval', 'times', 'series'])
    assert.deepEqual(data.times, ['2026-07', '2026-08', '2026-09'])
    assert.deepEqual(data.series.ndvi, climate.cities.jaipur.series.ndvi.slice(-3))
    assert.deepEqual(data.series.rain, climate.cities.jaipur.series.rain.slice(-3))
    assert.equal(res.body.meta.count, 3)
    // Without a query: everything.
    assert.deepEqual(assertOk(await srv.get('/api/v1/areas/bikaner/timeseries')).series, climate.cities.bikaner.series)
  })

  test('query errors', async () => {
    const cases = [
      ['/api/v1/timeseries?parameters=ndvi', 400, 'invalid_query'], // areas missing
      ['/api/v1/timeseries?areas=', 400, 'invalid_query'],
      ['/api/v1/timeseries?areas=,', 400, 'invalid_query'],
      ['/api/v1/timeseries?areas=jaipur&parameters=', 400, 'invalid_query'],
      ['/api/v1/timeseries?areas=jaipur,atlantis', 404, 'not_found'],
      ['/api/v1/timeseries?areas=jaipur&parameters=ndvi,bogus', 400, 'invalid_parameter'],
      ['/api/v1/timeseries?areas=jaipur&interval=daily', 400, 'unsupported_interval'],
      ['/api/v1/timeseries?areas=jaipur&interval=toString', 400, 'unsupported_interval'],
      ['/api/v1/areas/jaipur/timeseries?interval=16-day', 400, 'unsupported_interval'],
      ['/api/v1/areas/jaipur/timeseries?parameters=bogus', 400, 'invalid_parameter'],
      ['/api/v1/areas/jaipur/timeseries?from=2020-13', 400, 'invalid_query'],
      ['/api/v1/areas/jaipur/timeseries?from=2020-1', 400, 'invalid_query'],
      ['/api/v1/areas/jaipur/timeseries?to=20-01', 400, 'invalid_query'],
      ['/api/v1/areas/jaipur/timeseries?to=2020-01-01', 400, 'invalid_query'],
      ['/api/v1/areas/jaipur/timeseries?from=abcd-ef', 400, 'invalid_query'],
      ['/api/v1/areas/jaipur/timeseries?from=2021-01&to=2020-12', 400, 'invalid_query'],
      ['/api/v1/areas/jaipur/timeseries?from=2020-01&from=2020-02', 400, 'invalid_query'],
    ]
    for (const [url, status, code] of cases) assertError(await srv.get(url), status, code)
    const res = await srv.get('/api/v1/timeseries?areas=jaipur&interval=daily')
    assert.deepEqual(res.body.error.details.supported, ['monthly'])
    const bad = await srv.get('/api/v1/timeseries?areas=jaipur&parameters=bogus')
    assert.deepEqual(bad.body.error.details.unknown, ['bogus'])
  })
})

describe('layers', () => {
  test('GET /api/v1/areas/:areaId/layers for a plain city', async () => {
    const res = await srv.get('/api/v1/areas/jaipur/layers')
    const data = assertOk(res)
    assert.deepEqual(data.map((l) => l.id), LAYER_IDS)
    assert.equal(res.body.meta.count, 4)
    const [peak, change, day, night] = data
    assert.deepEqual(peak, {
      id: 'ndvi-peak', title: peak.title, parameter: 'ndvi', kind: 'raster', resolution: '250m', source: 'MODIS MOD13Q1',
      description: peak.description, bounds: rasters.jaipur.ndviBounds,
      interval: 'yearly', times: Object.keys(rasters.jaipur.years),
      image: { urlTemplate: '/map/raster/jaipur/ndvi-{time}.png' },
      values: { href: '/api/v1/areas/jaipur/layers/ndvi-peak/values', scale: 0.001, unit: '', width: 41, height: 41 },
    })
    assert.equal(peak.times[0], '2010')
    assert.equal(peak.times.at(-1), '2026')
    assert.equal(change.times, null)
    assert.equal(change.interval, null)
    assert.equal(day.interval, null)
    assert.deepEqual(change.image, { url: '/map/raster/jaipur/change.png' })
    assert.deepEqual(change.values, { href: '/api/v1/areas/jaipur/layers/ndvi-change/values', scale: 0.001, unit: '', width: 41, height: 41 })
    assert.equal(day.resolution, '1km')
    assert.deepEqual(day.bounds, rasters.jaipur.lstBounds)
    assert.deepEqual(day.image, { url: '/map/raster/jaipur/lst-day.png' })
    assert.deepEqual(day.values, { href: '/api/v1/areas/jaipur/layers/lst-day-summer/values', scale: 0.1, unit: '°C', width: 11, height: 11 })
    assert.deepEqual(night.image, { url: '/map/raster/jaipur/lst-night.png' })
    assert.equal(night.parameter, 'lst_night')
  })

  test('Jaisalmer also has the Sentinel-2 layers (image only)', async () => {
    const data = assertOk(await srv.get('/api/v1/areas/jaisalmer/layers'))
    assert.deepEqual(data.map((l) => l.id), [...LAYER_IDS, ...S2_IDS])
    for (const id of S2_IDS) {
      const l = data.find((x) => x.id === id)
      assert.equal(l.resolution, '10m')
      assert.equal(l.source, 'Sentinel-2')
      assert.equal(l.times, null)
      assert.equal(l.interval, null)
      assert.equal(l.values, null)
      assert.deepEqual(l.bounds, [[26.902729, 70.919915], [26.920817, 70.940063]])
      assert.deepEqual(l.image, { url: `/map/s2_${id.slice(3)}.jpg` })
    }
    assertError(await srv.get('/api/v1/areas/jaipur/layers/s2-ndvi'), 404, 'not_found')
  })

  test('GET /api/v1/areas/:areaId/layers/:layerId', async () => {
    const list = assertOk(await srv.get('/api/v1/areas/delhi/layers'))
    for (const l of list) assert.deepEqual(assertOk(await srv.get(`/api/v1/areas/delhi/layers/${l.id}`)), l)
    assertError(await srv.get('/api/v1/areas/delhi/layers/nope'), 404, 'not_found')
  })

  test('values of a timed layer for one time', async () => {
    const px = readData('pixels/jaipur.json')
    const data = assertOk(await srv.get('/api/v1/areas/jaipur/layers/ndvi-peak/values?time=2020'))
    assert.deepEqual(data, {
      layerId: 'ndvi-peak', areaId: 'jaipur', scale: 0.001, unit: '', width: 41, height: 41,
      bounds: rasters.jaipur.ndviBounds, time: '2020', values: px.yearVals['2020'],
    })
  })

  test('values of a timed layer without time: every time', async () => {
    const px = readData('pixels/udaipur.json')
    const data = assertOk(await srv.get('/api/v1/areas/udaipur/layers/ndvi-peak/values'))
    assert.deepEqual(data.times, Object.keys(px.yearVals))
    assert.deepEqual(data.values, px.yearVals)
    assert.equal(data.time, undefined)
  })

  test('values of a static layer', async () => {
    const px = readData('pixels/jodhpur.json')
    const data = assertOk(await srv.get('/api/v1/areas/jodhpur/layers/lst-day-summer/values'))
    assert.deepEqual(data, {
      layerId: 'lst-day-summer', areaId: 'jodhpur', scale: 0.1, unit: '°C', width: 11, height: 11,
      bounds: rasters.jodhpur.lstBounds, values: px.lstDayVals,
    })
  })

  test('every layer declares its interval; timed layers use a known format', async () => {
    for (const id of CITY_IDS) {
      for (const l of assertOk(await srv.get(`/api/v1/areas/${id}/layers`))) {
        assert.ok(Object.hasOwn(l, 'interval'), `${id}/${l.id}`)
        if (l.times === null) assert.equal(l.interval, null, `${id}/${l.id}`)
        else for (const t of l.times) assert.match(t, l.interval === 'yearly' ? /^\d{4}$/ : /./, `${id}/${l.id}`)
      }
    }
  })

  test('?time on /values is checked against the layer interval format', async () => {
    for (const t of ['2020-01', '20', 'abcd', '2020x']) {
      const res = await srv.get(`/api/v1/areas/jaipur/layers/ndvi-peak/values?time=${t}`)
      assertError(res, 400, 'invalid_query')
      assert.deepEqual(res.body.error.details, { parameter: 'time', format: 'YYYY', example: '2020' }, t)
    }
    // Well formed but not available: 404 with the available times.
    const res = await srv.get('/api/v1/areas/jaipur/layers/ndvi-peak/values?time=1999')
    assertError(res, 404, 'not_found')
    assert.deepEqual(res.body.error.details.times, Object.keys(rasters.jaipur.years))
  })

  test('values errors', async () => {
    assertError(await srv.get('/api/v1/areas/jaipur/layers/ndvi-peak/values?time=1999'), 404, 'not_found')
    assertError(await srv.get('/api/v1/areas/jaipur/layers/ndvi-peak/values?time=2020&time=2021'), 400, 'invalid_query')
    assertError(await srv.get('/api/v1/areas/jaipur/layers/ndvi-change/values?time=2020'), 400, 'invalid_query')
    assertError(await srv.get('/api/v1/areas/jaisalmer/layers/s2-ndvi/values'), 404, 'not_found')
    assertError(await srv.get('/api/v1/areas/jaipur/layers/nope/values'), 404, 'not_found')
  })

  test('every values.href resolves', async () => {
    for (const id of CITY_IDS) {
      for (const l of assertOk(await srv.get(`/api/v1/areas/${id}/layers`))) {
        if (!l.values) continue
        const data = assertOk(await srv.get(l.values.href))
        assert.equal(data.layerId, l.id)
      }
    }
  })
})

describe('basemap', () => {
  test('GET /api/v1/basemap', async () => {
    const res = await srv.get('/api/v1/basemap')
    const data = assertOk(res)
    assert.deepEqual(Object.keys(data), ['mosaics'])
    assert.deepEqual(data.mosaics[0], {
      id: 'region', areaId: 'region', zoom: 7, bounds: readData('mapmeta.json').region[0].bounds,
      image: '/map/region.jpg', labels: '/map/region_lab.png',
    })
    const z15 = data.mosaics.find((m) => m.id === 'jaipur_15')
    assert.equal(z15.areaId, 'jaipur')
    assert.equal(z15.labels, null)
    assert.equal(res.body.meta.count, data.mosaics.length)
  })
})
