// node test/fixtures/gee/make-fixtures.js
//
// Writes FAKE Earth Engine feature tables (jaipur, delhi) for the tests, in the
// exact layout of the team notebook's final CSV ("v4_physics_big_Final", cells
// 33, 42 and 45): the same columns in the same order, monthly rows from
// 2010-01-01, empty cells where a dataset has no data yet (Sentinel-5P before
// mid-2018, SMAP and Dynamic World before 2015). The values are synthetic
// (seasonal curves plus seeded noise), NOT satellite data; the physics columns
// are computed from them with the notebook's formulas, so the table is
// internally consistent. Deterministic: re-running gives the same files.

const fs = require('node:fs')
const path = require('node:path')

// Column order as the notebook writes it. Earth Engine returns each month's
// properties sorted by name, so `date` lands after the MODIS bands of the
// first table, and pandas' outer merges append the other tables' columns.
const COLUMNS = [
  'Emissivity_31', 'Emissivity_32', 'LST_Day_C', 'LST_Night_C', 'date',
  'Albedo', 'NDVI', 'NDWI',
  'AirTemp_C', 'Dewpoint_C', 'Precip_mm', 'Rs_down_Jm2', 'WindSpeed_ms',
  'UV_Aerosol_Index',
  'landcover_mode', 'soil_texture_mode', 'population_total', 'population_density_mean',
  'Soil_Moisture_Subsurface_mm', 'Soil_Moisture_Surface_mm',
  'Urban_Fraction', 'Vegetation_Fraction',
  'PDSI',
  'VPD_kPa', 'delta_T', 'Rs_down_Wm2', 'R_n', 'evopration_demand', 'LST_DTR',
  'Sensible_Heat_Proxy', 'Vapor_Slope_kPa_C', 'Precip_2mo_sum', 'Precip_3mo_sum',
]

const START = 2010
const END = { year: 2026, month: 9 } // last month: END_DATE 2026-10-01 is exclusive
const SIGMA = 5.670374e-8

// Seeded LCG so the fixture never changes between runs.
function rng(seed) {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 2 ** 32 - 0.5
  }
}

const AREAS = {
  jaipur: { seed: 11, ndvi: 0.17, green: 0.12, rain: 220, temp: 25.5, landcover: 50, soil: 9, pop: 41000, lastNdviMissing: true },
  delhi: { seed: 23, ndvi: 0.21, green: 0.10, rain: 260, temp: 25.0, landcover: 50, soil: 7, pop: 98000, lastNdviMissing: false },
}

