import { useCallback, useMemo, useState } from 'react'
import { ser } from '../../lib/data'
import { MON, mOf, FIRST_YEAR } from '../../lib/months'
import { P, fmtv, unitS } from '../../lib/params'
import { forecast } from '../../lib/stats'
import { css } from '../../lib/theme'
import { useApp } from '../../state/appContext'
import Chart from '../common/Chart'
import { Card, CardHead, Kicker, Lede, Readout, ReadoutItem, ReadoutWhen, Seg, SegButton, Select, Swatch } from '../ui'
import { noteCls } from '../../styles/classes'

/*
  "What the next months may look like" section.
  Baseline forecast (climatology + trend + persistence, see stats.forecast) for
  one parameter, 3 or 6 months ahead. The chart shows the last ~3 years observed,
  the usual seasonal curve, and the forecast with its 80% band. The readout
  above it describes the hovered month, or summarises the end of the forecast.
*/

const FC_KEYS = ['ndvi', 'sm_top', 'sm_root', 'tair', 'lst_day', 'rain']
const HORIZONS = [3, 6]

export default function Outlook() {
  const { city } = useApp()
  const [k, setK] = useState('ndvi')
  const [h, setH] = useState(3)
  // Hover is tagged with what was on screen when it was set, so it clears itself
  // (like the original's readF(null) on redraw) when the city, parameter or
  // horizon changes, without needing an effect to reset it.
  const viewKey = city + '|' + k + '|' + h
  const [hoverState, setHoverState] = useState({ key: '', x: null })
  const hover = hoverState.key === viewKey ? hoverState.x : null
  // Returning the previous object when nothing changed lets React skip the
  // re-render; pointermove fires many times within the same month.
  const onHover = useCallback((x) => setHoverState((prev) => (prev.key === viewKey && prev.x === x ? prev : { key: viewKey, x })), [viewKey])

  const a = ser(city, k)
  const f = useMemo(() => forecast(a, h), [a, h])

  // Window: the last 36 observed months plus the forecast horizon.
  // Forecast indices run past the end of DATA.months, so month/year are worked
  // out arithmetically from the window start instead of via mLabel/yOf.
  const i0 = f ? Math.max(0, f.li - 35) : 0
  const i1 = f ? f.li + h : 0
  const lab = useCallback((i) => {
    const m = (mOf(i0) + (i - i0)) % 12
    return MON[m] + ' ' + (FIRST_YEAR + Math.floor(i / 12))
  }, [i0])

  // css() is evaluated inside options() at draw time, and <Chart> redraws on
  // theme change, so the colours follow the theme without extra deps here.
  const options = useCallback(() => {
    const hist = a.map((v, i) => ({ x: i, y: v })).filter((p) => p.x >= i0 && p.x <= f.li)
    // The forecast line starts at the last observation so it joins the observed line
    const fc = [{ x: f.li, y: a[f.li] }, ...f.out.map((o) => ({ x: o.i, y: o.v }))]
    const norm = []
    for (let i = i0; i <= i1; i++) norm.push({ x: i, y: f.clim[(mOf(i0) + (i - i0)) % 12] })
    // Tick every January and July
    const xt = []
    for (let i = i0; i <= i1; i++) {
      const m = (mOf(i0) + (i - i0)) % 12
      if (m === 0 || m === 6) xt.push([i, MON[m] + " '" + String(FIRST_YEAR + Math.floor(i / 12)).slice(2)])
    }
    return {
      aria: P[k].label + ' forecast',
      series: [
        { name: 'Usual', color: css('--faint'), w: 1.5, dash: true, pts: norm, hover: false },
        { name: 'Observed', color: css('--s1'), w: 2.4, pts: hist, end: true },
        { name: 'Forecast', color: css('--s1'), w: 2.4, dash: true, pts: fc },
      ],
      // Band is pinched to zero width at the last observation, then widens to the forecast range
      band: [{ x: f.li, lo: a[f.li], hi: a[f.li] }, ...f.out.map((o) => ({ x: o.i, lo: o.lo, hi: o.hi }))],
      bandColor: css('--s1'),
      x0: i0,
      x1: i1,
      xTicks: xt,
      vline: f.li,
      shade: [[f.li, i1]],
      zero: P[k].sum,
    }
  }, [a, f, k, i0, i1])

  // Readout: hovered forecast month, hovered observed month, or the default summary
  let readout = null
  if (f) {
    const o = f.out.find((q) => q.i === hover)
    if (o) {
      readout = (
        <>
          <ReadoutWhen>{lab(hover)}</ReadoutWhen>
          <ReadoutItem><Swatch color="var(--s1)" />Forecast <b>{fmtv(k, o.v)}{unitS(k)}</b></ReadoutItem>
          <ReadoutItem>likely range <b>{fmtv(k, o.lo)}–{fmtv(k, o.hi)}</b></ReadoutItem>
          <ReadoutItem>usual <b>{fmtv(k, f.clim[o.m])}</b></ReadoutItem>
        </>
      )
    } else if (hover != null && a[hover] != null) {
      readout = (
        <>
          <ReadoutWhen>{lab(hover)}</ReadoutWhen>
          <ReadoutItem><Swatch color="var(--s1)" />Observed <b>{fmtv(k, a[hover])}{unitS(k)}</b></ReadoutItem>
          <ReadoutItem>usual <b>{fmtv(k, f.clim[mOf(hover)])}</b></ReadoutItem>
        </>
      )
    } else {
      const e = f.out[f.out.length - 1]
      readout = (
        <>
          <ReadoutWhen>By {lab(e.i)}</ReadoutWhen>
          <ReadoutItem><Swatch color="var(--s1)" />{P[k].label} <b>{fmtv(k, e.v)}{unitS(k)}</b></ReadoutItem>
          <ReadoutItem>likely range <b>{fmtv(k, e.lo)}–{fmtv(k, e.hi)}</b></ReadoutItem>
          <ReadoutItem>usual <b>{fmtv(k, f.clim[e.m])}</b></ReadoutItem>
          {/* One more decimal than the value itself: per-decade trends are small */}
          <ReadoutItem>trend <b>{f.perDecade >= 0 ? '+' : '−'}{Math.abs(f.perDecade).toFixed(P[k].dec + 1)}</b> per decade</ReadoutItem>
        </>
      )
    }
  }

  return (
    <Card id="outlook" aria-labelledby="outT">
      <CardHead
        aside={
          // CardHead makes this div a column (gap 6px), so the dropdown sits above
          // the buttons, centred, as in the original design. flex-wrap and
          // items-center are what the original's row class added on top.
          <div className="flex-wrap items-center">
            <Select id="fcParam" aria-label="Forecast parameter" value={k} onChange={(e) => setK(e.target.value)}>
              {FC_KEYS.map((key) => (
                <option key={key} value={key}>{P[key].label}</option>
              ))}
            </Select>
            <Seg id="fcH" role="group" aria-label="Months ahead">
              {HORIZONS.map((n) => (
                <SegButton key={n} data-h={n} pressed={h === n} onClick={() => setH(n)}>{n} months</SegButton>
              ))}
            </Seg>
          </div>
        }
      >
        <Kicker>Looking ahead</Kicker>
        <h2 id="outT">What the next months may look like</h2>
        <Lede>A baseline forecast built from each month's usual value, the long-term trend and recent conditions. The shaded band is where 8 in 10 outcomes should fall. The physics-informed model will replace this baseline.</Lede>
      </CardHead>
      <Readout id="fcRead">{readout}</Readout>
      {f ? (
        <Chart options={options} hover={hover} onHover={onHover} tall />
      ) : (
        // Same box as a tall chart, holding the message instead of an SVG
        <div className="relative h-[340px] w-full"><div className={noteCls}>Not enough data to forecast.</div></div>
      )}
    </Card>
  )
}
