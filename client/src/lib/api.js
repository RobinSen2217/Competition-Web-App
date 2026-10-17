// Client for the Express API (v1, see server/docs/API.md) and the converters
// from its resource shapes to the app's internal data shapes.
//
// Why a separate module: the API is deliberately generic (areas, parameters,
// layers, time series) so it can grow to custom areas, more intervals, forecasts
// and hazards, while the components were written against a few small, city-based
// shapes (DATA, BOUND, MAPMETA, RAS in lib/data.js). Everything that knows the
// API's URLs or JSON envelopes lives here, so a change to the API means a change
// to this file only, never to a component.
//
// RULE (same as lib/data.js): this module must not import anything that reads
// the app data, because lib/data.js imports it before initData() has run.
import { asset } from './asset'

// '' = same origin (/api, proxied to the Express server by Vite in dev).
// In production set VITE_API_URL to the hosted API, e.g. https://api.example.com.
// A trailing slash is dropped so `${API_BASE}/api/...` never has '//'.
export const API_BASE = (import.meta.env.VITE_API_URL || '').replace(/\/+$/, '')

// Version prefix of every request. Bumping it (v2) is a one-line change here plus
// the converters below for whatever shapes changed.
export const API_ROOT = `${API_BASE}/api/v1`

// Error thrown for any failed request. Carries the API's error envelope fields
// ({ error: { status, code, message, details } }) when the server sent one, so
// callers can branch on `code` (e.g. 'not_found') instead of parsing messages.
export class ApiError extends Error {
  constructor(message, { status = 0, code = 'network_error', details } = {}) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.details = details
  }
}

// Builds a query string following the API's conventions: arrays become
// comma-separated lists, null/undefined values are left out.
function queryString(query) {
  if (!query) return ''
  const parts = Object.entries(query)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => `${encodeURIComponent(k)}=${(Array.isArray(v) ? v : [v]).map((x) => encodeURIComponent(x)).join(',')}`)
  // Each item is encoded on its own so the list separators stay plain commas;
  // '*' ("all") passes through encodeURIComponent unchanged.
  return parts.length ? `?${parts.join('&')}` : ''
}

// GET one API resource and return the whole success envelope ({ data, meta }).
// `path` is either relative to API_ROOT ('/areas') or a full API path taken
// from a link inside a response ('/api/v1/areas/x/layers/y/values'), so links
// the server hands out can be followed without rebuilding them here.
export async function apiGet(path, { query, signal } = {}) {
  const url = (path.startsWith('/api/') ? API_BASE + path : API_ROOT + path) + queryString(query)
  let res
  try {
    res = await fetch(url, { signal, headers: { Accept: 'application/json' } })
  } catch (e) {
    throw new ApiError(`${path}: ${e.message}`, { code: e.name === 'AbortError' ? 'aborted' : 'network_error' })
  }
  // A non-JSON body (e.g. a SPA rewrite answering /api/... with index.html)
  // counts as a failure just like a bad status.
  const body = await res.json().catch(() => null)
  if (!res.ok) {
    const err = body?.error || {}
    throw new ApiError(`${path}: ${err.message || `HTTP ${res.status}`}`, { status: res.status, code: err.code || 'http_error', details: err.details })
  }
  if (!body || typeof body !== 'object' || !('data' in body)) throw new ApiError(`${path}: not an API response`, { status: res.status, code: 'bad_response' })
  return body
}

// GET and return only the payload (`data`) of the envelope.
export const apiData = async (path, opts) => (await apiGet(path, opts)).data

/* ---- startup requests ---- */

// The three requests the site needs before it can render. Each is a generic
// query ("everything, monthly"), not an endpoint made for this page, so the
// same endpoints serve custom areas or other intervals later.
// `type=city` on both: the explorer is built around the fixed city list; other
// area types (custom areas of interest) must not show up in its city picker,
// nor add their series to the startup download.
export function fetchStartup(signal) {
  return Promise.all([
    apiData('/timeseries', { query: { areas: '*', type: 'city', parameters: '*', interval: 'monthly' }, signal }),
    apiData('/areas', { query: { type: 'city', include: ['boundary', 'layers'] }, signal }),
    apiData('/basemap', { signal }),
  ]).then(([timeseries, areas, basemap]) => ({ timeseries, areas, basemap }))
}

