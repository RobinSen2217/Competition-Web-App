// "Choose what to plot": pick parameters, a year range and a layout (separate
// panels, all together on a 0–100 scale, or by season), read every value under
// the pointer in the readout, and download the data (CSV) or the charts (PNG).
import { useCallback, useMemo, useRef, useState } from 'react'
import Chart from '../common/Chart'
import { useApp } from '../../state/appContext'
import useThemeVersion from '../../hooks/useThemeVersion'
import { DATA, M, N, ser } from '../../lib/data'
import { MON, mLabel, mOf, yOf, YEARS, FIRST_YEAR, LAST_YEAR } from '../../lib/months'
import { PARAMS, P, fmtv, unitS } from '../../lib/params'
import { clim, lastIdx, roll } from '../../lib/stats'
import { yearTicks, monthTicks } from '../../lib/chart'
import { css } from '../../lib/theme'
import { store } from '../../lib/storage'
import { saveFile } from '../../lib/download'

const DEFAULT_SEL = ['ndvi', 'rain']
const GROUPS = [...new Set(PARAMS.map((p) => p.grp))]

// Four series colours; slots 4–7 reuse them (slot % 4). Separate and By season
// allow up to 8 parameters and Together up to 4, so colours can repeat once a
// parameter holds a slot of 4 or more (same as the original).
const SLOTS = ['--s1', '--s2', '--s3', '--s4']
const slotColor = (slot) => css(SLOTS[slot % 4])

const HELP = {
  panels: 'Each parameter gets its own panel and its own scale. All panels share the same months.',
  together: 'Lines are scaled to their own range (0 = lowest, 100 = highest in this period) so shapes and timing can be compared. Hover for real values.',
  season: 'Each year is a faint line across January to December. The dashed line is the average year; the coloured line is the most recent year.',
}

const VIEWS = [
  ['panels', 'Separate'],
  ['together', 'Together'],
  ['season', 'By season'],
]

const QUICK = [
  ['all', 'All years'],
  ['10', 'Last 10'],
  ['5', 'Last 5'],
]

// Colour follows a parameter while it stays selected: keep the slots of
// parameters that are still selected, drop the rest, and give each newcomer the
// lowest free slot. So removing "Rain" never repaints "NDVI".
function assignSlots(prev, sel) {
  const slotOf = {}
  for (const k of sel) if (prev[k] != null) slotOf[k] = prev[k]
  for (const k of sel) {
    if (slotOf[k] == null) {
      const used = Object.values(slotOf)
      slotOf[k] = [0, 1, 2, 3, 4, 5, 6, 7].find((i) => !used.includes(i))
    }
  }
  return slotOf
}

// Selection from the last visit, ignoring parameters that no longer exist.
function initialSelection() {
  const saved = store.get('sel', DEFAULT_SEL)
  let sel = Array.isArray(saved) ? saved.filter((k) => P[k]) : []
  if (!sel.length) sel = DEFAULT_SEL
  return { sel, slotOf: assignSlots({}, sel) }
}

// Month indices covering January of y0 through the last available month of y1
// (the final year may be incomplete).
function rangeIdx(y0, y1) {
  const i0 = M.indexOf(`${y0}-01`)
  const i1 = Math.min(N - 1, M.lastIndexOf(M.filter((x) => x.startsWith(String(y1))).pop()))
  return [i0, i1]
}

// Is a quick-year pill's range the one currently selected?
const quickOn = (q, y0, y1) => y1 === LAST_YEAR && (q === 'all' ? y0 === FIRST_YEAR : y0 === LAST_YEAR - +q + 1)

/* ---- chart panels ----
   Each panel memoises its chart options on the real inputs only, so moving the
   pointer (which changes `hover`) just moves the crosshair instead of redrawing.
   Colours are read inside options(); <Chart> re-calls it on theme change. */

// Separate view: one panel per parameter on its own scale, optionally with a
// 12-month running average drawn over a faded raw line.
function TimePanel({ city, k, slot, i0, i1, smooth, hover, onHover }) {
  const options = useCallback(
    (width) => {
      const a = ser(city, k), color = slotColor(slot)
      const pts = a.map((v, i) => ({ x: i, y: v })).filter((p) => p.x >= i0 && p.x <= i1)
      // Rainfall-like totals get a filled area, but not under the average line (too busy).
      const series = [{ name: P[k].label, color, w: smooth ? 1.2 : 2, op: smooth ? 0.45 : 1, pts, area: P[k].sum && !smooth }]
      if (smooth)
        series.push({
          name: '12-month average',
          color,
          w: 2.8,
          pts: roll(a).map((v, i) => ({ x: i, y: v })).filter((p) => p.x >= i0 && p.x <= i1),
          hover: false,
          end: true,
        })
      return { aria: P[k].label + ' over time', series, x0: i0, x1: i1, xTicks: yearTicks(i0, i1, width), zero: P[k].sum }
    },
    [city, k, slot, i0, i1, smooth],
  )
  return (
    <div className="panel">
      <div className="pt">
        {P[k].label}
        <span>
          {P[k].unit || 'index'} · {P[k].src}
        </span>
      </div>
      <Chart options={options} hover={hover} onHover={onHover} />
    </div>
  )
}

