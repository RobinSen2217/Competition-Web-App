import { useMemo } from 'react'
import { CITIES, M, useTimeseries } from '../../lib/store'
import { MON, mLabel, mOf, yOf } from '../../lib/months'
import { clim, lastIdx, mean, ndviStatus } from '../../lib/stats'
import { css } from '../../lib/theme'
import { useApp } from '../../state/appContext'
import useThemeVersion from '../../hooks/useThemeVersion'
import Sparkline from '../common/Sparkline'
import { SectionLoader, Skeleton } from '../common/SectionLoader'
import { cx } from '../../styles/classes'
import { Card, CardHead, Chip, Kicker, Lede } from '../ui'

// "At a glance": four headline cards for the selected city (greenness, monsoon
// rainfall, air temperature and surface soil moisture), each compared with what
// is usual for that time of year.

// Jun, Jul, Aug, Sep as 0-based month numbers: the Indian summer monsoon.
const MONSOON = [5, 6, 7, 8]

// The series the four cards draw; only these are fetched for the city.
const GLANCE_PARAMS = ['ndvi', 'rain', 'tair', 'sm_top']

// Height of the card grid, so the loader takes the same room (no jump when the
// numbers arrive), measured: one row of four cards, two rows of two, or four
// stacked on phones. The breakpoints are where the 180px-min grid rewraps.
const bodyH = 'h-[223px] max-[848px]:h-[480px] max-[464px]:h-[886px]'

// Index into M for a given year and 0-based month (-1 if outside the data).
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
  const { city } = useApp()
  // keepPrevious: on a city switch the previous city's cards stay (dimmed)
  // until the new numbers are in, instead of blinking to a loader.
  const { data, status, error, retry, stale } = useTimeseries({ areas: city, parameters: GLANCE_PARAMS }, { keepPrevious: true })
  // The city the shown numbers belong to (the previous one while stale)
  const c = data ? Object.keys(data)[0] : city
  const cs = data?.[c] // { ndvi, rain, tair, sm_top }: arrays aligned with M
  // Re-render on theme change so the sparkline colours read via css() update.
  useThemeVersion()

  // All numbers depend only on the loaded series, so they are recomputed only when the data changes.
  const g = useMemo(() => {
    if (!cs) return null
    const nd = ndviStatus(cs.ndvi)

    // Rainfall: this year's monsoon so far against the normal total for the same
    // months. Before June there is no monsoon yet this year, so fall back to the
    // whole of last year's monsoon (Jun–Sep). Missing months count as 0 mm.
    const rain = cs.rain, lr = lastIdx(rain), yr = yOf(lr), lastM = mOf(lr)
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
    const t = cs.tair, lt = lastIdx(t)
    const t12 = mean(t.slice(lt - 11, lt + 1))
    const base = mean(t.filter((v, i) => yOf(i) <= 2019))
    const td = t12 - base

    // Soil moisture: latest month against that calendar month's climatology,
    // in percentage points of saturation.
    const sm = cs.sm_top, ls = lastIdx(sm), smc = clim(sm), smd = sm[ls] - smc[mOf(ls)]

    return { nd, rain, rNow, rNorm, rLab, rd, t, td, base, sm, ls, smc, smd }
  }, [cs])

  // First load (or a failed one): the card's frame with the loader in place
  // of the four cards. The lede's month needs the data, so it waits too.
  if (!g) {
    return (
      <Card id="glance" aria-labelledby="glanceT" aria-busy={status === 'loading'}>
        <CardHead>
          <Kicker id="glanceKick">{CITIES[city].name} right now</Kicker>
          <h2 id="glanceT">How is the city doing?</h2>
          {/* Same sentence as when loaded, with a placeholder for the month, so
              the lede wraps the same and the card does not jump */}
          <Lede id="glanceLede">
            Latest satellite month:{' '}
            <span className="inline-block w-[72px] align-middle">
              <Skeleton animate={status === 'loading'} className="h-[14px] rounded-full" />
            </span>
            . Each card compares with the usual value for that time of year.
          </Lede>
        </CardHead>
        <SectionLoader
          label={`Loading ${CITIES[city].name}'s latest month…`}
          error={status === 'error' ? error : null}
          onRetry={retry}
          className={bodyH}
        />
      </Card>
    )
  }

  const { nd, rain, rNow, rNorm, rLab, rd, t, td, base, sm, ls, smc, smd } = g

  return (
    <Card id="glance" aria-labelledby="glanceT" aria-busy={stale}>
      <CardHead>
        <Kicker id="glanceKick">{CITIES[c].name} right now</Kicker>
        <h2 id="glanceT">How is the city doing?</h2>
        <Lede id="glanceLede">
          Latest satellite month: {mLabel(nd.li)}. Each card compares with the usual value for that time of year.
        </Lede>
      </CardHead>
      {stale && (
        <span role="status" className="sr-only">
          Loading {CITIES[city].name}…
        </span>
      )}
      {/* Dimmed while the next city's numbers load */}
      <div
        className={cx('grid grid-cols-[repeat(auto-fit,minmax(min(100%,180px),1fr))] gap-3 transition-opacity duration-200', stale && 'opacity-55')}
        id="glanceCards"
      >
        <GlanceCard
          lab="Vegetation greenness"
          big={nd.v.toFixed(2)}
          unit="NDVI"
          chip={nd.chip}
          txt={`${Math.abs(nd.d).toFixed(0)}% ${nd.d >= 0 ? 'above' : 'below'} a usual ${MON[mOf(nd.li)]}.`}
        >
          <Sparkline className={sparkCls} data={cs.ndvi} color={css('--s1')} />
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
