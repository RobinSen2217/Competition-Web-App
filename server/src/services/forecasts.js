// Forecast service: validates a forecast query against the forecast catalog,
// reads the area's Earth Engine feature table (src/forecast/tables.js, the
// output of the team notebook's pipeline), hands it to the forecasting module
// through a runner (src/forecast/runner.js) and presents the answer. The site's
// own climate data (the provider's timeseries) is not used here: the models
// were built on the notebook's table and need exactly its columns.
//
// The module is slow (seconds) and deterministic, so results are cached in
// memory per area + query + table version, and identical requests arriving
// while a run is in progress share that run. When the module cannot answer
// (FORECAST_MODE=snapshot, no Python, a timeout or a failure) a saved snapshot
// (src/forecast/snapshots.js) that covers the request is served instead, with
// data.source telling the client which one it got. A live run that could not
// start or timed out is remembered for a short while (retryAfterMs), so the
// same question goes straight to the snapshot instead of waiting again.
// An area whose table has not been extracted yet gets 503 forecast_unavailable
// with details.reason "no_gee_data" (or its snapshot, if one exists).

const { invalidQuery, invalidParameter, unsupportedInterval, insufficientData, modelFailure, forecastUnavailable } = require('../http/errors')
const { ALL } = require('../http/query')
const { getInterval } = require('../catalog/intervals')
const { getParameterDef } = require('../catalog/parameters')
const { MODELS, DEFAULT_TARGET, HORIZON, MODEL_OPTIONS, getTarget, targetKeys, modelIds } = require('../catalog/forecasts')
const { RunnerError, RUNNER_ERRORS } = require('../forecast/runner')
const { DEFAULT_SNAPSHOT_DIR, readSnapshot, fitSnapshot, coverageOf } = require('../forecast/snapshots')
const { createTableSource } = require('../forecast/tables')

// Contract version 2: the request carries the feature table (server/ml/README.md).
const REQUEST_VERSION = 2
// details.reason of the 503 for an area without an extracted table; clients
// branch on it to say "not available yet" rather than "something broke".
const NO_GEE_DATA = 'no_gee_data'
const DEFAULT_CACHE_SIZE = 200
// How long a run that could not start or timed out is remembered per area +
// query; meanwhile that question is answered from the snapshot at once.
const DEFAULT_RETRY_AFTER_MS = 60 * 1000
// Failures worth remembering: they would most likely happen again right away
// (Python missing) or cost a full timeout each time. A model failure or a
// refused request is quick and may depend on the data, so it is not.
const REMEMBERED_FAILURES = [RUNNER_ERRORS.UNAVAILABLE, RUNNER_ERRORS.TIMEOUT]

/**
 * @param {import('../providers/types').DataProvider} provider  unused: forecasts read the GEE tables
 * @param {object} services  uses requireArea
 * @param {{forecastRunner?: {name?: string, run: (request: object) => Promise<object>}|null,
 *          forecastMode?: 'live'|'snapshot', forecastSnapshotDir?: string, forecastTablesDir?: string,
 *          forecastCacheSize?: number, forecastRetryAfterMs?: number}} [options]
 *        forecastTablesDir: folder with areas.json and <id>.features.csv (default data/gee)
 *        forecastRetryAfterMs: how long a failed live run (unavailable, timeout)
 *        is remembered; 0 turns that off
 */
