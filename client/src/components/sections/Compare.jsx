import { useMemo, useState } from 'react'
import { flushSync } from 'react-dom'
import { DATA, CITY_IDS, ser } from '../../lib/data'
import { yOf } from '../../lib/months'
import { P, fmtv, unitS } from '../../lib/params'
import { mean } from '../../lib/stats'
import { useApp } from '../../state/appContext'

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

const signed = (v, dec) => (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(dec)

export default function Compare() {
  const { city, setCity } = useApp()
  const [k, setK] = useState('ndvi')

  const { rows, lo, hi, pad } = useMemo(() => {
    const rows = CITY_IDS.map((c) => {
      const a = ser(c, k)
      return { c, name: DATA.cities[c].name, e: fiveYearAvg(a, k, 2010), l: fiveYearAvg(a, k, 2021) }
    })
    // Shared scale across all cities, with 8% padding so dots don't sit on the edge
    const all = rows.flatMap((r) => [r.e, r.l]).filter((v) => v != null)
    const lo = Math.min(...all), hi = Math.max(...all), pad = (hi - lo) * 0.08 || 0.01
    return { rows, lo, hi, pad }
  }, [k])

  // Value -> % position along the track
  const X = (v) => ((v - (lo - pad)) / (hi + pad - (lo - pad))) * 100

  const open = (c) => {
    // Render the new city before scrolling, as the original did, so the scroll
    // target lands correctly even if sections above change height.
    flushSync(() => setCity(c))
    document.getElementById('glance')?.scrollIntoView()
  }

  return (
    <section className="card" id="compare" aria-labelledby="cmpT">
      <div className="head">
        <div>
          <span className="kicker">City to city</span>
          <h2 id="cmpT">How the cities compare</h2>
          <p className="lede">Average of 2010–2014 (hollow dot) against 2021–2025 (filled dot). Tap a city to open it.</p>
        </div>
        <select id="cmpParam" aria-label="Parameter to compare" value={k} onChange={(e) => setK(e.target.value)}>
          {CMP_KEYS.map((key) => (
            <option key={key} value={key}>{P[key].label}{P[key].sum ? ' (yearly total)' : ''}</option>
          ))}
        </select>
      </div>
      <div className="dumb" id="dumb">
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
              className="drow"
              data-c={r.c}
              aria-current={r.c === city}
              title={`${r.name}: ${fmtv(k, r.e)} → ${fmtv(k, r.l)}${unitS(k)}`}
              onClick={() => open(r.c)}
            >
              <b>{r.name}</b>
              <span className="dtrack" aria-hidden="true">
                <span className="dline" style={{ left: a + '%', width: b - a + '%' }} />
                <span className="ddot" style={{ left: X(r.e) + '%' }} />
                <span className="ddot on" style={{ left: X(r.l) + '%' }} />
              </span>
              <span className="v">{signed(d, P[k].dec)}{pct}</span>
            </button>
          )
        })}
        {/* Scale ends, aligned under the tracks */}
        <div className="xs muted" style={{ display: 'grid', gridTemplateColumns: '110px minmax(0,1fr) 90px', gap: 12, padding: '0 10px' }}>
          <span />
          <span style={{ display: 'flex', justifyContent: 'space-between' }} className="mono">
            <span>{(lo - pad).toFixed(P[k].dec)}{unitS(k)}</span>
            <span>{(hi + pad).toFixed(P[k].dec)}{unitS(k)}</span>
          </span>
          <span style={{ textAlign: 'right' }}>change</span>
        </div>
      </div>
    </section>
  )
}
