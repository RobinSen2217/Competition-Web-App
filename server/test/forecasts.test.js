// GET /areas/:areaId/forecasts with a fake forecasting module (no Python) and
// the fake Earth Engine tables in fixtures/gee (jaipur and delhi have one, the
// other areas have not been "extracted"): query validation, the request sent to
// the module, caching, areas without a table, snapshot mode and fallback, and
// how module failures map to HTTP errors. The process runner itself:
// forecast-runner.test.js. The real module: forecast-integration.test.js.

const { test, describe, before, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { startServer, assertError, assertOk } = require('./support/server')
const { fakeRunner, fakeResponse, GEE_FIXTURES } = require('./support/forecast')
const { RunnerError, createProcessRunner } = require('../src/forecast/runner')
const { writeSnapshot } = require('../src/forecast/snapshots')
const { parseTable } = require('../src/forecast/tables')
const { TARGETS } = require('../src/catalog/forecasts')

const CONFIG = { corsOrigins: '*', dataProvider: 'files', forecastMode: 'live' }
const URL = '/api/v1/areas/jaipur/forecasts'
const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'forecast-test-'))
const fixtureText = (id) => fs.readFileSync(path.join(GEE_FIXTURES, `${id}.features.csv`), 'utf8')
const fixtureTable = (id) => parseTable(fixtureText(id), id)
const fixtureAreas = JSON.parse(fs.readFileSync(path.join(GEE_FIXTURES, 'areas.json'), 'utf8'))
// Areas with a fake table, and some without one ("not extracted yet").
const WITH_TABLE = ['jaipur', 'delhi']
const WITHOUT_TABLE = fixtureAreas.map((a) => a.id).filter((id) => !WITH_TABLE.includes(id))

// A copy of the fixture tables the test may change.
function tablesCopy() {
  const dir = tmpDir()
  for (const f of fs.readdirSync(GEE_FIXTURES)) if (/\.(csv|json)$/.test(f)) fs.copyFileSync(path.join(GEE_FIXTURES, f), path.join(dir, f))
  return dir
}

// Saves a snapshot for `areaId` the way the build script does: a full API
// response for the longest horizon (24) and every model, computed from a
// table (jaipur's, for an area that has none).
function saveSnapshot(dir, areaId, { horizon = 24, models = ['ridge', 'nn', 'gbm'], provenance = true } = {}) {
  const table = fixtureTable(WITH_TABLE.includes(areaId) ? areaId : 'jaipur')
  const req = { area: { id: areaId, halfWidthKm: 1 }, target: 'NDVI', interval: 'monthly', horizon, models, ...table }
  // eslint-disable-next-line no-unused-vars
  const { version, provenance: prov, ...data } = fakeResponse(req)
  writeSnapshot([dir], areaId, 'ndvi', {
    data: { ...data, ...(provenance ? { provenance: prov } : {}), target: 'ndvi', source: 'snapshot' },
    meta: { parameters: ['ndvi'], horizon, models, units: { ndvi: '' }, generated: '2026-10-01T00:00:00.000Z', dataUpdated: '2026-09-30T00:00:00.000Z' },
  })
}

// A server with a fresh fake runner, an empty snapshot folder and the fixture tables.
async function withServer(fn, { runner = fakeRunner(), config = CONFIG, provider, snapshots = tmpDir(), tables = GEE_FIXTURES } = {}) {
  const srv = await startServer({ config, provider, forecastRunner: runner, forecastSnapshotDir: snapshots, forecastTablesDir: tables })
  try {
    await fn(srv, runner, snapshots)
  } finally {
    await srv.close()
  }
}

