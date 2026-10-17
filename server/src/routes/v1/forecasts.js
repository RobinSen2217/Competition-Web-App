// GET /areas/:areaId/forecasts: model forecasts of one parameter for one area
// (today NDVI from the notebook's Ridge / neural network / gradient boosting
// models, run by the forecasting module in server/ml). Query: parameters (one
// key, default ndvi), interval, horizon (steps ahead), models (list or "*").
// A live run takes seconds the first time; the service caches the result.

const express = require('express')
const { getOnly, servicesOf } = require('../../http/route')
const { ok } = require('../../http/respond')
const { listParam, singleParam } = require('../../http/query')

const router = express.Router()

getOnly(router, '/areas/:areaId/forecasts', async (req, res) => {
  const { data, meta } = await servicesOf(req).getForecast(req.params.areaId, {
    parameters: listParam(req.query, 'parameters'),
    interval: singleParam(req.query, 'interval'),
    horizon: singleParam(req.query, 'horizon'),
    models: listParam(req.query, 'models'),
  })
  ok(res, data, meta)
})

module.exports = router
