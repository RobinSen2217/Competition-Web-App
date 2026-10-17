// The real forecasting module (server/ml) end to end on the FAKE Earth Engine
// tables in fixtures/gee, when its Python environment exists and speaks
// contract version 2 (skipped otherwise; set it up as in README "Forecasts").
// Kept small (one model, a short horizon) because it trains real models.

const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { startServer, assertOk } = require('./support/server')
const { GEE_FIXTURES } = require('./support/forecast')
const { createProcessRunner, DEFAULT_PYTHON, ML_DIR } = require('../src/forecast/runner')
const { parseTable } = require('../src/forecast/tables')

// Ready = the venv's python exists and has the package at contract version 2.
const ready = fs.existsSync(DEFAULT_PYTHON) &&
  spawnSync(DEFAULT_PYTHON, ['-c', 'import sys, forecaster.contract as c; sys.exit(0 if c.VERSION == 2 else 1)'], { cwd: ML_DIR }).status === 0
const skip = !ready && 'server/ml/.venv with the forecaster package (contract v2) not found'

const table = (id) => parseTable(fs.readFileSync(path.join(GEE_FIXTURES, `${id}.features.csv`), 'utf8'), id)

let srv
before(async () => {
  if (skip) return
  srv = await startServer({
    config: { corsOrigins: '*', dataProvider: 'files', forecastMode: 'live' },
    forecastRunner: createProcessRunner({ timeoutMs: 180000 }),
    forecastSnapshotDir: fs.mkdtempSync(path.join(os.tmpdir(), 'forecast-it-')),
    forecastTablesDir: GEE_FIXTURES,
  })
})
after(() => srv && srv.close())

test('the real module forecasts Jaipur NDVI from its Earth Engine table through the API', { skip, timeout: 240000 }, async () => {
  const res = await srv.get('/api/v1/areas/jaipur/forecasts?parameters=ndvi&horizon=3&models=ridge')
  const data = assertOk(res)
  assert.equal(data.source, 'live')
  assert.equal(data.area, 'jaipur')
  assert.equal(data.target, 'ndvi')
  assert.match(data.issued, /^\d{4}-\d{2}$/)
  assert.equal(data.forecastTimes.length, 3)
  assert.ok(data.forecastTimes[0] > data.issued)
  const ridge = data.models.ridge
  assert.equal(ridge.forecast.length, 3)
  for (const v of ridge.forecast) assert.ok(Number.isFinite(v) && v > -1 && v < 1, `NDVI ${v}`)
  assert.equal(ridge.hindcast.times.length, ridge.hindcast.predicted.length)
  for (const split of ['train', 'test']) {
    for (const k of ['r2', 'rmse', 'from', 'to', 'n']) assert.ok(k in ridge.metrics[split], `${split}.${k}`)
  }
  assert.ok(ridge.importance.length > 0)
  assert.ok(Array.isArray(data.features) && Array.isArray(data.assumptions))
  assert.equal(data.modelVersion, 'gee-notebook-2026-10-08')

  // The observed series is the table's NDVI column, month by month
  const t = table('jaipur')
  const di = t.columns.indexOf('date')
  const ni = t.columns.indexOf('NDVI')
  assert.deepEqual(data.history.times, t.rows.map((r) => r[di].slice(0, 7)))
  // (the module may round its output, so values match to 1e-5)
  t.rows.forEach((r, i) => {
    const got = data.history.observed[i]
    if (r[ni] === null) assert.equal(got, null, `history ${i}`)
    else assert.ok(Math.abs(got - r[ni]) < 1e-5, `history ${i}: ${got} vs ${r[ni]}`)
  })

  assert.equal(data.provenance.pipeline, 'GEE notebook GEE_Data_Pipeline_Lat_Long_08_10_26')
  assert.equal(data.provenance.areaKm, '2 × 2 km')
  assert.ok(data.provenance.datasets.includes('ECMWF/ERA5_LAND/MONTHLY_AGGR'))
  assert.ok(data.provenance.datasets.some((d) => d.startsWith('LANDSAT/')))
  assert.ok(!Number.isNaN(Date.parse(data.provenance.generated)))
})

test('the real module is deterministic', { skip, timeout: 240000 }, async () => {
  // Bypasses the API cache: two separate processes must agree exactly
  // (apart from when they ran).
  const runner = createProcessRunner({ timeoutMs: 180000 })
  const areas = JSON.parse(fs.readFileSync(path.join(GEE_FIXTURES, 'areas.json'), 'utf8'))
  const cfg = areas.find((a) => a.id === 'delhi')
  const req = {
    version: 2, area: { id: 'delhi', name: cfg.name, center: { lat: cfg.lat, lon: cfg.lon }, halfWidthKm: cfg.halfWidthKm },
    interval: 'monthly', ...table('delhi'), target: 'NDVI', horizon: 2, models: ['ridge'], options: { testFraction: 0.2, seed: 42, lags: 2 },
  }
  const [a, b] = await Promise.all([runner.run(req), runner.run(req)])
  const strip = (r) => ({ ...r, provenance: { ...r.provenance, generated: null } })
  assert.deepEqual(strip(a), strip(b))
})
