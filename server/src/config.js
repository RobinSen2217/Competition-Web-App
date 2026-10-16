// Runtime settings read from the environment (server/.env is loaded by index.js).
// Read on every call rather than once at require time, so tests can change
// process.env (e.g. CORS_ORIGINS) and build a second app with other settings.

function list(value) {
  return String(value || '').split(',').map((s) => s.trim()).filter(Boolean)
}

const DEFAULT_TIMESERIES_MAX_VALUES = 500000

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
  }
}

module.exports = { loadConfig, DEFAULT_TIMESERIES_MAX_VALUES }
