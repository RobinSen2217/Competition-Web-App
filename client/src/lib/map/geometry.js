import L from 'leaflet'
import { CITY_IDS, DATA } from '../data'

// Kilometres per degree: latitude is ~constant, longitude shrinks with cos(lat).
const KM_PER_DEG_LAT = 110.574
const kmPerDegLon = (lat) => 111.32 * Math.cos((lat * Math.PI) / 180)

// Square of half-width hw km centred on lat/lon, as [[south, west], [north, east]].
export function squareAround(lat, lon, hw) {
  const dl = hw / KM_PER_DEG_LAT, dn = hw / kmPerDegLon(lat)
  return [[lat - dl, lon - dn], [lat + dl, lon + dn]]
}

// The 10 × 10 km measurement box every city-average series is computed over.
export const boxB = (c) => squareAround(DATA.cities[c].lat, DATA.cities[c].lon, 5)

// Overview of the whole region, used for the initial view and the "Region" button.
export const REGION_CENTER = [26.6, 74]

// Great-circle distance in km (the same formula map.distance() uses).
export const distKm = (a, b) => L.latLng(a).distanceTo(L.latLng(b)) / 1000

// Which raster cell of the active layer a click falls in. The rasters are square
// grids over their bounds: 41 × 41 cells for the 250 m NDVI layers and 11 × 11 for
// the 1 km temperature layers. Row 0 is the northern edge. Returns null for layers
// without per-pixel values or clicks outside the raster.
export const PIXEL_LAYERS = ['green', 'change', 'heatday', 'heatnight']
export function pixelAt(ll, layerId, r) {
  if (!r || !PIXEL_LAYERS.includes(layerId)) return null
  const heat = layerId.startsWith('heat')
  const b = heat ? r.lstBounds : r.ndviBounds, n = heat ? 11 : 41
  const [[s, w], [no, e]] = b
  if (ll.lat < s || ll.lat > no || ll.lng < w || ll.lng > e) return null
  // min() keeps a click exactly on the north/east edge inside the last cell
  const row = Math.min(n - 1, Math.floor(((no - ll.lat) / (no - s)) * n))
  const col = Math.min(n - 1, Math.floor(((ll.lng - w) / (e - w)) * n))
  return { row, col }
}

/* ---- area planner ---- */

// The half-width slider is logarithmic: 0..100 maps to 0.25..25 km so small and
// large areas get equal travel. Results snap to steps that read well
// (0.05 km below 2 km, 0.25 km below 10 km, whole km above).
export const sliderToKm = (v) => {
  const k = 0.25 * Math.pow(100, v / 100)
  return k < 2 ? Math.round(k * 20) / 20 : k < 10 ? Math.round(k * 4) / 4 : Math.round(k)
}
export const kmToSlider = (k) => Math.round((100 * Math.log(k / 0.25)) / Math.log(100))

export const hwLabel = (hw) => (hw < 2 ? hw.toFixed(2) : hw.toFixed(hw < 10 ? 1 : 0)) + ' km'

// Rows of the planner's <dl>. Pixel areas: a MODIS "1 km" pixel is 926.6 m square
// (0.8586 km²) and a "250 m" pixel 231.7 m square (0.0537 km²); Sentinel-2 is 10 m.
export function planStats({ lat, lon, hw }) {
  const side = 2 * hw, area = side * side
  const n = (x) => (x < 10 ? x.toFixed(1) : Math.round(x).toLocaleString('en-IN'))
  const near = CITY_IDS.map((c) => ({ c, dkm: distKm([lat, lon], [DATA.cities[c].lat, DATA.cities[c].lon]) })).sort((a, b) => a.dkm - b.dkm)[0]
  const s = side.toFixed(side < 10 ? 1 : 0)
  return [
    ['Box', `${s} × ${s} km`],
    ['Area', `${area < 10 ? area.toFixed(2) : Math.round(area).toLocaleString('en-IN')} km²`],
    ['Temperature pixels (1 km)', `≈ ${n(area / 0.8586)}`],
    ['Greenness pixels (250 m)', `≈ ${n(area / 0.0537)}`],
    ['Sentinel-2 pixels (10 m)', `≈ ${n(area * 1e4)}`],
    ['Nearest city', `${DATA.cities[near.c].name}, ${near.dkm.toFixed(0)} km`],
  ]
}

// Settings block to paste into the Earth Engine notebook.
export const planSnippet = ({ lat, lon, hw }) =>
  `CENTER_LAT = ${lat.toFixed(6)}\nCENTER_LON = ${lon.toFixed(6)}\nHALF_WIDTH_KM = ${hw}`
