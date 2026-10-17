// GET /hazards ... : the Disaster module. Hazard types (flood today), their
// events, the parameters measured during an event, an event's daily series
// and irregular observations, its per-day forecast / danger classification
// and its map layers (overlay images). Generic over hazards: everything
// hazard-specific lives in src/catalog/hazards and the hazard's dataset
// (src/services/hazards.js).

const express = require('express')
const { getOnly, servicesOf } = require('../../http/route')
const { ok } = require('../../http/respond')
const { listParam, singleParam, includeParam } = require('../../http/query')

// Layer images change only when the dataset is re-imported, and their URLs
// carry the image hash (?v=), so they may be cached for a day, like the
// website's /map rasters (client/vercel.json).
const CACHE_IMAGE = 'public, max-age=86400'

const router = express.Router()

getOnly(router, '/hazards', async (req, res) => {
  const list = await servicesOf(req).listHazards()
  ok(res, list, { count: list.length })
})

getOnly(router, '/hazards/:hazard', async (req, res) => {
  ok(res, await servicesOf(req).getHazard(req.params.hazard))
})

getOnly(router, '/hazards/:hazard/parameters', async (req, res) => {
  const list = servicesOf(req).listHazardParameters(req.params.hazard)
  ok(res, list, { count: list.length })
})

getOnly(router, '/hazards/:hazard/parameters/:key', async (req, res) => {
  ok(res, servicesOf(req).getHazardParameter(req.params.hazard, req.params.key))
})

// ?country= (list of ISO codes or names), ?bbox=west,south,east,north, ?include=layers
getOnly(router, '/hazards/:hazard/events', async (req, res) => {
  const svc = servicesOf(req)
  const events = await svc.listHazardEvents(req.params.hazard, {
    country: listParam(req.query, 'country'),
    bbox: singleParam(req.query, 'bbox'),
    include: includeParam(req.query, svc.hazardEventIncludeNames),
  })
  ok(res, events, { count: events.length })
})

// ?include=layers
getOnly(router, '/hazards/:hazard/events/:eventId', async (req, res) => {
  const svc = servicesOf(req)
  ok(res, await svc.getHazardEvent(req.params.hazard, req.params.eventId, includeParam(req.query, svc.hazardEventIncludeNames)))
})

getOnly(router, '/hazards/:hazard/events/:eventId/layers', async (req, res) => {
  const layers = await servicesOf(req).listEventLayers(req.params.hazard, req.params.eventId)
  ok(res, layers, { count: layers.length })
})

getOnly(router, '/hazards/:hazard/events/:eventId/layers/:layerId', async (req, res) => {
  ok(res, await servicesOf(req).getEventLayer(req.params.hazard, req.params.eventId, req.params.layerId))
})

// The layer's overlay image itself (PNG today), not a JSON envelope.
getOnly(router, '/hazards/:hazard/events/:eventId/layers/:layerId/image', async (req, res) => {
  const { hazard, eventId, layerId } = req.params
  const file = await servicesOf(req).getEventLayerImage(hazard, eventId, layerId)
  res.set('Cache-Control', CACHE_IMAGE)
  res.type(file.type)
  // cacheControl: false keeps the header above (send would replace it);
  // ETag and Last-Modified still come from the file, so a revalidation is a
  // 304. An error after the bytes started (the client went away) cannot be
  // answered any more, so only an error before that goes to the handler.
  await new Promise((resolve, reject) => {
    res.sendFile(file.path, { cacheControl: false, dotfiles: 'deny' }, (err) => (err && !res.headersSent ? reject(err) : resolve()))
  })
})

// ?parameters=, ?interval=, ?from=, ?to= (the hazard's interval decides the time format)
getOnly(router, '/hazards/:hazard/events/:eventId/timeseries', async (req, res) => {
  const { data, meta } = await servicesOf(req).getEventTimeseries(req.params.hazard, req.params.eventId, {
    parameters: listParam(req.query, 'parameters'),
    interval: singleParam(req.query, 'interval'),
    from: singleParam(req.query, 'from'),
    to: singleParam(req.query, 'to'),
  })
  ok(res, data, meta)
})

// ?models=, ?interval=, ?from=, ?to=
getOnly(router, '/hazards/:hazard/events/:eventId/forecast', async (req, res) => {
  const { data, meta } = await servicesOf(req).getEventForecast(req.params.hazard, req.params.eventId, {
    models: listParam(req.query, 'models'),
    interval: singleParam(req.query, 'interval'),
    from: singleParam(req.query, 'from'),
    to: singleParam(req.query, 'to'),
  })
  ok(res, data, meta)
})

module.exports = router
