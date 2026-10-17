import { useMemo } from 'react'
import { DATA, M, ser } from '../../lib/data'
import { MON, mLabel, mOf, yOf } from '../../lib/months'
import { clim, lastIdx, mean, ndviStatus } from '../../lib/stats'
import { css } from '../../lib/theme'
import { useApp } from '../../state/appContext'
import useThemeVersion from '../../hooks/useThemeVersion'
import Sparkline from '../common/Sparkline'
import { Card, CardHead, Chip, Kicker, Lede } from '../ui'

// "At a glance": four headline cards for the selected city (greenness, monsoon
// rainfall, air temperature and surface soil moisture), each compared with what
// is usual for that time of year.

// Jun, Jul, Aug, Sep as 0-based month numbers: the Indian summer monsoon.
const MONSOON = [5, 6, 7, 8]

// Index into DATA.months for a given year and 0-based month (-1 if outside the data).
const idxOf = (y, m) => M.indexOf(`${y}-${String(m + 1).padStart(2, '0')}`)

// Sparkline size inside a glance card.
const sparkCls = 'block h-[46px] w-full'

// One headline card; `chip` is [tone, text]. A sparkline, if any, goes in as children.
function GlanceCard({ lab, big, unit, chip, txt, children }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5 rounded-2xl bg-surface2 p-4">
      <span className="text-[14px] font-semibold text-muted">{lab}</span>
      <span className="font-mono text-[28px] leading-[1.1] font-medium">
        {big}
        <small className="ml-1 text-[14px] text-muted">{unit}</small>
      </span>
      <Chip tone={chip[0]}>{chip[1]}</Chip>
      <p className="text-[14px] text-muted">{txt}</p>
      {children}
    </div>
  )
}

export default function Glance() {
  const { city: c } = useApp()
  // Re-render on theme change so the sparkline colours read via css() update.
  useThemeVersion()

  // All numbers depend only on the city, so they are recomputed only when it changes.
  const g = useMemo(() => {
    const nd = ndviStatus(c)

    // Rainfall: this year's monsoon so far against the normal total for the same
    // months. Before June there is no monsoon yet this year, so fall back to the
    // whole of last year's monsoon (Jun–Sep). Missing months count as 0 mm.
    const rain = ser(c, 'rain'), lr = lastIdx(rain), yr = yOf(lr), lastM = mOf(lr)
    const monsoonMs = MONSOON.filter((m) => m <= lastM)
    const cl = clim(rain)
    let rNow, rNorm, rLab
    if (monsoonMs.length) {
      rNow = monsoonMs.reduce((s, m) => s + (rain[idxOf(yr, m)] || 0), 0)
      rNorm = monsoonMs.reduce((s, m) => s + cl[m], 0)
      rLab = `Monsoon ${yr} so far (${MON[monsoonMs[0]]}–${MON[monsoonMs[monsoonMs.length - 1]]})`
    } else {
      const y = yr - 1
      rNow = MONSOON.reduce((s, m) => s + (rain[idxOf(y, m)] || 0), 0)
      rNorm = MONSOON.reduce((s, m) => s + cl[m], 0)
      rLab = `Monsoon ${y} (Jun–Sep)`
    }
    const rd = ((rNow - rNorm) / rNorm) * 100

    // Air temperature: mean of the latest 12 months against the fixed 2010–2019
    // baseline. A full year is used so the season does not bias the comparison.
    const t = ser(c, 'tair'), lt = lastIdx(t)
    const t12 = mean(t.slice(lt - 11, lt + 1))
    const base = mean(t.filter((v, i) => yOf(i) <= 2019))
    const td = t12 - base

    // Soil moisture: latest month against that calendar month's climatology,
    // in percentage points of saturation.
    const sm = ser(c, 'sm_top'), ls = lastIdx(sm), smc = clim(sm), smd = sm[ls] - smc[mOf(ls)]

    return { nd, rain, rNow, rNorm, rLab, rd, t, td, base, sm, ls, smc, smd }
  }, [c])

  const { nd, rain, rNow, rNorm, rLab, rd, t, td, base, sm, ls, smc, smd } = g

  return (
    <Card id="glance" aria-labelledby="glanceT">
      <CardHead>
        <Kicker id="glanceKick">{DATA.cities[c].name} right now</Kicker>
        <h2 id="glanceT">How is the city doing?</h2>
        <Lede id="glanceLede">
          Latest satellite month: {mLabel(nd.li)}. Each card compares with the usual value for that time of year.
        </Lede>
      </CardHead>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,180px),1fr))] gap-3" id="glanceCards">
        <GlanceCard
          lab="Vegetation greenness"
          big={nd.v.toFixed(2)}
          unit="NDVI"
          chip={nd.chip}
          txt={`${Math.abs(nd.d).toFixed(0)}% ${nd.d >= 0 ? 'above' : 'below'} a usual ${MON[mOf(nd.li)]}.`}
        >
          <Sparkline className={sparkCls} data={ser(c, 'ndvi')} color={css('--s1')} />
        </GlanceCard>
        {/* Rainfall swings a lot year to year, so it uses a wider ±10% "normal" band */}
        <GlanceCard
          lab="Rainfall"
          big={Math.round(rNow)}
          unit="mm"
          chip={rd >= 10 ? ['good', 'Wetter than usual'] : rd <= -10 ? ['warn', 'Drier than usual'] : ['neutral', 'Near normal']}
          txt={`${rLab}. Usual: ${Math.round(rNorm)} mm.`}
        >
          <Sparkline className={sparkCls} data={rain} color={css('--s2')} />
        </GlanceCard>
        <GlanceCard
          lab="Air temperature"
          big={(td >= 0 ? '+' : '−') + Math.abs(td).toFixed(1)}
          unit="°C"
          chip={td >= 0.3 ? ['warn', 'Warmer'] : td <= -0.3 ? ['good', 'Cooler'] : ['neutral', 'Similar']}
          txt={`Last 12 months against the 2010–2019 average of ${base.toFixed(1)} °C.`}
        >
          <Sparkline className={sparkCls} data={t} color={css('--s3')} />
        </GlanceCard>
        <GlanceCard
          lab="Surface soil moisture"
          big={Math.round(sm[ls])}
          unit="% wet"
          chip={smd >= 5 ? ['good', 'Moister than usual'] : smd <= -5 ? ['warn', 'Drier than usual'] : ['neutral', 'Near normal']}
          txt={`${mLabel(ls)}. Usual for ${MON[mOf(ls)]}: ${Math.round(smc[mOf(ls)])}%.`}
        >
          <Sparkline className={sparkCls} data={sm} color={css('--s2')} />
        </GlanceCard>
      </div>
    </Card>
  )
}