module.exports = function forecastService(provider, services, options = {}) {
  const { requireArea } = services
  const tables = createTableSource(options.forecastTablesDir ? { dir: options.forecastTablesDir } : {})
  const runner = options.forecastRunner || null
  const mode = options.forecastMode || 'live'
  const snapshotDir = options.forecastSnapshotDir || DEFAULT_SNAPSHOT_DIR
  const cacheSize = options.forecastCacheSize || DEFAULT_CACHE_SIZE
  const retryAfterMs = options.forecastRetryAfterMs ?? DEFAULT_RETRY_AFTER_MS

  // key -> Promise of a finished run. Holding the promise (not the result)
  // lets concurrent identical requests wait for one run. A Map keeps insertion
  // order, so the oldest entry is evicted first once the cache is full.
  const cache = new Map()
  const remember = (key, promise) => {
    cache.set(key, promise)
    while (cache.size > cacheSize) cache.delete(cache.keys().next().value)
  }

  // area + query -> { error, until } for recent runs that could not start or
  // timed out. Not tied to the table version: new data does not install Python.
  const failures = new Map()
  const queryKey = (area, q) => JSON.stringify([area.id, q.target, q.interval, q.horizon, q.models])
  const recentFailure = (key) => {
    const f = failures.get(key)
    if (f && f.until > Date.now()) return f.error
    if (f) failures.delete(key)
    return null
  }
  const rememberFailure = (key, err) => {
    if (!(retryAfterMs > 0) || !REMEMBERED_FAILURES.includes(err.code)) return
    failures.delete(key) // re-insert at the end, so eviction stays oldest-first
    failures.set(key, { error: err, until: Date.now() + retryAfterMs })
    while (failures.size > cacheSize) failures.delete(failures.keys().next().value)
  }

  // ---- query ----

  // Parsed query values -> { target, interval, horizon, models }. Models come
  // back in catalog order so "nn,ridge" and "ridge,nn" share one cache entry.
  function resolveQuery({ parameters, interval, horizon, models } = {}) {
    let target = DEFAULT_TARGET
    if (parameters !== undefined) {
      // One target per request: each one is a separate model run, and its
      // response is already large (hindcast, metrics, importances per model).
      if (parameters === ALL || parameters.length !== 1) {
        throw invalidQuery('Forecasts take exactly one parameter per request, e.g. parameters=ndvi', {
          parameter: 'parameters', forecastable: targetKeys(),
        })
      }
      target = parameters[0]
    }
    const def = getTarget(target)
    if (!def) {
      const known = Boolean(getParameterDef(target))
      throw invalidParameter(
        known ? `Parameter "${target}" cannot be forecast yet` : `Unknown parameter "${target}"`,
        { [known ? 'unforecastable' : 'unknown']: [target], valid: targetKeys() },
      )
    }

    const intervalId = interval || def.intervals[0]
    if (!getInterval(intervalId) || !def.intervals.includes(intervalId)) {
      throw unsupportedInterval(`Forecasts of "${target}" are not available at interval "${intervalId}"`, {
        interval: intervalId, parameter: target, supported: def.intervals,
      })
    }

    let steps = HORIZON.default
    if (horizon !== undefined) {
      steps = /^\d+$/.test(horizon) ? Number(horizon) : NaN
      if (!(steps >= HORIZON.min && steps <= HORIZON.max)) {
        throw invalidQuery(`"horizon" must be a whole number from ${HORIZON.min} to ${HORIZON.max}, got "${horizon}"`, {
          parameter: 'horizon', min: HORIZON.min, max: HORIZON.max,
        })
      }
    }

    let chosen = modelIds()
    if (models !== undefined && models !== ALL) {
      const unknown = models.filter((m) => !Object.hasOwn(MODELS, m))
      if (unknown.length) throw invalidQuery(`Unknown model(s): ${unknown.join(', ')}`, { parameter: 'models', unknown, allowed: modelIds() })
      chosen = modelIds().filter((m) => models.includes(m))
    }

    return { target, interval: intervalId, horizon: steps, models: chosen }
  }

  // ---- live runs ----

  // The module's request, contract version 2 (server/ml/README.md, docs/API.md
  // "Forecasts"): the area's whole feature table, as extracted.
  async function buildRequest(area, q, table) {
    const def = getTarget(q.target)
    const ti = table.columns.indexOf(def.column)
    const observed = ti < 0 ? 0 : table.rows.filter((r) => r[ti] !== null).length
    // Checked here rather than left to the module so the client gets a clear
    // 422 instead of a model failure (e.g. a box where Landsat is always cloudy).
    if (observed < def.minObserved) {
      throw insufficientData(
        `Area "${area.id}" has ${observed} ${q.interval} values of "${q.target}" (${def.column}) in its Earth Engine table; a forecast needs at least ${def.minObserved}`,
        { areaId: area.id, parameter: q.target, observed, required: def.minObserved },
      )
    }
    // The box the table was extracted for (areas.json); the area's own centre
    // only if the file does not list it.
    const cfg = (await tables.getAreaConfig(area.id)) || {}
    const center = Number.isFinite(cfg.lat) && Number.isFinite(cfg.lon) ? { lat: cfg.lat, lon: cfg.lon } : area.center
    return {
      version: REQUEST_VERSION,
      area: { id: area.id, name: cfg.name || area.name, center, halfWidthKm: Number.isFinite(cfg.halfWidthKm) ? cfg.halfWidthKm : null },
      interval: q.interval,
      columns: table.columns,
      rows: table.rows,
      target: def.column,
      horizon: q.horizon,
      models: q.models,
      options: { ...MODEL_OPTIONS },
    }
  }

  // A response the rest of the API can rely on: every requested model with
  // `horizon` values. Anything else is treated as a failed run.
  function checkResponse(res, q) {
    const ok = res && typeof res === 'object' && res.target === getTarget(q.target).column &&
      Array.isArray(res.forecastTimes) && res.forecastTimes.length === q.horizon &&
      res.models && q.models.every((m) => res.models[m] && Array.isArray(res.models[m].forecast) && res.models[m].forecast.length === q.horizon)
    if (!ok) throw new RunnerError(RUNNER_ERRORS.MODEL_FAILURE, 'The forecasting module answered with a response that does not match the request')
    return res
  }

  // One run per distinct question and table version, shared by everyone asking.
  async function liveRun(area, q, table) {
    if (!runner) throw new RunnerError(RUNNER_ERRORS.UNAVAILABLE, 'No forecast runner is configured')
    const dataUpdated = table.updated
    const key = JSON.stringify([area.id, q.target, q.interval, q.horizon, q.models, dataUpdated])
    if (!cache.has(key)) {
      const run = (async () => {
        const response = checkResponse(await runner.run(await buildRequest(area, q, table)), q)
        return { response, generated: new Date().toISOString(), dataUpdated }
      })()
      // Failures are not cached: the next request tries again (Python may
      // have been installed meanwhile, or the timeout was a one-off).
      run.catch(() => { if (cache.get(key) === run) cache.delete(key) })
      remember(key, run)
    }
    return cache.get(key)
  }

  // ---- presenting ----

  function present({ response, generated, dataUpdated }, q, source, extraMeta = {}) {
    // `version` is the module's protocol version, not part of the API resource.
    // The module names the target by its table column ("NDVI"); the API by
    // its parameter key ("ndvi"), like every other endpoint. Overriding inside
    // the spread keeps the module's field order.
    // eslint-disable-next-line no-unused-vars
    const { version, ...rest } = response
    const def = getParameterDef(q.target)
    return {
      data: { ...rest, target: q.target, models: Object.fromEntries(q.models.map((m) => [m, response.models[m]])), source },
      meta: {
        parameters: [q.target],
        horizon: q.horizon,
        models: q.models,
        units: { [q.target]: def ? def.unit : '' },
        generated,
        dataUpdated,
        ...extraMeta,
      },
    }
  }

  async function fromSnapshot(area, q, extraMeta) {
    const snapshot = await readSnapshot(snapshotDir, area.id, q.target)
    const fitted = snapshot && fitSnapshot(snapshot, q)
    if (!fitted) return { snapshot, result: null }
    const { generated = null, dataUpdated = null } = snapshot.meta || {}
    return { snapshot, result: present({ response: fitted, generated, dataUpdated }, q, 'snapshot', extraMeta) }
  }

  // Runner failure without a usable snapshot -> the HTTP error clients see.
  // The module's own message stays in the server log: it can name paths or
  // library internals. The exception is a refused request (exit 2): the
  // module then explains what the data lacks (e.g. too few months with every
  // input), which is the useful answer and contains no internals.
  function runnerHttpError(err, area, q, snapshot) {
    const details = { areaId: area.id, parameter: q.target, saved: snapshot ? coverageOf(snapshot) : null }
    if (err.code === RUNNER_ERRORS.INVALID_INPUT) {
      return insufficientData(`Cannot forecast "${q.target}" for area "${area.id}": ${err.message}`, details)
    }
    if (err.code === RUNNER_ERRORS.UNAVAILABLE || err.code === RUNNER_ERRORS.TIMEOUT) {
      const why = err.code === RUNNER_ERRORS.TIMEOUT ? 'took too long' : 'is not available on this server'
      return forecastUnavailable(`The forecasting model ${why}, and no saved forecast covers this request. Try again later or ask for fewer months.`, details)
    }
    return modelFailure(`The forecasting model failed for area "${area.id}"`, details)
  }

  // No table for the area: nothing to run the models on, which is a normal
  // state (not extracted yet), not a failure, so it is never remembered.
  function noGeeData(area, q, snapshot) {
    return forecastUnavailable(
      `Earth Engine data for area "${area.id}" has not been extracted yet, so there is no forecast for it.`,
      { areaId: area.id, parameter: q.target, reason: NO_GEE_DATA, saved: snapshot ? coverageOf(snapshot) : null },
    )
  }

  // ---- public ----

  // GET /areas/:areaId/forecasts. Returns {data, meta}.
  async function getForecast(areaId, query) {
    const area = await requireArea(areaId)
    const q = resolveQuery(query)
    if (!area.coverage.intervals.includes(q.interval)) {
      throw unsupportedInterval(`Area "${area.id}" has no ${q.interval} data`, { interval: q.interval, areaId: area.id, supported: area.coverage.intervals })
    }

    if (mode === 'snapshot') {
      const { snapshot, result } = await fromSnapshot(area, q)
      if (result) return result
      if (!snapshot && !(await tables.getTable(area.id))) throw noGeeData(area, q, null)
      throw forecastUnavailable(
        snapshot
          ? `The saved forecast for "${area.id}" covers ${coverageOf(snapshot).horizon} months and models ${coverageOf(snapshot).models.join(', ')}; this request asks for more. Live forecasts are off on this server (FORECAST_MODE=snapshot).`
          : `No saved forecast of "${q.target}" for area "${area.id}", and live forecasts are off on this server (FORECAST_MODE=snapshot).`,
        { areaId: area.id, parameter: q.target, saved: snapshot ? coverageOf(snapshot) : null },
      )
    }

    const table = await tables.getTable(area.id)
    if (!table) {
      const { snapshot, result } = await fromSnapshot(area, q, { fallback: NO_GEE_DATA })
      if (result) return result
      throw noGeeData(area, q, snapshot)
    }

    // The same question failed to run a moment ago: answer from the snapshot
    // (or with the same error) without starting, and waiting for, another run.
    const key = queryKey(area, q)
    const recent = recentFailure(key)
    if (recent) {
      const { snapshot, result } = await fromSnapshot(area, q, { fallback: recent.code })
      if (result) return result
      throw runnerHttpError(recent, area, q, snapshot)
    }

    try {
      return present(await liveRun(area, q, table), q, 'live')
    } catch (err) {
      if (!(err instanceof RunnerError)) throw err // e.g. 422 insufficient_data, or a bug
      console.warn(`Forecast ${area.id}/${q.target} failed (${err.code}): ${err.message}${err.stderr ? `\n${err.stderr}` : ''}`)
      rememberFailure(key, err)
      const { snapshot, result } = await fromSnapshot(area, q, { fallback: err.code })
      if (result) return result
      throw runnerHttpError(err, area, q, snapshot)
    }
  }

  // Live run only, never a snapshot; errors as getForecast's (an area without
  // a table: 503 with details.reason "no_gee_data"). Used by
  // scripts/build-forecasts.js, which writes the snapshots themselves.
  async function runForecast(areaId, query) {
    const area = await requireArea(areaId)
    const q = resolveQuery(query)
    const table = await tables.getTable(area.id)
    if (!table) throw noGeeData(area, q, null)
    try {
      return present(await liveRun(area, q, table), q, 'live')
    } catch (err) {
      if (err instanceof RunnerError) {
        const http = runnerHttpError(err, area, q, null)
        http.cause = err
        throw http
      }
      throw err
    }
  }

  return { getForecast, runForecast, resolveForecastQuery: resolveQuery, forecastTables: tables }
}