describe('forecasts: live', () => {
  let srv, runner
  before(async () => {
    runner = fakeRunner()
    srv = await startServer({ config: CONFIG, forecastRunner: runner, forecastSnapshotDir: tmpDir(), forecastTablesDir: GEE_FIXTURES })
  })
  after(() => srv.close())

  test('returns the module response with source, meta and cache headers', async () => {
    const res = await srv.get(`${URL}?parameters=ndvi&horizon=12&models=ridge,nn,gbm`)
    const data = assertOk(res)
    assert.equal(res.headers.get('cache-control'), 'public, max-age=300')
    assert.equal(data.source, 'live')
    assert.equal(data.area, 'jaipur')
    assert.equal(data.target, 'ndvi')
    assert.equal(data.interval, 'monthly')
    assert.equal(data.version, undefined, 'the module protocol version is not part of the resource')
    assert.deepEqual(Object.keys(data.models), ['ridge', 'nn', 'gbm'])
    assert.equal(data.forecastTimes.length, 12)
    for (const m of Object.values(data.models)) {
      assert.equal(m.forecast.length, 12)
      for (const k of ['label', 'hindcast', 'metrics', 'importance']) assert.ok(k in m, k)
    }
    for (const k of ['issued', 'features', 'assumptions', 'modelVersion', 'dataUntil', 'history', 'provenance']) assert.ok(k in data, k)
    const meta = res.body.meta
    assert.deepEqual(meta.parameters, ['ndvi'])
    assert.equal(meta.horizon, 12)
    assert.deepEqual(meta.models, ['ridge', 'nn', 'gbm'])
    assert.deepEqual(meta.units, { ndvi: '' })
    assert.ok(!Number.isNaN(Date.parse(meta.generated)))
    // The table's version (its file time), not the site's data
    assert.equal(meta.dataUpdated, fs.statSync(path.join(GEE_FIXTURES, 'jaipur.features.csv')).mtime.toISOString())
  })

  test('sends the area\'s Earth Engine table to the module (contract v2)', async () => {
    runner.requests.length = 0
    assertOk(await srv.get(`${URL}?parameters=ndvi&horizon=6&models=gbm`))
    assert.equal(runner.requests.length, 1)
    const req = runner.requests[0]
    const cfg = fixtureAreas.find((a) => a.id === 'jaipur')
    assert.equal(req.version, 2)
    assert.deepEqual(req.area, { id: 'jaipur', name: cfg.name, center: { lat: cfg.lat, lon: cfg.lon }, halfWidthKm: 1 })
    assert.equal(req.interval, 'monthly')
    assert.equal(req.target, 'NDVI', 'the table column, not the API key')
    assert.equal(req.horizon, 6)
    assert.deepEqual(req.models, ['gbm'])
    assert.deepEqual(req.options, { testFraction: 0.2, seed: 42, lags: 2 })
    // The notebook's columns as they are in the file, every month, blanks as null
    const header = fixtureText('jaipur').split('\n')[0].split(',')
    assert.deepEqual(req.columns, header)
    assert.equal(req.rows.length, 201)
    const date = header.indexOf('date')
    assert.equal(req.rows[0][date], '2010-01-01')
    assert.equal(req.rows.at(-1)[date], '2026-09-01')
    for (const row of req.rows) {
      assert.equal(row.length, header.length)
      row.forEach((v, i) => assert.ok(i === date ? /^\d{4}-\d{2}-01$/.test(v) : v === null || Number.isFinite(v), `${header[i]}: ${v}`))
    }
    assert.equal(req.rows[0][header.indexOf('UV_Aerosol_Index')], null, 'Sentinel-5P starts in 2018')
    assert.deepEqual(req.rows, fixtureTable('jaipur').rows)
  })

  test('the API names the target by its parameter key; history comes from the table', async () => {
    const data = assertOk(await srv.get(`${URL}?horizon=3&models=ridge`))
    assert.equal(data.target, 'ndvi')
    assert.equal(data.history.times.length, 201)
    assert.equal(data.history.times[0], '2010-01')
    // The fixture's last months have no Landsat NDVI (monsoon clouds): the
    // forecast is issued from the last month that has one
    assert.equal(data.history.observed.at(-1), null)
    const last = data.history.observed.findLastIndex((v) => v !== null)
    assert.equal(data.issued, data.history.times[last])
    assert.ok(data.issued < '2026-09')
    assert.equal(data.provenance.areaKm, '2 × 2 km')
  })

  test('defaults: ndvi, monthly, 12 months, every model', async () => {
    const res = await srv.get(URL)
    const data = assertOk(res)
    assert.equal(data.target, 'ndvi')
    assert.equal(data.forecastTimes.length, 12)
    assert.deepEqual(Object.keys(data.models), ['ridge', 'nn', 'gbm'])
    assert.deepEqual(Object.keys(assertOk(await srv.get(`${URL}?models=*`)).models), ['ridge', 'nn', 'gbm'])
  })

  test('models come back in catalog order and share one cache entry', async () => {
    runner.requests.length = 0
    const a = assertOk(await srv.get(`${URL}?horizon=3&models=gbm,ridge`))
    const b = assertOk(await srv.get(`${URL}?horizon=3&models=ridge&models=gbm`))
    assert.deepEqual(Object.keys(a.models), ['ridge', 'gbm'])
    assert.deepEqual(a, b)
    assert.equal(runner.requests.length, 1)
  })

  test('validation errors', async () => {
    const cases = [
      ['?parameters=ndvi,rain', 400, 'invalid_query'],
      ['?parameters=*', 400, 'invalid_query'],
      ['?parameters=', 400, 'invalid_query'],
      ['?parameters=rain', 400, 'invalid_parameter'],
      ['?parameters=bogus', 400, 'invalid_parameter'],
      ['?horizon=0', 400, 'invalid_query'],
      ['?horizon=25', 400, 'invalid_query'],
      ['?horizon=abc', 400, 'invalid_query'],
      ['?horizon=1.5', 400, 'invalid_query'],
      ['?horizon=6&horizon=7', 400, 'invalid_query'],
      ['?models=ridge,xgboost', 400, 'invalid_query'],
      ['?interval=daily', 400, 'unsupported_interval'],
      ['?interval=yearly', 400, 'unsupported_interval'],
    ]
    for (const [q, status, code] of cases) assertError(await srv.get(URL + q), status, code)
    const rain = (await srv.get(`${URL}?parameters=rain`)).body.error
    assert.deepEqual(rain.details, { unforecastable: ['rain'], valid: ['ndvi'] })
    const bogus = (await srv.get(`${URL}?parameters=bogus`)).body.error
    assert.deepEqual(bogus.details.unknown, ['bogus'])
    const models = (await srv.get(`${URL}?models=ridge,xgboost`)).body.error
    assert.deepEqual(models.details, { parameter: 'models', unknown: ['xgboost'], allowed: ['ridge', 'nn', 'gbm'] })
    assert.deepEqual((await srv.get(`${URL}?horizon=99`)).body.error.details, { parameter: 'horizon', min: 1, max: 24 })
  })

  test('unknown area is 404 and never reaches the module', async () => {
    runner.requests.length = 0
    assertError(await srv.get('/api/v1/areas/atlantis/forecasts'), 404, 'not_found')
    assert.equal(runner.requests.length, 0)
  })

  test('only GET and HEAD', async () => {
    const res = await srv.get(URL, { method: 'POST' })
    assertError(res, 405, 'method_not_allowed')
    assert.equal(res.headers.get('allow'), 'GET, HEAD')
  })

  test('every area with a table can be forecast', async () => {
    for (const id of WITH_TABLE) {
      const data = assertOk(await srv.get(`/api/v1/areas/${id}/forecasts?horizon=2&models=ridge`))
      assert.equal(data.area, id)
    }
  })

  test('an area whose table has not been extracted is 503 no_gee_data, without running the module', async () => {
    runner.requests.length = 0
    for (const id of WITHOUT_TABLE) {
      const res = await srv.get(`/api/v1/areas/${id}/forecasts`)
      assertError(res, 503, 'forecast_unavailable')
      assert.match(res.body.error.message, /Earth Engine data for area ".+" has not been extracted yet/)
      assert.deepEqual(res.body.error.details, { areaId: id, parameter: 'ndvi', reason: 'no_gee_data', saved: null })
    }
    assert.equal(runner.requests.length, 0)
  })
})

