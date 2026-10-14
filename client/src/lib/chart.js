// Small SVG line-chart engine (imperative). Use it through <Chart>, which owns
// the container element and calls drawChart on size, option or theme changes.
import { css } from './theme'
import { FIRST_YEAR, MON, mOf, yOf } from './months'
import { noteCls } from '../styles/classes'

export function niceStep(x) {
  const p = Math.pow(10, Math.floor(Math.log10(x)))
  const f = x / p
  return (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * p
}

/*
  o = {
    series: [{ name, color, pts: [{x, y}], w?, op?, dash?, area?, end?, dots?, hover? }],
    x0, x1,                       // x domain (month indices, or 0..11 for season view)
    yMin?, yMax?, zero?, yFmt?, yLabels?,
    xTicks?: [[x, label]], shade?: [[xa, xb]], band?: [{x, lo, hi}], bandColor?, vline?,
    aria?, onHover?: (x | null) => void
  }
  Returns { X, Y, W, H, m, setHover(x) } or null when there is nothing to draw.
*/
export function drawChart(el, o) {
  const W = el.clientWidth || 600, H = el.clientHeight || 180, m = { l: o.yLabels === false ? 14 : 48, r: 16, t: 12, b: 26 }
  const ys = [...o.series.flatMap((s) => s.pts.map((p) => p.y)), ...(o.band || []).flatMap((b) => [b.lo, b.hi])].filter((v) => v != null && isFinite(v))
  if (!ys.length) {
    el.innerHTML = `<div class="${noteCls} flex h-full items-center justify-center">No data for this city and period.</div>`
    return null
  }
  let y0 = o.yMin ?? Math.min(...ys), y1 = o.yMax ?? Math.max(...ys)
  if (o.zero && y0 > 0) y0 = 0
  const step = niceStep((y1 - y0 || 1) / (H > 250 ? 5 : 3))
  if (o.yMin == null) y0 = Math.floor(y0 / step) * step
  if (o.yMax == null) y1 = Math.ceil(y1 / step) * step
  if (y1 === y0) y1 = y0 + step
  const X = (x) => m.l + ((x - o.x0) / (o.x1 - o.x0 || 1)) * (W - m.l - m.r), Y = (v) => m.t + (1 - (v - y0) / (y1 - y0)) * (H - m.t - m.b)
  const ink = css('--muted'), line = css('--line'), surf = css('--surface'), F = 'font-size="11" font-family="DM Mono, monospace"'
  let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${o.aria || ''}" xmlns="http://www.w3.org/2000/svg">`
  if (o.yLabels !== false)
    for (let v = y0; v <= y1 + 1e-9; v += step)
      s += `<line x1="${m.l}" x2="${W - m.r}" y1="${Y(v)}" y2="${Y(v)}" stroke="${line}"/><text x="${m.l - 8}" y="${Y(v) + 4}" text-anchor="end" ${F} fill="${ink}">${o.yFmt ? o.yFmt(v) : +v.toFixed(4)}</text>`
  else
    [y0, y1].forEach((v) => {
      s += `<line x1="${m.l}" x2="${W - m.r}" y1="${Y(v)}" y2="${Y(v)}" stroke="${line}"/>`
    })
  ;(o.xTicks || []).forEach(([x, lab]) => {
    s += `<text x="${X(x)}" y="${H - 7}" text-anchor="middle" ${F} fill="${ink}">${lab}</text>`
  })
  if (o.shade)
    o.shade.forEach((r) => {
      s += `<rect x="${X(r[0])}" y="${m.t}" width="${Math.max(0, X(r[1]) - X(r[0]))}" height="${H - m.t - m.b}" fill="${css('--surface2')}"/>`
    })
  if (o.band && o.band.length > 1) {
    const up = o.band.map((b) => `${X(b.x)},${Y(b.hi)}`), lo = o.band.slice().reverse().map((b) => `${X(b.x)},${Y(b.lo)}`)
    s += `<polygon points="${up.concat(lo).join(' ')}" fill="${o.bandColor}" fill-opacity=".16"/>`
  }
  if (o.vline != null) s += `<line x1="${X(o.vline)}" x2="${X(o.vline)}" y1="${m.t}" y2="${H - m.b}" stroke="${ink}" stroke-dasharray="3 4"/>`
  o.series.forEach((se) => {
    const segs = []
    let cur = []
    se.pts.forEach((p) => {
      if (p.y == null || !isFinite(p.y)) {
        if (cur.length) segs.push(cur)
        cur = []
      } else cur.push(p)
    })
    if (cur.length) segs.push(cur)
    if (se.area)
      segs.forEach((g) => {
        if (g.length > 1)
          s += `<path d="M${X(g[0].x)},${Y(Math.max(y0, 0))} ${g.map((p) => `L${X(p.x)},${Y(p.y)}`).join(' ')} L${X(g[g.length - 1].x)},${Y(Math.max(y0, 0))}Z" fill="${se.color}" fill-opacity=".10"/>`
      })
    segs.forEach((g) => {
      if (g.length > 1)
        s += `<polyline points="${g.map((p) => `${X(p.x)},${Y(p.y)}`).join(' ')}" fill="none" stroke="${se.color}" stroke-width="${se.w || 2}" stroke-opacity="${se.op ?? 1}" stroke-linejoin="round" stroke-linecap="round" ${se.dash ? 'stroke-dasharray="5 5"' : ''}/>`
      else if (se.dots !== false) s += `<circle cx="${X(g[0].x)}" cy="${Y(g[0].y)}" r="2.5" fill="${se.color}"/>`
    })
    if (se.end) {
      const g = se.pts.filter((p) => p.y != null)
      const p = g[g.length - 1]
      if (p) s += `<circle cx="${X(p.x)}" cy="${Y(p.y)}" r="4.5" fill="${se.color}" stroke="${surf}" stroke-width="2"/>`
    }
  })
  s += `<g class="hov"></g><rect class="hit" x="${m.l}" y="0" width="${W - m.l - m.r}" height="${H}" fill="transparent"/></svg>`
  el.innerHTML = s
  const svg = el.querySelector('svg'), hov = svg.querySelector('.hov'), hit = svg.querySelector('.hit')
  const api = {
    X, Y, W, H, m,
    setHover(x) {
      if (x == null || x < o.x0 || x > o.x1) {
        hov.innerHTML = ''
        return
      }
      let h = `<line x1="${X(x)}" x2="${X(x)}" y1="${m.t}" y2="${H - m.b}" stroke="${css('--ink')}" stroke-opacity=".35"/>`
      o.series.forEach((se) => {
        if (se.hover === false) return
        const p = se.pts.find((q) => q.x === x)
        if (p && p.y != null) h += `<circle cx="${X(x)}" cy="${Y(p.y)}" r="5" fill="${se.color}" stroke="${surf}" stroke-width="2"/>`
      })
      hov.innerHTML = h
    },
  }
  if (o.onHover) {
    const xs = [...new Set(o.series.flatMap((se) => se.pts.filter((p) => p.y != null).map((p) => p.x)))].sort((a, b) => a - b)
    const pick = (e) => {
      const r = svg.getBoundingClientRect()
      const x = (e.clientX - r.left) * (W / r.width)
      let b = null, bd = 1e9
      xs.forEach((v) => {
        const d = Math.abs(X(v) - x)
        if (d < bd) {
          bd = d
          b = v
        }
      })
      return b
    }
    hit.addEventListener('pointermove', (e) => o.onHover(pick(e)))
    hit.addEventListener('pointerdown', (e) => o.onHover(pick(e)))
    hit.addEventListener('pointerleave', () => o.onHover(null))
  }
  return api
}

// Year labels along a month-index axis, thinned for long spans / narrow charts.
export const yearTicks = (i0, i1, W) => {
  const span = i1 - i0, every = span > 150 ? (W < 560 ? 48 : 24) : span > 60 ? (W < 560 ? 24 : 12) : 12, out = []
  for (let i = i0; i <= i1; i++) {
    if (mOf(i) === 0 && (yOf(i) - FIRST_YEAR) % (every / 12) === 0) out.push([i, String(yOf(i))])
  }
  return out
}

export const monthTicks = (W) => MON.map((m, i) => [i, m]).filter((_, i) => W >= 520 || i % 2 === 0)
