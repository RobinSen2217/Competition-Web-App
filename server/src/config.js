// Runtime settings read from the environment (server/.env is loaded by index.js).
// Read on every call rather than once at require time, so tests can change
// process.env (e.g. CORS_ORIGINS) and build a second app with other settings.

function list(value) {
  return String(value || '').split(',').map((s) => s.trim()).filter(Boolean)
}

const DEFAULT_TIMESERIES_MAX_VALUES = 500000

// How /forecasts gets its numbers:
//   live      run the forecasting module (server/ml); if it cannot run or
//             fails, serve the saved snapshot when one matches the request
//   snapshot  never start Python; serve only the snapshots written by
//             `npm run forecasts:build` (e.g. a host without Python)
const FORECAST_MODES = ['live', 'snapshot']
const DEFAULT_FORECAST_TIMEOUT_MS = 60000
const DEFAULT_FORECAST_RETRY_AFTER_MS = 60000
// The team notebook's Earth Engine project.
const DEFAULT_GEE_PROJECT = 'miicproject2'

function loadConfig(env = process.env) {
  const origins = list(env.CORS_ORIGINS)
  return {
    // 5050 by default: macOS uses 5000 for AirPlay Receiver.
    port: Number(env.PORT) || 5050,
    // Unset (or containing "*") allows any origin, fine for a read-only public data API.
    corsOrigins: origins.length === 0 || origins.includes('*') ? '*' : origins,
    // Which data provider backs the API (see src/providers/index.js).
    dataProvider: env.DATA_PROVIDER || 'files',
    // Largest /timeseries response (areas x parameters x times) before it is
    // refused with 400 invalid_query; keeps one request from building a huge
    // body or, with a live provider, from fanning out into many upstream calls.
    timeseriesMaxValues: Number(env.TIMESERIES_MAX_VALUES) || DEFAULT_TIMESERIES_MAX_VALUES,
    forecastMode: forecastMode(env.FORECAST_MODE),
    // Python interpreter that has the forecasting module installed; unset =
    // the module's own venv, server/ml/.venv (see src/forecast/runner.js).
    forecastPython: env.FORECAST_PYTHON || undefined,
    // A run that takes longer is stopped (and the snapshot served, if any).
    forecastTimeoutMs: Number(env.FORECAST_TIMEOUT_MS) || DEFAULT_FORECAST_TIMEOUT_MS,
    // After a run that could not start or timed out, the same request is
    // answered from the snapshot for this long without trying again. 0 = off.
    forecastRetryAfterMs: nonNegative(env.FORECAST_RETRY_AFTER_MS, DEFAULT_FORECAST_RETRY_AFTER_MS),
    // Earth Engine login for `npm run gee:check` / `gee:extract` (scripts/gee.js),
    // which download the feature tables the forecasts read. The API itself never
    // calls Earth Engine. Project: the Google Cloud project the login runs under.
    geeProject: String(env.GEE_PROJECT || '').trim() || DEFAULT_GEE_PROJECT,
    // Path to a service-account JSON key (keep it in server/secrets/, which is
    // git-ignored). Unset = the credentials stored by `earthengine authenticate`.
    geeServiceAccountKey: String(env.GEE_SERVICE_ACCOUNT_KEY || '').trim() || undefined,
  }
}

// A whole number >= 0 (0 is meaningful), else the default.
function nonNegative(value, fallback) {
  const n = Number(value)
  return value !== undefined && String(value).trim() !== '' && Number.isFinite(n) && n >= 0 ? n : fallback
}

// A typo here would otherwise silently start Python on a host meant to serve
// snapshots only, so an unknown value stops the server at startup.
function forecastMode(value) {
  const mode = String(value || 'live').trim().toLowerCase()
  if (!FORECAST_MODES.includes(mode)) throw new Error(`Unknown FORECAST_MODE "${value}". Use one of: ${FORECAST_MODES.join(', ')}`)
  return mode
}

module.exports = { loadConfig, DEFAULT_TIMESERIES_MAX_VALUES, DEFAULT_FORECAST_TIMEOUT_MS, DEFAULT_FORECAST_RETRY_AFTER_MS, DEFAULT_GEE_PROJECT, FORECAST_MODES }