describe('forecasts: caching', () => {
  test('a repeated request does not run the module again; another question does', async () => {
    await withServer(async (srv, runner) => {
      assertOk(await srv.get(`${URL}?horizon=12`))
      assertOk(await srv.get(`${URL}?horizon=12`))
      assert.equal(runner.requests.length, 1)
      assertOk(await srv.get(`${URL}?horizon=6`))
      assertOk(await srv.get('/api/v1/areas/delhi/forecasts?horizon=12'))
      assert.equal(runner.requests.length, 3)
    })
  })

  test('concurrent identical requests share one run', async () => {
    await withServer(async (srv, runner) => {
      const results = await Promise.all(Array.from({ length: 5 }, () => srv.get(`${URL}?horizon=4`)))
      for (const r of results) assertOk(r)
      assert.equal(runner.requests.length, 1)
    }, { runner: fakeRunner(undefined, { delayMs: 100 }) })
  })

  test('a new extraction (the table file changes) runs the module again', async () => {
    const tables = tablesCopy()
    const file = path.join(tables, 'jaipur.features.csv')
    await withServer(async (srv, runner) => {
      assertOk(await srv.get(URL))
      assertOk(await srv.get(URL))
      assert.equal(runner.requests.length, 1)
      const later = new Date('2026-11-01T00:00:00.000Z')
      fs.utimesSync(file, later, later)
      const res = await srv.get(URL)
      assertOk(res)
      assert.equal(runner.requests.length, 2)
      assert.equal(res.body.meta.dataUpdated, later.toISOString())
    }, { tables })
  })

  test('a table extracted after the first request is picked up without a restart', async () => {
    const tables = tablesCopy()
    await withServer(async (srv) => {
      assertError(await srv.get('/api/v1/areas/udaipur/forecasts'), 503, 'forecast_unavailable')
      fs.copyFileSync(path.join(GEE_FIXTURES, 'jaipur.features.csv'), path.join(tables, 'udaipur.features.csv'))
      assert.equal(assertOk(await srv.get('/api/v1/areas/udaipur/forecasts')).source, 'live')
    }, { tables })
  })

  test('failures are not cached', async () => {
    const runner = fakeRunner(() => { throw new RunnerError('model_failure', 'boom') })
    await withServer(async (srv) => {
      assertError(await srv.get(URL), 502, 'model_failure')
      runner.impl = fakeResponse
      assertOk(await srv.get(URL))
      assert.equal(runner.requests.length, 2)
    }, { runner })
  })
})