// By-season view: every year in range as a faint Jan–Dec line, the average
// year (climatology to 2025) dashed, and the latest year with data in colour.
function SeasonPanel({ city, k, slot, y0, y1, hover, onHover }) {
  const options = useCallback(
    (width) => {
      const a = ser(city, k), ly = yOf(lastIdx(a)), cl = clim(a)
      // Fold the monthly series into { year: [12 values] } for the chosen years.
      const years = {}
      a.forEach((v, i) => {
        const y = yOf(i)
        if (y < y0 || y > y1) return
        if (!years[y]) years[y] = Array(12).fill(null)
        years[y][mOf(i)] = v
      })
      const series = Object.keys(years)
        .filter((y) => +y !== ly)
        .map((y) => ({ name: y, color: css('--year'), w: 1.3, pts: years[y].map((v, m) => ({ x: m, y: v })), hover: false, dots: false }))
      series.push({ name: 'Average year', color: css('--muted'), w: 2, dash: true, pts: cl.map((v, m) => ({ x: m, y: v })), dots: false })
      // The latest year is drawn last so it sits on top; absent if outside the range.
      if (years[ly]) series.push({ name: String(ly), color: slotColor(slot), w: 2.6, pts: years[ly].map((v, m) => ({ x: m, y: v })), end: true })
      return { aria: P[k].label + ' by month', series, x0: 0, x1: 11, xTicks: monthTicks(width), zero: P[k].sum }
    },
    [city, k, slot, y0, y1],
  )
  return (
    <div className="panel">
      <div className="pt">
        {P[k].label}
        <span>{P[k].unit || 'index'}</span>
      </div>
      <Chart options={options} hover={hover} onHover={onHover} />
    </div>
  )
}

// Together view: all parameters on one chart. Units differ, so each line is
// min–max scaled within the visible window (0 = its lowest, 100 = its highest).
function TogetherPanel({ city, selection, i0, i1, smooth, hover, onHover }) {
  const options = useCallback(
    (width) => {
      const series = selection.sel.map((k) => {
        const a = ser(city, k), src = smooth ? roll(a) : a
        // The 0–100 range comes from the raw values even when smoothing, so the
        // smoothed line sits inside the same reference as the raw one.
        const win = a.slice(i0, i1 + 1).filter((v) => v != null), lo = Math.min(...win), hi = Math.max(...win)
        return {
          name: P[k].label,
          color: slotColor(selection.slotOf[k]),
          w: 2,
          pts: src.map((v, i) => ({ x: i, y: v == null || i < i0 || i > i1 ? null : ((v - lo) / (hi - lo || 1)) * 100 })).filter((p) => p.x >= i0 && p.x <= i1),
        }
      })
      return {
        aria: 'Selected parameters scaled together',
        series,
        x0: i0,
        x1: i1,
        yMin: 0,
        yMax: 100,
        yFmt: (v) => (v === 0 ? 'low' : v === 100 ? 'high' : v),
        xTicks: yearTicks(i0, i1, width),
      }
    },
    [city, selection, i0, i1, smooth],
  )
  return (
    <div className="panel">
      <Chart options={options} hover={hover} onHover={onHover} tall />
    </div>
  )
}

