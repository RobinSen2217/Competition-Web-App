// Where each hazard API resource lives in the static snapshot
// (public/data/hazards/), shared by lib/hazards.js (which reads the snapshot)
// and scripts/snapshot-hazards.mjs (which writes it), so the two can never
// disagree about a file name.
//
// RULE: no imports and no import.meta here; the snapshot script runs this
// file under plain Node.
//
//   /hazards                                  -> index.json
//   /hazards/flood                            -> flood/hazard.json
//   /hazards/flood/parameters                 -> flood/parameters.json
//   /hazards/flood/events                     -> flood/events.json
//   /hazards/flood/events/<id>                -> flood/events/<id>.json
//   /hazards/flood/events/<id>/timeseries     -> flood/events/<id>/timeseries.json
//   /hazards/flood/events/<id>/forecast       -> flood/events/<id>/forecast.json
//   /hazards/flood/events/<id>/layers         -> flood/events/<id>/layers.json
//   a layer's overlay image                   -> flood/events/<id>/layers/<layerId>.<format>
//
// Each JSON file holds the API's whole response envelope ({ data, meta }) for
// the resource with no query, i.e. everything (all parameters, all models, the
// whole event); the client always asks the API for the same, so both sources
// answer the same question. Layer images are the API's image bytes unchanged;
// the saved layers.json keeps the API's own `url`s, so the client maps a layer
// to its saved image with snapshotLayerImage() instead.

// Ids are lowercase and URL-safe by the API's contract; anything else is
// refused rather than turned into a surprising path.
const ID = /^[a-z0-9][a-z0-9_.-]*$/

/**
 * Snapshot file (relative to public/data/hazards/) for an API path relative to
 * /api/v1, or null when the path has no snapshot.
 * @param {string} path  e.g. '/hazards/flood/events/09_thailand_bangkok/forecast'
 * @returns {string | null}  e.g. 'flood/events/09_thailand_bangkok/forecast.json'
 */
export function snapshotFile(path) {
  const parts = path.replace(/^\/+|\/+$/g, '').split('/')
  if (parts[0] !== 'hazards') return null
  const [, hazard, kind, eventId, sub] = parts
  if (parts.length === 1) return 'index.json'
  if (!ID.test(hazard)) return null
  if (parts.length === 2) return `${hazard}/hazard.json`
  if (parts.length === 3 && (kind === 'parameters' || kind === 'events')) return `${hazard}/${kind}.json`
  if (kind !== 'events' || !ID.test(eventId || '')) return null
  if (parts.length === 4) return `${hazard}/events/${eventId}.json`
  if (parts.length === 5 && (sub === 'timeseries' || sub === 'forecast' || sub === 'layers')) return `${hazard}/events/${eventId}/${sub}.json`
  return null
}

/**
 * Snapshot file (relative to public/data/hazards/) of one layer's overlay
 * image, or null when an id or the format is not a plain name.
 * @param {string} hazard
 * @param {string} eventId
 * @param {{ id: string, image?: { format?: string } }} layer  as /layers returns it
 * @returns {string | null}  e.g. 'flood/events/09_thailand_bangkok/layers/water-reference.png'
 */
export function snapshotLayerImage(hazard, eventId, layer) {
  const format = layer?.image?.format || 'png'
  if (![hazard, eventId, layer?.id].every((x) => ID.test(x || '')) || !/^[a-z0-9]+$/.test(format)) return null
  return `${hazard}/events/${eventId}/layers/${layer.id}.${format}`
}
