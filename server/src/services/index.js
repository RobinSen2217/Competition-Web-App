// Business logic between the HTTP routes and the data provider: validation
// against the catalogs, "*" resolution, include handling, interval checks and
// assembling public objects. Routes only parse HTTP and call these; providers
// only return raw facts. Every function takes already-parsed query values.
//
// One file per resource. createServices(provider, options) combines them into
// one object that each part can also use (e.g. areas embed layers, timeseries
// resolves areas). To add a resource (e.g. hazards), write
// services/<name>.js with the same (provider, services, options) signature and
// add it to PARTS. `options` holds limits from the config (see config.js).

const PARTS = [
  require('./parameters'),
  require('./areas'),
  require('./layers'),
  require('./timeseries'),
  require('./forecasts'),
  require('./meta'),
]

/**
 * @param {import('../providers/types').DataProvider} provider
 * @param {{timeseriesMaxValues?: number, forecastRunner?: object|null, forecastMode?: string,
 *          forecastSnapshotDir?: string, forecastTablesDir?: string, forecastCacheSize?: number,
 *          forecastRetryAfterMs?: number}} [options]
 */
function createServices(provider, options = {}) {
  const services = {}
  // Later parts may destructure earlier ones at creation time; parts that call
  // each other only at request time (areas -> layers) look them up lazily.
  for (const part of PARTS) Object.assign(services, part(provider, services, options))
  return services
}

module.exports = { createServices }
