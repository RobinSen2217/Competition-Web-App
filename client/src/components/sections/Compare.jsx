import { useMemo, useState } from 'react'
import { flushSync } from 'react-dom'
import { CITIES, CITY_IDS, useTimeseries } from '../../lib/store'
import { yOf } from '../../lib/months'
import { P, fmtv, unitS } from '../../lib/params'
import { mean } from '../../lib/stats'
import { useApp } from '../../state/appContext'
import { SectionLoader } from '../common/SectionLoader'
import { Card, CardHead, Kicker, Lede, Select } from '../ui'
import { cx } from '../../styles/classes'

/*
  "How the cities compare" section.
  A dumbbell row per city: hollow dot = 2010–2014 average, filled dot =
  2021–2025 average, on a shared scale. Clicking a row opens that city.
*/

const CMP_KEYS = ['ndvi', 'rain', 'tair', 'lst_day', 'lst_night', 'sm_root', 'aod']

// Average of one parameter over the 5 years starting at y0.
// Summed parameters (rain) are first totalled per year, and a year only counts
// when all 12 months are present, so a gap can't make a year look dry.
function fiveYearAvg(a, k, y0) {
  const v = []
  for (let y = y0; y < y0 + 5; y++) {
    const yr = a.filter((x, i) => yOf(i) === y)
    if (P[k].sum) {
      if (yr.every((x) => x != null) && yr.length === 12) v.push(yr.reduce((s, x) => s + x, 0))
    } else v.push(mean(yr))
  }
  return mean(v)
}

// Height of the six rows plus the scale line (measured, same at every width),
// so the loader takes the same room.
const bodyH = 'h-[412px]'

