// Layer service: merges what the provider reports per area (bounds, interval,
// times, image paths, grid size) with the layer catalog (title, units, scale),
// and serves the value grids behind the images.

const { notFound, invalidQuery } = require('../http/errors')
const { checkTime } = require('../http/query')
const { getLayerDef } = require('../catalog/layers')
const { getInterval } = require('../catalog/intervals')

/**
 * @param {import('../providers/types').DataProvider} provider
 * @param {object} services  uses requireArea
 */
module.exports = function layerService(provider, services) {
  const { requireArea } = services
  const valuesHref = (areaId, layerId) => `/api/v1/areas/${encodeURIComponent(areaId)}/layers/${encodeURIComponent(layerId)}/values`

  // Merges a provider/catalog layer record with its catalog definition.
  function presentLayer(areaId, rec) {
    const def = getLayerDef(rec.id)
    return {
      id: rec.id,
      title: def.title,
      parameter: def.parameter,
      kind: def.kind,
      resolution: def.resolution,
      source: def.source,
      description: def.description,
      bounds: rec.bounds,
      interval: rec.interval ?? null,
      times: rec.times,
      image: rec.image,
      values: def.values && rec.grid
        ? { href: valuesHref(areaId, rec.id), scale: def.values.scale, unit: def.values.unit, width: rec.grid.width, height: rec.grid.height }
        : null,
    }
  }

  // Public layers of an already resolved area record (also used by ?include=layers).
  async function layersOf(area) {
    return (await provider.listLayers(area)).map((r) => presentLayer(area.id, r))
  }

  async function listLayers(areaId) {
    return layersOf(await requireArea(areaId))
  }

  // The area record and the public layer, or 404.
  async function findLayer(areaId, layerId) {
    const area = await requireArea(areaId)
    const rec = (await provider.listLayers(area)).find((r) => r.id === layerId)
    if (!rec) throw notFound(`Unknown layer "${layerId}" for area "${areaId}". See /api/v1/areas/${areaId}/layers.`, { areaId, layerId })
    return { area, layer: presentLayer(areaId, rec) }
  }

  async function getLayer(areaId, layerId) {
    return (await findLayer(areaId, layerId)).layer
  }

  // ?time is checked in this order: static layers have one grid, so a time
  // there is a client mistake (400 rather than silently ignored); a time not
  // written in the layer's interval format is a 400 too (same parser as
  // /timeseries from/to); a well-formed time the layer lacks is a 404.
  async function getLayerValues(areaId, layerId, time) {
    const { area, layer } = await findLayer(areaId, layerId)
    if (!layer.values) throw notFound(`No values for layer "${layerId}" (it is an image only)`, { areaId, layerId })
    if (!layer.times && time !== undefined) {
      throw invalidQuery(`Layer "${layerId}" is static; leave out "time"`, { parameter: 'time', layerId })
    }
    if (layer.times && time !== undefined) {
      if (getInterval(layer.interval)) checkTime('time', time, layer.interval)
      if (!layer.times.includes(time)) throw notFound(`Layer "${layerId}" has no time "${time}"`, { areaId, layerId, time, times: layer.times })
    }
    const values = await provider.getLayerValues(area, layerId, time)
    if (values == null) throw notFound(`No values for layer "${layerId}"`, { areaId, layerId })
    const { scale, unit, width, height } = layer.values
    const out = { layerId, areaId, scale, unit, width, height, bounds: layer.bounds }
    if (layer.times && time !== undefined) out.time = time
    else if (layer.times) out.times = layer.times
    out.values = values
    return out
  }

  return { layersOf, listLayers, getLayer, getLayerValues }
}
