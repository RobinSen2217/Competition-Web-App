import { useMemo } from 'react'
import { motion } from 'framer-motion'
import { DATA, ser } from '../../lib/data'
import { MON, mLabel, mOf, yOf } from '../../lib/months'
import { P, PARAMS, fmtv, unitS } from '../../lib/params'
import { anom, clim, lastIdx, ols } from '../../lib/stats'
import { css } from '../../lib/theme'
import { useApp } from '../../state/appContext'
import useThemeVersion from '../../hooks/useThemeVersion'
import Sparkline from '../common/Sparkline'
import { REVEAL_VIEWPORT, fadeUp, stagger } from '../common/motionPresets'
import { Card, CardHead, Chip, Group, GroupTitle, Kicker, Lede } from '../ui'

// "Data analysis" overview: one small card per measure for the selected city,
// grouped like the plot builder. Each card shows the latest month, how it
// compares with the usual value for that calendar month, the long-term trend
// and a sparkline of the last 3 years.

// Group headings in display order, each with the series colour of its sparklines.
const GROUPS = [
  { name: 'Land and surface', color: '--s1' },
  { name: 'Water', color: '--s2' },
  { name: 'Weather and air', color: '--s3' },
]

// Same cut-off year as clim(): the last complete calendar year of the data.
const CLIM_TO = 2025

// |z| below this counts as "Near usual". Half a standard deviation keeps
// ordinary year-to-year wobble from being reported as a departure.
const Z_NEAR = 0.5

// A trend is reported only if the change it implies over the whole record is at
// least this fraction of the spread (standard deviation) of the monthly
// anomalies. Smaller drifts are lost in the month-to-month noise, so the card
// says "no clear trend" instead of printing a number that means little.
const TREND_MIN = 0.25

// Sign with the typographic minus used across the site.
const signed = (v, dec) => (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(dec)

const sd = (a) => {
  if (a.length < 2) return null
  const m = a.reduce((s, x) => s + x, 0) / a.length
  return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1))
}

// All statistics for one measure. Returns { empty: true } for an all-null series.
function analyse(c, k) {
  const a = ser(c, k) || []
  const li = lastIdx(a)
  if (li < 0) return { empty: true }

  // Latest value against the usual value for that calendar month. The spread is
  // the year-to-year standard deviation of that same month, over the same years
  // as the climatology, so z says how unusual this month is for the season.
  const m = mOf(li), cl = clim(a, CLIM_TO)
  const same = a.filter((v, i) => v != null && mOf(i) === m && yOf(i) <= CLIM_TO)
  const s = sd(same)
  let chip = null
  if (cl[m] != null && s) {
    const z = (a[li] - cl[m]) / s
    chip = Math.abs(z) < Z_NEAR ? 'Near usual' : z > 0 ? 'Higher than usual' : 'Lower than usual'
  }

  // Trend: OLS slope of the deseasonalised anomalies against the month index,
  // scaled from per month to per decade (x 120).
  const pts = anom(a).map((v, i) => (v == null ? null : [i, v])).filter(Boolean)
  let trend = null
  if (pts.length >= 24) {
    const slope = ols(pts.map((p) => [1, p[0]]), pts.map((p) => p[1])).b[1]
    const spread = sd(pts.map((p) => p[1]))
    const span = pts[pts.length - 1][0] - pts[0][0]
    const clear = spread > 0 && Math.abs(slope * span) >= TREND_MIN * spread
    trend = { perDecade: slope * 120, clear }
  }

  return { empty: false, a, li, usual: cl[m], chip, trend }
}

// One measure's card.
function ParamCard({ k, st, color }) {
  const p = P[k]
  return (
    <motion.div variants={fadeUp} className="flex min-w-0 flex-col gap-1.5 rounded-2xl bg-surface2 p-4">
      <span className="text-[14px] font-semibold text-muted">{p.label}</span>
      {st.empty ? (
        <span className="text-[17px] font-semibold text-muted">No data</span>
      ) : (
        <>
          <span className="font-mono text-[24px] leading-[1.1] font-medium">
            {fmtv(k, st.a[st.li])}
            {p.unit && <small className="ml-0.5 text-[13px] text-muted">{unitS(k).trim()}</small>}
          </span>
          <span className="text-[13px] text-muted">{mLabel(st.li)}</span>
          {/* Neutral tone on purpose: "higher" is good for some measures and bad for others */}
          {st.chip && <Chip tone="neutral">{st.chip}</Chip>}
          {st.usual != null && (
            <span className="text-[13px] text-muted">
              Usual {MON[mOf(st.li)]}: {fmtv(k, st.usual)}
              {unitS(k)}
            </span>
          )}
          {st.trend && (
            <span className="text-[13px] text-muted">
              Trend:{' '}
              {st.trend.clear ? (
                <b className="font-mono font-medium text-ink">
                  {signed(st.trend.perDecade, p.dec + 1)}
                  {unitS(k)} per decade
                </b>
              ) : (
                'no clear trend'
              )}
            </span>
          )}
          <Sparkline className="block h-[40px] w-full" data={st.a} color={css(color)} />
        </>
      )}
      <span className="text-[12.5px] text-muted">{p.src}</span>
    </motion.div>
  )
}

export default function Features() {
  const { city: c } = useApp()
  // Re-render on theme change so the sparkline colours read via css() update.
  useThemeVersion()

  // Every statistic depends only on the city.
  const stats = useMemo(() => Object.fromEntries(PARAMS.map((p) => [p.k, analyse(c, p.k)])), [c])

  return (
    <Card id="features" aria-labelledby="featuresT">
      <CardHead>
        <Kicker>{DATA.cities[c].name} in numbers</Kicker>
        <h2 id="featuresT">Every measure at a glance</h2>
        <Lede>
          Each card shows the latest month, whether it is higher or lower than usual for that time of year, the
          long-term trend per decade, and a line of the last 3 years.
        </Lede>
      </CardHead>
      {GROUPS.map((g) => (
        <Group key={g.name} role="group" aria-label={g.name}>
          <GroupTitle>{g.name}</GroupTitle>
          {/* The cards of a group fade up one after another (35 ms apart) when
              the grid first scrolls into view; each card takes its timing
              from the grid through the shared variants. */}
          <motion.div
            className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,160px),1fr))] gap-3"
            initial="hidden"
            whileInView="shown"
            viewport={REVEAL_VIEWPORT}
            variants={stagger}
          >
            {PARAMS.filter((p) => p.grp === g.name).map((p) => (
              <ParamCard key={p.k} k={p.k} st={stats[p.k]} color={g.color} />
            ))}
            {g.name === 'Water' && (
              <motion.div variants={fadeUp} className="flex min-w-0 flex-col gap-1.5 rounded-2xl bg-surface2 p-4">
                <span className="text-[14px] font-semibold text-muted">Water index (NDWI)</span>
                <span className="text-[17px] font-semibold text-muted">No series yet</span>
                <p className="text-[13px] text-muted">
                  A 10 m Sentinel-2 NDWI image exists only for Jaisalmer (Gadisar Lake), as the map layer “Water (NDWI)
                  10 m”. City-wide NDWI series will come with the Earth Engine pipeline.
                </p>
                <a href="#where" className="self-start text-[14px] font-semibold text-accent">
                  Open the map
                </a>
                <span className="text-[12.5px] text-muted">Sentinel-2</span>
              </motion.div>
            )}
          </motion.div>
        </Group>
      ))}
    </Card>
  )
}
