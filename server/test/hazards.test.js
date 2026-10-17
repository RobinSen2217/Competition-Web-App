// End-to-end tests of the hazard endpoints (/api/v1/hazards...): envelopes,
// filters, the daily series and irregular observations, the forecast / danger
// classification, the event map layers and their images, errors and HTTP
// conventions. They read the committed flood
// dataset (server/data/hazards/flood, written by server/ml; its numbers are
// checked against the notebook there) and cross-check the API against those
// files, plus a temporary hazards folder for the "not built yet" cases.

const { test, before, after, describe } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const http = require('node:http')
const os = require('node:os')
const path = require('node:path')
const { startServer, assertError, assertOk, DATA } = require('./support/server')
const { parseCsv } = require('../src/util/csv')
const flood = require('../src/catalog/hazards/flood')

const FLOOD_DIR = path.join(DATA, 'hazards', 'flood')
const manifest = JSON.parse(fs.readFileSync(path.join(FLOOD_DIR, 'events.json'), 'utf8'))
const layersFile = JSON.parse(fs.readFileSync(path.join(FLOOD_DIR, 'layers.json'), 'utf8'))
const snapshot = JSON.parse(fs.readFileSync(path.join(FLOOD_DIR, 'model', 'forecast.json'), 'utf8'))
const EVENT_IDS = manifest.events.map((e) => e.id)
const URL = '/api/v1/hazards/flood'

function readTable(rel) {
  const [header, ...rows] = parseCsv(fs.readFileSync(path.join(FLOOD_DIR, rel), 'utf8'))
  return rows.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i]])))
}

let srv
before(async () => {
  srv = await startServer({ config: { corsOrigins: '*', dataProvider: 'files' } })
})
after(() => srv.close())

describe('hazard types', () => {
  test('GET /hazards lists flood and what it provides', async () => {
    const res = await srv.get('/api/v1/hazards')
    const data = assertOk(res)
    assert.equal(res.headers.get('cache-control'), 'public, max-age=300')
    assert.equal(res.body.meta.count, data.length)
    const f = data.find((h) => h.id === 'flood')
    assert.equal(f.label, 'Flood')
    assert.equal(f.interval, 'daily')
    assert.deepEqual(f.provides.events, { count: 10, href: '/api/v1/hazards/flood/events' })
    assert.equal(f.provides.parameters.count, flood.parameters.length)
    assert.ok(f.provides.parameters.series.includes('rain_box_mm'))
    assert.ok(f.provides.parameters.observations.includes('soil_moisture'))
    assert.equal(f.provides.timeseries.href, '/api/v1/hazards/flood/events/{eventId}/timeseries')
    const fc = f.provides.forecast
    assert.equal(fc.available, true)
    assert.equal(fc.horizonDays, 3)
    assert.deepEqual(fc.classes, ['danger', 'no_danger'])
    assert.deepEqual(fc.models, [{ id: 'rain', label: 'Rainfall only', threshold: 0.55 }, { id: 'rain_soil', label: 'Rainfall + soil moisture', threshold: 0.75 }])
    assert.equal(fc.href, '/api/v1/hazards/flood/events/{eventId}/forecast')
    assert.deepEqual(f.coverage, { from: '2025-11-24', to: '2026-10-07', countries: ['BD', 'CN', 'IN', 'MZ', 'NP', 'PK', 'TH', 'US'] })
    assert.ok(!Number.isNaN(Date.parse(f.dataUpdated)))
  })

  test('GET /hazards/flood adds the dataset and the model with its scores', async () => {
    const data = assertOk(await srv.get(URL))
    assert.equal(data.id, 'flood')
    assert.deepEqual(Object.keys(data.dataset.tables), ['daily', 'soil_passes'])
    assert.equal(data.dataset.tables.soil_passes.kind, 'observation')
    assert.deepEqual(data.dataset.datasets.map((d) => d.doi), ['10.5067/GPM/IMERGDL/DAY/07', '10.5067/NIL3SME2-P1'])
    const m = data.forecast
    assert.equal(m.events, undefined, 'per-day results stay in the event forecast')
    assert.equal(m.models.rain.threshold, 0.55)
    assert.equal(m.models.rain_soil.threshold, 0.75)
    assert.equal(m.models.rain_soil.test.rows, 45)
    assert.equal(m.models.rain_soil.oof.sweep.length, 33)
    assert.deepEqual(m.split.testEvents, ['02_china_guangxi', '07_india_bihar_bhagalpur', '09_thailand_bangkok'])
    assert.equal(m.split.excludedEvents[0].id, '05_nepal_trishuli')
    assert.equal(m.provenance.notebookCheck.matches, true)
    assert.equal(m.data.records, 221)
  })

  test('unknown hazard is 404 with the valid ids', async () => {
    for (const url of ['/api/v1/hazards/volcano', '/api/v1/hazards/volcano/events', '/api/v1/hazards/volcano/parameters',
      '/api/v1/hazards/volcano/events/x/timeseries', '/api/v1/hazards/__proto__', '/api/v1/hazards/constructor/events']) {
      const res = await srv.get(url)
      assertError(res, 404, 'not_found')
    }
    const res = await srv.get('/api/v1/hazards/volcano')
    assert.deepEqual(res.body.error.details, { hazard: 'volcano', valid: ['flood'] })
  })
})

