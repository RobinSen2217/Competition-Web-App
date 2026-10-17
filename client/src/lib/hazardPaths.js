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
//
// Each file holds the API's whole response envelope ({ data, meta }) for the
// resource with no query, i.e. everything (all parameters, all models, the
// whole event); the client always asks the API for the same, so both sources
// answer the same question.

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
  if (parts.length === 5 && (sub === 'timeseries' || sub === 'forecast')) return `${hazard}/events/${eventId}/${sub}.json`
  return null
}
