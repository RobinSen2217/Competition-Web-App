// npm run gee:check | gee:extract [-- --end YYYY-MM-DD] | gee:extract -- --area <id>
//
// Runs the Earth Engine pipeline of the forecasting module (python -m
// forecaster.gee, a port of the team notebook) with the module's own Python
// and working directory, so the npm scripts work the same everywhere:
//   check     can we log in to Earth Engine with the configured credentials?
//   extract   download an area's monthly feature table into data/gee/<id>.features.csv
//             (--all: every area in data/gee/areas.json)
// Arguments after the command are passed through unchanged.
//
// Credentials (see README "Forecasts"): GEE_PROJECT and GEE_SERVICE_ACCOUNT_KEY
// are read from the environment or server/.env. A relative key path is taken
// relative to server/, where .env lives, not to server/ml where Python runs.

require('dotenv').config({ quiet: true, path: require('node:path').join(__dirname, '..', '.env') })
const path = require('node:path')
const { spawn } = require('node:child_process')
const { loadConfig } = require('../src/config')
const { DEFAULT_PYTHON, ML_DIR } = require('../src/forecast/runner')

const SERVER_DIR = path.join(__dirname, '..')

const config = loadConfig()
const env = { ...process.env, GEE_PROJECT: config.geeProject }
if (config.geeServiceAccountKey) env.GEE_SERVICE_ACCOUNT_KEY = path.resolve(SERVER_DIR, config.geeServiceAccountKey)
else delete env.GEE_SERVICE_ACCOUNT_KEY

// `gee:extract` is `extract --all`; `npm run gee:extract -- --area jaipur`
// means that one area, so --all is dropped when an area is named.
let args = process.argv.slice(2)
if (args.includes('--area')) args = args.filter((a) => a !== '--all')

const python = config.forecastPython || DEFAULT_PYTHON
const child = spawn(python, ['-m', 'forecaster.gee', ...args], { cwd: ML_DIR, env, stdio: 'inherit' })
child.on('error', (err) => {
  console.error(`Cannot start ${python} (${err.code || err.message}). Set up the module's Python first: see server/README.md, "Forecasts".`)
  process.exitCode = 1
})
// The module's exit code (0 ok, 1 failed or no credentials, 2 bad arguments / unknown area) is ours.
child.on('close', (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0)
})