describe('hazard parameters', () => {
  test('GET /hazards/flood/parameters describes every parameter', async () => {
    const res = await srv.get(`${URL}/parameters`)
    const data = assertOk(res)
    assert.equal(res.body.meta.count, data.length)
    assert.deepEqual(data.map((p) => p.key), flood.parameters.map((p) => p.key))
    for (const p of data) {
      for (const f of ['key', 'label', 'unit', 'decimals', 'group', 'kind', 'valueType', 'intervals', 'aggregation', 'source', 'dataset', 'derived', 'context', 'description']) {
        assert.ok(f in p, `${p.key}.${f}`)
      }
      assert.ok(['series', 'observation'].includes(p.kind))
      assert.deepEqual(p.intervals, p.kind === 'series' ? ['daily'] : [])
    }
    const by = Object.fromEntries(data.map((p) => [p.key, p]))
    assert.equal(by.rain_box_mm.unit, 'mm')
    assert.equal(by.rain_box_mm.dataset, 'gpm_imerg_late_v07')
    assert.deepEqual(by.rain_box_3d_mm.derived, { from: 'rain_box_mm', op: 'rolling_sum', window: 3 })
    assert.equal(by.in_flood_period.valueType, 'boolean')
    assert.equal(by.soil_moisture.kind, 'observation')
    assert.equal(by.soil_moisture.unit, 'm³/m³')
    assert.equal(by.soil_moisture.aggregation, null)
    assert.deepEqual(by.soil_moisture.context.map((c) => c.key), ['utc_time', 'local_time', 'track', 'direction', 'phase', 'in_reported_flood_period'])
  })

  test('GET /hazards/flood/parameters/:key', async () => {
    assert.equal(assertOk(await srv.get(`${URL}/parameters/soil_coverage_pct`)).unit, '%')
    const res = await srv.get(`${URL}/parameters/ndvi`)
    assertError(res, 404, 'not_found')
    assert.deepEqual(res.body.error.details, { hazard: 'flood', key: 'ndvi' })
  })
})

describe('hazard events', () => {
  test('GET /hazards/flood/events lists every event, Nepal included', async () => {
    const res = await srv.get(`${URL}/events`)
    const data = assertOk(res)
    assert.deepEqual(data.map((e) => e.id), EVENT_IDS)
    assert.equal(res.body.meta.count, 10)
    for (const e of data) {
      for (const f of ['id', 'hazard', 'name', 'country', 'admin', 'place', 'period', 'bbox', 'center', 'cause', 'coverage', 'forecast']) assert.ok(f in e, `${e.id}.${f}`)
      assert.equal(e.hazard, 'flood')
      assert.equal(e.bbox.length, 4)
      assert.ok(e.bbox[0] < e.bbox[2] && e.bbox[1] < e.bbox[3])
      assert.equal(e.center.lat, Math.round(((e.bbox[1] + e.bbox[3]) / 2) * 1e4) / 1e4)
      assert.equal(e.coverage.interval, 'daily')
      assert.ok(e.coverage.parameters.includes('rain_box_mm'))
      assert.equal(e.notes, undefined, 'details only on the event itself')
    }
    const nepal = data.find((e) => e.id === '05_nepal_trishuli')
    assert.equal(nepal.forecast.available, false)
    assert.equal(nepal.forecast.role, 'excluded')
    assert.match(nepal.forecast.reason, /glacier/)
    const china = data.find((e) => e.id === '02_china_guangxi')
    assert.deepEqual(china.forecast, { available: true, role: 'test', href: '/api/v1/hazards/flood/events/02_china_guangxi/forecast' })
    assert.equal(data.find((e) => e.id === '01_mozambique_limpopo').forecast.role, 'out_of_fold')
    assert.deepEqual(china.period, { reported: '4-6 Jul heavy rain, reservoir breach 6 Jul, receding from ~9 Jul', start: '2026-07-04',
      end: '2026-07-09', windowStart: '2026-06-27', windowEnd: '2026-07-09', soilWindowStart: '2026-06-22' })
  })

  test('?country= filters by ISO code or name, case-insensitive', async () => {
    const ids = async (q) => assertOk(await srv.get(`${URL}/events${q}`)).map((e) => e.id)
    assert.deepEqual(await ids('?country=IN'), ['06_india_bihar_patna', '07_india_bihar_bhagalpur'])
    assert.deepEqual(await ids('?country=in,us'), ['04_usa_indiana', '06_india_bihar_patna', '07_india_bihar_bhagalpur', '08_usa_wabash'])
    assert.deepEqual(await ids('?country=India&country=th'), ['06_india_bihar_patna', '07_india_bihar_bhagalpur', '09_thailand_bangkok'])
    assert.deepEqual(await ids('?country=*'), EVENT_IDS)
    assert.deepEqual(await ids('?country=FR'), [])
  })

  test('?bbox= keeps events whose box overlaps (antimeridian too)', async () => {
    const ids = async (q) => assertOk(await srv.get(`${URL}/events${q}`)).map((e) => e.id)
    assert.deepEqual(await ids('?bbox=84,24,88,26'), ['06_india_bihar_patna', '07_india_bihar_bhagalpur'])
    assert.deepEqual(await ids('?bbox=85.6,25.8,86,26'), ['06_india_bihar_patna']) // touching edges count
    assert.deepEqual(await ids('?bbox=100,-90,-80,90'), ['02_china_guangxi', '04_usa_indiana', '08_usa_wabash', '09_thailand_bangkok'])
    assert.deepEqual(await ids('?bbox=-10,40,10,60'), [])
    assert.deepEqual(await ids('?bbox=60,5,100,40&country=PK'), ['03_pakistan_punjab'])
    for (const q of ['?bbox=1,2,3', '?bbox=a,b,c,d', '?bbox=0,10,5,5', '?bbox=0,-91,5,5', '?bbox=-181,0,0,1', '?bbox=1,2,3,4,5', '?bbox=,,,', '?bbox=1,2,3,4&bbox=5,6,7,8']) {
      assertError(await srv.get(`${URL}/events${q}`), 400, 'invalid_query')
    }
    const res = await srv.get(`${URL}/events?bbox=1,2,3`)
    assert.equal(res.body.error.details.format, 'west,south,east,north')
  })

  test('GET /hazards/flood/events/:eventId has notes, summary, sources and links', async () => {
    const e = assertOk(await srv.get(`${URL}/events/06_india_bihar_patna`))
    const rec = manifest.events.find((x) => x.id === '06_india_bihar_patna')
    assert.equal(e.name, rec.name)
    assert.deepEqual(e.country, { code: 'IN', name: 'India' })
    assert.equal(e.admin, 'Bihar')
    assert.deepEqual(e.bbox, rec.bbox)
    assert.deepEqual(e.notes, rec.notes)
    assert.match(e.notes[0], /upstream/)
    assert.equal(e.summary.soilPasses, 14)
    assert.equal(e.attributes.rainDriven, true)
    assert.deepEqual(e.sources.map((s) => s.id), ['gpm_imerg_late_v07', 'nisar_l3_sme2_v1'])
    assert.match(e.sources[0].citation, /Huffman/)
    assert.ok(e.sources[1].files.includes('soil_moisture/06_india_bihar_patna/soil_moisture_passes.csv'))
    assert.deepEqual(e.links, {
      timeseries: `${URL}/events/06_india_bihar_patna/timeseries`,
      forecast: `${URL}/events/06_india_bihar_patna/forecast`,
      layers: `${URL}/events/06_india_bihar_patna/layers`,
    })
    assert.equal(e.layers, undefined, 'layers only with ?include=layers')
    assert.equal(e.coverage.days, 55)
    assert.equal(e.coverage.soilPasses, 14)
    assert.equal(assertOk(await srv.get(`${URL}/events/05_nepal_trishuli`)).attributes.rainDriven, false)
  })

  test('unknown or unsafe event ids are 404', async () => {
    // (A bare ".." never reaches the server: fetch resolves it in the URL.)
    for (const id of ['99_nowhere', '..%2F..%2Fevents.json', '..%2Fflood', '__proto__', 'events.json', 'a%00b']) {
      assertError(await srv.get(`${URL}/events/${id}`), 404, 'not_found')
      assertError(await srv.get(`${URL}/events/${id}/timeseries`), 404, 'not_found')
      assertError(await srv.get(`${URL}/events/${id}/forecast`), 404, 'not_found')
    }
    const res = await srv.get(`${URL}/events/99_nowhere`)
    assert.deepEqual(res.body.error.details, { hazard: 'flood', eventId: '99_nowhere' })
  })
})

