// Hazard service (the Disaster module): hazard types, their events, the
// parameters measured during an event, the event's daily series and irregular
// observations, the per-day forecast / danger classification, and the event's
// map layers (overlay images such as an observed water extent).
//
// Nothing here is specific to one hazard: what a hazard's parameters mean and
// where they live is in src/catalog/hazards/<hazard>.js, the data and model
// results come from the hazard provider (src/providers/hazards.js), and the
// model itself runs offline in server/ml (forecaster.hazards), whose saved
// result (the "snapshot") is served as it is, cut to the request.

const { notFound, invalidQuery, invalidParameter, unsupportedInterval, forecastUnavailable } = require('../http/errors')
const { ALL, checkTime } = require('../http/query')
const { timeWindow } = require('../catalog/intervals')
const { getHazardDef, hazardIds, presentHazardParameter, EVALUATION_ROLES } = require('../catalog/hazards')
const { createHazardFilesProvider } = require('../providers/hazards')

// details.reason of the 503 when a hazard's model has not been built yet.
const NO_MODEL = 'no_model'
// Event record fields presented on their own; anything else the dataset
// carries goes to `attributes` (e.g. the flood's rainDriven).
const EVENT_FIELDS = new Set(['id', 'name', 'country', 'admin', 'place', 'period', 'bbox', 'center', 'cause', 'notes',
  'summary', 'coverage', 'files', 'sources', 'warnings'])

// A CSV cell as JSON, by the parameter's valueType ("" / NaN = null).
function convert(cell, valueType) {
  if (cell === undefined || cell === null) return null
  const t = String(cell).trim()
  if (t === '' || t.toLowerCase() === 'nan') return null
  if (valueType === 'boolean') {
    const l = t.toLowerCase()
    return l === 'true' || l === '1' ? true : l === 'false' || l === '0' ? false : null
  }
  if (valueType === 'number' || valueType === 'integer') {
    const n = Number(t)
    return Number.isFinite(n) ? n : null
  }
  return t
}

// pandas rolling(window, min_periods=1).sum(): the step and the window-1
// before it, missing values skipped, null only if all are missing. Rounded to
// 6 decimals so 0.99 + 0.63 reads 1.62, not 1.6199999999999999.
function rollingSum(values, window) {
  return values.map((_, i) => {
    let sum = 0
    let any = false
    for (let j = Math.max(0, i - window + 1); j <= i; j++) {
      if (values[j] !== null) {
        sum += values[j]
        any = true
      }
    }
    return any ? Math.round(sum * 1e6) / 1e6 : null
  })
}

const DERIVED_OPS = { rolling_sum: (values, d) => rollingSum(values, d.window) }

// Does a snapshot event result have per-day scores? (Excluded events have no
// days; a "not_scored" event has days but no probabilities.)
const scored = (r) => Boolean(r && Array.isArray(r.dates)) && r.role !== 'not_scored'

// Optional extras of an event (?include=), like an area's ?include=layers.
const EVENT_INCLUDES = ['layers']
// Layer record fields served as they are (the importer writes their meaning
// with them, see server/ml forecaster/hazards/layers.py).
const LAYER_FIELDS = ['label', 'kind', 'description', 'time', 'crs', 'bounds', 'extent', 'legend', 'stats', 'source', 'notes']

/**
 * @param {import('../providers/types').DataProvider} provider  unused: hazards have their own provider
 * @param {object} services
 * @param {{hazardProvider?: import('../providers/types').HazardProvider, hazardsDir?: string}} [options]
 */
