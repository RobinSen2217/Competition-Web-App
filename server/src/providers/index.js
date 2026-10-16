// Picks the data provider named by DATA_PROVIDER (default "files"). The rest of
// the server only sees the contract in ./types.js, so switching to a live
// source means adding a provider here, not editing routes or services.

const { createFilesProvider } = require('./files')

const FACTORIES = {
  files: createFilesProvider,
  // nasa: require('./nasa').createNasaProvider,
  //   e.g. NASA POWER for the weather series and the MODIS subset API for NDVI/LST
  //   (see README "Later: live data"). It could wrap the files provider and only
  //   override getTimeseries(), keeping areas, layers and basemap from the files.
}

let cached
// One provider per process, created on first use so data loads once at startup.
function getProvider(name = require('../config').loadConfig().dataProvider) {
  if (cached && cached.name === name) return cached
  const factory = Object.hasOwn(FACTORIES, name) ? FACTORIES[name] : null
  if (!factory) throw new Error(`Unknown DATA_PROVIDER "${name}". Available: ${Object.keys(FACTORIES).join(', ')}`)
  cached = factory()
  return cached
}

module.exports = { getProvider, providerNames: () => Object.keys(FACTORIES) }
