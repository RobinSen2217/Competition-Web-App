// GET /health: liveness plus versions and data freshness. Meant for uptime
// checks, so it is never cached.

const express = require('express')
const { getOnly, servicesOf } = require('../../http/route')
const { ok, CACHE_NONE } = require('../../http/respond')

const router = express.Router()

getOnly(router, '/health', async (req, res) => {
  res.set('Cache-Control', CACHE_NONE)
  ok(res, await servicesOf(req).getHealth())
})

module.exports = router
