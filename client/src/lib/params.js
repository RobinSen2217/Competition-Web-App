// Every plottable series.
//   k: parameter key (useTimeseries)   label / short: full and compact names
//   unit: display unit                  dec: decimals for values, ticks and deltas
//   grp: heading the plot builder groups it under
//   sum: an amount that adds up over time (rain): Compare uses yearly totals and
//        % change, and charts start the axis at zero
//   src: data source shown on the chart panel
export const PARAMS = [
  { k: 'ndvi', label: 'Vegetation greenness', short: 'NDVI', unit: '', dec: 2, grp: 'Land and surface', src: 'MODIS MOD13Q1' },
  { k: 'lst_day', label: 'Land surface temp., day', short: 'LST day', unit: '°C', dec: 1, grp: 'Land and surface', src: 'MODIS MOD11A2' },
  { k: 'lst_night', label: 'Land surface temp., night', short: 'LST night', unit: '°C', dec: 1, grp: 'Land and surface', src: 'MODIS MOD11A2' },
  { k: 'albedo', label: 'Surface reflectivity (albedo)', short: 'Albedo', unit: '', dec: 3, grp: 'Land and surface', src: 'NASA POWER' },
  { k: 'rain', label: 'Rainfall', short: 'Rain', unit: 'mm', dec: 0, grp: 'Water', sum: true, src: 'NASA POWER' },
  { k: 'sm_top', label: 'Soil moisture, surface', short: 'Soil (top)', unit: '%', dec: 0, grp: 'Water', src: 'NASA POWER' },
  { k: 'sm_root', label: 'Soil moisture, root zone', short: 'Soil (roots)', unit: '%', dec: 0, grp: 'Water', src: 'NASA POWER' },
  { k: 'rh', label: 'Humidity', short: 'Humidity', unit: '%', dec: 0, grp: 'Water', src: 'NASA POWER' },
  { k: 'tair', label: 'Air temperature', short: 'Air temp.', unit: '°C', dec: 1, grp: 'Weather and air', src: 'NASA POWER' },
  { k: 'dew', label: 'Dewpoint temperature', short: 'Dewpoint', unit: '°C', dec: 1, grp: 'Weather and air', src: 'NASA POWER' },
  { k: 'wind', label: 'Wind speed', short: 'Wind', unit: 'm/s', dec: 1, grp: 'Weather and air', src: 'NASA POWER' },
  { k: 'uv', label: 'UV index', short: 'UV', unit: '', dec: 1, grp: 'Weather and air', src: 'NASA POWER' },
  { k: 'aod', label: 'Aerosol (haze and dust)', short: 'Aerosol', unit: 'AOD', dec: 2, grp: 'Weather and air', src: 'NASA POWER' },
  { k: 'sun', label: 'Sunshine', short: 'Sunshine', unit: 'MJ/m²/day', dec: 1, grp: 'Weather and air', src: 'NASA POWER' },
]

export const P = Object.fromEntries(PARAMS.map((p) => [p.k, p]))

export const fmtv = (k, v) => (v == null || isNaN(v) ? '–' : v.toFixed(P[k].dec))
// °C and % sit right after the number (21.3°C, 40%); other units get a space (12 mm).
export const unitS = (k) => (P[k].unit ? (P[k].unit === '°C' || P[k].unit === '%' ? P[k].unit : ' ' + P[k].unit) : '')
