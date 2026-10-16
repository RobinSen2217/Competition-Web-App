// GET /areas/:areaId/layers[/:layerId[/values]]: map layers of an area. The
// layer object points at static images (served by the website) and, when the
// layer has numbers behind it, at its /values grid.

const express = require('express')
const { getOnly, servicesOf } = require('../../http/route')
const { ok } = require('../../http/respond')
const { singleParam } = require('../../http/query')

const router = express.Router()

getOnly(router, '/areas/:areaId/layers', async (req, res) => {
  const layers = await servicesOf(req).listLayers(req.params.areaId)
  ok(res, layers, { count: layers.length })
})

getOnly(router, '/areas/:areaId/layers/:layerId', async (req, res) => {
  ok(res, await servicesOf(req).getLayer(req.params.areaId, req.params.layerId))
})

getOnly(router, '/areas/:areaId/layers/:layerId/values', async (req, res) => {
  const { areaId, layerId } = req.params
  ok(res, await servicesOf(req).getLayerValues(areaId, layerId, singleParam(req.query, 'time')))
})

module.exports = router