describe('event timeseries', () => {
  const TS = `${URL}/events/01_mozambique_limpopo/timeseries`

  test('every parameter by default: daily series on one time axis, passes as observations', async () => {
    const res = await srv.get(TS)
    const data = assertOk(res)
    const daily = readTable('events/01_mozambique_limpopo/daily.csv')
    assert.equal(data.hazard, 'flood')
    assert.equal(data.eventId, '01_mozambique_limpopo')
    assert.equal(data.interval, 'daily')
    assert.deepEqual(data.times, daily.map((r) => r.date))
    const series = flood.parameters.filter((p) => p.kind === 'series').map((p) => p.key)
    const obs = flood.parameters.filter((p) => p.kind === 'observation').map((p) => p.key)
    assert.deepEqual(Object.keys(data.series), series)
    assert.deepEqual(Object.keys(data.observations), obs)
    for (const k of series) assert.equal(data.series[k].length, data.times.length, k)
    assert.deepEqual(data.series.rain_box_mm, daily.map((r) => Number(r.rain_box_mm)))
    assert.deepEqual(data.series.rain_wettest_cell_mm, daily.map((r) => Number(r.rain_wettest_cell_mm)))
    assert.deepEqual(data.series.rain_cells_with_data, daily.map((r) => Number(r.cells_with_data)))
    assert.deepEqual(data.series.in_flood_period, daily.map((r) => r.in_flood_period === 'true'))
    const meta = res.body.meta
    assert.deepEqual(meta.parameters, [...series, ...obs])
    assert.equal(meta.count, 69)
    assert.equal(meta.from, '2025-11-24')
    assert.equal(meta.to, '2026-01-31')
    assert.equal(meta.units.soil_moisture, 'm³/m³')
    assert.equal(meta.observations.soil_moisture, 6)
    assert.equal(meta.requested, undefined)
  })

  test('derived rolling sums equal the model inputs of the snapshot', async () => {
    const data = assertOk(await srv.get(`${TS}?parameters=rain_box_3d_mm,rain_box_7d_mm,rain_wettest_3d_mm,rain_wettest_7d_mm`))
    const inputs = snapshot.events['01_mozambique_limpopo'].inputs
    const pairs = { rain_box_3d_mm: 'box_3d', rain_box_7d_mm: 'box_7d', rain_wettest_3d_mm: 'wet_3d', rain_wettest_7d_mm: 'wet_7d' }
    for (const [key, feature] of Object.entries(pairs)) {
      data.series[key].forEach((v, i) => assert.ok(Math.abs(v - inputs[feature][i]) < 1e-6, `${key}[${i}] ${v} vs ${inputs[feature][i]}`))
    }
  })

  test('observations carry their own times, values and context (same-day passes in file order)', async () => {
    const data = assertOk(await srv.get(`${URL}/events/09_thailand_bangkok/timeseries?parameters=soil_moisture,soil_coverage_pct`))
    const passes = readTable('events/09_thailand_bangkok/soil_passes.csv')
    assert.deepEqual(data.times.length, 14)
    assert.deepEqual(data.series, {})
    const sm = data.observations.soil_moisture
    assert.deepEqual(sm.times, passes.map((p) => p.date))
    assert.deepEqual(sm.values, passes.map((p) => Number(p.mean_sm_recommended_only)))
    assert.deepEqual(sm.context.track, passes.map((p) => Number(p.track)))
    assert.deepEqual(sm.context.direction, passes.map((p) => p.direction))
    assert.deepEqual(sm.context.in_reported_flood_period, passes.map((p) => p.in_reported_flood_period === 'true'))
    assert.deepEqual(data.observations.soil_coverage_pct.values, passes.map((p) => Number(p.coverage_pct)))
    // A pass without a recommended value is null, not dropped.
    const ctg = assertOk(await srv.get(`${URL}/events/10_bangladesh_chattogram/timeseries?parameters=soil_moisture`))
    assert.equal(ctg.observations.soil_moisture.values.filter((v) => v === null).length, 3)
    assert.equal(ctg.observations.soil_moisture.times.length, 7)
  })

  test('from/to cut series and observations; derived values still count earlier days', async () => {
    const res = await srv.get(`${URL}/events/02_china_guangxi/timeseries?parameters=rain_box_mm,rain_box_7d_mm,soil_moisture&from=2026-07-01&to=2026-07-09`)
    const data = assertOk(res)
    assert.deepEqual(data.times, ['2026-07-01', '2026-07-02', '2026-07-03', '2026-07-04', '2026-07-05', '2026-07-06', '2026-07-07', '2026-07-08', '2026-07-09'])
    assert.equal(data.series.rain_box_7d_mm[0], snapshot.events['02_china_guangxi'].inputs.box_7d[4])
    assert.deepEqual(data.observations.soil_moisture.times, ['2026-07-09'])
    assert.deepEqual(res.body.meta.requested, { from: '2026-07-01', to: '2026-07-09' })
    const outside = await srv.get(`${URL}/events/02_china_guangxi/timeseries?from=2030-01-01`)
    const empty = assertOk(outside)
    assert.deepEqual(empty.times, [])
    assert.deepEqual(empty.series.rain_box_mm, [])
    assert.deepEqual(empty.observations.soil_moisture.times, [])
    assert.equal(outside.body.meta.from, null)
    assert.equal(outside.body.meta.count, 0)
  })

  test('query errors', async () => {
    const cases = [
      ['?parameters=bogus', 400, 'invalid_parameter'],
      ['?parameters=rain_box_mm,ndvi', 400, 'invalid_parameter'],
      ['?parameters=', 400, 'invalid_query'],
      ['?interval=monthly', 400, 'unsupported_interval'],
      ['?interval=hourly', 400, 'unsupported_interval'],
      ['?from=2026-07', 400, 'invalid_query'],
      ['?from=2026-13-01', 400, 'invalid_query'],
      ['?to=20260701', 400, 'invalid_query'],
      ['?from=2026-07-05&to=2026-07-01', 400, 'invalid_query'],
      ['?from=2026-07-01&from=2026-07-02', 400, 'invalid_query'],
    ]
    for (const [q, status, code] of cases) assertError(await srv.get(`${TS}${q}`), status, code)
    const bad = (await srv.get(`${TS}?parameters=bogus`)).body.error.details
    assert.deepEqual(bad.unknown, ['bogus'])
    assert.ok(bad.valid.includes('soil_moisture'))
    assert.deepEqual((await srv.get(`${TS}?interval=monthly`)).body.error.details, { interval: 'monthly', supported: ['daily'] })
    assert.equal((await srv.get(`${TS}?from=2026-07`)).body.error.details.format, 'YYYY-MM-DD')
    // Duplicates and "*" follow the list conventions.
    const dup = assertOk(await srv.get(`${TS}?parameters=rain_box_mm&parameters=rain_box_mm,%20rain_box_mm`))
    assert.deepEqual(Object.keys(dup.series), ['rain_box_mm'])
    assert.deepEqual(Object.keys(assertOk(await srv.get(`${TS}?parameters=*`)).series).length, 8)
  })
})

