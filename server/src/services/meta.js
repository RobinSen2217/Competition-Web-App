// Service-level information: health and the basemap mosaics.

const pkg = require('../../package.json')

const API_VERSION = 'v1'
const SERVICE_NAME = 'competition-web-app-api'

/** @param {import('../providers/types').DataProvider} provider */
function metaService(provider) {
  const getBasemap = () => provider.getBasemap()

  async function getHealth() {
    return {
      status: 'ok',
      service: SERVICE_NAME,
      version: pkg.version,
      apiVersion: API_VERSION,
      provider: provider.name,
      dataUpdated: await provider.dataUpdated(),
    }
  }

  return { getBasemap, getHealth }
}

module.exports = Object.assign(metaService, { API_VERSION, SERVICE_NAME })