const signed = (v, dec) => (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(dec)

// One clickable city row. The reset at the start stands in for the original's
// `all: unset` on the button (no native look, text aligned to the start,
// inherited font). focus-visible keeps the page-wide accent outline but with
// no offset, because that reset also cleared the offset in the original.
// The current city's tint wins over the hover tint (aria variants sort after hover).
const rowCls = cx(
  'm-0 appearance-none border-0 bg-transparent text-start',
  'grid cursor-pointer grid-cols-[110px_minmax(0,1fr)_90px] items-center gap-3 rounded-xl px-2.5 py-2 text-[14px]',
  'hover:bg-surface2 focus-visible:outline-offset-0 aria-[current=true]:bg-accent-soft',
)

// Hollow dot (2010–2014); `on` fills it (2021–2025). left is set inline.
const dotCls = 'absolute top-1.5 -ml-[7px] box-border size-3.5 rounded-full border-[2.5px] border-s1'

export default function Compare() {
  const { city, setCity } = useApp()
  const [sel, setSel] = useState('ndvi')
  // One parameter for every city. keepPrevious: after picking another
  // parameter the current rows stay (dimmed) until its series are in.
  const { data, status, error, retry, stale } = useTimeseries({ areas: '*', parameters: [sel] }, { keepPrevious: true })
  // The parameter the shown rows belong to: the previous one while stale.
  // Read from the data itself (the first city that has the series).
  const k = (data && Object.values(data).map((o) => Object.keys(o)[0]).find(Boolean)) || sel

  const view = useMemo(() => {
    if (!data) return null
    // A city without this parameter gets an empty series (no dots)
    const rows = CITY_IDS.map((c) => {
      const a = data[c]?.[k] || []
      return { c, name: CITIES[c].name, e: fiveYearAvg(a, k, 2010), l: fiveYearAvg(a, k, 2021) }
    })
    // Shared scale across all cities, with 8% padding so dots don't sit on the edge
    const all = rows.flatMap((r) => [r.e, r.l]).filter((v) => v != null)
    const lo = Math.min(...all), hi = Math.max(...all), pad = (hi - lo) * 0.08 || 0.01
    return { rows, lo, hi, pad }
  }, [data, k])


  const open = (c) => {
    // Render the new city before scrolling, as the original did, so the scroll
    // target lands correctly even if sections above change height.
    flushSync(() => setCity(c))
    document.getElementById('glance')?.scrollIntoView()
  }

  return (
    <Card id="compare" aria-labelledby="cmpT" aria-busy={status === 'loading'}>
      <CardHead
        aside={
          <Select id="cmpParam" aria-label="Parameter to compare" value={sel} onChange={(e) => setSel(e.target.value)}>
            {CMP_KEYS.map((key) => (
              <option key={key} value={key}>{P[key].label}{P[key].sum ? ' (yearly total)' : ''}</option>
            ))}
          </Select>
        }
      >
        <Kicker>City to city</Kicker>
        <h2 id="cmpT">How the cities compare</h2>
        <Lede>Average of 2010–2014 (hollow dot) against 2021–2025 (filled dot). Tap a city to open it.</Lede>
      </CardHead>
      {view ? (
        <Dumbbells {...view} k={k} city={city} stale={stale} onOpen={open} />
      ) : (
        <SectionLoader label="Loading every city's series…" error={status === 'error' ? error : null} onRetry={retry} className={bodyH} />
      )}
    </Card>
  )
}

// The city rows and scale for parameter `k`. `stale`: these rows belong to the
// previously chosen parameter while the new one loads (dimmed, announced).
function Dumbbells({ rows, lo, hi, pad, k, city, stale, onOpen }) {
  // Value -> % position along the track
  const X = (v) => ((v - (lo - pad)) / (hi + pad - (lo - pad))) * 100

  return (
    <>
      {stale && (
        <span role="status" className="sr-only">
          Loading the new parameter…
        </span>
      )}
      <div className={cx('flex flex-col gap-1.5 transition-opacity duration-200', stale && 'opacity-55')} id="dumb">
        {rows.map((r) => {
          const d = r.l - r.e
          // Relative change only where a percentage is meaningful (totals and NDVI),
          // not for temperatures or aerosol where the zero point is arbitrary
          const pct = P[k].sum || k === 'ndvi' ? ` (${signed((d / r.e) * 100, 0)}%)` : ''
          const a = Math.min(X(r.e), X(r.l)), b = Math.max(X(r.e), X(r.l))
          return (
            <button
              key={r.c}
              type="button"
              className={rowCls}
              data-c={r.c}
              aria-current={r.c === city}
              title={`${r.name}: ${fmtv(k, r.e)} → ${fmtv(k, r.l)}${unitS(k)}`}
              onClick={() => onOpen(r.c)}
            >
              <b>{r.name}</b>
              {/* Track: a thin grey baseline (::before), the coloured span between the two averages, then the dots */}
              <span className="relative mx-2 h-[26px] before:absolute before:inset-x-0 before:top-3 before:h-0.5 before:rounded-[2px] before:bg-line before:content-['']" aria-hidden="true">
                <span className="absolute top-[11.5px] h-[3px] rounded-[3px] bg-s1" style={{ left: a + '%', width: b - a + '%' }} />
                <span className={cx(dotCls, 'bg-surface')} style={{ left: X(r.e) + '%' }} />
                <span className={cx(dotCls, 'bg-s1')} style={{ left: X(r.l) + '%' }} />
              </span>
              <span className="text-right font-mono">{signed(d, P[k].dec)}{pct}</span>
            </button>
          )
        })}
        {/* Scale ends, aligned under the tracks */}
        <div className="grid grid-cols-[110px_minmax(0,1fr)_90px] gap-3 px-2.5 text-[13px] text-muted">
          <span />
          <span className="flex justify-between font-mono tabular-nums">
            <span>{(lo - pad).toFixed(P[k].dec)}{unitS(k)}</span>
            <span>{(hi + pad).toFixed(P[k].dec)}{unitS(k)}</span>
          </span>
          <span className="text-right">change</span>
        </div>
      </div>
    </>
  )
}
