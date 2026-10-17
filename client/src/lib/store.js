/*
  Data store: the one place that knows where the app's data comes from, loads
  each piece only when a section asks for it, and keeps it in memory.

  ============================================================================
  HOW A SECTION GETS ITS DATA
  ============================================================================

  main.jsx awaits bootstrap() below, which loads only the area list (one
  small request). After it, these are ready and synchronous:
    CITY_IDS  ['jaipur', ...] in the server's order
    CITIES    { id: { id, name, state, lat, lon, from, to, parameters: [keys] } }
    M, N      the monthly time axis ['2010-01', ...] and its length; every series
              the store returns has exactly N values aligned with M
              (lib/months.js and lib/chart.js read them)
    DATA_SOURCE 'api' | 'fallback' (see "Fallback" below: it can change once,
              from 'fallback' to 'api', when a slow API answers late)
  Everything else is fetched on demand through the hooks below.

    1. Ask for exactly what the section draws, for the selected city (useApp().city):
         const { data, status, error, retry } = useTimeseries({ areas: city, parameters: ['ndvi', 'rain'] })
         const s = data?.[city]                 // { ndvi: [...N], rain: [...N] }
       All cities at once (Hero shelf, Compare, the nav's city picker):
         useTimeseries({ areas: CITY_IDS, parameters: ['ndvi'] })   // or areas: '*'
       Every parameter of a city (Features): parameters: '*'.
       Map: useAreaDetail(city) -> { boundary, raster, layers }, useBasemap() -> mosaics.
       Pixel inspector: getPixelValues(city) (promise, on click).
       Forecasts: lib/forecasts.js loadForecast(city).
    2. Render the card's frame (Card, CardHead with title) at once, and the
       body by status:
         status === 'loading' -> <SectionLoader label="Loading rainfall…" className="h-[340px]" />
                                 (components/common/SectionLoader.jsx; give it the
                                 body's usual height so nothing jumps), and put
                                 aria-busy={status === 'loading'} on the Card
         status === 'error'   -> <SectionLoader error={error} onRetry={retry} className="h-[340px]" />
         status === 'ready'   -> the real content from `data`
       Pass { keepPrevious: true } to keep showing the previous request's data
       (with `stale: true`) while the next one loads, e.g. for the map or a
       chart that should not blink on every change.
    3. Derived numbers (climatology, trends) go in useMemo keyed on `data`:
       `data` keeps its identity until the request changes.
    4. In pages/VegetationPage.jsx wrap the section in a LazySection: it
       mounts the section ~800px before it scrolls into view.

  ============================================================================

  Rules:
  - bootstrap() must have resolved before anything reads CITY_IDS, CITIES, M,
    N or DATA_SOURCE (main.jsx imports App.jsx only after it). This module
    itself may be imported earlier: it reads them only inside functions.
  - The hooks start their request in an effect (StrictMode-safe: the second
    effect run finds the request already in flight). Never call get*() during
    render; call them from effects or event handlers.
  - Requests are de-duplicated and cached for the page's lifetime. A failed
    request is not cached: the next call (or retry()) tries again.
  - Fallback: when the API is not used (production build without
    VITE_API_URL) or does not answer the bootstrap within 4 s, every call is
    answered from the static copies in public/data/fallback/ (fetched only
    when needed, not part of the JS), converted to the same shapes. Sections cannot tell the
    difference except through DATA_SOURCE.
  - Late API (the "upgrade"): a hosted API that sleeps when idle (Render's
    free tier) takes ~10-50 s to answer its first request. Waiting that long
    on the boot loader would be worse than the static copy, so startup still
    gives up after 4 s, but the /areas request keeps running (up to 60 s).
    If it then succeeds and lists the same cities with every parameter and
    month the app booted with, DATA_SOURCE switches to 'api' and every load
    started from then on (sections not reached yet, the live forecast, map
    layers) uses the API; what was already loaded stays as it is. This mixes
    sources only where it is safe: the static files are a copy of the API's
    data in the same shapes, and the city list and time axis (CITY_IDS,
    CITIES, M, N) never change after bootstrap. If the lists differ, the
    session stays on the fallback. A failed (not slow) API is not retried.
*/
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { asset } from './asset'
import { API_BASE, ApiError, fetchArea, fetchAreas, fetchBasemap, fetchPixelValues, fetchTimeseries, toAreaDetail, toCities, toMosaics } from './api'

