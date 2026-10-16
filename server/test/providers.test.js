// The provider contract (src/providers/types.js): services hand providers
// resolved AreaRecords, not bare ids, and the files provider copes with an
// area it did not create (e.g. a future custom area from a separate store).

const { test, describe } = require('node:test')
const assert = require('node:assert/strict')
const { createFilesProvider } = require('../src/providers/files')
const { startServer, assertOk, readData } = require('./support/server')

const files = createFilesProvider()

// An area the files know nothing about, shaped like a custom area would be.
const custom = {
  id: 'my-field', type: 'custom', name: 'My field', region: { state: 'Rajasthan', country: 'IN' },
  center: { lat: 26.9, lon: 75.8 }, bbox: [[26.8, 75.7], [27, 75.9]],
  coverage: { intervals: ['monthly'], from: '2010-01', to: '2026-09', parameters: [] },
  boundary: { type: 'Polygon', coordinates: [[[75.7, 26.8], [75.9, 26.8], [75.9, 27], [75.7, 27], [75.7, 26.8]]] },
}

describe('files provider', () => {
  test('methods take area records', async () => {
    const jaipur = await files.getArea('jaipur')
    assert.deepEqual(await files.getBoundary(jaipur), readData('boundaries.json').jaipur)
    assert.deepEqual((await files.listLayers(jaipur)).map((l) => l.id), ['ndvi-peak', 'ndvi-change', 'lst-day-summer', 'lst-night-summer'])
    const ts = await files.getTimeseries({ areas: [jaipur], parameters: ['ndvi'], interval: 'monthly', from: '2020-01', to: '2020-02' })
    assert.equal(ts.areas.jaipur.ndvi.length, 2)
    assert.deepEqual(await files.getLayerValues(jaipur, 'ndvi-peak', '2020'), readData('pixels/jaipur.json').yearVals['2020'])
  })

  test('an unknown area gets empty results, and its own boundary back', async () => {
    assert.deepEqual(await files.getBoundary(custom), custom.boundary)
    assert.deepEqual(await files.getBoundary({ ...custom, boundary: undefined }), null)
    assert.deepEqual(await files.listLayers(custom), [])
    assert.equal(await files.getLayerValues(custom, 'ndvi-peak'), null)
    const ts = await files.getTimeseries({ areas: [custom], parameters: ['ndvi', 'rain'], interval: 'monthly', from: '2020-01', to: '2020-03' })
    assert.deepEqual(ts.areas, { 'my-field': { ndvi: [null, null, null], rain: [null, null, null] } })
  })

  test('layers.extra.json records come after the rasters.json ones', async () => {
    const layers = await files.listLayers(await files.getArea('jaisalmer'))
    assert.deepEqual(layers.map((l) => l.id), ['ndvi-peak', 'ndvi-change', 'lst-day-summer', 'lst-night-summer', 's2-ndvi', 's2-ndwi', 's2-ndbi'])
    const extra = readData('layers.extra.json').jaisalmer
    for (const rec of extra) {
      const l = layers.find((x) => x.id === rec.id)
      assert.deepEqual(l, { id: rec.id, bounds: rec.bounds, interval: null, times: null, image: rec.image, grid: null })
    }
  })
})

describe('services', () => {
  test('pass resolved area records to the provider', async () => {
    // Wraps the files provider and records what each area-taking method receives.
    const seen = []
    const spy = Object.create(files)
    for (const m of ['getBoundary', 'listLayers', 'getLayerValues', 'getTimeseries']) {
      spy[m] = async (...args) => {
        seen.push([m, args[0]])
        return files[m](...args)
      }
    }
    const srv = await startServer({ provider: spy })
    try {
      assertOk(await srv.get('/api/v1/areas/delhi/boundary'))
      assertOk(await srv.get('/api/v1/areas/delhi/layers'))
      assertOk(await srv.get('/api/v1/areas/delhi/layers/ndvi-change/values'))
      assertOk(await srv.get('/api/v1/timeseries?areas=delhi,jaipur&parameters=ndvi&to=2010-01'))
      assertOk(await srv.get('/api/v1/areas?include=*'))
    } finally {
      await srv.close()
    }
    const delhi = await files.getArea('delhi')
    for (const [m, arg] of seen) {
      if (m === 'getTimeseries') assert.deepEqual(arg.areas.map((a) => a.id), ['delhi', 'jaipur'])
      else assert.equal(typeof arg, 'object', m)
    }
    assert.deepEqual(seen.find(([m]) => m === 'getBoundary')[1], delhi)
    assert.ok(seen.some(([m]) => m === 'getLayerValues'))
    assert.ok(seen.filter(([m]) => m === 'listLayers').length >= 7) // one per area for include=*, plus /layers
  })
})
