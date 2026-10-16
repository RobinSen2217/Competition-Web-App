// Proves the v1 API serves exactly the data in server/data, nothing lost: the
// old shapes are rebuilt from v1 responses and compared to the files.

const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
const { startServer, assertOk, readData } = require('./support/server')

let srv
before(async () => {
  srv = await startServer()
})
after(() => srv.close())

test('climate.json can be rebuilt from /areas and /timeseries?areas=*&parameters=*', async () => {
  const climate = readData('climate.json')
  const areas = assertOk(await srv.get('/api/v1/areas'))
  const ts = assertOk(await srv.get('/api/v1/timeseries?areas=*&parameters=*'))
  const rebuilt = { months: ts.times, cities: {} }
  for (const a of areas) {
    // Keep each city's own key order from the file (the API lists catalog order).
    const series = {}
    for (const k of Object.keys(climate.cities[a.id].series)) series[k] = ts.areas[a.id][k]
    rebuilt.cities[a.id] = { name: a.name, state: a.region.state, lat: a.center.lat, lon: a.center.lon, series }
  }
  assert.deepEqual(rebuilt, climate)
  // And no parameter or area the API returned is missing from the file.
  for (const id of Object.keys(ts.areas)) assert.deepEqual(Object.keys(ts.areas[id]).sort(), Object.keys(climate.cities[id].series).sort())
})

test('boundaries equal boundaries.json (per area and via include)', async () => {
  const boundaries = readData('boundaries.json')
  const rebuilt = {}
  for (const a of assertOk(await srv.get('/api/v1/areas?include=boundary'))) rebuilt[a.id] = a.boundary
  assert.deepEqual(rebuilt, boundaries)
  for (const id of Object.keys(boundaries)) {
    assert.deepEqual(assertOk(await srv.get(`/api/v1/areas/${id}/boundary`)).geometry, boundaries[id])
  }
})

test('per-pixel grids equal data/pixels/<id>.json', async () => {
  const fields = { 'ndvi-peak': 'yearVals', 'ndvi-change': 'changeVals', 'lst-day-summer': 'lstDayVals', 'lst-night-summer': 'lstNightVals' }
  for (const id of Object.keys(readData('rasters.json'))) {
    const px = readData(`pixels/${id}.json`)
    const rebuilt = {}
    for (const [layerId, field] of Object.entries(fields)) {
      rebuilt[field] = assertOk(await srv.get(`/api/v1/areas/${id}/layers/${layerId}/values`)).values
    }
    assert.deepEqual(rebuilt, px, id)
    for (const year of Object.keys(px.yearVals)) {
      const one = assertOk(await srv.get(`/api/v1/areas/${id}/layers/ndvi-peak/values?time=${year}`))
      assert.deepEqual(one.values, px.yearVals[year], `${id} ${year}`)
    }
  }
})

test('layer metadata covers every image path and bound in rasters.json', async () => {
  const rasters = readData('rasters.json')
  for (const [id, r] of Object.entries(rasters)) {
    const layers = Object.fromEntries(assertOk(await srv.get(`/api/v1/areas/${id}/layers`)).map((l) => [l.id, l]))
    const peak = layers['ndvi-peak']
    const years = Object.fromEntries(peak.times.map((t) => [t, peak.image.urlTemplate.replace('{time}', t)]))
    const rebuilt = {
      ndviBounds: peak.bounds,
      lstBounds: layers['lst-day-summer'].bounds,
      years,
      change: layers['ndvi-change'].image.url,
      lstDay: layers['lst-day-summer'].image.url,
      lstNight: layers['lst-night-summer'].image.url,
    }
    assert.deepEqual(layers['ndvi-change'].bounds, r.ndviBounds)
    assert.deepEqual(layers['lst-night-summer'].bounds, r.lstBounds)
    // eslint-disable-next-line no-unused-vars
    const { values, ...rest } = r
    assert.deepEqual(rebuilt, rest, id)
  }
})

test('basemap covers every mapmeta.json entry', async () => {
  const mapmeta = readData('mapmeta.json')
  const { mosaics } = assertOk(await srv.get('/api/v1/basemap'))
  const rebuilt = {}
  for (const m of mosaics) {
    assert.equal(m.image, `/map/${m.id}.jpg`)
    assert.equal(m.labels, mapmeta[m.areaId].find((x) => x.id === m.id).labels ? `/map/${m.id}_lab.png` : null)
    ;(rebuilt[m.areaId] ||= []).push({ id: m.id, z: m.zoom, bounds: m.bounds, labels: m.labels !== null })
  }
  assert.deepEqual(rebuilt, mapmeta)
})
