// npm run forecasts:build [-- areaId ...]
//
// Runs the forecasting module (server/ml) on every area's Earth Engine feature
// table (data/gee/<areaId>.features.csv, written by `npm run gee:extract`) for
// every forecastable parameter, at the longest horizon allowed
// (HORIZON.max) with every model, and saves each answer as a snapshot
// (src/forecast/snapshots.js), so the API (and the website's fallback) can
// answer any valid horizon and subset of models by cutting it down:
//   server/data/forecasts/<areaId>.<target>.json          served by the API when
//                                                       the module cannot run
//   client/public/data/forecasts/<areaId>.<target>.json   the website's bundled
//                                                       fallback (static hosting)
// Areas without a table yet are skipped and listed at the end (not a failure:
// their forecast appears once they have been extracted). Re-run it after an
// extraction. Exit code 1 if any area failed.

require('dotenv').config({ quiet: true })
const fs = require('node:fs')
const path = require('node:path')
const { loadConfig } = require('../src/config')
const { getProvider } = require('../src/providers')
const { createServices } = require('../src/services')
const { createProcessRunner } = require('../src/forecast/runner')
const { DEFAULT_SNAPSHOT_DIR, writeSnapshot } = require('../src/forecast/snapshots')
const { getTarget, targetKeys, HORIZON } = require('../src/catalog/forecasts')

const CLIENT_DIR = path.join(__dirname, '..', '..', 'client')
const CLIENT_SNAPSHOT_DIR = path.join(CLIENT_DIR, 'public', 'data', 'forecasts')
// Nobody is waiting on a request here, so give slow machines more room than
// the API's per-request timeout.
const MIN_BUILD_TIMEOUT_MS = 5 * 60 * 1000

async function main() {
  const config = loadConfig()
  const runner = createProcessRunner({
    ...(config.forecastPython ? { command: config.forecastPython } : {}),
    timeoutMs: Math.max(config.forecastTimeoutMs, MIN_BUILD_TIMEOUT_MS),
  })
  const services = createServices(getProvider(config.dataProvider), { forecastMode: 'live', forecastRunner: runner })
  const dirs = [DEFAULT_SNAPSHOT_DIR, ...(fs.existsSync(CLIENT_DIR) ? [CLIENT_SNAPSHOT_DIR] : [])]

  const only = process.argv.slice(2)
  const areas = (await services.listAreas()).filter((a) => !only.length || only.includes(a.id))
  if (only.length && areas.length !== only.length) throw new Error(`Unknown area id in: ${only.join(', ')}`)

  let failed = 0
  const skipped = []
  // One area at a time: each run already uses every core for model training,
  // and sequential output is easier to read.
  for (const area of areas) {
    for (const target of targetKeys()) {
      const def = getTarget(target)
      // The site's own parameters (climate.json) no longer matter here: the
      // table is the input. Only the interval must be one the area offers.
      if (!def.intervals.some((i) => area.coverage.intervals.includes(i))) continue
      const label = `${area.id}.${target}`
      const started = Date.now()
      try {
        if (!(await services.forecastTables.getTable(area.id))) {
          skipped.push(area.id)
          continue
        }
        const { data, meta } = await services.runForecast(area.id, { parameters: [target], horizon: String(HORIZON.max) })
        const files = writeSnapshot(dirs, area.id, target, { data: { ...data, source: 'snapshot' }, meta })
        const scores = Object.entries(data.models).map(([m, r]) => `${m} test R² ${r.metrics.test.r2 == null ? 'n/a' : r.metrics.test.r2.toFixed(2)}`).join(', ')
        console.log(`${label}: issued ${data.issued}, ${data.forecastTimes[0]}..${data.forecastTimes.at(-1)} (${scores}) in ${((Date.now() - started) / 1000).toFixed(1)} s`)
        for (const f of files) console.log(`  wrote ${path.relative(path.join(__dirname, '..', '..'), f)}`)
      } catch (err) {
        failed++
        console.error(`${label}: FAILED ${err.code || ''} ${err.message}`)
        if (err.cause && err.cause.message) console.error(`  ${err.cause.message}`)
        if (err.cause && err.cause.stderr) console.error(err.cause.stderr)
      }
    }
  }
  if (skipped.length) {
    const unique = [...new Set(skipped)]
    console.log(`Skipped (no Earth Engine table in data/gee yet): ${unique.join(', ')}. Run \`npm run gee:extract\` first (see README "Forecasts").`)
  }
  if (failed) {
    console.error(`${failed} forecast(s) failed. Is the module installed? See server/README.md, "Forecasts".`)
    process.exitCode = 1
  }
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