describe('event forecast', () => {
  test('a held-out test event: per-day probability, threshold and danger class for both models', async () => {
    const res = await srv.get(`${URL}/events/02_china_guangxi/forecast`)
    const data = assertOk(res)
    const r = snapshot.events['02_china_guangxi']
    assert.equal(data.available, true)
    assert.equal(data.interval, 'daily')
    assert.equal(data.horizonDays, 3)
    assert.equal(data.target.key, 'flood_within_3_days')
    assert.equal(data.target.labelParameter, 'in_flood_period')
    assert.deepEqual(data.classes.map((c) => c.id), ['danger', 'no_danger'])
    assert.equal(data.defaultModel, 'rain_soil')
    assert.equal(data.evaluation.role, 'test')
    assert.match(data.evaluation.description, /trained without it/)
    assert.deepEqual(data.times, r.dates)
    assert.deepEqual(data.actual, r.target)
    assert.deepEqual(data.actual.slice(-3), [null, null, null])
    assert.deepEqual(data.observed.in_flood_period, r.label)
    assert.deepEqual(Object.keys(data.models), ['rain', 'rain_soil'])
    for (const [m, model] of Object.entries(data.models)) {
      const exact = snapshot.models[m].thresholdExact
      assert.equal(model.threshold, m === 'rain' ? 0.55 : 0.75)
      assert.equal(model.probability.length, data.times.length)
      assert.deepEqual(model.class, model.probability.map((p) => (p >= exact ? 'danger' : 'no_danger')))
      assert.equal(model.summary.dangerDays, model.class.filter((c) => c === 'danger').length)
      assert.equal(model.fold, null)
      assert.equal(model.metrics.test.rows, 45)
      assert.equal(model.metrics.event.rows, 10)
      assert.equal(typeof model.metrics.outOfFold.balancedAccuracy, 'number')
    }
    // The notebook's printed numbers (cell 36), through the API.
    const round3 = (x) => Math.round(x * 1000) / 1000
    assert.equal(round3(data.models.rain.metrics.test.accuracy), 0.756)
    assert.equal(round3(data.models.rain_soil.metrics.test.accuracy), 0.778)
    assert.equal(round3(data.models.rain_soil.metrics.test.balancedAccuracy), 0.583)
    assert.equal(round3(data.models.rain.metrics.outOfFold.balancedAccuracy), 0.777)
    assert.equal(round3(data.models.rain_soil.metrics.event.predictedPositiveRate), 0.9)
    assert.equal(data.inputs.features.length, 12)
    assert.deepEqual(data.inputs.values.box_3d, r.inputs.box_3d)
    assert.equal(data.provenance.modelVersion, snapshot.modelVersion)
    assert.match(data.provenance.notebook, /flood_disaster\.ipynb/)
    const meta = res.body.meta
    assert.deepEqual(meta.models, ['rain', 'rain_soil'])
    assert.equal(meta.count, 13)
    assert.equal(meta.modelVersion, snapshot.modelVersion)
    assert.equal(meta.generated, snapshot.provenance.generated)
    assert.ok(!Number.isNaN(Date.parse(meta.dataUpdated)))
  })

  test('a training event is scored out-of-fold, by the model that held it out', async () => {
    const data = assertOk(await srv.get(`${URL}/events/04_usa_indiana/forecast?models=rain_soil`))
    assert.equal(data.evaluation.role, 'out_of_fold')
    assert.deepEqual(Object.keys(data.models), ['rain_soil'])
    const m = data.models.rain_soil
    assert.equal(typeof m.fold, 'number')
    assert.ok(m.foldEvents.includes('04_usa_indiana'))
    assert.deepEqual(m.probability, snapshot.events['04_usa_indiana'].models.rain_soil.probability)
    // Only the chosen model's features are listed.
    assert.equal(data.inputs.features.length, 12)
    const rainOnly = assertOk(await srv.get(`${URL}/events/04_usa_indiana/forecast?models=rain`))
    assert.equal(rainOnly.inputs.features.length, 8)
    assert.equal(rainOnly.inputs.values.soil_moisture, undefined)
  })

  test('Nepal is excluded, with the reason', async () => {
    const data = assertOk(await srv.get(`${URL}/events/05_nepal_trishuli/forecast`))
    assert.equal(data.available, false)
    assert.equal(data.evaluation.role, 'excluded')
    assert.match(data.evaluation.reason, /glacier/)
    assert.deepEqual(data.times, [])
    assert.deepEqual(data.models.rain.probability, [])
    assert.equal(data.models.rain.threshold, 0.55)
  })

  test('models, from/to and errors', async () => {
    const sorted = assertOk(await srv.get(`${URL}/events/02_china_guangxi/forecast?models=rain_soil,rain`))
    assert.deepEqual(Object.keys(sorted.models), ['rain', 'rain_soil'], 'snapshot order whatever the request order')
    const cut = await srv.get(`${URL}/events/02_china_guangxi/forecast?models=*&from=2026-07-04&to=2026-07-06`)
    const data = assertOk(cut)
    assert.deepEqual(data.times, ['2026-07-04', '2026-07-05', '2026-07-06'])
    assert.deepEqual(data.actual, snapshot.events['02_china_guangxi'].target.slice(7, 10))
    assert.equal(data.models.rain.probability.length, 3)
    assert.equal(data.models.rain.metrics.event.rows, 10, 'event scores stay whole-event')
    assert.deepEqual(cut.body.meta.requested, { from: '2026-07-04', to: '2026-07-06' })
    const cases = [
      ['?models=xgboost', 400, 'invalid_query'],
      ['?models=', 400, 'invalid_query'],
      ['?from=07-04', 400, 'invalid_query'],
      ['?from=2026-07-06&to=2026-07-04', 400, 'invalid_query'],
      ['?interval=monthly', 400, 'unsupported_interval'],
    ]
    for (const [q, status, code] of cases) assertError(await srv.get(`${URL}/events/02_china_guangxi/forecast${q}`), status, code)
    const unknown = (await srv.get(`${URL}/events/02_china_guangxi/forecast?models=rain,xgboost`)).body.error.details
    assert.deepEqual(unknown, { parameter: 'models', unknown: ['xgboost'], allowed: ['rain', 'rain_soil'] })
  })
})

