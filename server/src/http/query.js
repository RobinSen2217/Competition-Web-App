// Query-string parsing shared by every route, so the conventions hold everywhere:
//  - lists are comma-separated (?parameters=ndvi,rain) and repeated keys are
//    merged (?parameters=ndvi&parameters=rain is the same);
//  - "*" means "all" (returned as the ALL sentinel; the service resolves it);
//  - single values may be repeated only if every copy is identical;
//  - unknown query keys are ignored (callers simply never read them);
//  - time values are validated against the interval's format (catalog/intervals.js).
// Everything here throws 400 errors with a stable `code`; nothing knows about data.

const { invalidQuery, unsupportedInterval } = require('./errors')
const { DEFAULT_INTERVAL, getInterval, timeseriesIntervalIds } = require('../catalog/intervals')

const ALL = '*'

// Raw values for a key as an array of strings (Express gives a string or an array).
const rawValues = (query, name) => (query[name] === undefined ? [] : [].concat(query[name]).map(String))

// Comma-separated list. Returns undefined when absent, ALL for "*", otherwise
// the unique trimmed items in request order.
function listParam(query, name, { required = false } = {}) {
  const raw = rawValues(query, name)
  if (raw.length === 0) {
    if (required) throw invalidQuery(`"${name}" is required (a comma-separated list, or "*" for all)`, { parameter: name })
    return undefined
  }
  const items = [...new Set(raw.join(',').split(',').map((s) => s.trim()).filter(Boolean))]
  if (items.length === 0) throw invalidQuery(`"${name}" is empty. Give a comma-separated list or "*" for all.`, { parameter: name })
  return items.includes(ALL) ? ALL : items
}

// One value. Repeats are allowed only when they agree, so a merged query string
// never silently picks one of two different answers.
function singleParam(query, name) {
  const raw = [...new Set(rawValues(query, name).map((s) => s.trim()))]
  if (raw.length === 0 || (raw.length === 1 && raw[0] === '')) return undefined
  if (raw.length > 1) throw invalidQuery(`"${name}" was given more than once with different values`, { parameter: name, values: raw })
  return raw[0]
}

// ?interval=..., checked against the intervals /timeseries offers. `supported`
// replaces that list (e.g. with what an area actually has).
function intervalParam(query, supported = timeseriesIntervalIds()) {
  const id = singleParam(query, 'interval') || DEFAULT_INTERVAL
  if (!getInterval(id) || !supported.includes(id)) {
    throw unsupportedInterval(`Interval "${id}" is not supported`, { interval: id, supported })
  }
  return id
}

// Checks that `value` (from query key `name`) is written in the interval's
// format (e.g. monthly "YYYY-MM", yearly "YYYY"). Shared by query parsing and
// by services that only learn the interval later (a layer's ?time).
function checkTime(name, value, intervalId) {
  const interval = getInterval(intervalId)
  if (!interval.pattern.test(value)) {
    throw invalidQuery(`"${name}" must be ${interval.format} for ${interval.id} data, got "${value}"`, {
      parameter: name, format: interval.format, example: interval.example,
    })
  }
  return value
}

// A time value in the interval's format, or undefined when absent.
function timeParam(query, name, intervalId) {
  const v = singleParam(query, name)
  return v === undefined ? undefined : checkTime(name, v, intervalId)
}

// Inclusive from/to range; either end optional.
function rangeParams(query, intervalId) {
  const from = timeParam(query, 'from', intervalId)
  const to = timeParam(query, 'to', intervalId)
  if (from !== undefined && to !== undefined && from > to) {
    throw invalidQuery(`"from" (${from}) is after "to" (${to})`, { from, to })
  }
  return { from, to }
}

// ?include=a,b: optional extras of a resource. Returns a Set of the requested
// names ("*" = all allowed); an unknown name is a 400 so typos are not ignored.
function includeParam(query, allowed) {
  const list = listParam(query, 'include')
  if (list === undefined) return new Set()
  if (list === ALL) return new Set(allowed)
  const unknown = list.filter((v) => !allowed.includes(v))
  if (unknown.length) throw invalidQuery(`Unknown include value(s): ${unknown.join(', ')}`, { unknown, allowed })
  return new Set(list)
}

module.exports = { ALL, listParam, singleParam, intervalParam, checkTime, timeParam, rangeParams, includeParam }