describe('forecasts: module failures', () => {
  const failing = (code) => fakeRunner(() => { throw new RunnerError(code, `secret /path/to/python ${code}`) })

  for (const [code, status, apiCode] of [
    ['unavailable', 503, 'forecast_unavailable'],
    ['timeout', 503, 'forecast_unavailable'],
    ['model_failure', 502, 'model_failure'],
  ]) {
    test(`runner ${code} without a snapshot is ${status} ${apiCode}`, async () => {
      await withServer(async (srv) => {
        const res = await srv.get(URL)
        assertError(res, status, apiCode)
        assert.doesNotMatch(res.body.error.message, /secret/, 'module internals stay in the server log')
        assert.deepEqual(res.body.error.details, { areaId: 'jaipur', parameter: 'ndvi', saved: null })
      }, { runner: failing(code) })
    })
  }

  test('runner invalid_input without a snapshot is 422 insufficient_data with the module reason', async () => {
    await withServer(async (srv) => {
      const res = await srv.get(URL)
      assertError(res, 422, 'insufficient_data')
      assert.match(res.body.error.message, /invalid_input/)
      assert.deepEqual(res.body.error.details, { areaId: 'jaipur', parameter: 'ndvi', saved: null })
    }, { runner: failing('invalid_input') })
  })

  test('the real process runner: a module exiting 2 is 422 insufficient_data with its message', async () => {
    // The stand-in module (support/fake-forecaster.js) refuses with exit 2.
    const runner = createProcessRunner({ command: process.execPath, args: [path.join(__dirname, 'support', 'fake-forecaster.js'), 'too-few'], cwd: __dirname })
    await withServer(async (srv) => {
      const res = await srv.get(`${URL}?horizon=6`)
      assertError(res, 422, 'insufficient_data')
      assert.match(res.body.error.message, /^Cannot forecast "ndvi" for area "jaipur": Only 20 month\(s\) have every input/)
      assert.deepEqual(res.body.error.details, { areaId: 'jaipur', parameter: 'ndvi', saved: null })
    }, { runner })
  })

  test('a response that does not match the request is a model failure', async () => {
    const runner = fakeRunner((req) => ({ ...fakeResponse(req), forecastTimes: [] }))
    await withServer(async (srv) => assertError(await srv.get(URL), 502, 'model_failure'), { runner })
  })

  test('a runner that throws something else is a 500', async () => {
    const runner = fakeRunner(() => { throw new TypeError('bug') })
    await withServer(async (srv) => assertError(await srv.get(URL), 500, 'internal_error'), { runner })
  })

  test('no runner at all is 503 forecast_unavailable', async () => {
    await withServer(async (srv) => assertError(await srv.get(URL), 503, 'forecast_unavailable'), { runner: null })
  })

  test('a table with too few NDVI months is 422 insufficient_data, without running the module', async () => {
    const tables = tablesCopy()
    // Keep NDVI in the first 10 rows only (e.g. a box Landsat almost never sees clear)
    const [head, ...lines] = fixtureText('jaipur').trim().split('\n')
    const ni = head.split(',').indexOf('NDVI')
    const thinned = lines.map((l, i) => l.split(',').map((c, j) => (j === ni && i >= 10 ? '' : c)).join(','))
    const observed = thinned.filter((l) => l.split(',')[ni] !== '').length
    fs.writeFileSync(path.join(tables, 'jaipur.features.csv'), [head, ...thinned].join('\n') + '\n')
    await withServer(async (srv, runner) => {
      const res = await srv.get(URL)
      assertError(res, 422, 'insufficient_data')
      assert.deepEqual(res.body.error.details, { areaId: 'jaipur', parameter: 'ndvi', observed, required: TARGETS.ndvi.minObserved })
      assert.ok(observed > 0 && observed <= 10)
      assert.equal(runner.requests.length, 0)
    }, { tables })
  })

  test('a malformed table is a 500 (a broken deployment), not "no data"', async () => {
    const tables = tablesCopy()
    fs.writeFileSync(path.join(tables, 'jaipur.features.csv'), 'NDVI,AirTemp_C\n0.2,30\n')
    await withServer(async (srv, runner) => {
      assertError(await srv.get(URL), 500, 'internal_error')
      assert.equal(runner.requests.length, 0)
    }, { tables })
  })
})

