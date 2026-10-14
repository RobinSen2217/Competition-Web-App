import { mOf, yOf } from './months'
import { ser } from './data'

export const mean = (a) => {
  const v = a.filter((x) => x != null && !isNaN(x))
  return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null
}

// Monthly climatology (average for each calendar month) up to and including toYear.
// The 2025 default is the last complete calendar year of the data (which runs to
// Sep 2026), so a partial year can't skew the monthly norms. Update it when a
// full new year of data arrives.
export function clim(a, toYear = 2025) {
  const c = Array(12).fill(0).map(() => [])
  a.forEach((v, i) => {
    if (v != null && yOf(i) <= toYear) c[mOf(i)].push(v)
  })
  return c.map((x) => (x.length ? x.reduce((s, y) => s + y, 0) / x.length : null))
}

// Deseasonalised anomalies.
export function anom(a) {
  const c = clim(a)
  return a.map((v, i) => (v == null || c[mOf(i)] == null ? null : v - c[mOf(i)]))
}

// Trailing rolling mean; null until the window is full or if any value is missing.
export function roll(a, w = 12) {
  return a.map((_, i) => {
    if (i < w - 1) return null
    const s = a.slice(i - w + 1, i + 1)
    if (s.some((x) => x == null)) return null
    return s.reduce((x, y) => x + y, 0) / w
  })
}

export function lastIdx(a) {
  for (let i = a.length - 1; i >= 0; i--) if (a[i] != null) return i
  return -1
}

// Ordinary least squares. X rows include the intercept column. Returns {b, r2, res, sd}.
export function ols(X, y) {
  const p = X[0].length
  const A = Array(p).fill(0).map(() => Array(p + 1).fill(0))
  X.forEach((r, i) => {
    for (let a = 0; a < p; a++) {
      for (let b = 0; b < p; b++) A[a][b] += r[a] * r[b]
      A[a][p] += r[a] * y[i]
    }
  })
  for (let i = 0; i < p; i++) {
    let m = i
    for (let r = i + 1; r < p; r++) if (Math.abs(A[r][i]) > Math.abs(A[m][i])) m = r
    ;[A[i], A[m]] = [A[m], A[i]]
    const d = A[i][i] || 1e-12
    for (let j = i; j <= p; j++) A[i][j] /= d
    for (let r = 0; r < p; r++)
      if (r !== i) {
        const f = A[r][i]
        for (let j = i; j <= p; j++) A[r][j] -= f * A[i][j]
      }
  }
  const b = A.map((r) => r[p])
  const yh = X.map((r) => r.reduce((s, x, j) => s + x * b[j], 0))
  const ym = y.reduce((s, v) => s + v, 0) / y.length
  const ssr = y.reduce((s, v, i) => s + (v - yh[i]) ** 2, 0)
  const sst = y.reduce((s, v) => s + (v - ym) ** 2, 0)
  return { b, r2: 1 - ssr / sst, res: y.map((v, i) => v - yh[i]), sd: Math.sqrt(ssr / Math.max(1, y.length - p)) }
}

export function corr(a, b) {
  const n = a.length
  const ma = a.reduce((s, x) => s + x, 0) / n
  const mb = b.reduce((s, x) => s + x, 0) / n
  let sab = 0, saa = 0, sbb = 0
  for (let i = 0; i < n; i++) {
    sab += (a[i] - ma) * (b[i] - mb)
    saa += (a[i] - ma) ** 2
    sbb += (b[i] - mb) ** 2
  }
  return sab / Math.sqrt(saa * sbb)
}

// Baseline forecast: climatology + linear trend on anomalies + decaying persistence
// of the last 3 months' residual. 80% band = ±1.28 sd.
export function forecast(a, h) {
  const c = clim(a)
  const an = a.map((v, i) => (v == null ? null : v - c[mOf(i)]))
  const pts = an.map((v, i) => (v == null ? null : [i, v])).filter(Boolean)
  if (pts.length < 36) return null
  const f = ols(pts.map((p) => [1, p[0]]), pts.map((p) => p[1]))
  const fit = (i) => f.b[0] + f.b[1] * i
  const li = lastIdx(a)
  const recent = pts.filter((p) => p[0] > li - 3).map((p) => p[1] - fit(p[0]))
  const pers = recent.reduce((s, x) => s + x, 0) / recent.length
  const out = []
  for (let k = 1; k <= h; k++) {
    const i = li + k, m = (mOf(li) + k) % 12, v = c[m] + fit(i) + pers * Math.pow(0.6, k)
    out.push({ i, v, lo: v - 1.28 * f.sd, hi: v + 1.28 * f.sd, m })
  }
  return { li, out, perDecade: f.b[1] * 120, sd: f.sd, clim: c }
}

// Latest NDVI against the usual value for that calendar month.
export function ndviStatus(c) {
  const a = ser(c, 'ndvi'), li = lastIdx(a), cl = clim(a), d = ((a[li] - cl[mOf(li)]) / cl[mOf(li)]) * 100
  return {
    li,
    v: a[li],
    d,
    chip: d >= 5 ? ['good', 'Greener than usual'] : d <= -5 ? ['bad', 'Less green than usual'] : ['neutral', 'About normal'],
  }
}
