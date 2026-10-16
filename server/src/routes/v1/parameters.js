// GET /parameters and /parameters/:key: what each series key means
// (label, unit, decimals, aggregation, available intervals).

const express = require('express')
const { getOnly, servicesOf } = require('../../http/route')
const { ok } = require('../../http/respond')

const router = express.Router()

getOnly(router, '/parameters', async (req, res) => {
  const list = await servicesOf(req).listParameters()
  ok(res, list, { count: list.length })
})

getOnly(router, '/parameters/:key', async (req, res) => {
  ok(res, await servicesOf(req).getParameter(req.params.key))
})

module.exports = router
