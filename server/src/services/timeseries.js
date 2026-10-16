// Timeseries service: one query shape for one or many areas and parameters.
// Validates the interval against the interval catalog, each parameter's
// intervals and each area's coverage, checks the response size, then lets the
// provider select the (clipped) time window.

const { unsupportedInterval, invalidQuery } = require('../http/errors')
const { ALL } = require('../http/query')
const { getInterval, countTimes } = require('../catalog/intervals')
const { DEFAULT_TIMESERIES_MAX_VALUES } = require('../config')

/**
 * @param {import('../providers/types').DataProvider} provider
 * @param {object} services  uses resolveAreas and resolveParameters
 * @param {{timeseriesMaxValues?: number}} [options]
 */
module.exports = function timeseriesService(provider, services, options = {}) {
  const { resolveAreas, resolveParameters } = services
  const maxValues = options.timeseriesMaxValues || DEFAULT_TIMESERIES_MAX_VALUES

  // Upper bound of the number of times a response can hold: the requested
  // range clipped to the union of the areas' coverage.
  function timesUpperBound(areas, interval, from, to) {
    const covered = areas.map((a) => a.coverage).filter((c) => c.from != null && c.to != null)
    if (!covered.length) return 0
    const lo = covered.map((c) => c.from).reduce((a, b) => (b < a ? b : a))
    const hi = covered.map((c) => c.to).reduce((a, b) => (b > a ? b : a))
    return countTimes(interval, from !== undefined && from > lo ? from : lo, to !== undefined && to < hi ? to : hi)
  }

  // One query for one or many areas. `types` filters areas=* by area type.
  // Returns {data, meta} for the route.
  async function getTimeseries({ areas: requestedAreas, types, parameters: requestedParams, interval, from, to }) {
    const def = getInterval(interval)
    if (!def || !def.timeseries) throw unsupportedInterval(`Interval "${interval}" is not supported`, { interval })
    const areas = await resolveAreas(requestedAreas, { types })
    let params = await resolveParameters(requestedParams)
    // Parameters offered at other intervals only: "*" quietly means "every
    // parameter available at this interval"; one asked for by name is an error.
    if (requestedParams === ALL || requestedParams === undefined) {
      params = params.filter((p) => p.intervals.includes(interval))
    } else {
      const bad = params.find((p) => !p.intervals.includes(interval))
      if (bad) {
        throw unsupportedInterval(`Parameter "${bad.key}" has no ${interval} data`, { interval, parameter: bad.key, supported: bad.intervals })
      }
    }
    // Every requested area must offer the interval (custom areas or other
    // sources may offer different ones later).
    for (const a of areas) {
      if (!a.coverage.intervals.includes(interval)) {
        throw unsupportedInterval(`Area "${a.id}" has no ${interval} data`, { interval, areaId: a.id, supported: a.coverage.intervals })
      }
    }
    // Refuse oversized responses before asking the provider for anything.
    const requested = areas.length * params.length * timesUpperBound(areas, interval, from, to)
    if (requested > maxValues) {
      throw invalidQuery(
        `The response would hold ${requested} values (areas x parameters x times), more than the limit of ${maxValues}. ` +
          'Ask for fewer areas or parameters, or a shorter from/to range.',
        { limit: maxValues, requested },
      )
    }
    const keys = params.map((p) => p.key)
    const result = await provider.getTimeseries({ areas, parameters: keys, interval, from, to })
    const meta = {
      from: result.times[0] ?? null,
      to: result.times.at(-1) ?? null,
      count: result.times.length,
      parameters: keys,
      units: Object.fromEntries(params.map((p) => [p.key, p.unit])),
    }
    if (from !== undefined || to !== undefined) meta.requested = { from: from ?? null, to: to ?? null }
    return { data: { interval: result.interval, times: result.times, areas: result.areas }, meta }
  }

  return { getTimeseries }
}
