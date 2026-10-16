// "files" data provider: serves the JSON files in server/data (copies of what
// the website used to bundle) through the generic provider contract in
// ./types.js. The files themselves are never changed; this module adapts their
// shapes to the generic model:
//
//   climate.json      { months, cities: { id: { name, state, lat, lon, series } } }
//                     -> areas (type "city") and monthly timeseries
//   boundaries.json   { id: GeoJSON geometry }        -> area boundaries
//   rasters.json      { id: { ndviBounds, lstBounds, years, change, lstDay, lstNight } }
//                     -> layers (with pixels/<id>.json for their value grids)
//   pixels/<id>.json  { yearVals: { year: grid }, changeVals, lstDayVals, lstNightVals }
//   layers.extra.json { id: [{ id, bounds, interval, times, image, values }] }
//                     -> extra layers of an area that are not in rasters.json (e.g.
//                     the Sentinel-2 images of Jaisalmer), already in LayerRecord
//                     shape except `values` (null, a grid, or { time: grid })
//   mapmeta.json      { region|id: [{ id, z, bounds, labels }] } -> basemap mosaics
//
// Areas reach the methods as AreaRecords (see ./types.js) and are looked up by
// their id here; an area these files do not know gets empty results.
//
// Everything is read once when the provider is created (about 2 MB), so
// requests never touch the disk. Methods are async only to match the contract.

const fs = require('node:fs')
const path = require('node:path')
const { timeWindow } = require('../catalog/intervals')

const DEFAULT_DATA_DIR = path.join(__dirname, '..', '..', 'data')

// How the per-city raster fields in rasters.json and pixels/<id>.json map onto
// catalog layer ids. A timed layer has `images` (time -> path) and the interval
// its times are written in; a static one has `image`.
const RASTER_LAYERS = [
  { id: 'ndvi-peak', bounds: 'ndviBounds', images: 'years', interval: 'yearly', grid: 'yearVals' },
  { id: 'ndvi-change', bounds: 'ndviBounds', image: 'change', grid: 'changeVals' },
  { id: 'lst-day-summer', bounds: 'lstBounds', image: 'lstDay', grid: 'lstDayVals' },
  { id: 'lst-night-summer', bounds: 'lstBounds', image: 'lstNight', grid: 'lstNightVals' },
]

const own = (obj, key) => obj != null && typeof key === 'string' && Object.hasOwn(obj, key)
const gridSize = (grid) => ({ width: grid[0].length, height: grid.length })

// Turns { "2010": "/x/ndvi-2010.png", ... } into "/x/ndvi-{time}.png". The API
// promises a template for timed layers, so a path that does not follow the
// pattern is a data error and is reported at startup rather than per request.
function urlTemplate(byTime, where) {
  const [first, url] = Object.entries(byTime)[0]
  const template = url.split(first).join('{time}')
  for (const [t, u] of Object.entries(byTime)) {
    if (template.split('{time}').join(t) !== u) throw new Error(`${where}: image paths do not share one pattern ("${u}")`)
  }
  return template
}

// Newest modification time among the data files: "when was the data last
// changed", good enough until a live pipeline records its own fetch time.
function newestMtime(dir) {
  let newest = 0
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name)
    if (entry.isDirectory()) newest = Math.max(newest, newestMtime(p))
    else if (entry.name.endsWith('.json')) newest = Math.max(newest, fs.statSync(p).mtimeMs)
  }
  return newest
}

/**
 * @param {{dataDir?: string, country?: string}} [options]
 * @returns {import('./types').DataProvider}
 */
