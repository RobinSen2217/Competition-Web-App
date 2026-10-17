// Test helpers for forecasts: a response in the forecasting module's contract
// (version 2) computed from a request (no Python needed), fake runners built
// on it, and the folder of fake Earth Engine feature tables
// (fixtures/gee: jaipur and delhi have a table, the other areas do not).

const path = require('node:path')
const { MODELS } = require('../../src/catalog/forecasts')

const GEE_FIXTURES = path.join(__dirname, '..', 'fixtures', 'gee')

// "2026-09" + 2 -> "2026-11"
function addMonths(time, n) {
  const i = Number(time.slice(0, 4)) * 12 + Number(time.slice(5, 7)) - 1 + n
  return `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`
}

// The request's column as [{ time: 'YYYY-MM', value }], in row order.
function column(req, name) {
  const di = req.columns.indexOf('date')
  const ci = req.columns.indexOf(name)
  return req.rows.map((r) => ({ time: r[di].slice(0, 7), value: ci < 0 ? null : r[ci] }))
}

// Last month with a value, or null.
function lastObserved(series) {
  for (let i = series.length - 1; i >= 0; i--) if (series[i].value !== null) return series[i].time
  return null
}

// A well-formed module response for `req`. Forecast values encode the model's
// position so tests can tell models apart: ridge 0.1, nn 0.2, gbm 0.3, ...
function fakeResponse(req) {
  const target = column(req, req.target)
  const issued = lastObserved(target)
  const forecastTimes = Array.from({ length: req.horizon }, (_, i) => addMonths(issued, i + 1))
  const ids = Object.keys(MODELS)
  const models = Object.fromEntries(req.models.map((m) => {
    const level = (ids.indexOf(m) + 1) / 10
    const hindTimes = Array.from({ length: 12 }, (_, i) => addMonths(issued, i - 11))
    return [m, {
      label: MODELS[m].label,
      forecast: forecastTimes.map(() => level),
      hindcast: { times: hindTimes, observed: hindTimes.map(() => 0.3), predicted: hindTimes.map(() => level), r2: 0.5, rmse: 0.05 },
      metrics: {
        train: { r2: 0.8, rmse: 0.03, from: '2010-03', to: '2023-04', n: 158 },
        test: { r2: 0.6, rmse: 0.04, from: '2023-05', to: issued, n: 39 },
      },
      importance: [
        { feature: 'NDVI_lag1', label: "Last month's NDVI", value: 0.4 },
        { feature: 'VPD_kPa', label: 'Vapour pressure deficit', value: 0.1 },
      ],
    }]
  }))
  return {
    version: 2,
    area: req.area.id,
    target: req.target,
    interval: req.interval,
    issued,
    forecastTimes,
    models,
    history: { times: target.map((p) => p.time), observed: target.map((p) => p.value) },
    features: [{ key: 'VPD_kPa', label: 'Vapour pressure deficit', unit: 'kPa' }],
    assumptions: ['Future weather is each calendar month\'s historical average (climatology), not a weather forecast.'],
    modelVersion: 'test',
    dataUntil: { [req.target]: issued },
    provenance: {
      pipeline: 'GEE notebook GEE_Data_Pipeline_Lat_Long_08_10_26',
      datasets: ['LANDSAT/LC08/C02/T1_L2', 'ECMWF/ERA5_LAND/MONTHLY_AGGR'],
      areaKm: `${2 * (req.area.halfWidthKm ?? 1)} × ${2 * (req.area.halfWidthKm ?? 1)} km`,
      generated: '2026-10-01T00:00:00.000Z',
    },
  }
}

// A runner that records every request and answers with `impl(request)`
// (default: fakeResponse). `delayMs` keeps runs in flight so tests can send
// concurrent requests.
function fakeRunner(impl = fakeResponse, { delayMs = 0 } = {}) {
  const runner = {
    name: 'fake',
    requests: [],
    impl,
    async run(request) {
      runner.requests.push(request)
      if (delayMs) await new Promise((r) => setTimeout(r, delayMs))
      return runner.impl(request)
    },
  }
  return runner
}

module.exports = { addMonths, fakeResponse, fakeRunner, GEE_FIXTURES }