/* ---- v1 -> internal converters ---- */

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)

// Which API layer fills which slot of the internal RAS entry. The map explorer's
// four MODIS layers are presentation ids (green, change, heatday, heatnight in
// lib/map/layers.js); this table is the only place tying them to API layer ids.
export const RASTER_LAYERS = {
  years: 'ndvi-peak',
  change: 'ndvi-change',
  lstDay: 'lst-day-summer',
  lstNight: 'lst-night-summer',
}

// Shape check of the startup payloads. Cheap, but enough to catch an empty or
// half-deployed server, which would otherwise crash the components later.
// Returns the payload to use, or null when the API cannot be used at all.
//
// Only global problems reject the response: no time axis, no region mosaics
// (lib/map/basemap.js reads region[0] and region[1]) or no usable city. A
// single city lacking its series, boundary, center or three basemap mosaics
// (basemap.js reads MAPMETA[city][0..2]) is dropped with a warning, so one
// incomplete area on the server does not hide every other one.
export function validStartup({ timeseries, areas, basemap }) {
  if (!isObj(timeseries) || !Array.isArray(timeseries.times) || !timeseries.times.length || !isObj(timeseries.areas)) return null
  if (!Array.isArray(areas) || !isObj(basemap) || !Array.isArray(basemap.mosaics)) return null
  const byArea = groupMosaics(basemap.mosaics.filter((m) => isObj(m) && typeof m.id === 'string' && typeof m.image === 'string'))
  if ((byArea.region || []).length < 2) return null
  const usable = areas.filter((a) => {
    const missing = [
      !isObj(timeseries.areas[a?.id]) && 'series',
      !isObj(a?.boundary) && 'boundary',
      !isObj(a?.center) && 'center',
      (byArea[a?.id] || []).length < 3 && 'basemap mosaics',
      a?.layers !== undefined && !Array.isArray(a?.layers) && 'layers',
    ].filter(Boolean)
    if (typeof a?.id !== 'string') missing.unshift('id')
    if (missing.length) console.warn(`[data] skipping area ${a?.id ?? '(no id)'}: no valid ${missing.join(', ')}`)
    return !missing.length
  })
  if (!usable.length) return null
  return { timeseries, areas: usable, basemap }
}

// timeseries + areas -> DATA = { months, cities: { id: { name, state, lat, lon, series } } }.
// Cities keep the order of the /areas list. Only parameters the area reports
// in its coverage are kept, so a parameter added to the catalogue but not yet
// available for a city does not appear as an all-null series.
export function toClimate(timeseries, areas) {
  const cities = {}
  for (const a of areas) {
    const all = timeseries.areas[a.id] || {}
    const keys = Array.isArray(a.coverage?.parameters) ? a.coverage.parameters.filter((k) => k in all) : Object.keys(all)
    cities[a.id] = {
      name: a.name,
      state: a.region?.state,
      lat: a.center.lat,
      lon: a.center.lon,
      series: Object.fromEntries(keys.map((k) => [k, all[k]])),
    }
  }
  return { months: timeseries.times, cities }
}

// areas (with include=boundary) -> BOUND = { id: GeoJSON geometry }.
export const toBoundaries = (areas) => Object.fromEntries(areas.map((a) => [a.id, a.boundary]))

// Mosaic list -> { areaId: [mosaic, ...] }, keeping the server's order (coarse
// to fine), which the basemap relies on.
function groupMosaics(mosaics) {
  const out = {}
  for (const m of mosaics) (out[m.areaId] ??= []).push(m)
  return out
}

// basemap -> MAPMETA = { region: [m, m], <cityId>: [m, m, m] } with the fields
// lib/map/basemap.js reads: id, z (native zoom), bounds, image (public path of
// the photo) and labels (public path of the place-name overlay, or null). The
// paths stay unresolved here; basemap.js passes them through asset().
// lib/data.js fills the bundled mapmeta.json into the same shape.
export function toMosaics(basemap) {
  const grouped = groupMosaics(basemap.mosaics)
  return Object.fromEntries(
    Object.entries(grouped).map(([areaId, list]) => [
      areaId,
      list.map((m) => ({ id: m.id, z: m.zoom, bounds: m.bounds, image: m.image, labels: m.labels || null })),
    ]),
  )
}

