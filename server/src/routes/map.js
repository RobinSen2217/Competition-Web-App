// Bulk map endpoints: district outlines, basemap mosaics and raster metadata for
// every city in one response each (the map loads them all at startup).

const express = require('express')
const data = require('../data')

const router = express.Router()

router.get('/boundaries', (req, res) => {
  res.json(data.boundaries)
})

router.get('/map/mosaics', (req, res) => {
  res.json(data.mosaics)
})

router.get('/map/rasters', (req, res) => {
  res.json(data.rasters)
})

module.exports = router