describe('forecasts: snapshots', () => {
  test('live mode falls back to a matching snapshot when the module fails', async () => {
    const snapshots = tmpDir()
    saveSnapshot(snapshots, 'jaipur')
    const runner = fakeRunner(() => { throw new RunnerError('unavailable', 'no python') })
    await withServer(async (srv) => {
      const res = await srv.get(`${URL}?horizon=6&models=nn,gbm`)
      const data = assertOk(res)
      assert.equal(data.source, 'snapshot')
      assert.equal(data.forecastTimes.length, 6)
      assert.deepEqual(Object.keys(data.models), ['nn', 'gbm'])
      assert.equal(data.models.nn.forecast.length, 6)
      assert.equal(res.body.meta.fallback, 'unavailable')
      assert.equal(res.body.meta.generated, '2026-10-01T00:00:00.000Z')
      assert.equal(res.body.meta.horizon, 6)
    }, { runner, snapshots })
  })

  test('a request an (older, shorter) snapshot cannot answer still fails, with what is saved', async () => {
    const snapshots = tmpDir()
    saveSnapshot(snapshots, 'jaipur', { horizon: 12 })
    const runner = fakeRunner(() => { throw new RunnerError('unavailable', 'no python') })
    await withServer(async (srv) => {
      const more = await srv.get(`${URL}?horizon=18`)
      assertError(more, 503, 'forecast_unavailable')
      assert.deepEqual(more.body.error.details.saved, { horizon: 12, models: ['ridge', 'nn', 'gbm'] })
    }, { runner, snapshots })
  })

  test('a snapshot built like forecasts:build (24 months) answers every valid horizon', async () => {
    const snapshots = tmpDir()
    saveSnapshot(snapshots, 'jaipur')
    await withServer(async (srv) => {
      for (const h of [1, 12, 24]) {
        const res = await srv.get(`${URL}?horizon=${h}&models=gbm`)
        const data = assertOk(res)
        assert.equal(data.source, 'snapshot')
        assert.equal(data.forecastTimes.length, h)
        assert.deepEqual(Object.keys(data.models), ['gbm'])
        assert.equal(data.models.gbm.forecast.length, h)
        assert.equal(res.body.meta.horizon, h)
        assert.deepEqual(res.body.meta.models, ['gbm'])
      }
    }, { snapshots, config: { ...CONFIG, forecastMode: 'snapshot' } })
  })

  test('snapshot mode never runs the module', async () => {
    const snapshots = tmpDir()
    saveSnapshot(snapshots, 'jaipur', { horizon: 12, models: ['ridge', 'gbm'] })
    await withServer(async (srv, runner) => {
      const res = await srv.get(`${URL}?models=ridge`)
      const data = assertOk(res)
      assert.equal(data.source, 'snapshot')
      assert.deepEqual(Object.keys(data.models), ['ridge'])
      assert.equal(res.body.meta.fallback, undefined)
      assertError(await srv.get(`${URL}?models=nn`), 503, 'forecast_unavailable')
      assertError(await srv.get(`${URL}?horizon=13`), 503, 'forecast_unavailable')
      const none = await srv.get('/api/v1/areas/delhi/forecasts')
      assertError(none, 503, 'forecast_unavailable')
      assert.match(none.body.error.message, /FORECAST_MODE=snapshot/)
      // Neither a snapshot nor a table: the area simply has not been extracted
      const fresh = await srv.get('/api/v1/areas/udaipur/forecasts')
      assertError(fresh, 503, 'forecast_unavailable')
      assert.equal(fresh.body.error.details.reason, 'no_gee_data')
      assert.equal(runner.requests.length, 0)
    }, { snapshots, config: { ...CONFIG, forecastMode: 'snapshot' } })
  })

  test('an area without a table is answered from its snapshot when there is one', async () => {
    const snapshots = tmpDir()
    saveSnapshot(snapshots, 'udaipur')
    await withServer(async (srv, runner) => {
      const res = await srv.get('/api/v1/areas/udaipur/forecasts?horizon=6')
      assert.equal(assertOk(res).source, 'snapshot')
      assert.equal(res.body.meta.fallback, 'no_gee_data')
      assert.equal(runner.requests.length, 0)
    }, { snapshots })
  })

  test('a snapshot from before the Earth Engine pipeline (no provenance) is ignored', async () => {
    const snapshots = tmpDir()
    saveSnapshot(snapshots, 'jaipur', { provenance: false })
    saveSnapshot(snapshots, 'udaipur', { provenance: false })
    await withServer(async (srv) => {
      assertError(await srv.get(URL), 503, 'forecast_unavailable')
      const res = await srv.get('/api/v1/areas/udaipur/forecasts')
      assertError(res, 503, 'forecast_unavailable')
      assert.equal(res.body.error.details.reason, 'no_gee_data')
    }, { snapshots, config: { ...CONFIG, forecastMode: 'snapshot' } })
  })

  test('the app does not create a Python runner in snapshot mode', async () => {
    const snapshots = tmpDir()
    saveSnapshot(snapshots, 'jaipur')
    const srv = await startServer({ config: { ...CONFIG, forecastMode: 'snapshot' }, forecastSnapshotDir: snapshots })
    try {
      assert.equal(assertOk(await srv.get(URL)).source, 'snapshot')
    } finally {
      await srv.close()
    }
  })

  test('a broken snapshot file is ignored, not a 500', async () => {
    const snapshots = tmpDir()
    fs.writeFileSync(path.join(snapshots, 'jaipur.ndvi.json'), '{ not json')
    await withServer(async (srv) => {
      assertError(await srv.get(URL), 503, 'forecast_unavailable')
    }, { snapshots, config: { ...CONFIG, forecastMode: 'snapshot' } })
  })

  test('validation still comes first in snapshot mode', async () => {
    await withServer(async (srv) => {
      assertError(await srv.get(`${URL}?horizon=0`), 400, 'invalid_query')
      assertError(await srv.get('/api/v1/areas/atlantis/forecasts'), 404, 'not_found')
    }, { config: { ...CONFIG, forecastMode: 'snapshot' } })
  })
})

