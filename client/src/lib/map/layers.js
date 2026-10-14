import { RAS } from '../data'
import { asset } from '../asset'

// Data layers that can be drawn over the satellite photo in the map explorer.
// MODIS layers (green, change, heat*) exist for every city and their image URLs
// come from RAS[city]; the Sentinel-2 layers are a single notebook export that
// only covers Gadisar Lake, so they carry `only` and a fixed image + bounds.

// Bounds of the Sentinel-2 export (2 × 2 km around Gadisar Lake, Jaisalmer).
export const S2B = [[26.902729, 70.919915], [26.920817, 70.940063]]

// ramp: colour stops of the legend bar, tick labels under it and the two end captions.
export const MLAYERS = [
  { id: 'none', label: 'None', desc: 'Satellite photo only. Turn on a layer to see the data on top.' },
  { id: 'green', label: 'Greenness', ramp: { stops: ['#8c510a', '#d8b365', '#f6e8c3', '#c7e9b4', '#7fbc41', '#1b7837'], ticks: ['0', '0.12', '0.22', '0.32', '0.42', '0.6'], ends: ['Bare', 'Green'] }, desc: 'Monsoon-peak NDVI for the chosen year from MODIS 250 m pixels. Sand and roofs show brown; parks, tree-lined roads and fields show green. Tap a pixel to see its history.' },
  { id: 'change', label: 'Change since 2010–12', ramp: { stops: ['#8c510a', '#dfc27d', '#f5f5f5', '#a6dba0', '#1b7837'], ticks: ['−0.15', '−0.05', '0', '+0.05', '+0.15'], ends: ['Lost green', 'Gained green'] }, desc: 'Average monsoon peak of 2023–25 minus 2010–12. Green pixels gained vegetation; brown pixels lost it, often to new building.' },
  { id: 'heatday', label: 'Summer heat, day', ramp: { stops: ['#fff5eb', '#fdae6b', '#e6550d', '#7f2704'], ticks: ['30', '38', '44', '50 °C'], ends: ['Cooler', 'Hotter'] }, desc: 'Average April–June daytime land surface temperature, 2022–2026, from MODIS 1 km pixels. Bare and built ground heats most.' },
  { id: 'heatnight', label: 'Summer heat, night', ramp: { stops: ['#f7fbff', '#9ecae1', '#4292c6', '#08306b'], ticks: ['18', '24', '28', '32 °C'], ends: ['Cooler', 'Warmer'] }, desc: 'Average April–June night-time land surface temperature, 2022–2026. Built-up areas hold heat after dark.' },
  { id: 's2ndvi', label: 'NDVI 10 m', only: 'jaisalmer', img: asset('/map/s2_ndvi.jpg'), ramp: { stops: ['#a50026', '#f46d43', '#fee08b', '#d9ef8b', '#66bd63', '#006837'], ticks: ['−0.2', '0.05', '0.3', '0.55', '0.8'], ends: ['Water / bare', 'Green'] }, desc: 'Sentinel-2 10 m greenness from the Earth Engine notebook, 2 × 2 km around Gadisar Lake. Ten times sharper than MODIS.' },
  { id: 's2ndwi', label: 'Water (NDWI) 10 m', only: 'jaisalmer', img: asset('/map/s2_ndwi.jpg'), ramp: { stops: ['#f7fbff', '#c6dbef', '#6baed6', '#2171b5', '#08306b'], ticks: ['−0.5', '0', '0.5'], ends: ['Dry', 'Water'] }, desc: 'Sentinel-2 water index from the notebook. Only Gadisar Lake reads as open water.' },
  { id: 's2ndbi', label: 'Built-up (NDBI) 10 m', only: 'jaisalmer', img: asset('/map/s2_ndbi.jpg'), ramp: { stops: ['#fff7ec', '#fdd49e', '#fc8d59', '#d7301f', '#7f0000'], ticks: ['−0.3', '0', '0.3'], ends: ['Vegetated', 'Built-up'] }, desc: 'Sentinel-2 built-up index from the notebook. Dense housing shows darkest.' },
]

// Unknown ids (e.g. a stale value in localStorage) fall back to Greenness.
export const layerDef = (id) => MLAYERS.find((l) => l.id === id) || MLAYERS[1]

// True when a layer cannot be shown for this city (a city-specific layer of another city).
export const notForCity = (id, city) => {
  const d = layerDef(id)
  return !!d.only && d.only !== city
}

// The pills offered for a city: every shared layer plus that city's own extras.
export const layersFor = (city) => MLAYERS.filter((l) => !l.only || l.only === city)

// Image URL and lat/lon bounds for a layer, or null when the city has no raster.
// `year` only matters for the yearly greenness layer.
export function srcFor(city, id, year) {
  const r = RAS[city]
  if (!r) return null
  if (id === 'green') return { url: r.years[String(year)], b: r.ndviBounds }
  if (id === 'change') return { url: r.change, b: r.ndviBounds }
  if (id === 'heatday') return { url: r.lstDay, b: r.lstBounds }
  if (id === 'heatnight') return { url: r.lstNight, b: r.lstBounds }
  const d = MLAYERS.find((l) => l.id === id)
  if (d && d.img) return { url: d.img, b: S2B }
  return null
}

// The image drawn on top for the current map state: in greenness swipe mode the
// right-hand year (yb), otherwise the slider year. null for 'None'. Shared by the
// overlay builder and the swipe divider's visibility so the two can't disagree.
export const mainSrc = (city, id, { swipe, year, yb }) => srcFor(city, id, id === 'green' && swipe ? yb : year)
