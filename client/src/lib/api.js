// Client for the Express API (v1, see server/docs/API.md) and the converters
// from its resource shapes to the app's internal data shapes.
//
// Why a separate module: the API is deliberately generic (areas, parameters,
// layers, time series) so it can grow to custom areas, more intervals, forecasts
// and hazards, while the components were written against a few small, city-based
// shapes (city list, series per city, boundary, raster set, basemap mosaics; see
// lib/store.js). Everything that knows the API's URLs or JSON envelopes lives
// here, so a change to the API means a change to this file only, never to a
// component.
//
// RULE: this module must not import anything that reads the app data, because
// lib/store.js imports it before bootstrap() has run.
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

/* ---- requests ---- */

// Every request is a generic query of the v1 API, not an endpoint made for one
// section, so the same calls serve custom areas or other intervals later. The
// data store (lib/store.js) is the only caller: it adds caching, timeouts and
// the static fallback on top.

// The area list (no geometry, no layers): names, centres and what each area
// covers. `type=city`: the explorer is built around the fixed city list; other
// area types (custom areas of interest) must not show up in its city picker.
export const fetchAreas = (signal) => apiData('/areas', { query: { type: 'city' }, signal })

// Monthly series for some areas and parameters. `parameters` may be '*'.
export const fetchTimeseries = ({ areas, parameters, from, to }, signal) =>
  apiData('/timeseries', { query: { areas, parameters, interval: 'monthly', from, to }, signal })

// One area with extra parts (`include`: 'boundary', 'layers').
export const fetchArea = (areaId, include, signal) => apiData(`/areas/${encodeURIComponent(areaId)}`, { query: { include }, signal })

// Every basemap mosaic (region pair plus three zoom levels per city).
export const fetchBasemap = (signal) => apiData('/basemap', { signal })

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

// The area list -> city metadata, dropping (with a warning) any area the site
// cannot use: no id, name or centre, or no monthly coverage to place it on the
// time axis. Returns [{ id, name, state, lat, lon, from, to, parameters }] in
// the server's order. Only parameters the area reports in its coverage are
// listed, so a parameter added to the catalogue but not yet available for a
// city never shows up as an all-null series.
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/
export function toCities(areas) {
  if (!Array.isArray(areas)) return []
  return areas.flatMap((a) => {
    const c = a?.coverage
    const missing = [
      typeof a?.id !== 'string' && 'id',
      typeof a?.name !== 'string' && 'name',
      !(isObj(a?.center) && Number.isFinite(a.center.lat) && Number.isFinite(a.center.lon)) && 'center',
      !(MONTH.test(c?.from) && MONTH.test(c?.to) && c.from <= c.to) && 'monthly coverage',
    ].filter(Boolean)
    if (missing.length) {
      console.warn(`[data] skipping area ${a?.id ?? '(no id)'}: no valid ${missing.join(', ')}`)
      return []
    }
    return [{
      id: a.id,
      name: a.name,
      state: a.region?.state,
      lat: a.center.lat,
      lon: a.center.lon,
      from: c.from,
      to: c.to,
      parameters: Array.isArray(c.parameters) ? c.parameters.filter((k) => typeof k === 'string') : [],
    }]
  })
}

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
// lib/store.js fills the static mapmeta.json into the same shape.
// Returns null when the response is unusable: basemap.js needs the region pair
// (region[0], region[1]); a city with fewer than three mosaics is skipped there.
export function toMosaics(basemap) {
  if (!isObj(basemap) || !Array.isArray(basemap.mosaics)) return null
  const grouped = groupMosaics(basemap.mosaics.filter((m) => isObj(m) && typeof m.id === 'string' && typeof m.image === 'string'))
  if ((grouped.region || []).length < 2) return null
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
// values link (informational; the store's getPixelValues reads the links of
// all four layers from `valueLinks`, the second result).
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

// One area (with include=boundary,layers) -> the store's area detail:
// { boundary: GeoJSON geometry | null, raster: RAS entry | null,
//   layers: { layerId: { bounds, url, urlTemplate } }, pixelLinks: links | null }
// pixelLinks: the four /values links fetchPixelValues needs (null when the
// area's MODIS layers do not all expose values).
export function toAreaDetail(area) {
  if (!isObj(area) || typeof area.id !== 'string') return null
  const a = { ...area, layers: Array.isArray(area.layers) ? area.layers : [] }
  const { rasters, valueLinks } = toRasters([a])
  return {
    boundary: isObj(a.boundary) ? a.boundary : null,
    raster: rasters[a.id] || null,
    layers: toAreaLayers([a])[a.id],
    pixelLinks: valueLinks[a.id] || null,
  }
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
