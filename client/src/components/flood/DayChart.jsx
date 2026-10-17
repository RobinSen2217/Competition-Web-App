import { useRef } from 'react'
import useElementWidth from '../../hooks/useElementWidth'
import { dateLabel, dayStr, niceStep } from './format'

/*
  Small SVG chart on a daily axis, for the hazard pages. The look follows
  lib/chart.js (the vegetation page's charts): recessive grid in --line, DM
  Mono 11px tick labels in --muted, 2px lines, a crosshair on hover. That
  engine draws monthly lines only, so this one is written for what hazard
  data needs: daily bars, lines, satellite passes as points with whiskers,
  shaded day ranges and threshold lines.

  It is drawn by React (not innerHTML) and colours are CSS variables in style
  props, so a light/dark or green/blue theme change repaints it without a
  redraw. One y axis only: two quantities of different units go in two
  charts (see the parameter charts).

  x is a continuous day count (days since 1970-01-01, see format.js dayNum):
  day d covers [d, d + 1), so a daily value sits at d + 0.5 and a pass at
  12:00 UTC at d + 0.5 too. x0..x1 are the first and last day shown.

  layers, drawn in order:
    { type: 'shade', ranges: [[dayA, dayB], ...], color, opacity }  full-height day columns (inclusive)
    { type: 'rug', ranges, color }                                  a thin strip along the bottom
    { type: 'bars', color, pts: [{ x: day, y }] }                    one bar per day
    { type: 'line', color, pts: [{ x, y }], width?, dash?, opacity?, dots? }  null y breaks the line
    { type: 'points', color, pts: [{ x, y, lo?, hi?, color?, opacity? }], hollow? }  markers, optional whiskers lo..hi
    { type: 'hline', y, color, dash?, label? }                       horizontal reference line

  hover / onHover: the hovered day (integer) or null, shared between charts.
*/

const M = { l: 46, r: 14, t: 14, b: 26 }
const FONT = { fontSize: 11, fontFamily: 'DM Mono, ui-monospace, monospace' }
const v = (name) => `var(${name})`

// The y range of every value the layers draw
function extent(layers) {
  const ys = []
  for (const L of layers) {
    if (L.type === 'hline') ys.push(L.y)
    for (const p of L.pts || []) {
      if (p.y != null && Number.isFinite(p.y)) ys.push(p.y)
      if (p.lo != null && Number.isFinite(p.lo)) ys.push(p.lo)
      if (p.hi != null && Number.isFinite(p.hi)) ys.push(p.hi)
    }
  }
  return ys
}

// Tick step in days so labels stay ~64px apart
function dayStep(span, plotW) {
  const fit = Math.max(1, Math.floor(plotW / 64))
  for (const s of [1, 2, 3, 7, 14, 28, 56, 112]) if (span / s <= fit) return s
  return 224
}

// Bar with rounded top corners, anchored to the baseline
function barPath(x, y, w, h, r) {
  const rr = Math.min(r, w / 2, Math.abs(h))
  if (h <= 0) return ''
  return `M${x},${y + h}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h}Z`
}

export default function DayChart({ x0, x1, layers, height = 240, yMin, yMax, zero = false, yFmt, aria, hover = null, onHover, empty = 'No data for this period.' }) {
  const ref = useRef(null)
  const W = useElementWidth(ref, 100)
  const ys = extent(layers)
  return (
    <div ref={ref} className="relative w-full" style={{ height }}>
      {W > 0 && ys.length > 0 && (
        <Plot W={W} H={height} x0={x0} x1={x1} layers={layers} ys={ys} yMin={yMin} yMax={yMax} zero={zero} yFmt={yFmt} aria={aria} hover={hover} onHover={onHover} />
      )}
      {W > 0 && !ys.length && (
        <div className="flex h-full items-center justify-center rounded-xl bg-surface2 px-3.5 py-2.5 text-center text-[14px] text-muted">{empty}</div>
      )}
    </div>
  )
}

