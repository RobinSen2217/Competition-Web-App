// GET /timeseries (many areas) and /areas/:areaId/timeseries (one area).
// Both share one query shape: parameters, interval, from, to.

const express = require('express')
const { getOnly, servicesOf } = require('../../http/route')
const { ok } = require('../../http/respond')
const { ALL, listParam, intervalParam, rangeParams } = require('../../http/query')

const router = express.Router()

// The query fields common to both routes. The interval is read first because
// it decides the format of from/to.
function seriesQuery(query) {
  const interval = intervalParam(query)
  return { interval, ...rangeParams(query, interval), parameters: listParam(query, 'parameters') ?? ALL }
}

// ?type= filters areas=* by area type (as on /areas); ids listed by name are
// returned as asked.
getOnly(router, '/timeseries', async (req, res) => {
  const areas = listParam(req.query, 'areas', { required: true })
  const types = listParam(req.query, 'type')
  const { data, meta } = await servicesOf(req).getTimeseries({ areas, types, ...seriesQuery(req.query) })
  ok(res, data, meta)
})

getOnly(router, '/areas/:areaId/timeseries', async (req, res) => {
  const id = req.params.areaId
  const { data, meta } = await servicesOf(req).getTimeseries({ areas: [id], ...seriesQuery(req.query) })
  ok(res, { interval: data.interval, times: data.times, series: data.areas[id] }, meta)
})

module.exports = router
