// Loads the data files in server/data once at startup and builds the lookups the
// routes use. Nothing here is fetched live yet: the files are copies of what the
// website used to bundle (see README "Data files" and "Later: live data").
//
//   climate.json     { months: ["2010-01", ...], cities: { id: { name, state, lat, lon, series } } }
//   boundaries.json  { id: GeoJSON geometry }
//   mapmeta.json     basemap mosaic bounds/zoom, returned as is
//   rasters.json     per-city raster bounds and static image paths
//   pixels/<id>.json per-pixel values behind the raster images

const fs = require('node:fs')
const path = require('node:path')

const DATA_DIR = path.join(__dirname, '..', 'data')

const readJson = (file) => JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), 'utf8'))

const climate = readJson('climate.json')
const boundaries = readJson('boundaries.json')
const mosaics = readJson('mapmeta.json')
const rawRasters = readJson('rasters.json')

const cityIds = Object.keys(climate.cities)
const months = climate.months

// Object.hasOwn guards against ids like "__proto__" or "toString" resolving to
// inherited properties of the plain objects above.
const hasCity = (id) => typeof id === 'string' && Object.hasOwn(climate.cities, id)

// Per-pixel grids, one file per city. Loaded up front (~0.7 MB in total) so a
// request never touches the disk.
const pixels = {}
for (const id of cityIds) {
  const file = path.join('pixels', `${id}.json`)
  if (fs.existsSync(path.join(DATA_DIR, file))) pixels[id] = readJson(file)
}

// Raster metadata as the API exposes it. The old "values" field pointed at a
// static values.json; the same numbers are now served by /api/cities/:id/pixels.
// Image paths stay as they are: the images are static files on the website.
const rasters = {}
for (const [id, r] of Object.entries(rawRasters)) {
  // eslint-disable-next-line no-unused-vars
  const { values, ...rest } = r
  rasters[id] = { ...rest, pixels: `/api/cities/${id}/pixels` }
}

// Display metadata for every series key. Kept in step with client/src/lib/params.js.
// "sun" is NASA POWER ALLSKY_SFC_SW_DWN, which is in MJ/m²/day (not kWh).
const PARAMETER_META = {
  ndvi: { label: 'Vegetation greenness', unit: '', decimals: 2, group: 'Land and surface', source: 'MODIS MOD13Q1' },
  lst_day: { label: 'Land surface temp., day', unit: '°C', decimals: 1, group: 'Land and surface', source: 'MODIS MOD11A2' },
  lst_night: { label: 'Land surface temp., night', unit: '°C', decimals: 1, group: 'Land and surface', source: 'MODIS MOD11A2' },
  albedo: { label: 'Surface reflectivity (albedo)', unit: '', decimals: 3, group: 'Land and surface', source: 'NASA POWER' },
  rain: { label: 'Rainfall', unit: 'mm', decimals: 0, group: 'Water', source: 'NASA POWER', isSum: true },
  sm_top: { label: 'Soil moisture, surface', unit: '%', decimals: 0, group: 'Water', source: 'NASA POWER' },
  sm_root: { label: 'Soil moisture, root zone', unit: '%', decimals: 0, group: 'Water', source: 'NASA POWER' },
  rh: { label: 'Humidity', unit: '%', decimals: 0, group: 'Water', source: 'NASA POWER' },
  tair: { label: 'Air temperature', unit: '°C', decimals: 1, group: 'Weather and air', source: 'NASA POWER' },
  tmax: { label: 'Max air temperature', unit: '°C', decimals: 1, group: 'Weather and air', source: 'NASA POWER' },
  tmin: { label: 'Min air temperature', unit: '°C', decimals: 1, group: 'Weather and air', source: 'NASA POWER' },
  dew: { label: 'Dewpoint temperature', unit: '°C', decimals: 1, group: 'Weather and air', source: 'NASA POWER' },
  wind: { label: 'Wind speed', unit: 'm/s', decimals: 1, group: 'Weather and air', source: 'NASA POWER' },
  uv: { label: 'UV index', unit: '', decimals: 1, group: 'Weather and air', source: 'NASA POWER' },
  aod: { label: 'Aerosol (haze and dust)', unit: 'AOD', decimals: 2, group: 'Weather and air', source: 'NASA POWER' },
  sun: { label: 'Sunshine', unit: 'MJ/m²/day', decimals: 1, group: 'Weather and air', source: 'NASA POWER' },
}

// Every series key present in the data, in the order the first city lists them,
// plus any key only some cities have (none today, but cheap to be safe).
const seriesKeys = []
for (const id of cityIds) {
  for (const k of Object.keys(climate.cities[id].series)) if (!seriesKeys.includes(k)) seriesKeys.push(k)
}

// Keys without metadata still get listed (label = key) so a new series in the
// data shows up in the API before anyone writes its label.
const parameters = seriesKeys.map((key) => {
  const m = PARAMETER_META[key] || { label: key, unit: '', decimals: 2, group: 'Other', source: '' }
  return { key, label: m.label, unit: m.unit, decimals: m.decimals, group: m.group, source: m.source, isSum: Boolean(m.isSum) }
})

// "When was the data last changed": newest modification time among the data
// files. Good enough until a live pipeline records its own fetch time.
function newestMtime(dir) {
  let newest = 0
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name)
    if (entry.isDirectory()) newest = Math.max(newest, newestMtime(p))
    else if (entry.name.endsWith('.json')) newest = Math.max(newest, fs.statSync(p).mtimeMs)
  }
  return newest
}
const dataUpdated = new Date(newestMtime(DATA_DIR)).toISOString()

module.exports = {
  climate,
  boundaries,
  mosaics,
  rasters,
  pixels,
  months,
  cityIds,
  hasCity,
  seriesKeys,
  parameters,
  dataUpdated,
}
