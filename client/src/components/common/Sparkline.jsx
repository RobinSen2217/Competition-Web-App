import { lastIdx } from '../../lib/stats'

// Tiny trend line of the last n+1 months, with a dot on the latest value.
export default function Sparkline({ data, color, n = 35 }) {
  const li = lastIdx(data), i0 = Math.max(0, li - n), seg = data.slice(i0, li + 1), v = seg.filter((x) => x != null)
  if (!v.length) return null
  const lo = Math.min(...v), hi = Math.max(...v), w = 200, h = 40
  const X = (i) => (i / (seg.length - 1)) * w
  const Y = (x) => h - 3 - ((x - lo) / (hi - lo || 1)) * (h - 6)
  let d = '', pen = false
  seg.forEach((x, i) => {
    if (x == null) {
      pen = false
      return
    }
    d += (pen ? 'L' : 'M') + X(i).toFixed(1) + ',' + Y(x).toFixed(1) + ' '
    pen = true
  })
  return (
    <svg viewBox={`-4 0 ${w + 8} ${h}`} preserveAspectRatio="none" aria-hidden="true">
      <path d={d} fill="none" stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
      <circle cx={X(seg.length - 1)} cy={Y(seg[seg.length - 1])} r="3" fill={color} />
    </svg>
  )
}
