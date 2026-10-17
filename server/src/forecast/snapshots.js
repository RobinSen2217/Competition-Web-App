// Saved forecasts ("snapshots"): one file per area and target,
// data/forecasts/<areaId>.<target>.json, written by `npm run forecasts:build`.
// The file is a complete API response ({data, meta}, data.source "snapshot")
// for the largest request (HORIZON.max months, every model), so any valid
// request can be answered from it by dropping models and trimming months.
// The client bundles a copy as its offline fallback and reads the same shape.
//
// Snapshots let the API answer where Python cannot run (FORECAST_MODE=snapshot)
// and keep forecasts available when a live run fails. They are built from the
// Earth Engine feature tables (data/gee), so an area gets one only after its
// table has been extracted.

const fs = require('node:fs')
const path = require('node:path')
const { DEFAULT_DATA_DIR } = require('../providers/files')

const DEFAULT_SNAPSHOT_DIR = path.join(DEFAULT_DATA_DIR, 'forecasts')

// Ids come from the provider, but they also become a file name here, so
// anything that could leave the folder is refused outright.
const SAFE_ID = /^[A-Za-z0-9_-]+$/
const fileName = (areaId, target) => {
  if (!SAFE_ID.test(areaId) || !SAFE_ID.test(target)) throw new Error(`Unsafe snapshot name ${areaId}.${target}`)
  return `${areaId}.${target}.json`
}

// The saved envelope, or null when there is none (or it cannot be read: a
// broken snapshot must not turn a fallback into a 500). A snapshot without
// `provenance` predates the Earth Engine pipeline (it was computed from the
// site's climate.json) and is ignored rather than served as if it were current.
async function readSnapshot(dir, areaId, target) {
  try {
    const body = JSON.parse(await fs.promises.readFile(path.join(dir, fileName(areaId, target)), 'utf8'))
    return body && body.data && body.data.models && body.data.provenance ? body : null
  } catch (err) {
    if (err.code !== 'ENOENT') console.warn(`Ignoring unreadable forecast snapshot ${areaId}.${target}: ${err.message}`)
    return null
  }
}

// What a snapshot can answer, for error messages: { horizon, models }.
const coverageOf = (snapshot) => ({
  horizon: snapshot.data.forecastTimes.length,
  models: Object.keys(snapshot.data.models),
})

// The snapshot's data narrowed to the request, or null when it cannot answer
// it (other interval, a model it lacks, more months than it holds).
function fitSnapshot(snapshot, { target, interval, horizon, models }) {
  const d = snapshot.data
  if (d.target !== target || d.interval !== interval) return null
  if (!Array.isArray(d.forecastTimes) || d.forecastTimes.length < horizon) return null
  if (!models.every((m) => d.models[m] && Array.isArray(d.models[m].forecast) && d.models[m].forecast.length >= horizon)) return null
  return {
    ...d,
    forecastTimes: d.forecastTimes.slice(0, horizon),
    models: Object.fromEntries(models.map((m) => [m, { ...d.models[m], forecast: d.models[m].forecast.slice(0, horizon) }])),
  }
}

// Writes the envelope into every directory (the server's and the client's
// bundled copy). Written to a temp file first and renamed, so a server reading
// the snapshot meanwhile never sees half a file.
function writeSnapshot(dirs, areaId, target, envelope) {
  const name = fileName(areaId, target)
  const text = `${JSON.stringify(envelope)}\n`
  return dirs.map((dir) => {
    fs.mkdirSync(dir, { recursive: true })
    const file = path.join(dir, name)
    const tmp = `${file}.${process.pid}.tmp`
    fs.writeFileSync(tmp, text)
    fs.renameSync(tmp, file)
    return file
  })
}

module.exports = { DEFAULT_SNAPSHOT_DIR, readSnapshot, fitSnapshot, coverageOf, writeSnapshot }
