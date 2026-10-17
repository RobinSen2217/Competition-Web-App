/*
  Hazard data (the Disaster module): hazard types, their parameters and
  events, each event's daily series and observations, and its per-day
  forecast with danger classes. API: GET /api/v1/hazards/... (server/docs/API.md,
  "Hazards").

  Everything here is generic: nothing names "flood", "rain" or "soil". The
  pages read labels, units, decimals, groups, models and thresholds from the
  responses, so a new hazard, event or parameter on the server shows up
  without a client change.

  Loading goes through the data store's cache (lib/store.js load/useResource):
  one request per resource for the page's lifetime, shared between sections,
  retried on "Try again". Each hook loads the WHOLE resource (every
  parameter, every model, the whole event) and sections pick what they draw,
  so switching a chart's parameter or model never fetches anything, and the
  static snapshot below can answer exactly like the API.

    const { data, status, error, retry } = useHazard('flood')
    const ts = useEventTimeseries('flood', eventId, { keepPrevious: true })

  Where the answers come from:
  - The API, when the site uses it (DATA_SOURCE 'api') and it has the hazard
    endpoints. Decided once per session by the first request (GET /hazards):
    the hosted API may run an older server without them (404), and then every
    hazard request goes to the snapshot instead of failing one by one.
  - Otherwise the static snapshot in public/data/hazards/ (see
    lib/hazardPaths.js for the file names), real API responses saved by
    `npm run hazards:snapshot` (scripts/snapshot-hazards.mjs). Also used for a
    single request that fails on the API (network, timeout), when the snapshot
    has that resource; if it does not, the API's error is the one shown.
*/
import { DATA_SOURCE, load, useResource } from './store'
import { API_BASE, ApiError, apiGet } from './api'
import { asset } from './asset'
import { snapshotFile, snapshotLayerImage } from './hazardPaths'

// The API is known to be awake here (the site booted on it), but a forecast
// or a long event's series can be a few hundred KB on a slow connection.
const REQUEST_TIMEOUT_MS = 15000

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)

/* ---- the two sources ---- */

async function fromApi(path) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS)
  try {
    return await apiGet(path, { signal: ctrl.signal })
  } catch (e) {
    if (ctrl.signal.aborted) throw new ApiError(`${path}: no answer within ${REQUEST_TIMEOUT_MS / 1000} s`, { code: 'timeout' })
    throw e
  } finally {
    clearTimeout(timer)
  }
}

async function fromSnapshot(path) {
  const file = snapshotFile(path)
  if (!file) throw new ApiError(`${path}: not in the saved copy`, { status: 404, code: 'not_found' })
  let res
  try {
    res = await fetch(asset(`/data/hazards/${file}`))
  } catch (e) {
    throw new ApiError(`${path}: ${e.message}`, { code: 'network_error' })
  }
  // A static host answers a missing file with index.html (status 200), so a
  // body that is not an API envelope counts as missing too.
  const body = res.ok ? await res.json().catch(() => null) : null
  if (!isObj(body) || !('data' in body)) throw new ApiError(`${path}: not in the saved copy`, { status: 404, code: 'not_found' })
  return body
}

// 'api' | 'snapshot', decided once (see the header). The probe's answer is
// kept, so the hazard list costs no second request.
let sourcePromise = null
let probeBody = null
function hazardSource() {
  sourcePromise ??= (async () => {
    if (DATA_SOURCE !== 'api') return 'snapshot'
    try {
      const body = await fromApi('/hazards')
      if (!Array.isArray(body.data)) throw new ApiError('/hazards: unexpected response', { code: 'bad_response' })
      probeBody = body
      return 'api'
    } catch (e) {
      console.warn(`[hazards] API has no hazard data (${e.message}); using the saved copy`)
      return 'snapshot'
    }
  })()
  return sourcePromise
}

// { body, from: 'api' | 'snapshot' } of one resource; `from` says which source
// actually answered (a single API failure can fall back to the saved copy),
// for answers that point at more files, like a layer's image.
async function hazardFetch(path) {
  if ((await hazardSource()) === 'snapshot') return { body: await fromSnapshot(path), from: 'snapshot' }
  if (path === '/hazards' && probeBody) return { body: probeBody, from: 'api' }
  try {
    return { body: await fromApi(path), from: 'api' }
  } catch (e) {
    // A real "no such thing" from the API is the answer; anything else
    // (network, timeout, server error) may still be in the saved copy.
    if (e.code === 'not_found' || e.code === 'invalid_query' || e.code === 'invalid_parameter') throw e
    try {
      const body = await fromSnapshot(path)
      console.warn(`[hazards] ${path}: API failed (${e.message}); using the saved copy`)
      return { body, from: 'snapshot' }
    } catch {
      throw e
    }
  }
}

/**
 * The envelope ({ data, meta }) of one hazard resource, from whichever source
 * is in use. Not cached itself; the getters below cache through load().
 * @param {string} path  relative to /api/v1, without a query
 */
export const hazardGet = async (path) => (await hazardFetch(path)).body

