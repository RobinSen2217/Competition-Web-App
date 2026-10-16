// GET /basemap: the pre-rendered satellite mosaics (static website images) with
// their bounds and native zoom. Pure data: which mosaic to show at which zoom
// is a display decision left to the client.

const express = require('express')
const { getOnly, servicesOf } = require('../../http/route')
const { ok } = require('../../http/respond')

const router = express.Router()

getOnly(router, '/basemap', async (req, res) => {
  const basemap = await servicesOf(req).getBasemap()
  ok(res, basemap, { count: basemap.mosaics.length })
})

module.exports = router