export { API_BASE }

// Whether to try the API at all. In dev the Vite proxy serves /api, so always
// try. In a production build only when VITE_API_URL is set: without it the
// live site skips requests that would just 404.
const USE_API = import.meta.env.DEV || !!API_BASE

// How long startup waits for the API before switching to the static files.
const BOOT_TIMEOUT_MS = 4000
// How long the same /areas request may keep running after that, for the
// late upgrade to the API (a sleeping Render instance takes up to ~50 s).
const UPGRADE_TIMEOUT_MS = 60000
// Later requests: the server is known to be up, but a response can be large
// (every series of every city) on a slow connection.
const REQUEST_TIMEOUT_MS = 20000

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)

/* ---- bootstrap: the city list and the time axis ---- */

export const DEFAULT_CITY = 'jaipur'
export let DATA_SOURCE // 'api' | 'fallback'
export let CITY_IDS // ['jaipur', ...] in the server's order
export let CITIES // { id: { id, name, state, lat, lon, from: 'YYYY-MM', to: 'YYYY-MM', parameters: [keys with data] } }
export let M // ['2010-01', ..., '2026-09']: monthly axis spanning every city's coverage
export let N // M.length
let monthIndex // Map 'YYYY-MM' -> index into M

// Every month from `from` to `to` inclusive ('YYYY-MM' strings).
function monthRange(from, to) {
  const out = []
  let y = +from.slice(0, 4), m = +from.slice(5)
  const endY = +to.slice(0, 4), endM = +to.slice(5)
  while (y < endY || (y === endY && m <= endM)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`)
    if (++m > 12) {
      m = 1
      y++
    }
  }
  return out
}

// Runs fn(signal), aborting after `ms`. A timeout surfaces as an ApiError with
// code 'timeout' so the message in an error card says what happened.
async function withTimeout(ms, what, fn) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), ms)
  try {
    return await fn(ctrl.signal)
  } catch (e) {
    if (ctrl.signal.aborted) throw new ApiError(`${what}: no answer within ${ms / 1000} s`, { code: 'timeout' })
    throw e
  } finally {
    clearTimeout(timer)
  }
}

// API bootstrap: the area list only. Rejects when the API cannot be used.
async function citiesFromApi() {
  const cities = toCities(await withTimeout(UPGRADE_TIMEOUT_MS, '/areas', (signal) => fetchAreas(signal)))
  if (!cities.length) throw new Error('API has no usable city')
  return cities
}

// Whether the API's city list can replace the fallback mid-session (see
// "Late API" above): same cities, each with every parameter it booted with,
// and a time span covering the whole axis M.
function sameCities(apiCities) {
  if (apiCities.length !== CITY_IDS.length) return false
  return apiCities.every((a) => {
    const c = CITIES[a.id]
    return c && c.parameters.every((k) => a.parameters.includes(k)) && a.from <= M[0] && a.to >= M[N - 1]
  })
}

const TIMED_OUT = Symbol('timed out')

// Fallback bootstrap: the city list and axis from the static climate.json
// (the same file then answers every timeseries request, see loadSeries).
async function citiesFromFallback() {
  const climate = await fallbackJson('climate')
  if (!Array.isArray(climate.months) || !climate.months.length || !isObj(climate.cities)) throw new Error('climate.json: no time axis or cities')
  const from = climate.months[0], to = climate.months[climate.months.length - 1]
  return Object.entries(climate.cities).map(([id, c]) => ({
    id,
    name: c.name,
    state: c.state,
    lat: c.lat,
    lon: c.lon,
    from,
    to,
    parameters: Object.keys(c.series || {}),
  }))
}

// Loads the city list (API first, static fallback otherwise) and fills the
// bootstrap exports. Resolves to DATA_SOURCE. Safe to call more than once.
let bootPromise
export function bootstrap() {
  bootPromise ??= (async () => {
    // The API gets BOOT_TIMEOUT_MS to answer; its request keeps running
    // after that for the late upgrade (see "Late API" above)
    const apiReq = USE_API ? citiesFromApi() : null
    let api = null, lateApi = null
    if (apiReq) {
      api = await Promise.race([apiReq, new Promise((r) => setTimeout(r, BOOT_TIMEOUT_MS, TIMED_OUT))]).catch((e) => {
        console.warn(`[data] API unavailable: ${e.message}`)
        return null
      })
      if (api === TIMED_OUT) {
        console.warn(`[data] API did not answer within ${BOOT_TIMEOUT_MS / 1000} s; starting from the static files and switching if it answers later`)
        lateApi = apiReq
        api = null
      }
    }
    const source = api ? 'api' : 'fallback'
    const cities = api || (await citiesFromFallback())
    if (!cities.length) throw new Error('no city to show')
    const from = cities.reduce((a, c) => (c.from < a ? c.from : a), cities[0].from)
    const to = cities.reduce((a, c) => (c.to > a ? c.to : a), cities[0].to)
    M = monthRange(from, to)
    N = M.length
    monthIndex = new Map(M.map((m, i) => [m, i]))
    CITY_IDS = cities.map((c) => c.id)
    CITIES = Object.fromEntries(cities.map((c) => [c.id, c]))
    DATA_SOURCE = source
    console.info(`[data] using ${source === 'api' ? `API (${API_BASE || 'same origin'})` : 'static fallback files'}`)
    // Only now, with CITY_IDS etc. filled in, may a late answer be compared
    // with them (it may already have arrived while the static file loaded)
    lateApi?.then(
      (late) => {
        if (!sameCities(late)) return console.warn('[data] the API answered late with a different city list; staying on the static files')
        DATA_SOURCE = 'api'
        console.info(`[data] API answered late; using it from now on (${API_BASE || 'same origin'})`)
      },
      (e) => console.warn(`[data] API unavailable: ${e.message}`),
    )
    return source
  })()
  return bootPromise
}

/* ---- static fallback files (public/data/fallback/<name>.json) ---- */

// One fetch per file for the page's lifetime; a failed one is forgotten so the
// next call retries.
const files = new Map()
function fallbackJson(name) {
  if (!files.has(name)) {
    const p = fetch(asset(`/data/fallback/${name}.json`)).then(async (res) => {
      if (!res.ok) throw new Error(`${name}.json: HTTP ${res.status}`)
      // Static hosts answer unknown paths with index.html: not JSON = missing
      const body = await res.json().catch(() => null)
      if (!isObj(body)) throw new Error(`${name}.json: not a data file`)
      return body
    })
    files.set(name, p)
    p.catch(() => files.get(name) === p && files.delete(name))
  }
  return files.get(name)
}

// mapmeta.json stores only the mosaic id and a labels flag; fill in the image
// paths by the same naming rule the server uses (/map/<id>.jpg,
// /map/<id>_lab.png), so the result equals lib/api.js toMosaics() of /basemap.
const resolveMosaics = (mapmeta) =>
  Object.fromEntries(
    Object.entries(mapmeta).map(([areaId, list]) => [
      areaId,
      list.map((m) => ({ id: m.id, z: m.z, bounds: m.bounds, image: `/map/${m.id}.jpg`, labels: m.labels ? `/map/${m.id}_lab.png` : null })),
    ]),
  )

// rasters.json stores public paths ('/map/raster/...'); resolve them against
// the deploy base, as lib/api.js does for the API's layers.
const resolveRaster = (r) =>
  r && {
    ...r,
    years: Object.fromEntries(Object.entries(r.years).map(([y, u]) => [y, asset(u)])),
    change: asset(r.change),
    lstDay: asset(r.lstDay),
    lstNight: asset(r.lstNight),
    values: asset(r.values),
  }

/* ---- generic resource cache + hook ---- */

// key -> { status: 'loading' | 'ready' | 'error', data, error, promise }.
// Entries are replaced (never mutated), so useSyncExternalStore sees a new
// snapshot exactly when something changed.
const entries = new Map()
const listeners = new Set()
const subscribe = (fn) => {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
const notify = () => listeners.forEach((fn) => fn())

// Snapshots for a key that has no entry yet (or no key).
const PENDING = Object.freeze({ status: 'loading', data: undefined, error: null })
const IDLE = Object.freeze({ status: 'idle', data: undefined, error: null })

/**
 * Loads `key` once with `loader` and caches the result for the page's lifetime.
 * Concurrent calls share one promise; a failed load is retried on the next call.
 * Do not call during render (it notifies subscribers synchronously).
 * @param {string} key  cache key; one key = one result
 * @param {() => Promise<any>} loader
 * @returns {Promise<any>} the loader's result
 */
export function load(key, loader) {
  const cur = entries.get(key)
  if (cur && cur.status !== 'error') return cur.promise
  // The loader runs on a microtask, after the entry exists, so a loader that
  // itself calls load() for the same key finds it in flight instead of recursing.
  const promise = Promise.resolve().then(loader)
  entries.set(key, { status: 'loading', data: undefined, error: null, promise })
  const settle = (next) => {
    // A newer attempt (retry) owns the key now; this result is stale
    if (entries.get(key)?.promise !== promise) return
    entries.set(key, { ...next, promise })
    notify()
  }
  promise.then(
    (data) => settle({ status: 'ready', data, error: null }),
    (error) => {
      console.warn(`[data] ${key}: ${error?.message || error}`)
      settle({ status: 'error', data: undefined, error })
    },
  )
  if (cur) notify() // an error entry went back to loading
  return promise
}

/**
 * Current cache entry of a key without loading it, or undefined.
 * @returns {{ status, data, error, promise } | undefined}
 */
export const peek = (key) => entries.get(key)

/**
 * React hook over load(): starts the load when mounted (or when `key`
 * changes) and re-renders when it settles.
 * @param {string | null} key  null = nothing to load (status 'idle')
 * @param {() => Promise<any>} loader  called at most once per key while cached
 * @param {{ keepPrevious?: boolean }} [opts]  keepPrevious: while a new key
 *   loads, keep returning the last ready data (with stale: true)
 * @returns {{ data: any, status: 'idle' | 'loading' | 'ready' | 'error',
 *   error: Error | null, stale: boolean, retry: () => void }}
 */
export function useResource(key, loader, { keepPrevious = false } = {}) {
  // The latest loader, so a new closure each render doesn't restart the load
  const loaderRef = useRef(loader)
  useEffect(() => {
    loaderRef.current = loader
  })
  const entry = useSyncExternalStore(subscribe, () => (key == null ? IDLE : entries.get(key) ?? PENDING))

  useEffect(() => {
    if (key != null) load(key, () => loaderRef.current())
  }, [key])

  const retry = useCallback(() => {
    if (key != null) load(key, () => loaderRef.current())
  }, [key])

  // Last ready data, kept for keepPrevious. Adjusted during render (React's
  // "storing information from previous renders" pattern), not in an effect,
  // so no frame shows the empty state in between.
  const [prev, setPrev] = useState(undefined)
  if (keepPrevious && entry.status === 'ready' && entry.data !== prev) setPrev(entry.data)
  const stale = keepPrevious && entry.status === 'loading' && prev !== undefined

  return useMemo(
    () => ({ data: stale ? prev : entry.data, status: entry.status, error: entry.error, stale, retry }),
    [entry, prev, stale, retry],
  )
}

/* ---- time series ---- */

// One promise per (area, parameter) pair, so sections asking for overlapping
// sets share what is already loaded or in flight: Glance asking for ndvi + rain
// after the shelf loaded ndvi of every city only fetches rain.
const seriesCache = new Map() // 'area|param' -> Promise<number[] | undefined>
const sk = (a, k) => `${a}|${k}`

// Array aligned with M (length N, null where the source has no value).
function align(times, values) {
  if (!Array.isArray(values)) return undefined
  if (times.length === N && times[0] === M[0] && times[N - 1] === M[N - 1]) return values
  const out = new Array(N).fill(null)
  times.forEach((t, i) => {
    const j = monthIndex.get(t)
    if (j !== undefined) out[j] = values[i] ?? null
  })
  return out
}

// One request for every pair in areas x keys -> { area: { key: [..N] } }.
async function loadSeries(areas, keys) {
  if (DATA_SOURCE === 'fallback') {
    const climate = await fallbackJson('climate')
    return Object.fromEntries(areas.map((a) => [a, Object.fromEntries(keys.map((k) => [k, align(climate.months, climate.cities[a]?.series?.[k])]))]))
  }
  const ts = await withTimeout(REQUEST_TIMEOUT_MS, '/timeseries', (signal) => fetchTimeseries({ areas, parameters: keys }, signal))
  if (!isObj(ts) || !Array.isArray(ts.times) || !isObj(ts.areas)) throw new ApiError('/timeseries: unexpected response', { code: 'bad_response' })
  return Object.fromEntries(areas.map((a) => [a, Object.fromEntries(keys.map((k) => [k, align(ts.times, ts.areas[a]?.[k])]))]))
}

// [[areaId, [keys]]] for a request. Unknown areas reject; parameters an area
// has no data for are left out (they would be all null).
function plan(areas, parameters) {
  const ids = areas === '*' ? CITY_IDS : [].concat(areas)
  return ids.map((a) => {
    const c = CITIES[a]
    if (!c) throw new ApiError(`unknown area: ${a}`, { code: 'not_found' })
    return [a, parameters === '*' ? c.parameters : [].concat(parameters).filter((k) => c.parameters.includes(k))]
  })
}

/**
 * Monthly series, aligned with M (length N, null = no value).
 * Pairs already loaded or in flight are reused; the rest come in ONE request
 * (the smallest areas x parameters rectangle covering them).
 * @param {{ areas: string | string[] | '*', parameters?: string[] | '*' }} q
 * @returns {Promise<{ [areaId]: { [param]: (number|null)[] } }>} parameters
 *   the area has no data for are absent
 */
export async function getTimeseries({ areas, parameters = '*' }) {
  const wanted = plan(areas, parameters)
  const missA = new Set(), missK = new Set()
  for (const [a, keys] of wanted)
    for (const k of keys)
      if (!seriesCache.has(sk(a, k))) {
        missA.add(a)
        missK.add(k)
      }
  if (missA.size) {
    const batch = loadSeries([...missA], [...missK])
    for (const a of missA)
      for (const k of missK) {
        if (seriesCache.has(sk(a, k)) || !CITIES[a].parameters.includes(k)) continue
        const p = batch.then((res) => res[a]?.[k])
        seriesCache.set(sk(a, k), p)
        // Forget a failed pair so the next request fetches it again
        p.catch(() => seriesCache.get(sk(a, k)) === p && seriesCache.delete(sk(a, k)))
      }
  }
  const out = {}
  await Promise.all(
    wanted.map(async ([a, keys]) => {
      out[a] = {}
      const vals = await Promise.all(keys.map((k) => seriesCache.get(sk(a, k))))
      keys.forEach((k, i) => {
        if (vals[i]) out[a][k] = vals[i]
      })
    }),
  )
  return out
}

// Stable cache key for a list ('*' stays '*'; order and duplicates ignored).
const listKey = (v) => (v === '*' ? '*' : [...new Set([].concat(v))].sort().join(','))

/**
 * Hook: monthly series for some areas and parameters.
 * @param {{ areas: string | string[] | '*' | null, parameters?: string[] | '*' }} q
 *   areas null = nothing yet (status 'idle'). Arrays may be new each render:
 *   the key is built from their sorted contents.
 * @param {{ keepPrevious?: boolean }} [opts]  see useResource
 * @returns {{ data: { [areaId]: { [param]: (number|null)[] } } | undefined,
 *   status, error, stale, retry }}  `data` keeps its identity while the request
 *   is the same, so it is safe in useMemo/useEffect deps.
 * Caching: per (area, parameter) pair, for the page's lifetime.
 * Example: const { data, status } = useTimeseries({ areas: city, parameters: ['ndvi'] }); data?.[city].ndvi
 */
export function useTimeseries({ areas, parameters = '*' } = {}, opts) {
  const key = areas == null ? null : `ts:${listKey(areas)}:${listKey(parameters)}`
  return useResource(key, () => getTimeseries({ areas, parameters }), opts)
}

/* ---- area detail (boundary, layers) ---- */

const DEFAULT_INCLUDE = ['boundary', 'layers']
const areaKey = (id, include) => `area:${id}:${listKey(include)}`

async function loadAreaDetail(areaId, include) {
  if (!CITIES[areaId]) throw new ApiError(`unknown area: ${areaId}`, { code: 'not_found' })
  const inc = [].concat(include)
  if (DATA_SOURCE === 'fallback') {
    const [bounds, rasters] = await Promise.all([
      inc.includes('boundary') ? fallbackJson('boundaries') : null,
      inc.includes('layers') ? fallbackJson('rasters') : null,
    ])
    // The static files have no layer list and no /values links: the map uses
    // its own Sentinel-2 constants and the per-city values.json instead.
    return { boundary: bounds?.[areaId] ?? null, raster: resolveRaster(rasters?.[areaId]) ?? null, layers: {}, pixelLinks: null, source: 'fallback' }
  }
  const area = await withTimeout(REQUEST_TIMEOUT_MS, `/areas/${areaId}`, (signal) => fetchArea(areaId, inc, signal))
  const d = toAreaDetail(area)
  if (!d) throw new ApiError(`/areas/${areaId}: unexpected response`, { code: 'bad_response' })
  return { ...d, source: 'api' }
}

/**
 * One area's boundary and map layers.
 * @param {string} areaId
 * @param {string[]} [include]  parts to load: 'boundary', 'layers' (default both)
 * @returns {Promise<{ boundary: GeoJSON geometry | null,
 *   raster: { ndviBounds, lstBounds, years: { year: url }, change, lstDay, lstNight, values } | null,
 *   layers: { layerId: { bounds, url, urlTemplate } }, pixelLinks: object | null,
 *   source: 'api' | 'fallback' }>}
 *   raster: the four MODIS layers (null when the area lacks one); layers: every
 *   API layer ({} with the fallback); pixelLinks and source: internal, used by
 *   getPixelValues (source is where this detail came from, which after a late
 *   upgrade can differ from the current DATA_SOURCE).
 */
export const getAreaDetail = (areaId, include = DEFAULT_INCLUDE) => load(areaKey(areaId, include), () => loadAreaDetail(areaId, include))

/**
 * Hook form of getAreaDetail. areaId null = idle. Cached per area + include.
 * @returns {{ data: (see getAreaDetail) | undefined, status, error, stale, retry }}
 */
export function useAreaDetail(areaId, include = DEFAULT_INCLUDE, opts) {
  return useResource(areaId == null ? null : areaKey(areaId, include), () => loadAreaDetail(areaId, include), opts)
}

/* ---- basemap ---- */

async function loadBasemap() {
  const mosaics =
    DATA_SOURCE === 'fallback'
      ? resolveMosaics(await fallbackJson('mapmeta'))
      : toMosaics(await withTimeout(REQUEST_TIMEOUT_MS, '/basemap', (signal) => fetchBasemap(signal)))
  if (!mosaics || (mosaics.region || []).length < 2) throw new ApiError('/basemap: no region mosaics', { code: 'bad_response' })
  return mosaics
}

/**
 * The satellite basemap mosaics: { region: [m, m], <cityId>: [z10, z13, z15] },
 * m = { id, z, bounds, image, labels } (public paths, labels null = none).
 * A city may lack its three mosaics; lib/map/basemap.js skips it then.
 * @returns {Promise<object>} cached for the page's lifetime
 */
export const getBasemap = () => load('basemap', loadBasemap)

/** Hook form of getBasemap: { data, status, error, stale, retry }. */
export const useBasemap = () => useResource('basemap', loadBasemap)

/* ---- pixel values (map pixel inspector) ---- */

/**
 * Per-pixel values of the four MODIS layers of an area (~120 KB), on demand:
 * { yearVals: { year: grid }, changeVals: grid, lstDayVals: grid, lstNightVals: grid }
 * (stored integers; consumers apply the scale), or null when the area has no
 * inspector data. API: four /values requests; fallback: the city's values.json.
 * @returns {Promise<object | null>} cached per area
 */
export const getPixelValues = (areaId) =>
  load(`pixels:${areaId}`, async () => {
    const d = await getAreaDetail(areaId)
    // By the detail's own source, not DATA_SOURCE: a detail loaded from the
    // static files before a late upgrade has no API links
    if (d.source === 'api') return d.pixelLinks ? fetchPixelValues(d.pixelLinks) : null
    if (!d.raster?.values) return null
    const res = await fetch(d.raster.values)
    if (!res.ok) throw new Error(`values.json: HTTP ${res.status}`)
    return res.json()
  })
