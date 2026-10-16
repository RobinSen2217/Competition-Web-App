// Parameter catalog: what each measured quantity is, independent of where the
// numbers come from. The provider supplies values; this file supplies meaning
// (label, unit, how to aggregate). Kept in step with client/src/lib/params.js.
//
// To add a parameter: add an entry below (order = listing order) and make the
// provider return a series under the same key. A key the provider returns but
// that is missing here is still served, with placeholder metadata (see
// describeUnknown), so new data is never hidden by a missing label.
//
// aggregation: how finer values combine into one interval value. Needed once
// other intervals (or custom areas) are computed from finer data:
//   "mean" average, "sum" total (amounts such as rain), "max" highest value.

const PARAMETERS = [
  {
    key: 'ndvi', label: 'Vegetation greenness', unit: '', decimals: 2, group: 'Land and surface',
    source: 'MODIS MOD13Q1', aggregation: 'max',
    description: 'Normalized difference vegetation index. The monthly value is the greenest 16-day composite of the month (box mean of valid 250 m pixels).',
  },
  {
    key: 'lst_day', label: 'Land surface temp., day', unit: '°C', decimals: 1, group: 'Land and surface',
    source: 'MODIS MOD11A2', aggregation: 'mean', description: 'Daytime land surface temperature from 1 km pixels.',
  },
  {
    key: 'lst_night', label: 'Land surface temp., night', unit: '°C', decimals: 1, group: 'Land and surface',
    source: 'MODIS MOD11A2', aggregation: 'mean', description: 'Night-time land surface temperature from 1 km pixels.',
  },
  {
    key: 'rain', label: 'Rainfall', unit: 'mm', decimals: 0, group: 'Water', source: 'NASA POWER', aggregation: 'sum',
    description: 'Total precipitation (PRECTOTCORR x days in the period).',
  },
  { key: 'tair', label: 'Air temperature', unit: '°C', decimals: 1, group: 'Weather and air', source: 'NASA POWER', aggregation: 'mean', description: 'Air temperature at 2 m (T2M).' },
  { key: 'tmax', label: 'Max air temperature', unit: '°C', decimals: 1, group: 'Weather and air', source: 'NASA POWER', aggregation: 'mean', description: 'Daily maximum air temperature at 2 m (T2M_MAX), averaged.' },
  { key: 'tmin', label: 'Min air temperature', unit: '°C', decimals: 1, group: 'Weather and air', source: 'NASA POWER', aggregation: 'mean', description: 'Daily minimum air temperature at 2 m (T2M_MIN), averaged.' },
  { key: 'dew', label: 'Dewpoint temperature', unit: '°C', decimals: 1, group: 'Weather and air', source: 'NASA POWER', aggregation: 'mean', description: 'Dew/frost point at 2 m (T2MDEW).' },
  { key: 'rh', label: 'Humidity', unit: '%', decimals: 0, group: 'Water', source: 'NASA POWER', aggregation: 'mean', description: 'Relative humidity at 2 m (RH2M).' },
  { key: 'wind', label: 'Wind speed', unit: 'm/s', decimals: 1, group: 'Weather and air', source: 'NASA POWER', aggregation: 'mean', description: 'Wind speed at 2 m (WS2M).' },
  { key: 'sm_top', label: 'Soil moisture, surface', unit: '%', decimals: 0, group: 'Water', source: 'NASA POWER', aggregation: 'mean', description: 'Surface soil wetness (GWETTOP x 100).' },
  { key: 'sm_root', label: 'Soil moisture, root zone', unit: '%', decimals: 0, group: 'Water', source: 'NASA POWER', aggregation: 'mean', description: 'Root zone soil wetness (GWETROOT x 100).' },
  { key: 'albedo', label: 'Surface reflectivity (albedo)', unit: '', decimals: 3, group: 'Land and surface', source: 'NASA POWER', aggregation: 'mean', description: 'All-sky surface albedo (ALLSKY_SRF_ALB).' },
  { key: 'uv', label: 'UV index', unit: '', decimals: 1, group: 'Weather and air', source: 'NASA POWER', aggregation: 'mean', description: 'All-sky surface UV index (ALLSKY_SFC_UV_INDEX).' },
  { key: 'aod', label: 'Aerosol (haze and dust)', unit: 'AOD', decimals: 2, group: 'Weather and air', source: 'NASA POWER', aggregation: 'mean', description: 'Aerosol optical depth at 550 nm (AOD_55).' },
  { key: 'sun', label: 'Sunshine', unit: 'MJ/m²/day', decimals: 1, group: 'Weather and air', source: 'NASA POWER', aggregation: 'mean', description: 'All-sky surface shortwave irradiance (ALLSKY_SFC_SW_DWN).' },
]

// Intervals each parameter is offered at unless an entry says otherwise.
const DEFAULT_INTERVALS = ['monthly']

const byKey = new Map(PARAMETERS.map((p) => [p.key, p]))

// Public shape of a parameter (fixed field order, intervals filled in).
function present(p) {
  const out = {
    key: p.key, label: p.label, unit: p.unit, decimals: p.decimals, group: p.group, source: p.source,
    aggregation: p.aggregation, intervals: p.intervals || DEFAULT_INTERVALS,
  }
  if (p.description) out.description = p.description
  return out
}

// Placeholder for a key that the data has but this catalog does not describe yet.
const describeUnknown = (key) => ({
  key, label: key, unit: '', decimals: 2, group: 'Other', source: '', aggregation: 'mean', intervals: DEFAULT_INTERVALS,
})

const getParameterDef = (key) => (byKey.has(key) ? present(byKey.get(key)) : null)

// Catalog entries first (catalog order), then extra keys the provider reported.
function listParameterDefs(extraKeys = []) {
  const out = PARAMETERS.map(present)
  for (const k of extraKeys) if (!byKey.has(k)) out.push(describeUnknown(k))
  return out
}

module.exports = { PARAMETERS, getParameterDef, listParameterDefs, describeUnknown }