describe('forecasts: remembered failures', () => {
  const failing = (code) => fakeRunner(() => { throw new RunnerError(code, code) })

  for (const code of ['unavailable', 'timeout']) {
    test(`after a run fails with ${code}, the same request goes straight to the snapshot`, async () => {
      const snapshots = tmpDir()
      saveSnapshot(snapshots, 'jaipur')
      await withServer(async (srv, runner) => {
        for (let i = 0; i < 3; i++) {
          const res = await srv.get(`${URL}?horizon=6`)
          assert.equal(assertOk(res).source, 'snapshot')
          assert.equal(res.body.meta.fallback, code)
        }
        assert.equal(runner.requests.length, 1)
        // Another area or query is tried on its own.
        assertOk(await srv.get(`${URL}?horizon=7`))
        assertError(await srv.get('/api/v1/areas/delhi/forecasts'), 503, 'forecast_unavailable')
        assert.equal(runner.requests.length, 3)
      }, { runner: failing(code), snapshots })
    })
  }

  test('without a snapshot the remembered failure answers with the same error, without a run', async () => {
    await withServer(async (srv, runner) => {
      assertError(await srv.get(URL), 503, 'forecast_unavailable')
      assertError(await srv.get(URL), 503, 'forecast_unavailable')
      assert.equal(runner.requests.length, 1)
    }, { runner: failing('timeout') })
  })

  test('the module is tried again once the window has passed', async () => {
    const runner = failing('unavailable')
    await withServer(async (srv) => {
      assertError(await srv.get(URL), 503, 'forecast_unavailable')
      assertError(await srv.get(URL), 503, 'forecast_unavailable')
      assert.equal(runner.requests.length, 1)
      await new Promise((r) => setTimeout(r, 200))
      runner.impl = fakeResponse
      assert.equal(assertOk(await srv.get(URL)).source, 'live')
      assert.equal(runner.requests.length, 2)
    }, { runner, config: { ...CONFIG, forecastRetryAfterMs: 150 } })
  })

  test('model failures and refusals are not remembered; 0 turns remembering off', async () => {
    await withServer(async (srv, runner) => {
      assertError(await srv.get(URL), 502, 'model_failure')
      assertError(await srv.get(URL), 502, 'model_failure')
      assert.equal(runner.requests.length, 2)
    }, { runner: failing('model_failure') })
    await withServer(async (srv, runner) => {
      assertError(await srv.get(URL), 422, 'insufficient_data')
      assertError(await srv.get(URL), 422, 'insufficient_data')
      assert.equal(runner.requests.length, 2)
    }, { runner: failing('invalid_input') })
    await withServer(async (srv, runner) => {
      assertError(await srv.get(URL), 503, 'forecast_unavailable')
      assertError(await srv.get(URL), 503, 'forecast_unavailable')
      assert.equal(runner.requests.length, 2)
    }, { runner: failing('unavailable'), config: { ...CONFIG, forecastRetryAfterMs: 0 } })
  })
})