module.exports = function hazardService(provider, services, options = {}) {
  const hazards = options.hazardProvider || createHazardFilesProvider(options.hazardsDir ? { dir: options.hazardsDir } : {})
  const href = (...parts) => ['/api/v1/hazards', ...parts.map((p) => (p.startsWith('{') ? p : encodeURIComponent(p)))].join('/')

  // ---- lookups ----

  function requireHazard(id) {
    const def = getHazardDef(id)
    if (!def) throw notFound(`Unknown hazard "${id}". See /api/v1/hazards for valid ids.`, { hazard: id, valid: hazardIds() })
    return def
  }

  async function requireEvent(def, eventId) {
    const ev = await hazards.getEvent(def.id, eventId)
    if (!ev) throw notFound(`Unknown ${def.id} event "${eventId}". See ${href(def.id, 'events')}.`, { hazard: def.id, eventId })
    return ev
  }

  const snapshotOf = (def) => (def.forecast ? hazards.getModel(def.id, def.forecast.snapshot) : Promise.resolve(null))

  // { eventId: [layer record] }. Layers are optional for a provider (an
  // injected one may have none), and a record without a usable id is skipped
  // rather than served half-formed.
  async function layersOf(def) {
    const all = hazards.getLayers ? await hazards.getLayers(def.id) : {}
    const out = {}
    for (const [eventId, recs] of Object.entries(all || {})) {
      if (Array.isArray(recs)) out[eventId] = recs.filter((r) => r && typeof r.id === 'string' && r.id !== '')
    }
    return out
  }
  const eventLayers = (layers, eventId) => (Object.hasOwn(layers, eventId) ? layers[eventId] : [])

  // ?parameters= (list, ALL or undefined) -> catalog parameter defs, in request order.
  function resolveParameters(def, requested) {
    if (requested === undefined || requested === ALL) return def.parameters
    const byKey = new Map(def.parameters.map((p) => [p.key, p]))
    const unknown = requested.filter((k) => !byKey.has(k))
    if (unknown.length) {
      throw invalidParameter(`Unknown ${def.id} parameter(s): ${unknown.join(', ')}`, { unknown, valid: [...byKey.keys()] })
    }
    return requested.map((k) => byKey.get(k))
  }

  // ?interval=, ?from=, ?to= against the hazard's interval.
  function resolveRange(def, { interval, from, to }) {
    const id = interval || def.interval
    if (id !== def.interval) throw unsupportedInterval(`${def.label} data is ${def.interval} only`, { interval: id, supported: [def.interval] })
    if (from !== undefined) checkTime('from', from, id)
    if (to !== undefined) checkTime('to', to, id)
    if (from !== undefined && to !== undefined && from > to) throw invalidQuery(`"from" (${from}) is after "to" (${to})`, { from, to })
    return { interval: id, from, to }
  }

  // ?bbox=west,south,east,north (degrees). west > east crosses the antimeridian.
  function parseBbox(value) {
    if (value === undefined) return undefined
    const parts = value.split(',').map((s) => s.trim())
    const nums = parts.map(Number)
    const bad = parts.length !== 4 || parts.some((s) => s === '') || nums.some((n) => !Number.isFinite(n))
    const [w, s, e, n] = nums
    if (bad || Math.abs(w) > 180 || Math.abs(e) > 180 || Math.abs(s) > 90 || Math.abs(n) > 90 || s > n) {
      throw invalidQuery('"bbox" must be west,south,east,north in degrees (WGS84), e.g. bbox=60,5,100,40', {
        parameter: 'bbox', format: 'west,south,east,north', example: '60,5,100,40',
      })
    }
    return [w, s, e, n]
  }

  // Do two [w, s, e, n] boxes overlap? A query box may cross the antimeridian.
  function intersects(q, b) {
    if (!b) return false
    const [w, s, e, n] = q
    const [bw, bs, be, bn] = b
    if (bs > n || bn < s) return false
    const lonOverlap = (lo, hi) => !(bw > hi || be < lo)
    return w <= e ? lonOverlap(w, e) : lonOverlap(w, 180) || lonOverlap(-180, e)
  }

  // ---- presenting ----

  const tablesOf = (ev) => Object.keys(ev.files || {})

  // Catalog parameters this event has data for.
  function eventParameters(def, ev) {
    const tables = new Set(tablesOf(ev))
    const has = (p) => (p.derived ? has(def.parameters.find((x) => x.key === p.derived.from) || {}) : tables.has(p.table))
    return def.parameters.filter(has).map((p) => p.key)
  }

  function forecastStatus(def, ev, snapshot) {
    if (!def.forecast) return null
    if (!snapshot) return { available: false, role: null, reason: NO_MODEL }
    const r = snapshot.events?.[ev.id]
    if (!r) return { available: false, role: null, reason: 'This event is not in the model results; rebuild the model.' }
    if (!scored(r)) return { available: false, role: r.role, reason: r.reason || EVALUATION_ROLES[r.role] || null }
    return { available: true, role: r.role, href: href(def.id, 'events', ev.id, 'forecast') }
  }

  // Public shape of a layer. `url` is the overlay image on this API, with the
  // image's hash as ?v= so a rebuilt image gets a new URL (the image itself
  // may be cached for a day).
  function presentLayer(def, ev, rec) {
    const self = href(def.id, 'events', ev.id, 'layers', rec.id)
    const sha = rec.image?.sha256
    const url = `${self}/image${sha ? `?v=${String(sha).slice(0, 12)}` : ''}`
    const out = { id: rec.id, hazard: def.id, eventId: ev.id }
    for (const k of LAYER_FIELDS) out[k] = rec[k] ?? (k === 'notes' ? [] : null)
    out.label ??= rec.id
    out.url = url
    // eslint-disable-next-line no-unused-vars
    const { sha256, ...image } = rec.image || {}
    out.image = { ...image, url }
    out.links = { self }
    return out
  }

  function presentEvent(def, ev, snapshot, dataset, detail = false, layers = {}, include = new Set()) {
    const own = eventLayers(layers, ev.id)
    const out = {
      id: ev.id,
      hazard: def.id,
      name: ev.name ?? ev.id,
      country: ev.country ?? null,
      admin: ev.admin ?? null,
      place: ev.place ?? null,
      period: ev.period ?? null,
      bbox: ev.bbox ?? null,
      center: ev.center ?? null,
      cause: ev.cause ?? null,
      coverage: { interval: def.interval, parameters: eventParameters(def, ev), ...(ev.coverage || {}), layers: own.map((l) => l.id) },
      forecast: forecastStatus(def, ev, snapshot),
    }
    if (include.has('layers')) out.layers = own.map((l) => presentLayer(def, ev, l))
    if (!detail) return out
    const byId = new Map((dataset?.datasets || []).map((d) => [d.id, d]))
    out.notes = ev.notes || []
    out.summary = ev.summary ?? null
    out.attributes = Object.fromEntries(Object.entries(ev).filter(([k]) => !EVENT_FIELDS.has(k)))
    out.sources = (ev.sources || []).map((s) => ({ ...(byId.get(s.dataset) || { id: s.dataset }), files: s.files || [] }))
    out.links = {
      timeseries: href(def.id, 'events', ev.id, 'timeseries'),
      forecast: def.forecast ? href(def.id, 'events', ev.id, 'forecast') : null,
      layers: href(def.id, 'events', ev.id, 'layers'),
    }
    return out
  }

  function forecastSummary(def, snapshot) {
    if (!def.forecast) return null
    if (!snapshot) return { available: false, reason: NO_MODEL }
    return {
      available: true,
      horizonDays: snapshot.horizonDays,
      target: snapshot.target,
      classes: (snapshot.classes || []).map((c) => c.id),
      defaultModel: snapshot.defaultModel ?? null,
      models: Object.entries(snapshot.models).map(([id, m]) => ({ id, label: m.label, threshold: m.threshold })),
      modelVersion: snapshot.modelVersion,
      href: href(def.id, 'events', '{eventId}', 'forecast'),
    }
  }

  // The model's own description and scores, without the per-day results.
  function modelDetail(snapshot) {
    // eslint-disable-next-line no-unused-vars
    const { events, updated, version, ...rest } = snapshot
    return rest
  }

  async function presentHazard(def, detail = false) {
    const [dataset, events, snapshot, layers] = await Promise.all([hazards.getDataset(def.id), hazards.listEvents(def.id), snapshotOf(def), layersOf(def)])
    // Layers of events that exist (a stale layers.json entry is not counted).
    const known = new Set(events.map((e) => e.id))
    const allLayers = Object.entries(layers).filter(([id]) => known.has(id)).flatMap(([, recs]) => recs)
    const froms = events.map((e) => e.coverage?.from).filter(Boolean).sort()
    const tos = events.map((e) => e.coverage?.to).filter(Boolean).sort()
    const series = def.parameters.filter((p) => p.kind === 'series').map((p) => p.key)
    const observations = def.parameters.filter((p) => p.kind === 'observation').map((p) => p.key)
    const out = {
      id: def.id,
      label: def.label,
      description: def.description,
      interval: def.interval,
      provides: {
        events: { count: events.length, href: href(def.id, 'events') },
        parameters: { count: def.parameters.length, series, observations, href: href(def.id, 'parameters') },
        timeseries: { intervals: [def.interval], href: href(def.id, 'events', '{eventId}', 'timeseries') },
        forecast: forecastSummary(def, snapshot),
        layers: {
          count: allLayers.length,
          events: events.filter((e) => eventLayers(layers, e.id).length).length,
          ids: [...new Set(allLayers.map((l) => l.id))].sort(),
          kinds: [...new Set(allLayers.map((l) => l.kind).filter(Boolean))].sort(),
          href: href(def.id, 'events', '{eventId}', 'layers'),
        },
      },
      coverage: {
        from: froms[0] ?? null,
        to: tos.at(-1) ?? null,
        countries: [...new Set(events.map((e) => e.country?.code).filter(Boolean))].sort(),
      },
      dataUpdated: dataset?.updated ?? null,
    }
    if (!detail) return out
    out.dataset = dataset && {
      description: dataset.description ?? null,
      generated: dataset.generated ?? null,
      tables: Object.fromEntries(Object.entries(dataset.tables || {}).map(([k, t]) => [k, { kind: t.kind, columns: t.columns || {} }])),
      datasets: dataset.datasets || [],
      notes: dataset.notes || [],
    }
    out.forecast = snapshot ? modelDetail(snapshot) : null
    return out
  }

  // ---- public ----

  async function listHazards() {
    return Promise.all(hazardIds().map((id) => presentHazard(getHazardDef(id))))
  }

  async function getHazard(id) {
    return presentHazard(requireHazard(id), true)
  }

  function listHazardParameters(hazardId) {
    const def = requireHazard(hazardId)
    return def.parameters.map((p) => presentHazardParameter(def, p))
  }

  function getHazardParameter(hazardId, key) {
    const def = requireHazard(hazardId)
    const p = def.parameters.find((x) => x.key === key)
    if (!p) throw notFound(`Unknown ${def.id} parameter "${key}". See ${href(def.id, 'parameters')}.`, { hazard: def.id, key })
    return presentHazardParameter(def, p)
  }

  // ?country= (ISO 3166-1 alpha-2 codes or names, case-insensitive) and ?bbox=.
  async function listHazardEvents(hazardId, { country, bbox, include } = {}) {
    const def = requireHazard(hazardId)
    const box = parseBbox(bbox)
    const [events, snapshot, dataset, layers] = await Promise.all([hazards.listEvents(def.id), snapshotOf(def), hazards.getDataset(def.id), layersOf(def)])
    const wanted = country === undefined || country === ALL ? null : new Set(country.map((c) => c.toLowerCase()))
    return events
      .filter((e) => !wanted || wanted.has(String(e.country?.code || '').toLowerCase()) || wanted.has(String(e.country?.name || '').toLowerCase()))
      .filter((e) => !box || intersects(box, e.bbox))
      .map((e) => presentEvent(def, e, snapshot, dataset, false, layers, include))
  }

  async function getHazardEvent(hazardId, eventId, include) {
    const def = requireHazard(hazardId)
    const ev = await requireEvent(def, eventId)
    const [snapshot, dataset, layers] = await Promise.all([snapshotOf(def), hazards.getDataset(def.id), layersOf(def)])
    return presentEvent(def, ev, snapshot, dataset, true, layers, include)
  }

  // ---- layers ----

  async function listEventLayers(hazardId, eventId) {
    const def = requireHazard(hazardId)
    const ev = await requireEvent(def, eventId)
    return eventLayers(await layersOf(def), ev.id).map((l) => presentLayer(def, ev, l))
  }

  async function findLayer(hazardId, eventId, layerId) {
    const def = requireHazard(hazardId)
    const ev = await requireEvent(def, eventId)
    const own = eventLayers(await layersOf(def), ev.id)
    const rec = own.find((l) => l.id === layerId)
    if (!rec) {
      throw notFound(`Unknown layer "${layerId}" for ${def.id} event "${ev.id}". See ${href(def.id, 'events', ev.id, 'layers')}.`,
        { hazard: def.id, eventId: ev.id, layerId, valid: own.map((l) => l.id) })
    }
    return { def, ev, rec }
  }

  async function getEventLayer(hazardId, eventId, layerId) {
    const { def, ev, rec } = await findLayer(hazardId, eventId, layerId)
    return presentLayer(def, ev, rec)
  }

  // The overlay image file for the route to stream: { path, type, size, updated }.
  async function getEventLayerImage(hazardId, eventId, layerId) {
    const { def, ev, rec } = await findLayer(hazardId, eventId, layerId)
    const file = hazards.getLayerFile ? await hazards.getLayerFile(def.id, ev.id, rec.id) : null
    if (!file) throw notFound(`Layer "${rec.id}" of ${def.id} event "${ev.id}" has no image`, { hazard: def.id, eventId: ev.id, layerId: rec.id })
    return file
  }

  // GET .../events/:eventId/timeseries. Regular series share `times` (the
  // event's interval axis); irregular observations (satellite passes) come
  // with their own times and context. Returns {data, meta}.
  async function getEventTimeseries(hazardId, eventId, query = {}) {
    const def = requireHazard(hazardId)
    const ev = await requireEvent(def, eventId)
    const { interval, from, to } = resolveRange(def, query)
    const params = resolveParameters(def, query.parameters)

    const tables = {}
    const table = async (name) => (Object.hasOwn(tables, name) ? tables[name] : (tables[name] = await hazards.getTable(def.id, ev.id, name)))

    // The time axis: every row of the event's series tables, in date order.
    const seriesTables = [...new Set(def.parameters.filter((p) => p.kind === 'series' && p.table).map((p) => p.table))]
    const axis = new Set()
    for (const name of seriesTables) {
      const t = await table(name)
      if (t) for (const r of t.rows) axis.add(r[t.columns.indexOf(t.timeColumn)])
    }
    const allTimes = [...axis].sort()
    const [lo, hi] = timeWindow(allTimes, from, to)

    // Full-length values of a series parameter (derived ones are computed on
    // the whole event, then cut, so a 3-day total on `from` counts the days before).
    const full = {}
    async function seriesValues(p) {
      if (Object.hasOwn(full, p.key)) return full[p.key]
      let values
      if (p.derived) {
        const src = def.parameters.find((x) => x.key === p.derived.from)
        values = DERIVED_OPS[p.derived.op](await seriesValues(src), p.derived)
      } else {
        const t = await table(p.table)
        const ci = t ? t.columns.indexOf(p.column) : -1
        const ti = t ? t.columns.indexOf(t.timeColumn) : -1
        const byTime = new Map(ci < 0 ? [] : t.rows.map((r) => [r[ti], convert(r[ci], p.valueType)]))
        values = allTimes.map((time) => (byTime.has(time) ? byTime.get(time) : null))
      }
      return (full[p.key] = values)
    }

    async function observationValues(p) {
      const t = await table(p.table)
      const context = def.observationContext?.[p.table] || []
      const out = { times: [], values: [], context: Object.fromEntries(context.map((c) => [c.key, []])) }
      if (!t) return out
      const ti = t.columns.indexOf(t.timeColumn)
      const ci = t.columns.indexOf(p.column)
      const rows = t.rows
        .map((r, i) => ({ r, i }))
        .filter(({ r }) => (from === undefined || r[ti] >= from) && (to === undefined || r[ti] <= to))
        .sort((a, b) => (a.r[ti] < b.r[ti] ? -1 : a.r[ti] > b.r[ti] ? 1 : a.i - b.i)) // same day: file order
      for (const { r } of rows) {
        out.times.push(r[ti])
        out.values.push(ci < 0 ? null : convert(r[ci], p.valueType))
        for (const c of context) {
          const k = t.columns.indexOf(c.key)
          out.context[c.key].push(k < 0 ? null : convert(r[k], c.valueType))
        }
      }
      return out
    }

    const series = {}
    const observations = {}
    for (const p of params) {
      if (p.kind === 'series') series[p.key] = (await seriesValues(p)).slice(lo, hi)
      else observations[p.key] = await observationValues(p)
    }
    const times = allTimes.slice(lo, hi)
    const meta = {
      from: times[0] ?? null,
      to: times.at(-1) ?? null,
      count: times.length,
      parameters: params.map((p) => p.key),
      units: Object.fromEntries(params.map((p) => [p.key, p.unit])),
      observations: Object.fromEntries(Object.entries(observations).map(([k, o]) => [k, o.times.length])),
    }
    if (from !== undefined || to !== undefined) meta.requested = { from: from ?? null, to: to ?? null }
    return { data: { hazard: def.id, eventId: ev.id, interval, times, series, observations }, meta }
  }

  // GET .../events/:eventId/forecast: per day, each model's probability,
  // threshold and danger class, the actual outcome, the model's scores and
  // how the event was scored. Returns {data, meta}.
  async function getEventForecast(hazardId, eventId, query = {}) {
    const def = requireHazard(hazardId)
    if (!def.forecast) throw notFound(`Hazard "${def.id}" has no forecast`, { hazard: def.id })
    const ev = await requireEvent(def, eventId)
    const { from, to } = resolveRange(def, query)
    const snapshot = await snapshotOf(def)
    if (!snapshot) {
      throw forecastUnavailable(
        `The ${def.id} forecast has not been built yet (python -m forecaster.hazards build ${def.id} in server/ml).`,
        { hazard: def.id, eventId: ev.id, reason: NO_MODEL },
      )
    }
    const allModels = Object.keys(snapshot.models)
    let chosen = allModels
    if (query.models !== undefined && query.models !== ALL) {
      const unknown = query.models.filter((m) => !Object.hasOwn(snapshot.models, m))
      if (unknown.length) throw invalidQuery(`Unknown model(s): ${unknown.join(', ')}`, { parameter: 'models', unknown, allowed: allModels })
      chosen = allModels.filter((m) => query.models.includes(m))
    }

    const r = snapshot.events?.[ev.id] || null
    const role = r?.role ?? null
    const available = scored(r)
    const dates = available ? r.dates : []
    const [lo, hi] = timeWindow(dates, from, to)
    const cut = (a) => (Array.isArray(a) ? a.slice(lo, hi) : [])
    const times = cut(dates)
    const labelKey = snapshot.target?.labelParameter || 'label'

    const models = {}
    for (const m of chosen) {
      const spec = snapshot.models[m]
      const day = available ? r.models[m] : null
      const cls = cut(day?.class)
      const dangerDays = times.filter((_, i) => cls[i] === 'danger')
      models[m] = {
        label: spec.label,
        threshold: spec.threshold,
        probability: cut(day?.probability),
        class: cls,
        summary: { dangerDays: dangerDays.length, firstDanger: dangerDays[0] ?? null, lastDanger: dangerDays.at(-1) ?? null },
        fold: day?.fold ?? null,
        foldEvents: day?.foldEvents ?? null,
        metrics: {
          // This event's days with a known outcome (whole event, not cut by from/to).
          event: day?.metrics ?? null,
          test: spec.test,
          outOfFold: { balancedAccuracy: spec.oof?.balancedAccuracy ?? null, rows: spec.oof?.rows ?? null },
        },
      }
    }
    const usedFeatures = new Set(chosen.flatMap((m) => snapshot.models[m].features || []))
    const features = (snapshot.features || []).filter((f) => usedFeatures.has(f.key))

    const data = {
      hazard: def.id,
      eventId: ev.id,
      interval: snapshot.interval || def.interval,
      available,
      horizonDays: snapshot.horizonDays,
      target: snapshot.target,
      classes: snapshot.classes,
      defaultModel: snapshot.defaultModel ?? null,
      evaluation: {
        role,
        description: role ? EVALUATION_ROLES[role] || null : null,
        reason: available ? null : r?.reason || (r ? EVALUATION_ROLES[role] || null : 'This event is not in the model results; rebuild the model.'),
      },
      times,
      actual: cut(r?.target),
      observed: { [labelKey]: cut(r?.label) },
      models,
      inputs: { features, values: Object.fromEntries(features.map((f) => [f.key, cut(r?.inputs?.[f.key])])) },
      provenance: { modelVersion: snapshot.modelVersion, ...snapshot.provenance },
    }
    const meta = {
      models: chosen,
      from: times[0] ?? null,
      to: times.at(-1) ?? null,
      count: times.length,
      generated: snapshot.provenance?.generated ?? null,
      modelVersion: snapshot.modelVersion ?? null,
      dataUpdated: snapshot.updated ?? null,
    }
    if (from !== undefined || to !== undefined) meta.requested = { from: from ?? null, to: to ?? null }
    return { data, meta }
  }

  return {
    listHazards, getHazard, listHazardParameters, getHazardParameter,
    listHazardEvents, getHazardEvent, getEventTimeseries, getEventForecast,
    listEventLayers, getEventLayer, getEventLayerImage,
    hazardEventIncludeNames: EVENT_INCLUDES,
  }
}