function createFilesProvider({ dataDir = DEFAULT_DATA_DIR, country = 'IN' } = {}) {
  const readJson = (file) => JSON.parse(fs.readFileSync(path.join(dataDir, file), 'utf8'))
  const climate = readJson('climate.json')
  const boundaries = readJson('boundaries.json')
  const mapmeta = readJson('mapmeta.json')
  const rasters = readJson('rasters.json')
  const extraLayers = fs.existsSync(path.join(dataDir, 'layers.extra.json')) ? readJson('layers.extra.json') : {}
  const cities = climate.cities
  const times = climate.months // the monthly time axis shared by every city
  const areaIds = Object.keys(cities)

  const pixels = {}
  for (const id of areaIds) {
    const file = path.join('pixels', `${id}.json`)
    if (fs.existsSync(path.join(dataDir, file))) pixels[id] = readJson(file)
  }

  // Parameter keys in data order (first city's order, then any extras).
  const parameterKeys = []
  for (const id of areaIds) for (const k of Object.keys(cities[id].series)) if (!parameterKeys.includes(k)) parameterKeys.push(k)

  // Areas, built once. coverage.parameters lists keys with at least one value.
  const areas = areaIds.map((id) => {
    const c = cities[id]
    return {
      id,
      type: 'city',
      name: c.name,
      region: { state: c.state, country },
      center: { lat: c.lat, lon: c.lon },
      coverage: {
        intervals: ['monthly'],
        from: times[0] ?? null,
        to: times.at(-1) ?? null,
        parameters: Object.keys(c.series).filter((k) => c.series[k].some((v) => v !== null)),
      },
    }
  })
  const areaById = new Map(areas.map((a) => [a.id, a]))

  // Layer record from its parts; `stored` is null, the grid of a static layer
  // or { time: grid } of a timed one.
  const layerRecord = ({ id, bounds, interval, times, image }, stored) => {
    const sample = times ? stored && Object.values(stored)[0] : stored
    return {
      id, bounds, interval, times, image,
      grid: sample ? gridSize(sample) : null,
      _values: stored || null, // internal: not part of the record returned to callers
    }
  }

  // Layer records per area (rasters.json rows first, then layers.extra.json),
  // plus where each one's values live.
  const layers = {}
  for (const id of areaIds) {
    const r = rasters[id]
    const px = pixels[id] || {}
    const fromRasters = !r ? [] : RASTER_LAYERS.filter((m) => r[m.images || m.image]).map((m) => {
      const timed = Boolean(m.images)
      return layerRecord({
        id: m.id,
        bounds: r[m.bounds],
        interval: timed ? m.interval : null,
        times: timed ? Object.keys(r[m.images]).sort() : null,
        image: timed ? { urlTemplate: urlTemplate(r[m.images], `rasters.json ${id}.${m.images}`) } : { url: r[m.image] },
      }, px[m.grid])
    })
    const extra = (own(extraLayers, id) ? extraLayers[id] : []).map((l) => layerRecord(l, l.values))
    if (fromRasters.length || extra.length) layers[id] = [...fromRasters, ...extra]
  }
  const findLayer = (areaId, layerId) => (layers[areaId] || []).find((l) => l.id === layerId) || null
  // eslint-disable-next-line no-unused-vars
  const publicLayer = ({ _values, ...rest }) => rest

  const mosaics = []
  for (const [areaId, list] of Object.entries(mapmeta)) {
    for (const m of list) {
      mosaics.push({
        id: m.id, areaId, zoom: m.z, bounds: m.bounds,
        image: `/map/${m.id}.jpg`, labels: m.labels ? `/map/${m.id}_lab.png` : null,
      })
    }
  }

  const updated = new Date(newestMtime(dataDir)).toISOString()

  return {
    name: 'files',

    async listAreas() {
      return areas
    },

    async getArea(id) {
      return own(cities, id) ? areaById.get(id) : null
    },

    async getBoundary(area) {
      if (area.boundary) return area.boundary // e.g. a custom area carrying its own geometry
      return own(boundaries, area.id) ? boundaries[area.id] : null
    },

    async listParameterKeys() {
      return parameterKeys
    },

    async getTimeseries({ areas: requested, parameters, interval, from, to }) {
      // Only monthly exists in the files; the service checks coverage first.
      if (interval !== 'monthly') throw new Error(`files provider has no ${interval} data`)
      const [lo, hi] = timeWindow(times, from, to)
      const out = {}
      for (const { id } of requested) {
        const series = own(cities, id) ? cities[id].series : {}
        out[id] = {}
        for (const k of parameters) {
          // Missing months stay null; a parameter (or area) without data is all nulls.
          out[id][k] = own(series, k) ? series[k].slice(lo, hi) : new Array(hi - lo).fill(null)
        }
      }
      return { interval, times: times.slice(lo, hi), areas: out }
    },

    async listLayers(area) {
      return (own(layers, area.id) ? layers[area.id] : []).map(publicLayer)
    },

    async getLayerValues(area, layerId, time) {
      const layer = own(layers, area.id) ? findLayer(area.id, layerId) : null
      if (!layer || !layer._values) return null
      if (layer.times && time !== undefined) return own(layer._values, time) ? layer._values[time] : null
      return layer._values
    },

    async getBasemap() {
      return { mosaics }
    },

    async dataUpdated() {
      return updated
    },
  }
}

module.exports = { createFilesProvider, DEFAULT_DATA_DIR }
