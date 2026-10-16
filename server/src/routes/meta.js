// Service-level endpoints: health check, parameter list and the bulk climate
// download the website loads at startup.

const express = require('express')
const data = require('../data')

const router = express.Router()

// Health is meant for uptime checks, so it must never be served from a cache.
router.get('/health', (req, res) => {
  res.set('Cache-Control', 'no-store')
  res.json({
    status: 'ok',
    service: 'competition-web-app-api',
    dataUpdated: data.dataUpdated,
    cities: data.cityIds.length,
    months: data.months.length,
  })
})

router.get('/parameters', (req, res) => {
  res.json({ parameters: data.parameters })
})

// Exactly the shape of the old client/src/data/climate.json, so the website's
// data layer did not have to change when it moved to the API.
router.get('/climate', (req, res) => {
  res.json(data.climate)
})

module.exports = router
