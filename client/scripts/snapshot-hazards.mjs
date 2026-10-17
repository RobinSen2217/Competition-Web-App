#!/usr/bin/env node
/*
  Saves the hazard API's answers as static files in public/data/hazards/, the
  copy the site uses when it has no API with hazard data (a static deploy, or
  a hosted API still running an older server). See src/lib/hazards.js.

    npm run hazards:snapshot                          # API at http://localhost:5050
    npm run hazards:snapshot -- http://localhost:5097 # another server

  Walks the API instead of reading the server's files, so the copy is exactly
  what the API answers (same shapes, same rounding): /hazards, then for every
  hazard its detail, parameters and events, and for every event its detail,
  whole series and whole forecast (when the hazard has one). File names come
  from src/lib/hazardPaths.js, the same table the client reads them with.

  The folder is rebuilt from scratch, so a removed event or hazard does not
  leave a stale file behind. Nothing is written unless every request worked.
*/
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { snapshotFile } from '../src/lib/hazardPaths.js'

const base = (process.argv[2] || process.env.API_URL || 'http://localhost:5050').replace(/\/+$/, '')
const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'data', 'hazards')

// path (relative to /api/v1) -> envelope
const files = new Map()

async function get(path) {
  const url = `${base}/api/v1${path}`
  const res = await fetch(url, { headers: { Accept: 'application/json' } })
  const body = await res.json().catch(() => null)
  if (!res.ok || !body || !('data' in body)) throw new Error(`${url}: ${body?.error?.message || `HTTP ${res.status}`}`)
  if (!snapshotFile(path)) throw new Error(`${path}: no snapshot file name (see src/lib/hazardPaths.js)`)
  files.set(path, body)
  return body.data
}

const hazards = await get('/hazards')
for (const h of hazards) {
  const hp = `/hazards/${encodeURIComponent(h.id)}`
  const detail = await get(hp)
  await get(`${hp}/parameters`)
  const events = await get(`${hp}/events`)
  for (const e of events) {
    const ep = `${hp}/events/${encodeURIComponent(e.id)}`
    await get(ep)
    await get(`${ep}/timeseries`)
    // Every event of a hazard with a forecast has a forecast resource, also
    // the excluded ones (available: false with the reason), so save them all
    if (detail.forecast) await get(`${ep}/forecast`)
  }
  console.log(`${h.id}: ${events.length} events`)
}

await rm(outDir, { recursive: true, force: true })
let bytes = 0
for (const [path, body] of files) {
  const file = join(outDir, snapshotFile(path))
  await mkdir(dirname(file), { recursive: true })
  const text = JSON.stringify(body)
  bytes += text.length
  await writeFile(file, text + '\n')
}
console.log(`Saved ${files.size} responses from ${base} (${Math.round(bytes / 1024)} KB) to ${outDir}`)
