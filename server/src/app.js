// Builds the Express app (routes, CORS, caching, errors) without starting it,
// so index.js can listen on PORT and the tests can listen on a random port.

const express = require('express')
const cors = require('cors')
const { notFound, errorHandler } = require('./errors')

function corsOrigin() {
  // CORS_ORIGINS="https://a.com,https://b.com" allows just those; unset (or "*")
  // allows any origin, which is fine for a read-only public data API.
  const list = (process.env.CORS_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean)
  return list.length === 0 || list.includes('*') ? '*' : list
}

function createApp() {
  const app = express()
  app.disable('x-powered-by')
  app.use(cors({ origin: corsOrigin(), methods: ['GET', 'HEAD', 'OPTIONS'] }))

  // The data only changes when the files are replaced, so let browsers and CDNs
  // reuse responses for five minutes. /api/health and errors override this.
  app.use('/api', (req, res, next) => {
    res.set('Cache-Control', 'public, max-age=300')
    next()
  })

  app.use('/api', require('./routes/meta'))
  app.use('/api', require('./routes/cities'))
  app.use('/api', require('./routes/map'))

  app.use(notFound)
  app.use(errorHandler)
  return app
}

module.exports = { createApp }