function table(cfg) {
  const r = rng(cfg.seed)
  const rows = []
  let ndviPrev = cfg.ndvi
  const precip = []
  for (let y = START; y <= END.year; y++) {
    for (let m = 1; m <= 12; m++) {
      if (y === END.year && m > END.month) break
      const i = rows.length
      const date = `${y}-${String(m).padStart(2, '0')}-01`
      const season = Math.cos((2 * Math.PI * (m - 6)) / 12) // +1 in June, -1 in December
      const monsoon = m >= 7 && m <= 9 ? 1 : m === 6 || m === 10 ? 0.25 : 0.02
      const AirTemp_C = cfg.temp + 8 * season + r() * 1.5
      const Dewpoint_C = 8 + 14 * monsoon + 4 * season + r() * 2
      const Precip_mm = Math.max(0, cfg.rain * monsoon * (1 + r() * 0.8) + 3 * r())
      const WindSpeed_ms = 2.6 + 0.9 * season + r() * 0.4
      const days = new Date(Date.UTC(y, m, 0)).getUTCDate()
      const Rs_down_Jm2 = (215 + 55 * season - 40 * monsoon + r() * 10) * days * 86400
      const LST_Day_C = AirTemp_C + 6 + 6 * season - 6 * monsoon + r() * 2
      const LST_Night_C = AirTemp_C - 6 + r() * 1.5
      const Emissivity_31 = 0.968 + 0.004 * monsoon + r() * 0.002
      const Emissivity_32 = 0.972 + 0.003 * monsoon + r() * 0.002
      const Albedo = 0.235 - 0.02 * monsoon + r() * 0.006
      // NDVI follows the previous months' rain, with a slow trend upward
      precip.push(Precip_mm)
      const wet = (precip[i - 1] || 0) + 0.5 * (precip[i - 2] || 0)
      ndviPrev = 0.55 * ndviPrev + 0.45 * (cfg.ndvi + cfg.green * Math.min(1, wet / cfg.rain) + 0.0015 * (y - START)) + r() * 0.012
      // Monsoon clouds hide some months from Landsat
      const cloudy = monsoon === 1 && r() > 0.25
      const lastRow = y === END.year && m === END.month
      const NDVI = cloudy || (lastRow && cfg.lastNdviMissing) ? null : ndviPrev
      const NDWI = NDVI === null ? null : -NDVI * 1.05 + r() * 0.01
      const UV_Aerosol_Index = y > 2018 || (y === 2018 && m >= 7) ? 0.8 + 0.6 * season + r() * 0.3 : null
      const smap = y >= 2015 && !(y === 2015 && m < 4)
      const dw = y >= 2015 && !(y === 2015 && m < 7)

      const row = {
        Emissivity_31, Emissivity_32, LST_Day_C, LST_Night_C, date,
        Albedo, NDVI, NDWI, AirTemp_C, Dewpoint_C, Precip_mm, Rs_down_Jm2, WindSpeed_ms,
        UV_Aerosol_Index,
        landcover_mode: cfg.landcover, soil_texture_mode: cfg.soil, population_total: cfg.pop, population_density_mean: cfg.pop / 400,
        Soil_Moisture_Subsurface_mm: smap ? 60 + 90 * monsoon + r() * 8 : null,
        Soil_Moisture_Surface_mm: smap ? 6 + 14 * monsoon + r() * 2 : null,
        Urban_Fraction: dw ? 0.35 + 0.002 * (y - 2015) + r() * 0.02 : null,
        Vegetation_Fraction: dw ? 0.2 + 0.15 * monsoon + r() * 0.03 : null,
        PDSI: 0.5 * Math.sin(i / 17) + r() * 0.8,
      }
      // Cell 45, formula for formula
      const es = 0.6108 * Math.exp((17.27 * AirTemp_C) / (AirTemp_C + 237.3))
      const ea = 0.6108 * Math.exp((17.27 * Dewpoint_C) / (Dewpoint_C + 237.3))
      row.VPD_kPa = es - ea
      row.delta_T = LST_Day_C - AirTemp_C
      row.Rs_down_Wm2 = Rs_down_Jm2 / (days * 86400)
      const TaK = AirTemp_C + 273.15
      const epsSky = 1.24 * ((ea * 10) / TaK) ** (1 / 7)
      const TskyK = epsSky ** 0.25 * TaK
      const TsK = LST_Day_C + 273.15
      row.R_n = (1 - Albedo) * row.Rs_down_Wm2 + Emissivity_31 * SIGMA * TskyK ** 4 - Emissivity_31 * SIGMA * TsK ** 4
      row.evopration_demand = row.VPD_kPa * WindSpeed_ms
      row.LST_DTR = LST_Day_C - LST_Night_C
      row.Sensible_Heat_Proxy = row.delta_T * WindSpeed_ms
      row.Vapor_Slope_kPa_C = (4098 * es) / (AirTemp_C + 237.3) ** 2
      row.Precip_2mo_sum = precip.slice(-2).reduce((a, b) => a + b, 0)
      row.Precip_3mo_sum = precip.slice(-3).reduce((a, b) => a + b, 0)
      rows.push(row)
    }
  }
  return rows
}

// pandas-like: empty for NaN, plain decimals otherwise.
const cell = (v) => (v === null ? '' : typeof v === 'string' ? v : String(Number(v.toPrecision(12))))

for (const [id, cfg] of Object.entries(AREAS)) {
  const rows = table(cfg)
  const text = [COLUMNS.join(','), ...rows.map((row) => COLUMNS.map((c) => cell(row[c])).join(','))].join('\n') + '\n'
  fs.writeFileSync(path.join(__dirname, `${id}.features.csv`), text)
  console.log(`wrote ${id}.features.csv (${rows.length} months)`)
}
