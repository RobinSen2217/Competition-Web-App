// The /api/v1 router: one sub-router per resource. A breaking change would get
// a new /api/v2 router next to this one, so existing clients keep working.
// Planned resources (docs/API.md "Planned") get their own file here:
//   hazards.js     GET /hazards, /areas/:areaId/hazards (Disaster module)

const express = require('express')
const { cache, CACHE_DATA } = require('../../http/respond')

const router = express.Router()

// Data responses may be cached for five minutes; /health and errors override this.
router.use(cache(CACHE_DATA))

router.use(require('./health'))
router.use(require('./parameters'))
router.use(require('./areas'))
router.use(require('./timeseries'))
router.use(require('./layers'))
router.use(require('./forecasts'))
router.use(require('./basemap'))

module.exports = router