// Envelope -> payload, with a minimal shape check so a half-deployed server
// fails here with a clear message instead of deep inside a chart.
async function payload(path, check) {
  const { data } = await hazardGet(path)
  if (!check(data)) throw new ApiError(`${path}: unexpected response`, { code: 'bad_response' })
  return data
}

// An event's layers, each with `imageSrc`: the overlay image from the source
// that answered. The API's `url` is a path on the API (prefix its origin); the
// saved copy keeps that url, so its image is the saved file next to it.
async function eventLayers(h, e) {
  const path = `${eventPath(h, e)}/layers`
  const { body, from } = await hazardFetch(path)
  if (!Array.isArray(body.data)) throw new ApiError(`${path}: unexpected response`, { code: 'bad_response' })
  return body.data.map((layer) => {
    const file = from === 'snapshot' ? snapshotLayerImage(h, e, layer) : null
    const imageSrc = from === 'api' ? (typeof layer.url === 'string' ? API_BASE + layer.url : null) : file && asset(`/data/hazards/${file}`)
    return { ...layer, imageSrc }
  })
}

const seg = (id) => encodeURIComponent(id)
const hazardPath = (h) => `/hazards/${seg(h)}`
const eventPath = (h, e) => `${hazardPath(h)}/events/${seg(e)}`

/* ---- loaders (cached per resource for the page's lifetime) ---- */

const loaders = {
  hazards: () => payload('/hazards', Array.isArray),
  hazard: (h) => payload(hazardPath(h), (d) => isObj(d) && d.id === h),
  parameters: (h) => payload(`${hazardPath(h)}/parameters`, Array.isArray),
  events: (h) => payload(`${hazardPath(h)}/events`, Array.isArray),
  event: (h, e) => payload(eventPath(h, e), (d) => isObj(d) && d.id === e),
  timeseries: (h, e) => payload(`${eventPath(h, e)}/timeseries`, (d) => isObj(d) && Array.isArray(d.times) && isObj(d.series) && isObj(d.observations)),
  forecast: (h, e) => payload(`${eventPath(h, e)}/forecast`, (d) => isObj(d) && Array.isArray(d.times) && isObj(d.models)),
  layers: eventLayers,
}

const keyOf = (kind, ...ids) => `hz:${kind}:${ids.join('/')}`

/** Promise forms (for effects and event handlers, never during render). */
export const getHazards = () => load(keyOf('hazards'), loaders.hazards)
export const getHazard = (h) => load(keyOf('hazard', h), () => loaders.hazard(h))
export const getEventForecast = (h, e) => load(keyOf('forecast', h, e), () => loaders.forecast(h, e))

// Hook over one cached resource; any id null = idle (nothing to load yet).
function useHz(kind, ids, opts) {
  const key = ids.some((x) => x == null) ? null : keyOf(kind, ...ids)
  return useResource(key, () => loaders[kind](...ids), opts)
}

/**
 * Every hazard type: [{ id, label, description, interval, provides, coverage, dataUpdated }].
 * @returns {{ data, status, error, stale, retry }} as lib/store.js useResource
 */
export const useHazards = (opts) => useHz('hazards', [], opts)

/**
 * One hazard with `dataset` (description, tables, datasets with citations,
 * notes) and `forecast` (target, classes, models with thresholds and scores,
 * split, provenance), or forecast null when it has none.
 */
export const useHazard = (hazard, opts) => useHz('hazard', [hazard], opts)

/**
 * The hazard's parameters: [{ key, label, unit, decimals, group, kind:
 * 'series' | 'observation', valueType, derived, context, source, dataset, description }].
 */
export const useHazardParameters = (hazard, opts) => useHz('parameters', [hazard], opts)

/**
 * The hazard's events: [{ id, name, country: { code, name }, admin, place,
 * period: { reported, start, end, windowStart, windowEnd, ... }, bbox:
 * [w, s, e, n], center, cause, coverage, forecast: { available, role, ... } }].
 */
export const useHazardEvents = (hazard, opts) => useHz('events', [hazard], opts)

/** One event, plus notes, summary, attributes, sources, links. */
export const useHazardEvent = (hazard, eventId, opts) => useHz('event', [hazard, eventId], opts)

/**
 * The event's whole daily series and observations:
 * { times, series: { key: [...] }, observations: { key: { times, values, context: { col: [...] } } } }.
 */
export const useEventTimeseries = (hazard, eventId, opts) => useHz('timeseries', [hazard, eventId], opts)

/**
 * The event's whole forecast: { available, evaluation, times, actual,
 * observed, models: { id: { label, threshold, probability, class, summary,
 * fold, foldEvents, metrics } }, inputs, provenance, ... }.
 */
export const useEventForecast = (hazard, eventId, opts) => useHz('forecast', [hazard, eventId], opts)

/**
 * The event's map layers (overlay images), [] when it has none: [{ id, label,
 * kind, description, time, bounds: [[s, w], [n, e]], legend, stats, source:
 * { provenanceNote, ... }, notes, url, image, imageSrc }]. `imageSrc` is
 * added here: the image's address from whichever source answered.
 */
export const useEventLayers = (hazard, eventId, opts) => useHz('layers', [hazard, eventId], opts)
