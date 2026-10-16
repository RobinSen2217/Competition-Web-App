// Builds the Express app (CORS, the /api/v1 router, 404 and error handling)
// without starting it, so index.js can listen on PORT and tests can listen on
// a random port. createApp({ provider }) lets tests or tools inject a provider.

const express = require('express')
const cors = require('cors')
const { loadConfig } = require('./config')
const { getProvider } = require('./providers')
const { createServices } = require('./services')
const { notFoundHandler, errorHandler } = require('./http/errors')

function createApp({ config = loadConfig(), provider } = {}) {
  const app = express()
  app.disable('x-powered-by')
  // Routes reach the services through req.app.locals (see http/route.js).
  app.locals.services = createServices(provider || getProvider(config.dataProvider), {
    timeseriesMaxValues: config.timeseriesMaxValues,
  })

  app.use(cors({ origin: config.corsOrigins, methods: ['GET', 'HEAD', 'OPTIONS'] }))
  app.use('/api/v1', require('./routes/v1'))

  app.use(notFoundHandler)
  app.use(errorHandler)
  return app
}

module.exports = { createApp }
