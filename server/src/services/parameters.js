// Parameter service: the catalog (src/catalog/parameters.js) merged with the
// keys the provider actually has, and resolution of ?parameters= lists.

const { notFound, invalidParameter } = require('../http/errors')
const { ALL } = require('../http/query')
const { listParameterDefs, getParameterDef, describeUnknown } = require('../catalog/parameters')

/** @param {import('../providers/types').DataProvider} provider */
module.exports = function parameterService(provider) {
  async function listParameters() {
    return listParameterDefs(await provider.listParameterKeys())
  }

  async function getParameter(key) {
    const known = (await provider.listParameterKeys()).includes(key)
    const def = getParameterDef(key) || (known ? describeUnknown(key) : null)
    if (!def) throw notFound(`Unknown parameter "${key}". See /api/v1/parameters for valid keys.`, { key })
    return def
  }

  // ALL or a list of keys -> the parameter objects, in request order.
  async function resolveParameters(requested = ALL) {
    const all = await listParameters()
    if (requested === ALL) return all
    const byKey = new Map(all.map((p) => [p.key, p]))
    const unknown = requested.filter((k) => !byKey.has(k))
    if (unknown.length) {
      throw invalidParameter(`Unknown parameter(s): ${unknown.join(', ')}`, { unknown, valid: [...byKey.keys()] })
    }
    return requested.map((k) => byKey.get(k))
  }

  return { listParameters, getParameter, resolveParameters }
}