describe('event layers', () => {
  // The committed layers (server/ml: python -m forecaster.hazards import flood --layers ...).
  const LAYER_EVENTS = Object.keys(layersFile.layers)
  const recOf = (eventId, id) => layersFile.layers[eventId].find((l) => l.id === id)

  test('the reference water of the three held-out test events is there', () => {
    assert.deepEqual(LAYER_EVENTS, ['02_china_guangxi', '07_india_bihar_bhagalpur', '09_thailand_bangkok'])
    for (const e of LAYER_EVENTS) assert.deepEqual(layersFile.layers[e].map((l) => l.id), ['water-reference'])
  })

  test('GET /hazards counts the layers', async () => {
    const f = assertOk(await srv.get('/api/v1/hazards')).find((h) => h.id === 'flood')
    assert.deepEqual(f.provides.layers, {
      count: 3, events: 3, ids: ['water-reference'], kinds: ['mask'], href: '/api/v1/hazards/flood/events/{eventId}/layers',
    })
  })

  test('events list the ids of their layers in coverage; ?include=layers embeds them', async () => {
    const plain = assertOk(await srv.get(`${URL}/events`))
    for (const e of plain) {
      assert.deepEqual(e.coverage.layers, (layersFile.layers[e.id] || []).map((l) => l.id), e.id)
      assert.equal(e.layers, undefined)
    }
    const withLayers = assertOk(await srv.get(`${URL}/events?include=layers`))
    for (const e of withLayers) assert.equal(e.layers.length, e.coverage.layers.length, e.id)
    assert.deepEqual(withLayers.find((e) => e.id === '09_thailand_bangkok').layers,
      assertOk(await srv.get(`${URL}/events/09_thailand_bangkok/layers`)))
    const one = assertOk(await srv.get(`${URL}/events/07_india_bihar_bhagalpur?include=*`))
    assert.equal(one.layers[0].id, 'water-reference')
    assert.equal(one.notes.length > 0, true, 'still the detailed event')
    assertError(await srv.get(`${URL}/events/07_india_bihar_bhagalpur?include=boundary`), 400, 'invalid_query')
    assertError(await srv.get(`${URL}/events?include=nope`), 400, 'invalid_query')
  })

  test('GET .../layers and .../layers/:layerId serve the record without its file path', async () => {
    for (const eventId of LAYER_EVENTS) {
      const res = await srv.get(`${URL}/events/${eventId}/layers`)
      const list = assertOk(res)
      assert.equal(res.body.meta.count, list.length)
      const layer = assertOk(await srv.get(`${URL}/events/${eventId}/layers/water-reference`))
      assert.deepEqual(list, [layer])
      const rec = recOf(eventId, 'water-reference')
      const self = `${URL}/events/${eventId}/layers/water-reference`
      const url = `${self}/image?v=${rec.image.sha256.slice(0, 12)}`
      assert.deepEqual(Object.keys(layer), ['id', 'hazard', 'eventId', 'label', 'kind', 'description', 'time', 'crs', 'bounds',
        'extent', 'legend', 'stats', 'source', 'notes', 'url', 'image', 'links'])
      assert.equal(layer.hazard, 'flood')
      assert.equal(layer.eventId, eventId)
      assert.equal(layer.kind, 'mask')
      assert.equal(layer.crs, 'EPSG:4326')
      assert.equal(layer.time, null, 'the notebook does not date the reference labels')
      assert.equal(layer.url, url)
      assert.deepEqual(layer.links, { self })
      assert.equal(layer.image.url, url)
      assert.equal(layer.image.sha256, undefined)
      assert.equal(layer.file, undefined, 'the server path stays private')
      for (const k of ['bounds', 'extent', 'legend', 'stats', 'source', 'notes', 'label', 'description']) assert.deepEqual(layer[k], rec[k], k)
      assert.deepEqual(layer.legend.map((c) => [c.value, c.key]), [[1, 'water'], [0, 'not_water'], [255, 'unknown']])
      assert.equal(layer.source.file, `${eventId}_water_reference.tif`)
      assert.equal(layer.source.origin, null)
      assert.match(layer.source.provenanceNote, /does not say/)
    }
  })

  test('bounds, image size and stats agree with each other', () => {
    for (const eventId of LAYER_EVENTS) {
      const { bounds, extent, image, stats } = recOf(eventId, 'water-reference')
      const [[s, w], [n, e]] = bounds
      const [[xs, xw], [xn, xe]] = extent
      const [dx, dy] = stats.pixelSizeDeg
      // The image covers the raster plus at most one block of padding east and south.
      assert.ok(w === xw && n === xn && e >= xe && s <= xs, eventId)
      assert.ok(e - xe < image.downsample * dx + 1e-9 && xs - s < image.downsample * dy + 1e-9, eventId)
      assert.ok(Math.abs((e - w) - image.width * image.downsample * dx) < 1e-6, eventId)
      assert.ok(Math.abs((n - s) - image.height * image.downsample * dy) < 1e-6, eventId)
      assert.ok(Math.max(image.width, image.height) <= 2048 && image.bytes < 500 * 1024, eventId)
      // Every pixel is in exactly one class; areas add up.
      const c = stats.classes
      assert.equal(c.water.pixels + c.not_water.pixels + c.unknown.pixels, stats.width * stats.height)
      assert.equal(stats.pixels, stats.width * stats.height)
      assert.ok(Math.abs(c.water.areaKm2 + c.not_water.areaKm2 - stats.knownAreaKm2) < 0.02)
      assert.ok(Math.abs(stats.knownAreaKm2 + c.unknown.areaKm2 - stats.totalAreaKm2) < 0.02)
      assert.ok(Math.abs(c.water.pctOfKnown + c.not_water.pctOfKnown - 100) < 0.01)
      // ~30 m pixels: about 0.0008 km² each at these latitudes.
      const perPixel = c.water.areaKm2 / c.water.pixels
      assert.ok(perPixel > 0.0007 && perPixel < 0.0009, `${eventId} ${perPixel}`)
      // The event box lies inside the raster, so its numbers are a part of the whole.
      assert.ok(stats.eventBox.classes.water.pixels <= c.water.pixels && stats.eventBox.pixels < stats.pixels)
    }
    // The numbers of the import (native ~30 m, per-row cos(lat) areas).
    const water = (id) => recOf(id, 'water-reference').stats.classes.water
    assert.deepEqual([water('02_china_guangxi').pixels, water('07_india_bihar_bhagalpur').pixels, water('09_thailand_bangkok').pixels],
      [173812, 766858, 934566])
  })

  test('GET .../image streams the PNG with a day of caching and revalidation', async () => {
    const rec = recOf('07_india_bihar_bhagalpur', 'water-reference')
    const url = `${srv.base}${URL}/events/07_india_bihar_bhagalpur/layers/water-reference/image`
    const res = await fetch(url)
    assert.equal(res.status, 200)
    assert.equal(res.headers.get('content-type'), 'image/png')
    assert.equal(res.headers.get('cache-control'), 'public, max-age=86400')
    assert.equal(res.headers.get('access-control-allow-origin'), '*')
    const bytes = Buffer.from(await res.arrayBuffer())
    assert.deepEqual(bytes, fs.readFileSync(path.join(FLOOD_DIR, rec.file)))
    assert.equal(bytes.length, rec.image.bytes)
    assert.equal(bytes.subarray(1, 4).toString(), 'PNG')
    assert.deepEqual([bytes.readUInt32BE(16), bytes.readUInt32BE(20)], [rec.image.width, rec.image.height])
    // The ?v= of the layer's url is only for cache busting.
    assert.equal((await fetch(`${url}?v=${rec.image.sha256.slice(0, 12)}`)).status, 200)
    // Revalidation with the ETag is a 304 (plain http: fetch would add no-cache).
    const status = await new Promise((resolve, reject) => {
      http.get(url, { headers: { 'If-None-Match': res.headers.get('etag') } }, (r) => { r.resume(); resolve(r.statusCode) }).on('error', reject)
    })
    assert.equal(status, 304)
  })

  test('unknown layers, events without layers and unsafe ids are 404', async () => {
    const res = await srv.get(`${URL}/events/07_india_bihar_bhagalpur/layers/nope`)
    assertError(res, 404, 'not_found')
    assert.deepEqual(res.body.error.details, { hazard: 'flood', eventId: '07_india_bihar_bhagalpur', layerId: 'nope', valid: ['water-reference'] })
    assert.deepEqual(assertOk(await srv.get(`${URL}/events/01_mozambique_limpopo/layers`)), [])
    for (const p of ['01_mozambique_limpopo/layers/water-reference', '01_mozambique_limpopo/layers/water-reference/image',
      '99_nowhere/layers', '99_nowhere/layers/water-reference/image', '07_india_bihar_bhagalpur/layers/..%2F..%2Fevents.json/image',
      '07_india_bihar_bhagalpur/layers/__proto__', '07_india_bihar_bhagalpur/layers/water-reference%00/image']) {
      assertError(await srv.get(`${URL}/events/${p}`), 404, 'not_found')
    }
    assertError(await srv.get('/api/v1/hazards/volcano/events/x/layers'), 404, 'not_found')
  })

  describe('a layers.json written by hand', () => {
    let tmp, s
    before(async () => {
      tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hazards-layers-'))
      fs.cpSync(FLOOD_DIR, path.join(tmp, 'flood'), { recursive: true, filter: (src) => !src.includes(`${path.sep}model`) })
      const good = recOf('02_china_guangxi', 'water-reference')
      const layers = {
        ...layersFile,
        layers: {
          '02_china_guangxi': [
            good,
            { ...good, id: 'escape', file: '../../../package.json' },
            { ...good, id: 'gone', file: 'events/02_china_guangxi/layers/gone.png' },
            { ...good, id: 'not-an-image', file: 'events.json' },
            { label: 'no id' },
          ],
          '04_usa_indiana': [{ id: 'flood-depth', label: 'Depth', kind: 'raster', bounds: [[39.6, -86.4], [40.2, -85.6]],
            file: 'events/04_usa_indiana/layers/flood-depth.png', image: { format: 'png', width: 1, height: 1 } }],
          '99_stale_event': [good],
        },
      }
      fs.writeFileSync(path.join(tmp, 'flood', 'layers.json'), JSON.stringify(layers))
      // Any kind of layer: a 1x1 PNG for the made-up raster layer.
      fs.mkdirSync(path.join(tmp, 'flood', 'events', '04_usa_indiana', 'layers'), { recursive: true })
      fs.copyFileSync(path.join(FLOOD_DIR, good.file), path.join(tmp, 'flood', 'events', '04_usa_indiana', 'layers', 'flood-depth.png'))
      s = await startServer({ config: { corsOrigins: '*', dataProvider: 'files' }, hazardsDir: tmp })
    })
    after(async () => {
      await s.close()
      fs.rmSync(tmp, { recursive: true, force: true })
    })

    test('any number and kind of layers; stale events and records without an id are left out', async () => {
      const f = assertOk(await s.get('/api/v1/hazards')).find((h) => h.id === 'flood')
      assert.deepEqual(f.provides.layers.ids, ['escape', 'flood-depth', 'gone', 'not-an-image', 'water-reference'])
      assert.deepEqual(f.provides.layers.kinds, ['mask', 'raster'])
      assert.equal(f.provides.layers.count, 5)
      assert.equal(f.provides.layers.events, 2)
      const depth = assertOk(await s.get(`${URL}/events/04_usa_indiana/layers/flood-depth`))
      assert.equal(depth.kind, 'raster')
      assert.deepEqual(depth.legend, null)
      assert.deepEqual(depth.notes, [])
      assert.equal(depth.url, `${URL}/events/04_usa_indiana/layers/flood-depth/image`, 'no hash, no ?v=')
      const img = await fetch(`${s.base}${depth.url}`)
      assert.equal(img.status, 200)
    })

    test('a file outside the folder, a missing file or a non-image is 404, never served', async () => {
      for (const id of ['escape', 'gone', 'not-an-image']) {
        assert.equal(assertOk(await s.get(`${URL}/events/02_china_guangxi/layers/${id}`)).id, id)
        assertError(await s.get(`${URL}/events/02_china_guangxi/layers/${id}/image`), 404, 'not_found')
      }
    })

    test('a rebuilt layers.json is picked up without a restart', async () => {
      const file = path.join(tmp, 'flood', 'layers.json')
      fs.writeFileSync(file, JSON.stringify({ hazard: 'flood', layers: {} }))
      const later = new Date(Date.now() + 5000)
      fs.utimesSync(file, later, later)
      assert.deepEqual(assertOk(await s.get(`${URL}/events/02_china_guangxi`)).coverage.layers, [])
    })
  })
})

