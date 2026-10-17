// Hazard data provider ("files"): serves the hazard datasets in
// server/data/hazards/<hazardId>/ through the hazard provider contract
// (HazardProvider in ./types.js). The layout is the one server/ml writes
// (forecaster/hazards/dataset.py), the same for every hazard:
//
//   events.json                   { hazard, interval, generated, description,
//                                   tables: { name: { kind, file, timeColumn, columns } },
//                                   datasets: [...], notes: [...], events: [...] }
//   events/<eventId>/<table>.csv  the tables named in events.json (`file` is a
//                                 pattern with "{eventId}"), first row = header
//   model/<name>.json             model snapshots (e.g. model/forecast.json)
//   layers.json                   optional map layers per event: { layers: { <eventId>:
//                                 [{ id, label, kind, bounds, file, image, legend, stats, ... }] } }
//   events/<eventId>/layers/*     the layers' overlay images (`file` in layers.json)
//
// Values come back raw (CSV cells as strings, JSON as parsed); meaning and
// conversion live in src/catalog/hazards and src/services/hazards.js. Files are
// read on first use and re-read only when they change on disk (a new import or
// build), so requests normally never touch the disk and no restart is needed.
// A live source later (e.g. today's rainfall) would be another provider with
// the same methods.

const fs = require('node:fs')
const path = require('node:path')
const { parseCsv } = require('../util/csv')
const { DEFAULT_DATA_DIR } = require('./files')

const DEFAULT_HAZARDS_DIR = path.join(DEFAULT_DATA_DIR, 'hazards')
// Overlay image formats a layer file may have, by its extension.
const IMAGE_TYPES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' }

// Ids become path segments here, so anything that could leave the folder is
// treated as unknown rather than read.
const SAFE_ID = /^[A-Za-z0-9_-]+$/
const safe = (...ids) => ids.every((id) => typeof id === 'string' && SAFE_ID.test(id))

/**
 * @param {{dir?: string}} [options]  dir: the hazards folder (default server/data/hazards)
 * @returns {import('./types').HazardProvider}
 */
function createHazardFilesProvider({ dir = DEFAULT_HAZARDS_DIR } = {}) {
  // file -> { stamp, value }
  const cache = new Map()

  async function readCached(file, parse) {
    let stat
    try {
      stat = await fs.promises.stat(file)
    } catch (err) {
      if (err.code === 'ENOENT' || err.code === 'ENOTDIR') return null
      throw err
    }
    const stamp = `${stat.mtimeMs}:${stat.size}`
    const hit = cache.get(file)
    if (hit && hit.stamp === stamp) return hit.value
    // A broken file is a broken deployment: let it throw (500, logged).
    const value = { value: parse(await fs.promises.readFile(file, 'utf8'), file), updated: stat.mtime.toISOString() }
    cache.set(file, { stamp, value })
    return value
  }

  const parseJson = (text, file) => {
    try {
      return JSON.parse(text)
    } catch (err) {
      throw new Error(`${path.relative(dir, file)}: ${err.message}`)
    }
  }

  async function manifest(hazardId) {
    if (!safe(hazardId)) return null
    const hit = await readCached(path.join(dir, hazardId, 'events.json'), parseJson)
    if (!hit) return null
    if (!Array.isArray(hit.value.events) || typeof hit.value.tables !== 'object') {
      throw new Error(`hazards/${hazardId}/events.json: needs "events" and "tables"`)
    }
    return hit
  }

  // { eventId: [layer record] }; {} when the hazard has no layers.json.
  async function getLayers(hazardId) {
    if (!safe(hazardId)) return {}
    const hit = await readCached(path.join(dir, hazardId, 'layers.json'), parseJson)
    if (!hit) return {}
    const { layers } = hit.value
    if (!layers || typeof layers !== 'object' || Array.isArray(layers)) {
      throw new Error(`hazards/${hazardId}/layers.json: needs "layers": { eventId: [layer] }`)
    }
    return layers
  }

  return {
    name: 'files',

    async getDataset(hazardId) {
      const m = await manifest(hazardId)
      if (!m) return null
      // eslint-disable-next-line no-unused-vars
      const { events, ...rest } = m.value
      return { ...rest, updated: m.updated }
    },

    async listEvents(hazardId) {
      const m = await manifest(hazardId)
      return m ? m.value.events : []
    },

    async getEvent(hazardId, eventId) {
      const m = await manifest(hazardId)
      if (!m || !safe(eventId)) return null
      return m.value.events.find((e) => e && e.id === eventId) || null
    },

    async getTable(hazardId, eventId, table) {
      const m = await manifest(hazardId)
      const spec = m && Object.hasOwn(m.value.tables, table) ? m.value.tables[table] : null
      if (!spec || !safe(eventId)) return null
      const file = path.join(dir, hazardId, spec.file.split('{eventId}').join(eventId))
      if (!file.startsWith(path.join(dir, hazardId) + path.sep)) return null
      const hit = await readCached(file, (text) => {
        const [header = [], ...rows] = parseCsv(text)
        const columns = header.map((c) => c.trim())
        rows.forEach((r, i) => {
          if (r.length !== columns.length) throw new Error(`${path.relative(dir, file)}: row ${i + 2} has ${r.length} fields, the header ${columns.length}`)
        })
        return { columns, rows, timeColumn: spec.timeColumn || 'date', kind: spec.kind }
      })
      return hit ? { ...hit.value, updated: hit.updated } : null
    },

    getLayers,

    // The overlay image of one layer, for the route to stream: { path, type,
    // size, updated }, or null (unknown layer, missing file, or a `file` that
    // would leave the hazard's folder).
    async getLayerFile(hazardId, eventId, layerId) {
      if (!safe(hazardId, eventId, layerId)) return null
      const layers = await getLayers(hazardId)
      const rec = Object.hasOwn(layers, eventId) && Array.isArray(layers[eventId]) ? layers[eventId].find((l) => l && l.id === layerId) : null
      if (!rec || typeof rec.file !== 'string') return null
      const root = path.resolve(dir, hazardId) + path.sep
      const file = path.resolve(root, rec.file)
      const type = IMAGE_TYPES[path.extname(file).toLowerCase()]
      if (!file.startsWith(root) || !type) return null
      try {
        const stat = await fs.promises.stat(file)
        return stat.isFile() ? { path: file, type, size: stat.size, updated: stat.mtime.toISOString() } : null
      } catch (err) {
        if (err.code === 'ENOENT' || err.code === 'ENOTDIR') return null
        throw err
      }
    },

    async getModel(hazardId, name) {
      if (!safe(hazardId, name)) return null
      const hit = await readCached(path.join(dir, hazardId, 'model', `${name}.json`), parseJson)
      return hit ? { ...hit.value, updated: hit.updated } : null
    },
  }
}

module.exports = { createHazardFilesProvider, DEFAULT_HAZARDS_DIR }
