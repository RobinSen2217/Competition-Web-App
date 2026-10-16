// Single entry point for the app's datasets.
// - Loaded once at startup by initData(): climate series, district boundaries,
//   mosaic metadata and raster metadata. They come from the Express API
//   (/api/climate, /api/boundaries, /api/map/mosaics, /api/map/rasters) when it
//   answers, otherwise from the copies bundled in src/data.
// - Fetched later on demand: the map imagery (static files in public/map, URLs in
//   MAPMETA and RAS) and the per-pixel values (loadPixelValues below).
//
// RULE: data modules must not be imported before initData() has finished.
// The exports below are live bindings (`export let`) that stay undefined until
// initData() assigns them, and several modules read them at import time (e.g.
// months.js builds YEARS from M). main.jsx therefore awaits initData() and only
// then dynamically imports App.jsx, which pulls in everything else. This file
// itself must only import modules that do not read the data (asset.js).
import { asset } from './asset'

// '' = same origin (/api, proxied to the Express server by Vite in dev).
// In production set VITE_API_URL to the hosted API, e.g. https://api.example.com.
// A trailing slash is dropped so `${API_BASE}/api/...` never has '//'.
export const API_BASE = (import.meta.env.VITE_API_URL || '').replace(/\/+$/, '')

// Whether to try the API at all. In dev the Vite proxy serves /api, so always
// try. In a production build only when VITE_API_URL is set: until the API is
// hosted, the live site skips four requests that would just 404.
const USE_API = import.meta.env.DEV || !!API_BASE

// How long startup waits for the API before using the bundled data instead.
const API_TIMEOUT_MS = 4000

export let DATA // { months: ["2010-01", ...], cities: { id: { name, state, lat, lon, series: { key: [..] } } } }
export let BOUND // { cityId: GeoJSON geometry of the district }
export let MAPMETA // { region: [mosaic, mosaic], cityId: [z10, z13, z15 mosaics] }
export let RAS // { cityId: { ndviBounds, lstBounds, years: {year: url}, change, lstDay, lstNight, values: url } }
export let M // DATA.months
export let N // M.length
export let CITY_IDS // Object.keys(DATA.cities), in data order
export const DEFAULT_CITY = 'jaipur'
export let DATA_SOURCE // 'api' | 'bundled'

export const ser = (c, k) => DATA.cities[c].series[k]

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)

// Fetches one JSON endpoint; any non-2xx status counts as a failure.
async function getJson(path, signal) {
  const res = await fetch(API_BASE + path, { signal, headers: { Accept: 'application/json' } })
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`)
  return res.json()
}

// Shape check of the four API payloads. Cheap, but enough to catch an HTML page
// (e.g. a SPA rewrite answering /api/... with index.html), an empty object or a
// half-deployed server, any of which would otherwise crash the components.
function validApi({ climate, boundaries, mosaics, rasters }) {
  if (!isObj(climate) || !Array.isArray(climate.months) || !climate.months.length) return false
  if (!isObj(climate.cities) || !Object.keys(climate.cities).length) return false
  if (!isObj(boundaries) || !isObj(mosaics) || !Array.isArray(mosaics.region)) return false
  if (!isObj(rasters)) return false
  return Object.entries(climate.cities).every(
    ([id, c]) =>
      isObj(c?.series) &&
      boundaries[id] &&
      (!rasters[id] || (isObj(rasters[id].years) && typeof rasters[id].pixels === 'string')),
  )
}

// Loads all four datasets from the API in parallel. Resolves to null on any
// failure (network error, timeout, bad status, invalid shape).
async function fromApi() {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), API_TIMEOUT_MS)
  try {
    const [climate, boundaries, mosaics, rasters] = await Promise.all(
      ['/api/climate', '/api/boundaries', '/api/map/mosaics', '/api/map/rasters'].map((p) => getJson(p, ctrl.signal)),
    )
    const d = { climate, boundaries, mosaics, rasters }
    return validApi(d) ? d : null
  } catch {
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
  return { climate: climate.default, boundaries: boundaries.default, mosaics: mosaics.default, rasters: rasters.default }
}

// Raster JSON stores public paths ('/map/raster/...'); resolve the images against
// the deploy base. The pixel values come from the API (`pixels`, an /api path)
// or, for the bundled data, from a static values.json in public/ (`values`).
// Either way components see one `values` URL.
function resolveRasters(rasters, source) {
  return Object.fromEntries(
    Object.entries(rasters).map(([c, r]) => {
      const { pixels, ...rest } = r
      return [
        c,
        {
          ...rest,
          years: Object.fromEntries(Object.entries(r.years).map(([y, u]) => [y, asset(u)])),
          change: asset(r.change),
          lstDay: asset(r.lstDay),
          lstNight: asset(r.lstNight),
          values: source === 'api' ? API_BASE + pixels : asset(r.values),
        },
      ]
    }),
  )
}

// Loads the data (API first, bundled copy as fallback) and fills the exports.
// Never mixes sources: if any API request fails, all four datasets come from
// the bundle so the series, outlines and rasters always belong together.
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
    RAS = resolveRasters(d.rasters, source)
    M = DATA.months
    N = M.length
    CITY_IDS = Object.keys(DATA.cities)
    DATA_SOURCE = source
    console.info(`[data] using ${source === 'api' ? `API (${API_BASE || 'same origin'})` : 'bundled data'}`)
    return source
  })()
  return initPromise
}

// Per-pixel values for the map's pixel inspector (~120 KB per city), fetched on demand.
// Shape: { yearVals: {year: 41x41}, changeVals: 41x41, lstDayVals: 11x11, lstNightVals: 11x11 }
const pixelCache = new Map()
export function loadPixelValues(c) {
  const r = RAS[c]
  if (!r) return Promise.resolve(null)
  if (!pixelCache.has(c)) {
    const p = fetch(r.values)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.json()
      })
      .catch((e) => {
        // Drop the failed promise so the next click retries
        pixelCache.delete(c)
        throw e
      })
    pixelCache.set(c, p)
  }
  return pixelCache.get(c)
}