describe('hazards without data or a model', () => {
  let tmp, bare
  before(async () => {
    // A copy of the flood dataset without model/ (imported, not built yet).
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hazards-'))
    fs.cpSync(FLOOD_DIR, path.join(tmp, 'flood'), { recursive: true, filter: (src) => !src.includes(`${path.sep}model`) })
    bare = await startServer({ config: { corsOrigins: '*', dataProvider: 'files' }, hazardsDir: tmp })
  })
  after(async () => {
    await bare.close()
    fs.rmSync(tmp, { recursive: true, force: true })
  })

  test('no model yet: data works, the forecast is 503 forecast_unavailable (reason no_model)', async () => {
    const h = assertOk(await bare.get('/api/v1/hazards')).find((x) => x.id === 'flood')
    assert.deepEqual(h.provides.forecast, { available: false, reason: 'no_model' })
    assert.equal(assertOk(await bare.get(URL)).forecast, null)
    const ev = assertOk(await bare.get(`${URL}/events/02_china_guangxi`))
    assert.deepEqual(ev.forecast, { available: false, role: null, reason: 'no_model' })
    assert.equal(assertOk(await bare.get(`${URL}/events/02_china_guangxi/timeseries`)).times.length, 13)
    const res = await bare.get(`${URL}/events/02_china_guangxi/forecast`)
    assertError(res, 503, 'forecast_unavailable')
    assert.deepEqual(res.body.error.details, { hazard: 'flood', eventId: '02_china_guangxi', reason: 'no_model' })
  })

  test('no dataset at all: no events, nothing to look up', async () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'hazards-empty-'))
    const s = await startServer({ config: { corsOrigins: '*', dataProvider: 'files' }, hazardsDir: empty })
    try {
      const h = assertOk(await s.get('/api/v1/hazards')).find((x) => x.id === 'flood')
      assert.equal(h.provides.events.count, 0)
      assert.equal(h.provides.layers.count, 0)
      assert.deepEqual(h.coverage, { from: null, to: null, countries: [] })
      assert.equal(h.dataUpdated, null)
      assert.deepEqual(assertOk(await s.get(`${URL}/events`)), [])
      assertError(await s.get(`${URL}/events/02_china_guangxi`), 404, 'not_found')
      assert.equal(assertOk(await s.get(URL)).dataset, null)
    } finally {
      await s.close()
      fs.rmSync(empty, { recursive: true, force: true })
    }
  })

  test('a re-imported dataset is picked up without a restart', async () => {
    const file = path.join(tmp, 'flood', 'events.json')
    const m = JSON.parse(fs.readFileSync(file, 'utf8'))
    m.events[0].name = 'Renamed'
    fs.writeFileSync(file, JSON.stringify(m))
    const later = new Date(Date.now() + 5000)
    fs.utimesSync(file, later, later)
    assert.equal(assertOk(await bare.get(`${URL}/events/01_mozambique_limpopo`)).name, 'Renamed')
  })
})