// Image URL of a layer at one time (timed layers) or its single image (static).
const layerImage = (layer, time) => asset(time === undefined ? layer.image.url : layer.image.urlTemplate.replaceAll('{time}', time))

// areas (with include=layers) -> RAS = { id: { ndviBounds, lstBounds, years: {year: url},
// change, lstDay, lstNight, values } } with image URLs resolved against the
// deploy base. A city gets an entry only when it has all four MODIS layers, as
// before when a city was missing from rasters.json. `values` is the ndvi-peak
// values link (informational; loadPixelValues reads the links of all four
// layers from `valueLinks`, the second result).
export function toRasters(areas) {
  const rasters = {}, valueLinks = {}
  for (const a of areas) {
    const byId = Object.fromEntries((a.layers || []).map((l) => [l.id, l]))
    const L = Object.fromEntries(Object.entries(RASTER_LAYERS).map(([slot, id]) => [slot, byId[id]]))
    if (!Object.values(L).every(Boolean) || !Array.isArray(L.years.times)) continue
    rasters[a.id] = {
      ndviBounds: L.years.bounds,
      lstBounds: L.lstDay.bounds,
      years: Object.fromEntries(L.years.times.map((t) => [t, layerImage(L.years, t)])),
      change: layerImage(L.change),
      lstDay: layerImage(L.lstDay),
      lstNight: layerImage(L.lstNight),
      values: L.years.values?.href ? API_BASE + L.years.values.href : null,
    }
    // Only cities whose four layers all expose values get the pixel inspector
    if (Object.values(L).every((l) => l.values?.href)) valueLinks[a.id] = Object.fromEntries(Object.entries(L).map(([slot, l]) => [slot, l.values.href]))
  }
  return { rasters, valueLinks }
}

// areas (with include=layers) -> { areaId: { layerId: { bounds, url, urlTemplate } } }
// for every layer of every area, image paths resolved against the deploy base
// (url for static layers, urlTemplate with '{time}' for timed ones). Lets the
// map draw layers the RAS shape has no slot for (e.g. the Sentinel-2 images,
// see lib/map/layers.js) from the server's bounds and paths.
export function toAreaLayers(areas) {
  return Object.fromEntries(
    areas.map((a) => [
      a.id,
      Object.fromEntries(
        (a.layers || []).map((l) => [
          l.id,
          {
            bounds: l.bounds,
            url: l.image?.url ? asset(l.image.url) : null,
            urlTemplate: l.image?.urlTemplate ? asset(l.image.urlTemplate) : null,
          },
        ]),
      ),
    ]),
  )
}

// Fetches the per-pixel values of the four MODIS layers in parallel and returns
// them in the internal shape used by the pixel inspector (lib/map/popups.js):
// { yearVals: {year: grid}, changeVals: grid, lstDayVals: grid, lstNightVals: grid }.
// The grids are the stored integers, unchanged (consumers apply the scale).
// The timed layer is requested without `time`, which returns every year at once.
export async function fetchPixelValues(links) {
  const [years, change, lstDay, lstNight] = await Promise.all(
    [links.years, links.change, links.lstDay, links.lstNight].map((href) => apiData(href)),
  )
  return { yearVals: years.values, changeVals: change.values, lstDayVals: lstDay.values, lstNightVals: lstNight.values }
}

/* ---- forecasts ---- */

// GET /areas/:id/forecasts: the server runs the forecasting module (server/ml)
// for one area and returns its response as `data` (shape documented in
// lib/forecasts.js). Returns the whole envelope, because `meta` says when the
// forecast was computed and, for a saved one, why (meta.generated,
// meta.fallback). The target goes in `parameters` like everywhere else in the
// API (one key); horizon, models (comma list) and interval as named.
export const fetchForecast = (areaId, { target, horizon, models, interval = 'monthly' }, signal) =>
  apiGet(`/areas/${encodeURIComponent(areaId)}/forecasts`, { query: { parameters: target, horizon, models, interval }, signal })
