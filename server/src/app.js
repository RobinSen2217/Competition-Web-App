// Builds the Express app (CORS, the /api/v1 router, 404 and error handling)
// without starting it, so index.js can listen on PORT and tests can listen on
// a random port. createApp({ provider, forecastRunner, forecastTablesDir }) lets
// tests or tools inject a provider, a stand-in for the forecasting module or
// another folder of Earth Engine feature tables.

const express = require('express')
const cors = require('cors')
const { loadConfig } = require('./config')
const { getProvider } = require('./providers')
const { createServices } = require('./services')
const { createProcessRunner } = require('./forecast/runner')
const { notFoundHandler, errorHandler } = require('./http/errors')

// The default runner starts the Python module per request. Not created in
// snapshot mode, so such a server never tries to start Python at all.
function defaultRunner(config) {
  if (config.forecastMode === 'snapshot') return null
  return createProcessRunner({
    ...(config.forecastPython ? { command: config.forecastPython } : {}),
    ...(config.forecastTimeoutMs ? { timeoutMs: config.forecastTimeoutMs } : {}),
  })
}

function createApp({ config = loadConfig(), provider, forecastRunner, forecastSnapshotDir, forecastTablesDir } = {}) {
  const app = express()
  app.disable('x-powered-by')
  // Routes reach the services through req.app.locals (see http/route.js).
  app.locals.services = createServices(provider || getProvider(config.dataProvider), {
    timeseriesMaxValues: config.timeseriesMaxValues,
    forecastMode: config.forecastMode || 'live',
    forecastRunner: forecastRunner === undefined ? defaultRunner(config) : forecastRunner,
    forecastSnapshotDir,
    forecastTablesDir,
    forecastRetryAfterMs: config.forecastRetryAfterMs,
  })

  app.use(cors({ origin: config.corsOrigins, methods: ['GET', 'HEAD', 'OPTIONS'] }))
  app.use('/api/v1', require('./routes/v1'))

  app.use(notFoundHandler)
  app.use(errorHandler)
  return app
}

module.exports = { createApp }
