// GET /areas, /areas/:areaId and /areas/:areaId/boundary. An area is any place
// the API has data for (type "city" today; custom areas later). Optional
// extras come with ?include=boundary,layers (or "*").

const express = require('express')
const { getOnly, servicesOf } = require('../../http/route')
const { ok } = require('../../http/respond')
const { listParam, includeParam } = require('../../http/query')

const router = express.Router()

getOnly(router, '/areas', async (req, res) => {
  const svc = servicesOf(req)
  const include = includeParam(req.query, svc.areaIncludeNames)
  const areas = await svc.listAreas({ types: listParam(req.query, 'type'), include })
  ok(res, areas, { count: areas.length })
})

getOnly(router, '/areas/:areaId', async (req, res) => {
  const svc = servicesOf(req)
  const include = includeParam(req.query, svc.areaIncludeNames)
  ok(res, await svc.getArea(req.params.areaId, include))
})

getOnly(router, '/areas/:areaId/boundary', async (req, res) => {
  ok(res, await servicesOf(req).getBoundary(req.params.areaId))
})

// Reserved (see docs/API.md "Planned"): POST /areas for custom areas of
// interest, GET /areas/:areaId/forecasts and /areas/:areaId/hazards.

module.exports = router
