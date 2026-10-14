import { DATA } from '../data'
import { FIRST_YEAR, LAST_YEAR } from '../months'
import { mean } from '../stats'
import { boxB, distKm } from './geometry'
import L from 'leaflet'

// HTML for Leaflet popups opened by a map click. Popups live outside React's
// tree, so they are plain strings, styled with Tailwind classes written out in
// full (Tailwind finds classes by scanning source text). Numbers in <b> use the
// mono font.

// Pixel inspector. `vals` is the result of loadPixelValues(city); values are
// stored as integers: NDVI × 1000 and temperature × 10.
//   green / change: the pixel's monsoon-peak NDVI for every year as a mini line
//     chart, plus the fixed 2010–12 vs 2023–25 comparison behind the Change layer
//   heatday / heatnight: the pixel's April–June mean surface temperature
export function pixelPopupHtml({ layerId, row, col, vals, year }) {
  if (layerId === 'green' || layerId === 'change') {
    const ys = Array.from({ length: LAST_YEAR - FIRST_YEAR + 1 }, (_, i) => FIRST_YEAR + i)
    const v = ys.map((y) => {
      const x = vals.yearVals[String(y)]?.[row]?.[col]
      return x == null ? null : x / 1000
    })
    const ok = v.filter((x) => x != null)
    if (!ok.length) return 'No clear value for this pixel.'
    // 220 × 60 sparkline: x spans 6..214, y spans 54 (lowest) .. 8 (highest)
    const lo = Math.min(...ok), hi = Math.max(...ok)
    const X = (i) => 6 + (i / (ys.length - 1)) * 208
    const Y = (x) => 54 - ((x - lo) / (hi - lo || 1)) * 46
    // Missing years break the line instead of being bridged
    let dpath = '', pen = false
    v.forEach((x, i) => {
      if (x == null) {
        pen = false
        return
      }
      dpath += (pen ? 'L' : 'M') + X(i).toFixed(1) + ',' + Y(x).toFixed(1)
      pen = true
    })
    // The greenness layer highlights the year shown on the map; Change has no single year
    const hiY = layerId === 'green' ? year : null
    const hv = hiY ? v[hiY - FIRST_YEAR] : null
    const cv = vals.changeVals[row][col]
    // Fixed comparison windows (same as the Change layer), indexed by year
    const win = (a, b) => v.slice(a - FIRST_YEAR, b - FIRST_YEAR + 1)
    const title = layerId === 'green'
      ? `NDVI ${hiY}: ${hv == null ? '–' : hv.toFixed(2)}`
      : `Change: ${cv == null ? '–' : (cv >= 0 ? '+' : '−') + Math.abs(cv / 1000).toFixed(2)}`
    return `<div><b class="font-mono">${title}</b><br><span class="text-[13px] text-muted">250 m pixel · monsoon peak ${FIRST_YEAR}–${LAST_YEAR}</span>
      <svg class="mt-1.5 block h-[60px] w-[220px]" viewBox="0 0 220 60"><path d="${dpath}" fill="none" stroke="#2E7D4F" stroke-width="2"/>${hiY && hv != null ? `<circle cx="${X(hiY - FIRST_YEAR)}" cy="${Y(hv)}" r="3.5" fill="#2E7D4F"/>` : ''}<text x="6" y="10" font-size="9" fill="#777">${hi.toFixed(2)}</text><text x="6" y="58" font-size="9" fill="#777">${lo.toFixed(2)}</text><text x="214" y="58" font-size="9" fill="#777" text-anchor="end">${LAST_YEAR}</text></svg>
      <span class="text-[13px] text-muted">2010–12 avg <b class="font-mono">${(mean(win(2010, 2012)) || 0).toFixed(2)}</b> → 2023–25 avg <b class="font-mono">${(mean(win(2023, 2025)) || 0).toFixed(2)}</b></span></div>`
  }
  const grid = layerId === 'heatday' ? vals.lstDayVals : vals.lstNightVals
  const x = grid[row][col]
  return `<div><b class="font-mono">${x == null ? '–' : (x / 10).toFixed(1) + ' °C'}</b><br><span class="text-[13px] text-muted">${layerId === 'heatday' ? 'Daytime' : 'Night-time'} surface temperature, April–June average 2022–2026, 1 km pixel</span></div>`
}

// Fallback for clicks without pixel data: the coordinates, and either "inside
// the box" or the distance to the selected city's centre.
export function pointPopupHtml(ll, city) {
  const d = DATA.cities[city]
  const inBox = L.latLngBounds(boxB(city)).contains(ll)
  return `<b>${ll.lat.toFixed(4)}°N, ${ll.lng.toFixed(4)}°E</b><br>${inBox ? 'Inside the measurement box' : distKm(ll, [d.lat, d.lon]).toFixed(1) + ' km from the ' + d.name + ' centre'}`
}