describe('another hazard provider (injected)', () => {
  // In-memory provider: the contract in src/providers/types.js, e.g. what a
  // live source would implement. Covers the roles the flood data does not have.
  const days = ['2026-01-01', '2026-01-02']
  const scores = (p) => ({ probability: p, class: p.map((x) => (x === null ? null : x >= 0.5 ? 'danger' : 'no_danger')), threshold: 0.5 })
  const fake = {
    name: 'memory',
    async getDataset(h) { return h === 'flood' ? { interval: 'daily', tables: { daily: { kind: 'series' } }, datasets: [], notes: [], updated: '2026-01-03T00:00:00.000Z' } : null },
    async listEvents(h) { return h === 'flood' ? [{ id: 'new_event', name: 'New', files: { daily: 'x' } }, { id: 'odd_fold', name: 'Odd', files: { daily: 'x' } }] : [] },
    async getEvent(h, id) { return (await this.listEvents(h)).find((e) => e.id === id) || null },
    async getTable(h, id, table) {
      if (table !== 'daily') return null
      return { columns: ['date', 'rain_box_mm', 'in_flood_period'], rows: [['2026-01-01', '1.5', 'false'], ['2026-01-02', '', 'true']], timeColumn: 'date', kind: 'series' }
    },
    async getModel() {
      return {
        horizonDays: 3, target: { key: 't', labelParameter: 'in_flood_period' }, classes: [{ id: 'danger' }, { id: 'no_danger' }],
        models: { m1: { label: 'M1', threshold: 0.5, features: [], test: {}, oof: {} } },
        events: {
          new_event: { role: 'unseen', dates: days, label: [false, true], target: [null, null], inputs: {}, models: { m1: scores([0.7, 0.2]) } },
          odd_fold: { role: 'not_scored', dates: days, label: [false, true], target: [1, null], inputs: {}, models: { m1: scores([null, null]) } },
        },
        provenance: {}, updated: '2026-01-03T00:00:00.000Z',
      }
    },
  }
  let mem
  before(async () => { mem = await startServer({ config: { corsOrigins: '*', dataProvider: 'files' }, hazardProvider: fake }) })
  after(() => mem.close())

  test('an event the model never trained on is scored ("unseen")', async () => {
    const data = assertOk(await mem.get(`${URL}/events/new_event/forecast`))
    assert.equal(data.available, true)
    assert.equal(data.evaluation.role, 'unseen')
    assert.deepEqual(data.models.m1.class, ['danger', 'no_danger'])
    assert.deepEqual(data.models.m1.summary, { dangerDays: 1, firstDanger: '2026-01-01', lastDanger: '2026-01-01' })
  })

  test('a training event without a fold model has no forecast ("not_scored")', async () => {
    const data = assertOk(await mem.get(`${URL}/events/odd_fold/forecast`))
    assert.equal(data.available, false)
    assert.equal(data.evaluation.role, 'not_scored')
    assert.deepEqual(data.times, [])
    const ev = assertOk(await mem.get(`${URL}/events/odd_fold`))
    assert.equal(ev.forecast.available, false)
  })

  test('a provider without layers: every event has none', async () => {
    const h = assertOk(await mem.get('/api/v1/hazards')).find((x) => x.id === 'flood')
    assert.equal(h.provides.layers.count, 0)
    const ev = assertOk(await mem.get(`${URL}/events/new_event?include=layers`))
    assert.deepEqual(ev.coverage.layers, [])
    assert.deepEqual(ev.layers, [])
    assert.deepEqual(assertOk(await mem.get(`${URL}/events/new_event/layers`)), [])
    assertError(await mem.get(`${URL}/events/new_event/layers/water-reference/image`), 404, 'not_found')
  })

  test('empty cells are null; series from the injected tables', async () => {
    const data = assertOk(await mem.get(`${URL}/events/new_event/timeseries?parameters=rain_box_mm,rain_box_3d_mm,in_flood_period,soil_moisture`))
    assert.deepEqual(data.times, days)
    assert.deepEqual(data.series, { rain_box_mm: [1.5, null], rain_box_3d_mm: [1.5, 1.5], in_flood_period: [false, true] })
    assert.deepEqual(data.observations.soil_moisture.values, [])
  })
})

describe('HTTP conventions', () => {
  test('HEAD works, other methods are 405 with Allow', async () => {
    for (const url of ['/api/v1/hazards', URL, `${URL}/parameters`, `${URL}/events`, `${URL}/events/02_china_guangxi/forecast`,
      `${URL}/events/02_china_guangxi/layers`, `${URL}/events/02_china_guangxi/layers/water-reference`,
      `${URL}/events/02_china_guangxi/layers/water-reference/image`]) {
      const head = await fetch(srv.base + url, { method: 'HEAD' })
      assert.equal(head.status, 200, url)
      const res = await srv.get(url, { method: 'POST' })
      assertError(res, 405, 'method_not_allowed')
      assert.equal(res.headers.get('allow'), 'GET, HEAD')
    }
  })

  test('unknown query keys are ignored; CORS header present', async () => {
    const res = await srv.get(`${URL}/events?foo=bar`)
    assert.equal(assertOk(res).length, 10)
    assert.equal(res.headers.get('access-control-allow-origin'), '*')
  })
})
