// Single entry point for the app's datasets.
// - Bundled from src/data: climate series, district boundaries, mosaic metadata
//   and raster metadata.
// - Fetched at runtime from public/map: the map imagery (URLs in MAPMETA and RAS)
//   and the per-pixel values (loadPixelValues below).
// When the server is ready, replace both the imports and those URLs/fetches here;
// the components stay unchanged.
import climate from '../data/climate.json'
import boundaries from '../data/boundaries.json'
import mapmeta from '../data/mapmeta.json'
import rasters from '../data/rasters.json'
import { asset } from './asset'

export const DATA = climate // { months: ["2010-01", ...], cities: { id: { name, state, lat, lon, series: { key: [..] } } } }
export const BOUND = boundaries // { cityId: GeoJSON geometry of the district }
export const MAPMETA = mapmeta // { region: [mosaic, mosaic], cityId: [z10, z13, z15 mosaics] }
// The JSON stores public paths ('/map/raster/...'); resolve them against the deploy base here.
export const RAS = Object.fromEntries(
  Object.entries(rasters).map(([c, r]) => [
    c,
    {
      ...r,
      years: Object.fromEntries(Object.entries(r.years).map(([y, u]) => [y, asset(u)])),
      change: asset(r.change),
      lstDay: asset(r.lstDay),
      lstNight: asset(r.lstNight),
      values: asset(r.values),
    },
  ]),
) // { cityId: { ndviBounds, lstBounds, years: {year: url}, change, lstDay, lstNight, values: url } }

export const M = DATA.months
export const N = M.length
export const CITY_IDS = Object.keys(DATA.cities)
export const DEFAULT_CITY = 'jaipur'

export const ser = (c, k) => DATA.cities[c].series[k]

// Per-pixel values for the map's pixel inspector (~120 KB per city), fetched on demand.
// Shape: { yearVals: {year: 41x41}, changeVals: 41x41, lstDayVals: 11x11, lstNightVals: 11x11 }
const pixelCache = new Map()
export function loadPixelValues(c) {
  const r = RAS[c]
  if (!r) return Promise.resolve(null)
  if (!pixelCache.has(c)) {
    const p = fetch(r.values)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.json()
      })
      .catch((e) => {
        pixelCache.delete(c)
        throw e
      })
    pixelCache.set(c, p)
  }
  return pixelCache.get(c)
}
