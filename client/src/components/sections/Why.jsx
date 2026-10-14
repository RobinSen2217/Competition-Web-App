import { useMemo } from 'react'
import { DATA, N, ser } from '../../lib/data'
import { yOf } from '../../lib/months'
import { mean, anom, roll, ols, corr } from '../../lib/stats'
import { css } from '../../lib/theme'
import { useApp } from '../../state/appContext'
import useThemeVersion from '../../hooks/useThemeVersion'
import { Card, CardHead, Kicker, Lede } from '../ui'

/*
  "Why is greenness changing?" section.
  For the selected city it links deseasonalised NDVI to a few weather drivers,
  shows one bar per driver (strongest link first) and writes a short story:
  which factor matters most, how much weather explains, and whether a trend is
  left over once weather is accounted for (a hint of land change).
*/

// [series key, label shown on the bar]
const DRIVERS = [
  ['rain', 'Rainfall'],
  ['sm_root', 'Soil moisture'],
  ['tair', 'Air temperature'],
  ['rh', 'Humidity'],
]

// Leftover trend (NDVI per decade) above which we call it real land change
// rather than noise.
const LAND_SIG = 0.004

function analyse(c) {
  const nd = anom(ser(c, 'ndvi'))

  // For each driver, find the delay (0–3 months) at which its anomalies
  // correlate best with NDVI anomalies. Rain is smoothed over 2 months first
  // because a single wet month rarely shows up in greenness on its own.
  const res = DRIVERS.map(([k, lab]) => {
    const a = anom(k === 'rain' ? roll(ser(c, k), 2) : ser(c, k))
    let best = { r: 0, lag: 0 }
    for (let lag = 0; lag <= 3; lag++) {
      const xs = [], ys = []
      for (let i = lag; i < N; i++) {
        if (nd[i] != null && a[i - lag] != null) {
          xs.push(a[i - lag])
          ys.push(nd[i])
        }
      }
      // Need a reasonable sample before a correlation means anything
      if (xs.length > 40) {
        const r = corr(xs, ys)
        if (Math.abs(r) > Math.abs(best.r)) best = { r, lag }
      }
    }
    return { k, lab, ...best, a }
  })

  // Multiple regression of NDVI anomalies on every driver at its best lag.
  // r2 is the weather-explained share; the residuals are what weather can't explain.
  // Start at i=3 so every lagged index (up to 3 back) exists.
  const rows = [], yv = [], idx = []
  for (let i = 3; i < N; i++) {
    if (nd[i] == null) continue
    const r = res.map((x) => x.a[i - x.lag])
    if (r.some((v) => v == null)) continue
    rows.push([1, ...r])
    yv.push(nd[i])
    idx.push(i)
  }
  const fit = ols(rows, yv)
  // Linear trend in the residuals over time; slope is per month, ×120 = per decade
  const resid = ols(idx.map((i) => [1, i]), fit.res)
  const leftTrend = resid.b[1] * 120

  // Plain average NDVI in a fixed early and late window
  const nd0 = ser(c, 'ndvi')
  const early = mean(nd0.filter((v, i) => yOf(i) >= 2010 && yOf(i) <= 2014))
  const late = mean(nd0.filter((v, i) => yOf(i) >= 2021 && yOf(i) <= 2025))

  // Strongest link first, regardless of sign
  const sorted = [...res].sort((a, b) => Math.abs(b.r) - Math.abs(a.r))
  return { res: sorted, r2: fit.r2, leftTrend, early, late }
}