describe('forecasts: config', () => {
  const { loadConfig } = require('../src/config')
  test('FORECAST_* settings', () => {
    assert.deepEqual(
      (({ forecastMode, forecastPython, forecastTimeoutMs }) => ({ forecastMode, forecastPython, forecastTimeoutMs }))(loadConfig({})),
      { forecastMode: 'live', forecastPython: undefined, forecastTimeoutMs: 60000 },
    )
    assert.equal(loadConfig({}).forecastRetryAfterMs, 60000)
    assert.equal(loadConfig({ FORECAST_RETRY_AFTER_MS: '0' }).forecastRetryAfterMs, 0)
    assert.equal(loadConfig({ FORECAST_RETRY_AFTER_MS: '2500' }).forecastRetryAfterMs, 2500)
    assert.equal(loadConfig({ FORECAST_RETRY_AFTER_MS: 'soon' }).forecastRetryAfterMs, 60000)
    assert.equal(loadConfig({}).geeProject, 'miicproject2')
    assert.equal(loadConfig({}).geeServiceAccountKey, undefined)
    assert.equal(loadConfig({ GEE_PROJECT: ' other ', GEE_SERVICE_ACCOUNT_KEY: 'secrets/key.json' }).geeProject, 'other')
    assert.equal(loadConfig({ GEE_SERVICE_ACCOUNT_KEY: 'secrets/key.json' }).geeServiceAccountKey, 'secrets/key.json')
    const c = loadConfig({ FORECAST_MODE: 'Snapshot', FORECAST_PYTHON: '/opt/py', FORECAST_TIMEOUT_MS: '5000' })
    assert.equal(c.forecastMode, 'snapshot')
    assert.equal(c.forecastPython, '/opt/py')
    assert.equal(c.forecastTimeoutMs, 5000)
    assert.throws(() => loadConfig({ FORECAST_MODE: 'offline' }), /FORECAST_MODE/)
  })
})
