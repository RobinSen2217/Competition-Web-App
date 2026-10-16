// Single entry point for the app's datasets.
// - Loaded once at startup by initData(): climate series, district boundaries,
//   mosaic metadata and raster metadata. They come from the Express API (v1:
//   /timeseries, /areas, /basemap; requests and conversions live in lib/api.js)
//   when it answers, otherwise from the copies bundled in src/data.
// - Fetched later on demand: the map imagery (static files in public/map, URLs in
//   MAPMETA and RAS) and the per-pixel values (loadPixelValues below).
//
// The exports keep the app's internal shapes (documented next to each one), not
// the API's: lib/api.js converts the API resources into them, so components
// never depend on the API format.
//
// RULE: data modules must not be imported before initData() has finished.
// The exports below are live bindings (`export let`) that stay undefined until
// initData() assigns them, and several modules read them at import time (e.g.
// months.js builds YEARS from M). main.jsx therefore awaits initData() and only
// then dynamically imports App.jsx, which pulls in everything else. This file
// itself must only import modules that do not read the data (asset.js, api.js).
import { asset } from './asset'
import { API_BASE, fetchStartup, fetchPixelValues, toAreaLayers, toBoundaries, toClimate, toMosaics, toRasters, validStartup } from './api'

export { API_BASE }

// Whether to try the API at all. In dev the Vite proxy serves /api, so always
// try. In a production build only when VITE_API_URL is set: until the API is
// hosted, the live site skips requests that would just 404.
const USE_API = import.meta.env.DEV || !!API_BASE

// How long startup waits for the API before using the bundled data instead.
const API_TIMEOUT_MS = 4000

export let DATA // { months: ["2010-01", ...], cities: { id: { name, state, lat, lon, series: { key: [..] } } } }
export let BOUND // { cityId: GeoJSON geometry of the district }
export let MAPMETA // { region: [mosaic, mosaic], cityId: [z10, z13, z15 mosaics] }, mosaic = { id, z, bounds, image, labels } (public paths; labels null = none)
export let RAS // { cityId: { ndviBounds, lstBounds, years: {year: url}, change, lstDay, lstNight, values: url } }
// API only ({} with bundled data): every layer the server lists per city,
// { cityId: { layerId: { bounds, url, urlTemplate } } }. lib/map/layers.js uses
// it for layers RAS has no slot for, with its own constants as fallback.
export let AREA_LAYERS
export let M // DATA.months
export let N // M.length
export let CITY_IDS // Object.keys(DATA.cities), in data order
export const DEFAULT_CITY = 'jaipur'
export let DATA_SOURCE // 'api' | 'bundled'

export const ser = (c, k) => DATA.cities[c].series[k]

// API only: { cityId: { years, change, lstDay, lstNight } } links to each
// layer's /values resource, used by loadPixelValues.
let valueLinks = {}

// Loads the startup data from the API in parallel and converts it to the
// internal shapes. Resolves to null on any failure (network error, timeout,
// bad status, invalid shape).
async function fromApi() {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), API_TIMEOUT_MS)
  try {
    const d = validStartup(await fetchStartup(ctrl.signal))
    if (!d) {
      console.warn('[data] API response unusable (no time axis, region mosaics or valid city)')
      return null
    }
    const { rasters, valueLinks: links } = toRasters(d.areas)
    return {
      climate: toClimate(d.timeseries, d.areas),
      boundaries: toBoundaries(d.areas),
      mosaics: toMosaics(d.basemap),
      rasters,
      valueLinks: links,
      areaLayers: toAreaLayers(d.areas),
    }
  } catch (e) {
    console.warn(`[data] API unavailable: ${e.message}`)
    return null
  } finally {
    clearTimeout(timer)
  }
}

// The bundled copies, loaded only when the API is not used. Dynamic imports keep
// them out of the main bundle; Vite emits them as separate chunks.
async function fromBundle() {
  const [climate, boundaries, mosaics, rasters] = await Promise.all([
    import('../data/climate.json'),
    import('../data/boundaries.json'),
    import('../data/mapmeta.json'),
    import('../data/rasters.json'),
  ])
  return {
    climate: climate.default,
    boundaries: boundaries.default,
    mosaics: resolveBundledMosaics(mosaics.default),
    rasters: resolveBundledRasters(rasters.default),
  }
}

// Bundled mapmeta.json stores only the mosaic id and a labels flag; fill in the
// image paths by the same naming rule the server's files provider uses
// (/map/<id>.jpg, /map/<id>_lab.png), so MAPMETA has the same shape and values
// as lib/api.js toMosaics() builds from /basemap.
function resolveBundledMosaics(mapmeta) {
  return Object.fromEntries(
    Object.entries(mapmeta).map(([areaId, list]) => [
      areaId,
      list.map((m) => ({ id: m.id, z: m.z, bounds: m.bounds, image: `/map/${m.id}.jpg`, labels: m.labels ? `/map/${m.id}_lab.png` : null })),
    ]),
  )
}

// Bundled raster JSON stores public paths ('/map/raster/...'); resolve them
// against the deploy base. (The API converter in lib/api.js already does this.)
function resolveBundledRasters(rasters) {
  return Object.fromEntries(
    Object.entries(rasters).map(([c, r]) => [
      c,
      {
        ...r,
        years: Object.fromEntries(Object.entries(r.years).map(([y, u]) => [y, asset(u)])),
        change: asset(r.change),
        lstDay: asset(r.lstDay),
        lstNight: asset(r.lstNight),
        values: asset(r.values),
      },
    ]),
  )
}

// Loads the data (API first, bundled copy as fallback) and fills the exports.
// Never mixes sources: if any API request fails, everything comes from the
// bundle so the series, outlines and rasters always belong together.
// Safe to call more than once; later calls return the first result.
let initPromise
export function initData() {
  initPromise ??= (async () => {
    const api = USE_API ? await fromApi() : null
    const source = api ? 'api' : 'bundled'
    const d = api || (await fromBundle())
    DATA = d.climate
    BOUND = d.boundaries
    MAPMETA = d.mosaics
    RAS = d.rasters
    AREA_LAYERS = d.areaLayers || {}
    valueLinks = d.valueLinks || {}
    M = DATA.months
    N = M.length
    CITY_IDS = Object.keys(DATA.cities)
    DATA_SOURCE = source
    console.info(`[data] using ${source === 'api' ? `API (${API_BASE || 'same origin'})` : 'bundled data'}`)
    return source
  })()
  return initPromise
}

// The bundled per-city values.json (already in the internal shape).
async function bundledPixelValues(url) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

// Per-pixel values for the map's pixel inspector (~120 KB per city), fetched on demand.
// Shape: { yearVals: {year: 41x41}, changeVals: 41x41, lstDayVals: 11x11, lstNightVals: 11x11 }
// API: four /values requests in parallel (lib/api.js); bundled: one values.json.
const pixelCache = new Map()
export function loadPixelValues(c) {
  const r = RAS[c]
  if (!r) return Promise.resolve(null)
  if (DATA_SOURCE === 'api' && !valueLinks[c]) return Promise.resolve(null)
  if (!pixelCache.has(c)) {
    const p = (DATA_SOURCE === 'api' ? fetchPixelValues(valueLinks[c]) : bundledPixelValues(r.values)).catch((e) => {
      // Drop the failed promise so the next click retries
      pixelCache.delete(c)
      throw e
    })
    pixelCache.set(c, p)
  }
  return pixelCache.get(c)
}