export default function PlotBuilder() {
  const { city, toast } = useApp()
  // Re-render on theme change: the pill dots and readout swatches bake css() colours.
  useThemeVersion()

  // sel and its colour slots live together so they always change in one update.
  const [selection, setSelection] = useState(initialSelection)
  const { sel, slotOf } = selection
  const [view, setView] = useState('panels')
  const [y0, setY0] = useState(FIRST_YEAR)
  const [y1, setY1] = useState(LAST_YEAR)
  const [smooth, setSmooth] = useState(false)
  // One crosshair shared by every panel: a month index (time views) or 0–11 (season).
  const [hover, setHover] = useState(null)
  // Used by the PNG export to collect this section's chart SVGs and titles.
  const panelsRef = useRef(null)

  const [i0, i1] = useMemo(() => rangeIdx(y0, y1), [y0, y1])
  const colorOf = (k) => slotColor(slotOf[k])

  const updateSel = (next) => setSelection((prev) => ({ sel: next, slotOf: assignSlots(prev.slotOf, next) }))

  const togglePill = (k) => {
    let next
    if (sel.includes(k)) {
      if (sel.length === 1) {
        toast('Keep at least one parameter')
        return
      }
      next = sel.filter((x) => x !== k)
    } else {
      // A single chart gets unreadable past 4 lines, and there are only 4 distinct colours.
      if (view === 'together' && sel.length >= 4) {
        toast('Together shows up to 4. Switch to Separate for more.')
        return
      }
      if (sel.length >= 8) {
        toast('Up to 8 at a time')
        return
      }
      next = [...sel, k]
    }
    store.set('sel', next)
    updateSel(next)
  }

  const changeView = (v) => {
    setView(v)
    // Hover x means different things per view (month index vs calendar month).
    setHover(null)
    if (v === 'together' && sel.length > 4) {
      // Deliberately not persisted: the saved selection only changes on pill clicks,
      // so going back to Separate on the next visit restores the full set.
      updateSel(sel.slice(0, 4))
      toast('Together shows up to 4 parameters')
    }
  }

  // The two year selects push each other so the range never inverts.
  const changeY0 = (v) => {
    setY0(v)
    if (y1 < v) setY1(v)
  }
  const changeY1 = (v) => {
    setY1(v)
    if (y0 > v) setY0(v)
  }
  const quick = (q) => {
    setY1(LAST_YEAR)
    setY0(q === 'all' ? FIRST_YEAR : LAST_YEAR - +q + 1)
  }

  /* ---- downloads ---- */
  const cityName = DATA.cities[city].name

  const save = (filename, data) => {
    saveFile(filename, data)
    toast('Downloaded ' + filename)
  }

  // Raw monthly values for the selected years; units go into the column names
  // (stripped to letters and % so headers stay spreadsheet-friendly).
  const downloadCsv = () => {
    const head = ['month', ...sel.map((k) => `${k}${P[k].unit ? '_' + P[k].unit.replace(/[^a-z%]/gi, '') : ''}`)]
    let csv = head.join(',') + '\n'
    for (let i = i0; i <= i1; i++)
      csv +=
        [
          M[i],
          ...sel.map((k) => {
            const v = ser(city, k)[i]
            return v == null ? '' : v
          }),
        ].join(',') + '\n'
    save(`${cityName}_${y0}-${y1}.csv`, csv)
  }

  // Re-draw the visible chart SVGs onto one canvas (at 2× for sharpness) with a
  // title and source line, then save it as a PNG.
  const downloadPng = async () => {
    const host = panelsRef.current
    if (!host) return
    const svgs = [...host.querySelectorAll('.chart svg')]
    if (!svgs.length) return
    // Panel titles are the text node before the unit <span>; Together has none.
    const titles = [...host.querySelectorAll('.pt')].map((t) => t.firstChild.textContent)
    const W = 1200, ph = view === 'together' ? 420 : 240, H = 90 + svgs.length * (ph + 34) + 30
    const cv = document.createElement('canvas')
    cv.width = W * 2
    cv.height = H * 2
    const g = cv.getContext('2d')
    g.scale(2, 2)
    g.fillStyle = css('--surface')
    g.fillRect(0, 0, W, H)
    g.fillStyle = css('--ink')
    g.font = '600 24px Georgia, serif'
    g.fillText(`${cityName}: ${sel.map((k) => P[k].label).join(', ')} (${y0}–${y1})`.slice(0, 90), 30, 44)
    g.font = '13px sans-serif'
    g.fillStyle = css('--muted')
    g.fillText('Vegetation of the City · MODIS and NASA POWER', 30, 66)
    for (let n = 0; n < svgs.length; n++) {
      // Clone so resizing and dropping the hover crosshair doesn't touch the live chart.
      const s = svgs[n].cloneNode(true)
      s.setAttribute('width', W - 60)
      s.setAttribute('height', ph)
      s.querySelector('.hov')?.remove()
      // An SVG must be loaded as an image before canvas can draw it.
      const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(s)], { type: 'image/svg+xml' }))
      const img = new Image()
      await new Promise((r) => {
        img.onload = r
        img.onerror = r
        img.src = url
      })
      const y = 90 + n * (ph + 34)
      if (titles[n]) {
        g.fillStyle = css('--ink')
        g.font = '600 14px sans-serif'
        g.fillText(titles[n], 30, y + 14)
      }
      g.drawImage(img, 30, y + 22, W - 60, ph)
      URL.revokeObjectURL(url)
    }
    cv.toBlob((b) => b && save(`${cityName}_chart.png`, b), 'image/png')
  }

  /* ---- readout ---- */
  let readout
  if (view === 'season') {
    if (hover == null) {
      readout = (
        <>
          <span className="when">By season</span>
          <span className="it">Hover a chart to compare the latest year with the average year for any month.</span>
        </>
      )
    } else {
      // Compare the hovered calendar month in each parameter's latest year with its usual value.
      const m = hover
      readout = (
        <>
          <span className="when">{MON[m]}</span>
          {sel.map((k) => {
            const a = ser(city, k), ly = yOf(lastIdx(a)), i = M.indexOf(`${ly}-${String(m + 1).padStart(2, '0')}`), cl = clim(a)[m]
            return (
              <span className="it" key={k}>
                <i style={{ background: colorOf(k) }}></i>
                {P[k].short}: <b>{i >= 0 && a[i] != null ? fmtv(k, a[i]) : '–'}</b> in {ly}, usual <b>{fmtv(k, cl)}</b>
              </span>
            )
          })}
        </>
      )
    }
  } else {
    // Without a hover, show the latest month that every selected parameter has (capped to the range).
    const i = hover ?? Math.min(i1, ...sel.map((k) => lastIdx(ser(city, k))))
    readout = (
      <>
        <span className="when">{mLabel(i)}</span>
        {sel.map((k) => {
          const v = ser(city, k)[i]
          return (
            <span className="it" key={k}>
              <i style={{ background: colorOf(k) }}></i>
              {P[k].short}{' '}
              <b>
                {fmtv(k, v)}
                {v != null ? unitS(k) : ''}
              </b>
            </span>
          )
        })}
        {hover == null && <span className="it xs">latest · hover to explore</span>}
      </>
    )
  }

  /* ---- charts ---- */
  let panels
  if (view === 'together') {
    panels = <TogetherPanel city={city} selection={selection} i0={i0} i1={i1} smooth={smooth} hover={hover} onHover={setHover} />
  } else if (view === 'season') {
    panels = sel.map((k) => <SeasonPanel key={k} city={city} k={k} slot={slotOf[k]} y0={y0} y1={y1} hover={hover} onHover={setHover} />)
  } else {
    panels = sel.map((k) => <TimePanel key={k} city={city} k={k} slot={slotOf[k]} i0={i0} i1={i1} smooth={smooth} hover={hover} onHover={setHover} />)
  }

  return (
    <section className="card" id="plot" aria-labelledby="plotT">
      <div className="head">
        <div>
          <span className="kicker">Explore the data</span>
          <h2 id="plotT">Choose what to plot</h2>
          <p className="lede">Tap parameters to add or remove them. The charts update straight away. Hover or touch a chart to read every value for that month.</p>
        </div>
        <div className="rowc">
          <button type="button" className="btn soft" id="dlCsv" onClick={downloadCsv}>
            Download data (CSV)
          </button>
          <button type="button" className="btn soft" id="dlPng" onClick={downloadPng}>
            Download picture
          </button>
        </div>
      </div>
      <div className="builder">
        <div className="side">
          <div id="paramGroups">
            {GROUPS.map((grp) => (
              <div className="grp" style={{ marginBottom: 14 }} key={grp}>
                <span className="t">{grp}</span>
                <div className="pills">
                  {PARAMS.filter((p) => p.grp === grp).map((p) => {
                    const on = sel.includes(p.k)
                    return (
                      <button type="button" className="pill" data-k={p.k} aria-pressed={on} key={p.k} onClick={() => togglePill(p.k)}>
                        <span className="dot" style={{ background: on ? colorOf(p.k) : 'var(--line)' }}></span>
                        {p.label}
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
          <div className="grp">
            <span className="t">Years</span>
            <div className="rowc">
              <select id="y0" aria-label="From year" value={y0} onChange={(e) => changeY0(+e.target.value)}>
                {YEARS.map((y) => (
                  <option value={y} key={y}>
                    {y}
                  </option>
                ))}
              </select>
              <span className="muted">to</span>
              <select id="y1" aria-label="To year" value={y1} onChange={(e) => changeY1(+e.target.value)}>
                {YEARS.map((y) => (
                  <option value={y} key={y}>
                    {y}
                  </option>
                ))}
              </select>
            </div>
            <div className="pills" id="quickYears">
              {QUICK.map(([q, label]) => (
                <button type="button" className="pill" data-q={q} aria-pressed={quickOn(q, y0, y1)} key={q} onClick={() => quick(q)}>
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="grp">
            <span className="t">How to show them</span>
            <div className="seg" id="viewSeg" role="group" aria-label="Chart layout">
              {VIEWS.map(([v, label]) => (
                <button type="button" data-v={v} aria-pressed={view === v} key={v} onClick={() => changeView(v)}>
                  {label}
                </button>
              ))}
            </div>
            <label className="toggle">
              <input type="checkbox" id="smooth" checked={smooth} onChange={(e) => setSmooth(e.target.checked)} /> Show 12-month average
            </label>
            <p className="xs muted" id="viewHelp">
              {HELP[view]}
            </p>
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
          <div className="readout" id="readout" aria-live="polite">
            {readout}
          </div>
          <div className="panels" id="panels" ref={panelsRef}>
            {panels}
          </div>
        </div>
      </div>
    </section>
  )
}
