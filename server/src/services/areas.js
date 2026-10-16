// Area service: area lookup, ?areas= resolution, type filtering, ?include=
// expansion and boundaries. Areas are generic (type "city" today) so custom
// areas of interest can be added later as another type.

const { notFound } = require('../http/errors')
const { ALL } = require('../http/query')

/**
 * @param {import('../providers/types').DataProvider} provider
 * @param {object} services  the combined services (for includes that use other resources)
 */
// Administrative level of each area type's outline (Feature properties.level).
const BOUNDARY_LEVEL = { city: 'district' }

module.exports = function areaService(provider, services) {
  async function requireArea(id) {
    const area = await provider.getArea(id)
    if (!area) throw notFound(`Unknown area "${id}". See /api/v1/areas for valid ids.`, { areaId: id })
    return area
  }

  // Keeps the areas whose type is in `types` (undefined or ALL = every type).
  const ofTypes = (areas, types) => (types === undefined || types === ALL ? areas : areas.filter((a) => types.includes(a.type)))

  // ALL or a list of ids -> area records, in request order (ALL = data order).
  // `types` filters the ALL expansion only: ids that were asked for by name
  // are returned as asked.
  async function resolveAreas(requested, { types } = {}) {
    if (requested === ALL) return ofTypes(await provider.listAreas(), types)
    const found = await Promise.all(requested.map((id) => provider.getArea(id)))
    const unknown = requested.filter((id, i) => !found[i])
    if (unknown.length) throw notFound(`Unknown area(s): ${unknown.join(', ')}. See /api/v1/areas.`, { unknown })
    return found
  }

  // Optional extras an area can embed with ?include=. Add an entry to offer a
  // new one (e.g. a forecast summary or current hazards later).
  const AREA_INCLUDES = {
    boundary: async (area) => provider.getBoundary(area),
    layers: async (area) => services.layersOf(area), // defined later, looked up per request
  }
  const areaIncludeNames = Object.keys(AREA_INCLUDES)

  async function expandArea(area, include = new Set()) {
    const out = { ...area }
    for (const name of areaIncludeNames) if (include.has(name)) out[name] = await AREA_INCLUDES[name](area)
    return out
  }

  async function listAreas({ types, include } = {}) {
    const areas = ofTypes(await provider.listAreas(), types)
    return Promise.all(areas.map((a) => expandArea(a, include)))
  }

  async function getArea(id, include) {
    return expandArea(await requireArea(id), include)
  }

  async function getBoundary(id) {
    const area = await requireArea(id)
    const geometry = await provider.getBoundary(area)
    if (!geometry) throw notFound(`No boundary for area "${id}"`, { areaId: id })
    return { type: 'Feature', properties: { areaId: area.id, name: area.name, level: BOUNDARY_LEVEL[area.type] || area.type }, geometry }
  }

  return { areaIncludeNames, requireArea, resolveAreas, listAreas, getArea, getBoundary }
}
