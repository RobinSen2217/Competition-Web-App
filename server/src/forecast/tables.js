// The forecasts' input data: one monthly feature table per area, written by
// the Earth Engine pipeline in server/ml (`npm run gee:extract`, a port of the
// team notebook GEE_Data_Pipeline_Lat_Long_08_10_26):
//
//   data/gee/areas.json             [{ id, name, lat, lon, halfWidthKm, state }]
//                                   the box (centre +- halfWidthKm) each table
//                                   was extracted for
//   data/gee/<areaId>.features.csv  the notebook's final CSV ("v4_physics_big_Final"):
//                                   a `date` column (YYYY-MM-DD, first of the
//                                   month) and one column per feature, empty
//                                   where Earth Engine had no value
//
// The tables are passed to the forecasting module as they are (column names
// and all); which columns the model uses is the module's business. This file
// only parses them, so the service can tell "no table yet" from "a table".
// Not part of the files provider: the site's own data (climate.json) is a
// different source and is no longer used for forecasts.

const fs = require('node:fs')
const path = require('node:path')
const { DEFAULT_DATA_DIR } = require('../providers/files')
const { parseCsv } = require('../util/csv')

const DEFAULT_TABLES_DIR = path.join(DEFAULT_DATA_DIR, 'gee')
const DATE_COLUMN = 'date'

// Ids become a file name here, so anything that could leave the folder is refused.
const SAFE_ID = /^[A-Za-z0-9_-]+$/
const tableFile = (dir, areaId) => {
  if (!SAFE_ID.test(areaId)) throw new Error(`Unsafe area id for a feature table: ${areaId}`)
  return path.join(dir, `${areaId}.features.csv`)
}

// A cell as JSON: a number, or null for an empty / NaN / inf cell (pandas
// writes missing values as empty fields).
function cellValue(s) {
  const t = s.trim()
  if (t === '') return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

// "2010-01-01" or "2010-01-01 00:00:00" -> "2010-01-01"
function dateValue(s) {
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(s.trim())
  if (!m) throw new Error(`bad date "${s}"`)
  return m[1]
}

function parseTable(text, where) {
  const [header, ...body] = parseCsv(text)
  if (!header) throw new Error(`${where}: empty file`)
  const columns = header.map((c) => c.trim())
  const di = columns.indexOf(DATE_COLUMN)
  if (di < 0) throw new Error(`${where}: no "${DATE_COLUMN}" column`)
  const rows = body.map((cells, r) => {
    if (cells.length !== columns.length) throw new Error(`${where}: row ${r + 2} has ${cells.length} fields, the header ${columns.length}`)
    return cells.map((c, i) => (i === di ? dateValue(c) : cellValue(c)))
  })
  // The notebook sorts by date before saving; sorted again so a hand-edited
  // file cannot hand the model months out of order.
  rows.sort((a, b) => (a[di] < b[di] ? -1 : a[di] > b[di] ? 1 : 0))
  return { columns, rows }
}

/**
 * @param {{dir?: string}} [options]  dir: folder with areas.json and the tables
 */
function createTableSource({ dir = DEFAULT_TABLES_DIR } = {}) {
  // file -> { stamp, value }. Re-read only when the file changes (a new
  // extraction), so requests normally never parse the CSV again.
  const parsed = new Map()
  async function readCached(file, parse) {
    let stat
    try {
      stat = await fs.promises.stat(file)
    } catch (err) {
      if (err.code === 'ENOENT') return null
      throw err
    }
    const stamp = `${stat.mtimeMs}:${stat.size}`
    const hit = parsed.get(file)
    if (hit && hit.stamp === stamp) return hit.value
    const value = { ...parse(await fs.promises.readFile(file, 'utf8')), updated: stat.mtime.toISOString() }
    parsed.set(file, { stamp, value })
    return value
  }

  // The area's extraction settings from areas.json, or null when it has none.
  async function getAreaConfig(areaId) {
    const file = path.join(dir, 'areas.json')
    const list = await readCached(file, (text) => ({ areas: JSON.parse(text) }))
    const found = list && Array.isArray(list.areas) ? list.areas.find((a) => a && a.id === areaId) : null
    return found || null
  }

  // { columns, rows, updated } for the area, or null when nothing has been
  // extracted for it yet. `updated` (the file's modification time) is the
  // table's version: a new extraction means new forecasts.
  // A malformed table throws: that is a broken deployment, not "no data".
  async function getTable(areaId) {
    const file = tableFile(dir, areaId)
    return readCached(file, (text) => parseTable(text, path.basename(file)))
  }

  return { dir, getAreaConfig, getTable }
}

module.exports = { createTableSource, parseTable, DEFAULT_TABLES_DIR, DATE_COLUMN }
