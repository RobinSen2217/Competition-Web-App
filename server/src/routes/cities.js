// Per-city endpoints: the city list, one city's summary, its monthly series
// (optionally filtered by parameter and month range), outline, raster metadata
// and per-pixel values.

const express = require('express')
const data = require('../data')
const { HttpError } = require('../errors')

const router = express.Router()

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/

const cityInfo = (id) => {
  const c = data.climate.cities[id]
  return { id, name: c.name, state: c.state, lat: c.lat, lon: c.lon }
}

// Resolves :cityId once for every route below, so each handler can assume the
// city exists and unknown ids all fail the same way.
router.param('cityId', (req, res, next, id) => {
  if (!data.hasCity(id)) return next(new HttpError(404, `Unknown city "${id}". See /api/cities for valid ids.`))
  next()
})

// A query value may arrive as an array when the key is repeated (?from=a&from=b).
function singleValue(query, name) {
  const v = query[name]
  if (v === undefined) return undefined
  if (typeof v !== 'string') throw new HttpError(400, `"${name}" must be given once`)
  return v.trim()
}

function parseMonth(query, name) {
  const v = singleValue(query, name)
  if (v === undefined || v === '') return undefined
  if (!MONTH_RE.test(v)) throw new HttpError(400, `"${name}" must be a month as YYYY-MM, got "${v}"`)
  return v
}

router.get('/cities', (req, res) => {
  res.json({ cities: data.cityIds.map(cityInfo) })
})

router.get('/cities/:cityId', (req, res) => {
  const id = req.params.cityId
  const { months } = data
  res.json({
    ...cityInfo(id),
    parameters: Object.keys(data.climate.cities[id].series),
    months: { first: months[0], last: months[months.length - 1], count: months.length },
  })
})

router.get('/cities/:cityId/series', (req, res) => {
  const id = req.params.cityId
  const series = data.climate.cities[id].series
  const available = Object.keys(series)

  // params: comma-separated keys, repeated ?params= also accepted. Absent = all.
  let keys = available
  if (req.query.params !== undefined) {
    const raw = [].concat(req.query.params).join(',')
    keys = [...new Set(raw.split(',').map((s) => s.trim()).filter(Boolean))]
    if (keys.length === 0) throw new HttpError(400, '"params" is empty. Leave it out to get every parameter.')
    const unknown = keys.filter((k) => !available.includes(k))
    if (unknown.length) {
      throw new HttpError(400, `Unknown parameter(s): ${unknown.join(', ')}. Valid: ${available.join(', ')}`)
    }
  }

  const from = parseMonth(req.query, 'from')
  const to = parseMonth(req.query, 'to')
  if (from && to && from > to) throw new HttpError(400, `"from" (${from}) is after "to" (${to})`)

  // "YYYY-MM" strings sort chronologically, so plain string comparison selects
  // the range. A range reaching outside the data is clipped to what exists.
  const all = data.months
  const start = from ? all.findIndex((m) => m >= from) : 0
  const endAfter = to ? all.findLastIndex((m) => m <= to) + 1 : all.length
  const lo = start === -1 ? all.length : start
  const hi = Math.max(lo, endAfter)

  const out = {}
  for (const k of keys) out[k] = series[k].slice(lo, hi) // nulls (missing months) pass through untouched
  res.json({
    city: id,
    from: from || all[0],
    to: to || all[all.length - 1],
    months: all.slice(lo, hi),
    series: out,
  })
})

router.get('/cities/:cityId/boundary', (req, res) => {
  const geometry = data.boundaries[req.params.cityId]
  if (!geometry) throw new HttpError(404, `No boundary for city "${req.params.cityId}"`)
  res.json(geometry)
})

router.get('/cities/:cityId/rasters', (req, res) => {
  const r = data.rasters[req.params.cityId]
  if (!r) throw new HttpError(404, `No rasters for city "${req.params.cityId}"`)
  res.json(r)
})

router.get('/cities/:cityId/pixels', (req, res) => {
  const p = data.pixels[req.params.cityId]
  if (!p) throw new HttpError(404, `No pixel values for city "${req.params.cityId}"`)
  res.json(p)
})

module.exports = router