// "same month", "1 month later", "2 months later"
const lagText = (lag) => (lag === 0 ? 'same month' : lag + ' month' + (lag > 1 ? 's' : '') + ' later')
const signed = (v, dec) => (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(dec)

export default function Why() {
  const { city } = useApp()
  // Bar colours are read with css() during render, so re-render on theme change
  useThemeVersion()

  // 16 lagged correlations (4 drivers × 4 lags) and two regressions. Cheap, but the
  // component also re-renders on theme changes, so only recompute when the city changes.
  const { res, r2, leftTrend, early, late } = useMemo(() => analyse(city), [city])

  const d = DATA.cities[city]
  const top = res[0]
  const wx = Math.round(r2 * 100)
  const landSig = Math.abs(leftTrend) > LAND_SIG

  return (
    <Card id="why" aria-labelledby="whyT">
      <CardHead>
        <Kicker>What drives the change</Kicker>
        <h2 id="whyT">Why is greenness changing?</h2>
        <Lede>We remove the normal seasonal cycle, then test how closely month-to-month greenness follows each weather factor, allowing a delay of up to three months. What weather cannot explain is a hint of land change: irrigation, new parks, or building over green land.</Lede>
      </CardHead>
      {/* Bars beside the story; stacked on narrow screens */}
      <div className="grid grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] gap-6 max-[901px]:grid-cols-[minmax(0,1fr)]">
        <div className="flex flex-col gap-3" id="drivers">
          {/* Column headings. Unlike the bar rows, this keeps its columns on small screens. */}
          <div className="grid grid-cols-[150px_1fr_64px] gap-3 text-[13px] text-muted">
            <span>Factor</span>
            <span>How closely greenness follows it</span>
            <span className="text-right">Link</span>
          </div>
          {res.map((x) => (
            <div className="grid grid-cols-[150px_minmax(0,1fr)_64px] items-center gap-3 text-[14px] max-[521px]:grid-cols-[110px_minmax(0,1fr)_52px]" key={x.k}>
              <span>
                {x.lab}
                <br />
                <span className="text-[13px] text-muted">{lagText(x.lag)}{x.r < 0 ? ' · opposite' : ''}</span>
              </span>
              <div className="h-3.5 overflow-hidden rounded-full bg-surface2">
                {/* Bar length is |r| on a 0–1 scale; orange (--s3) marks an inverse link */}
                <div className="h-full rounded-full bg-accent transition-[width] duration-500 ease-[ease]" style={{ width: Math.abs(x.r) * 100 + '%', background: x.r < 0 ? css('--s3') : css('--s1') }} />
              </div>
              <span className="text-right font-mono">{signed(x.r, 2)}</span>
            </div>
          ))}
          <p className="text-[13px] text-muted">Link is the correlation (−1 to +1) between this factor's unusual months and greenness's unusual months, at the best delay. Above about 0.3 is a clear link at this sample size. Orange bars move in the opposite direction.</p>
        </div>
        <div className="flex flex-col gap-3 rounded-2xl bg-surface2 p-[18px]" id="whyStory">
          <Kicker>{d.name} in short</Kicker>
          <p className="font-display text-[22px] leading-[1.3]">
            {/* |r| ≥ 0.3 is roughly where a link is clear at this sample size */}
            {Math.abs(top.r) >= 0.3 ? (
              <>
                Greenness here follows <b>{top.lab.toLowerCase()}</b> most closely{top.lag ? `, with about a ${top.lag}-month delay` : ''}.
              </>
            ) : (
              'No single weather factor tracks greenness closely here.'
            )}
          </p>
          <p className="text-[15px]">Weather explains about <b>{wx}%</b> of the month-to-month ups and downs once seasons are removed.</p>
          <p className="text-[15px]">
            Average greenness moved from <b className="font-mono tabular-nums">{early.toFixed(3)}</b> (2010–14) to <b className="font-mono tabular-nums">{late.toFixed(3)}</b> (2021–25). After accounting for weather, the leftover trend is <b className="font-mono tabular-nums">{signed(leftTrend, 3)}</b> NDVI per decade
            {landSig
              ? leftTrend > 0
                ? ': greening that weather does not explain, which points to irrigation, tree planting or other land change.'
                : ': browning that weather does not explain, which points to land change such as building over green areas.'
              : ', small enough to be mostly weather.'}
          </p>
          {/* 15px, not the 13px of the other small print: the original's story paragraph size won over its small-text class */}
          <p className="text-[15px] text-muted">These are statistical links, not proof of cause. Confirming land change needs land-cover maps, which are part of the next stage.</p>
        </div>
      </div>
    </Card>
  )
}