function Plot({ W, H, x0, x1, layers, ys, yMin, yMax, zero, yFmt, aria, hover, onHover }) {
  const plotW = Math.max(10, W - M.l - M.r)
  const plotH = H - M.t - M.b
  const days = x1 - x0 + 1
  const bw = plotW / days
  const X = (x) => M.l + (x - x0) * bw

  // y scale with "nice" round ticks, as lib/chart.js
  let y0 = yMin ?? Math.min(...ys)
  let y1 = yMax ?? Math.max(...ys)
  if (zero && y0 > 0) y0 = 0
  const step = niceStep((y1 - y0 || Math.abs(y1) || 1) / (H > 230 ? 4 : 3))
  if (yMin == null) y0 = Math.floor(y0 / step) * step
  if (yMax == null) y1 = Math.ceil(y1 / step) * step
  if (y1 === y0) y1 = y0 + step
  const Y = (val) => M.t + (1 - (val - y0) / (y1 - y0)) * plotH
  const yTicks = []
  for (let t = y0; t <= y1 + step * 1e-6; t += step) yTicks.push(+t.toFixed(10))
  const fmtY = yFmt || ((t) => String(+t.toFixed(4)))

  const ds = dayStep(days, plotW)
  const xTicks = []
  for (let d = x0; d <= x1; d += ds) xTicks.push(d)

  const pick = (e) => {
    const r = e.currentTarget.getBoundingClientRect()
    const px = ((e.clientX - r.left) / r.width) * plotW
    return Math.min(x1, Math.max(x0, x0 + Math.floor(px / bw)))
  }
  const barW = Math.max(1, Math.min(bw * 0.72, 22))
  const hovering = hover != null && hover >= x0 && hover <= x1

  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={aria} className="block touch-pan-y overflow-visible">
      {/* Shaded day ranges first, under the grid */}
      {layers.map((L, li) =>
        L.type === 'shade'
          ? L.ranges.map(([a, b]) => (
              <rect key={`s${li}-${a}`} x={X(Math.max(a, x0))} y={M.t} width={Math.max(0, X(Math.min(b, x1) + 1) - X(Math.max(a, x0)))} height={plotH} style={{ fill: v(L.color), opacity: L.opacity ?? 0.14 }} />
            ))
          : null,
      )}
      {yTicks.map((t) => (
        <g key={t}>
          <line x1={M.l} x2={W - M.r} y1={Y(t)} y2={Y(t)} style={{ stroke: v('--line') }} />
          <text x={M.l - 8} y={Y(t) + 4} textAnchor="end" style={{ ...FONT, fill: v('--muted') }}>
            {fmtY(t)}
          </text>
        </g>
      ))}
      {xTicks.map((d) => (
        <text key={d} x={X(d + 0.5)} y={H - 7} textAnchor="middle" style={{ ...FONT, fill: v('--muted') }}>
          {dateLabel(dayStr(d), { year: false })}
        </text>
      ))}
      {layers.map((L, li) => {
        const key = `l${li}`
        if (L.type === 'rug')
          return L.ranges.map(([a, b]) => (
            <rect key={`${key}-${a}`} x={X(Math.max(a, x0)) + 1} y={M.t + plotH - 5} width={Math.max(0, X(Math.min(b, x1) + 1) - X(Math.max(a, x0)) - 2)} height={5} rx={2.5} style={{ fill: v(L.color) }} />
          ))
        if (L.type === 'bars')
          return (
            <g key={key} style={{ fill: v(L.color) }}>
              {L.pts.map((p) =>
                p.y == null || !Number.isFinite(p.y) || p.x < x0 || p.x > x1 ? null : (
                  <path key={p.x} d={barPath(X(p.x + 0.5) - barW / 2, Y(Math.max(p.y, y0)), barW, Y(Math.max(y0, Math.min(0, y1))) - Y(Math.max(p.y, y0)), 3)} opacity={hovering && hover !== p.x ? 0.55 : 1} />
                ),
              )}
            </g>
          )
        if (L.type === 'line') {
          // Split at missing values so a gap shows as a gap
          const segs = []
          let cur = []
          for (const p of L.pts) {
            if (p.y == null || !Number.isFinite(p.y)) {
              if (cur.length) segs.push(cur)
              cur = []
            } else cur.push(p)
          }
          if (cur.length) segs.push(cur)
          return (
            <g key={key}>
              {segs.map((g, i) =>
                g.length > 1 ? (
                  <polyline
                    key={i}
                    points={g.map((p) => `${X(p.x)},${Y(p.y)}`).join(' ')}
                    fill="none"
                    strokeWidth={L.width || 2}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                    strokeDasharray={L.dash ? '5 5' : undefined}
                    style={{ stroke: v(L.color), opacity: L.opacity ?? 1 }}
                  />
                ) : (
                  <circle key={i} cx={X(g[0].x)} cy={Y(g[0].y)} r={2.5} style={{ fill: v(L.color), opacity: L.opacity ?? 1 }} />
                ),
              )}
              {L.dots &&
                L.pts.map((p) =>
                  p.y == null ? null : <circle key={`d${p.x}`} cx={X(p.x)} cy={Y(p.y)} r={p.r || 2.5} style={{ fill: v(p.color || L.color), opacity: L.opacity ?? 1 }} />,
                )}
            </g>
          )
        }
        if (L.type === 'points')
          return (
            <g key={key}>
              {L.pts.map((p, i) => {
                if (p.y == null || !Number.isFinite(p.y)) return null
                const c = v(p.color || L.color)
                const cx = X(p.x)
                return (
                  <g key={i} opacity={p.opacity ?? 1}>
                    {p.lo != null && p.hi != null && (
                      <g style={{ stroke: c }} strokeWidth={1.5}>
                        <line x1={cx} x2={cx} y1={Y(p.lo)} y2={Y(p.hi)} />
                        <line x1={cx - 4} x2={cx + 4} y1={Y(p.lo)} y2={Y(p.lo)} />
                        <line x1={cx - 4} x2={cx + 4} y1={Y(p.hi)} y2={Y(p.hi)} />
                      </g>
                    )}
                    {/* 2px surface ring so overlapping passes stay apart */}
                    <circle cx={cx} cy={Y(p.y)} r={hovering && Math.floor(p.x) === hover ? 6.5 : 5} strokeWidth={2} style={{ fill: L.hollow ? v('--surface') : c, stroke: L.hollow ? c : v('--surface') }} />
                  </g>
                )
              })}
            </g>
          )
        if (L.type === 'hline')
          return (
            <g key={key}>
              <line x1={M.l} x2={W - M.r} y1={Y(L.y)} y2={Y(L.y)} strokeWidth={1.5} strokeDasharray={L.dash === false ? undefined : '6 4'} style={{ stroke: v(L.color) }} />
              {L.label && (
                <text x={W - M.r} y={Y(L.y) - 5} textAnchor="end" style={{ ...FONT, fill: v('--ink') }} paintOrder="stroke" stroke="var(--surface)" strokeWidth={3}>
                  {L.label}
                </text>
              )}
            </g>
          )
        return null
      })}
      {hovering && <HoverMarks layers={layers} day={hover} X={X} Y={Y} top={M.t} bottom={M.t + plotH} />}
      {onHover && (
        <rect
          x={M.l}
          y={0}
          width={plotW}
          height={H}
          fill="transparent"
          onPointerMove={(e) => onHover(pick(e))}
          onPointerDown={(e) => onHover(pick(e))}
          onPointerLeave={() => onHover(null)}
        />
      )}
    </svg>
  )
}

// Crosshair over the hovered day and a ringed dot on each line there
function HoverMarks({ layers, day, X, Y, top, bottom }) {
  const cx = X(day + 0.5)
  return (
    <g pointerEvents="none">
      <line x1={cx} x2={cx} y1={top} y2={bottom} style={{ stroke: v('--ink'), opacity: 0.35 }} />
      {layers.map((L, li) =>
        L.type === 'line' && L.hover !== false
          ? L.pts
              .filter((p) => p.y != null && Math.floor(p.x) === day)
              .map((p, i) => <circle key={`${li}-${i}`} cx={X(p.x)} cy={Y(p.y)} r={5} strokeWidth={2} style={{ fill: v(p.color || L.color), stroke: v('--surface') }} />)
          : null,
      )}
    </g>
  )
}
