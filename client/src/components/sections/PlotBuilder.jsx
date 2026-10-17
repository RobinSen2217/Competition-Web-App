// "Choose what to plot": pick parameters, a year range and a layout (separate
// panels, all together on a 0–100 scale, or by season), read every value under
// the pointer in the readout, and download the data (CSV) or the charts (PNG).
//
// Data: only the selected parameters of the selected city are fetched (store
// useTimeseries, cached per city + parameter), so adding a pill loads just that
// one series and going back to a city already seen costs nothing.
import { useCallback, useMemo, useRef, useState } from 'react'
import Chart from '../common/Chart'
import { SectionLoader } from '../common/SectionLoader'
import { Btn, Card, CardHead, Group, GroupTitle, Kicker, Lede, Pill, PillDot, Pills, Readout, ReadoutItem, ReadoutWhen, Seg, SegButton, Select, Swatch, Toggle } from '../ui'
import { useApp } from '../../state/appContext'
import useThemeVersion from '../../hooks/useThemeVersion'
import { CITIES, M, N, useTimeseries } from '../../lib/store'
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

// One chart with its title above.
const panelCls = 'flex flex-col gap-0.5'
const panelUnitCls = 'font-medium text-muted'

// Parameter name on the left, unit/source <span> on the right. data-panel-title
// lets the PNG export find the titles; placeholder panels (no chart yet) leave
// it off (mark={false}) so titles and chart SVGs stay paired one to one.
function PanelTitle({ mark = true, children }) {
  return (
    <div data-panel-title={mark ? '' : undefined} className="flex justify-between gap-2.5 text-[14px] font-semibold">
      {children}
    </div>
  )
}

// Separate view: one panel per parameter on its own scale, optionally with a
// 12-month running average drawn over a faded raw line.
function TimePanel({ k, a, slot, i0, i1, smooth, hover, onHover }) {
  const options = useCallback(
    (width) => {
      const color = slotColor(slot)
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
    [a, k, slot, i0, i1, smooth],
  )
  return (
    <div className={panelCls}>
      <PanelTitle>
        {P[k].label}
        <span className={panelUnitCls}>
          {P[k].unit || 'index'} · {P[k].src}
        </span>
      </PanelTitle>
      <Chart options={options} hover={hover} onHover={onHover} />
    </div>
  )
}

// By-season view: every year in range as a faint Jan–Dec line, the average
// year (climatology to 2025) dashed, and the latest year with data in colour.
function SeasonPanel({ k, a, slot, y0, y1, hover, onHover }) {
  const options = useCallback(
    (width) => {
      const ly = yOf(lastIdx(a)), cl = clim(a)
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
    [a, k, slot, y0, y1],
  )
  return (
    <div className={panelCls}>
      <PanelTitle>
        {P[k].label}
        <span className={panelUnitCls}>{P[k].unit || 'index'}</span>
      </PanelTitle>
      <Chart options={options} hover={hover} onHover={onHover} />
    </div>
  )
}

// Together view: all parameters on one chart. Units differ, so each line is
// min–max scaled within the visible window (0 = its lowest, 100 = its highest).
// `keys` are the selected parameters whose series are loaded, `s` the series.
function TogetherPanel({ keys, s, slotOf, i0, i1, smooth, hover, onHover }) {
  const options = useCallback(
    (width) => {
      const series = keys.map((k) => {
        const a = s[k], src = smooth ? roll(a) : a
        // The 0–100 range comes from the raw values even when smoothing, so the
        // smoothed line sits inside the same reference as the raw one.
        const win = a.slice(i0, i1 + 1).filter((v) => v != null), lo = Math.min(...win), hi = Math.max(...win)
        return {
          name: P[k].label,
          color: slotColor(slotOf[k]),
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
    [keys, s, slotOf, i0, i1, smooth],
  )
  return (
    <div className={panelCls}>
      <Chart options={options} hover={hover} onHover={onHover} tall />
    </div>
  )
}

// Stand-in for one parameter's panel while its series loads (a pill was just
// added), or when this city has no such series. Same title and chart height,
// so the panels below don't move when the chart arrives.
function PendingPanel({ k, missing }) {
  return (
    <div className={panelCls}>
      <PanelTitle mark={false}>
        {P[k].label}
        <span className={panelUnitCls}>{P[k].unit || 'index'}</span>
      </PanelTitle>
      {missing ? (
        <p className="flex h-[180px] items-center justify-center rounded-[14px] bg-surface2 px-4 text-center text-[14px] text-muted">
          No {P[k].label} data for this city.
        </p>
      ) : (
        <SectionLoader label={`Loading ${P[k].label}…`} className="h-[180px] min-h-0" />
      )}
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

  // The selected parameters of this city. keepPrevious: while a newly added
  // pill's series loads, the panels already drawn stay up (only the new one
  // shows a loader). A city switch has no previous data for the new city
  // (data[city] is undefined), so the whole chart area shows the loader then.
  const { data, status, error, retry } = useTimeseries({ areas: city, parameters: sel }, { keepPrevious: true })
  const s = data?.[city]
  // Selected parameters whose series are here, in selection order. Memoised on
  // the inputs so the Together chart's options keep their identity on hover.
  const avail = useMemo(() => (s ? sel.filter((k) => s[k]) : []), [s, sel])
  // A parameter the city simply has no data for (request done, series absent)
  const missing = (k) => status === 'ready' && !!s && !s[k]
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
  const cityName = CITIES[city].name

  const save = (filename, data) => {
    saveFile(filename, data)
    toast('Downloaded ' + filename)
  }

  // Raw monthly values for the selected years; units go into the column names
  // (stripped to letters and % so headers stay spreadsheet-friendly).
  const downloadCsv = () => {
    if (!avail.length) return
    const head = ['month', ...avail.map((k) => `${k}${P[k].unit ? '_' + P[k].unit.replace(/[^a-z%]/gi, '') : ''}`)]
    let csv = head.join(',') + '\n'
    for (let i = i0; i <= i1; i++)
      csv +=
        [
          M[i],
          ...avail.map((k) => {
            const v = s[k][i]
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
    const svgs = [...host.querySelectorAll('[data-chart] svg')]
    if (!svgs.length) return
    // Panel titles are the text node before the unit <span>; Together has none.
    const titles = [...host.querySelectorAll('[data-panel-title]')].map((t) => t.firstChild.textContent)
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

  // Nothing of this city loaded yet (first visit to the section, a city
  // switch) or the request failed: one loader / error for the chart area.
  const pendingAll = !avail.length && !sel.every(missing)
  // Selected parameters still on their way (shown as loaders / a note)
  const loadingKeys = sel.filter((k) => !s?.[k] && !missing(k))

  /* ---- readout ---- */
  let readout
  if (pendingAll) {
    readout = <ReadoutItem>{status === 'error' ? 'The data could not be loaded.' : 'Loading the data…'}</ReadoutItem>
  } else if (view === 'season') {
    if (hover == null) {
      readout = (
        <>
          <ReadoutWhen>By season</ReadoutWhen>
          <ReadoutItem>Hover a chart to compare the latest year with the average year for any month.</ReadoutItem>
        </>
      )
    } else {
      // Compare the hovered calendar month in each parameter's latest year with its usual value.
      const m = hover
      readout = (
        <>
          <ReadoutWhen>{MON[m]}</ReadoutWhen>
          {avail.map((k) => {
            const a = s[k], ly = yOf(lastIdx(a)), i = M.indexOf(`${ly}-${String(m + 1).padStart(2, '0')}`), cl = clim(a)[m]
            return (
              <ReadoutItem key={k}>
                <Swatch color={colorOf(k)} />
                {P[k].short}: <b>{i >= 0 && a[i] != null ? fmtv(k, a[i]) : '–'}</b> in {ly}, usual <b>{fmtv(k, cl)}</b>
              </ReadoutItem>
            )
          })}
        </>
      )
    }
  } else {
    // Without a hover, show the latest month that every selected parameter has (capped to the range).
    const i = hover ?? Math.min(i1, ...avail.map((k) => lastIdx(s[k])))
    readout = (
      <>
        <ReadoutWhen>{mLabel(i)}</ReadoutWhen>
        {avail.map((k) => {
          const v = s[k][i]
          return (
            <ReadoutItem key={k}>
              <Swatch color={colorOf(k)} />
              {P[k].short}{' '}
              <b>
                {fmtv(k, v)}
                {v != null ? unitS(k) : ''}
              </b>
            </ReadoutItem>
          )
        })}
        {/* This was "it xs", but the readout item's 14px outranked .xs, so it stays 14px. */}
        {hover == null && <ReadoutItem>latest · hover to explore</ReadoutItem>}
      </>
    )
  }

  /* ---- charts ---- */
  let panels
  if (pendingAll) {
    // Roughly the height of what it stands in for (one or two 180px charts with titles)
    panels = (
      <SectionLoader
        label={`Loading ${cityName}'s data…`}
        error={status === 'error' ? error : null}
        onRetry={retry}
        className={view === 'together' ? 'h-[340px]' : sel.length > 1 ? 'h-[420px]' : 'h-[205px]'}
      />
    )
  } else if (view === 'together' && avail.length) {
    panels = (
      <>
        <TogetherPanel keys={avail} s={s} slotOf={slotOf} i0={i0} i1={i1} smooth={smooth} hover={hover} onHover={setHover} />
        {/* A just-added parameter joins the chart once its series is in */}
        {loadingKeys.length > 0 && (
          <p role="status" className="text-[13px] text-muted">
            Loading {loadingKeys.map((k) => P[k].label).join(', ')}…
          </p>
        )}
      </>
    )
  } else {
    const Panel = view === 'season' ? SeasonPanel : TimePanel
    panels = sel.map((k) =>
      s?.[k] ? (
        <Panel key={k} k={k} a={s[k]} slot={slotOf[k]} i0={i0} i1={i1} y0={y0} y1={y1} smooth={smooth} hover={hover} onHover={setHover} />
      ) : (
        <PendingPanel key={k} k={k} missing={missing(k)} />
      ),
    )
  }

  return (
    <Card id="plot" aria-labelledby="plotT" aria-busy={status === 'loading'}>
      <CardHead
        aside={
          // CardHead turns this div into a 6px-gap column, so the two buttons stack.
          <div className="flex-wrap items-center">
            <Btn soft id="dlCsv" onClick={downloadCsv}>
              Download data (CSV)
            </Btn>
            <Btn soft id="dlPng" onClick={downloadPng}>
              Download picture
            </Btn>
          </div>
        }
      >
        <Kicker>Explore the data</Kicker>
        <h2 id="plotT">Choose what to plot</h2>
        <Lede>Tap parameters to add or remove them. The charts update straight away. Hover or touch a chart to read every value for that month.</Lede>
      </CardHead>
      {/* Controls rail on the left, readout and charts on the right; stacked at 900px and below. */}
      <div className="grid grid-cols-[290px_minmax(0,1fr)] gap-[22px] max-[901px]:grid-cols-[minmax(0,1fr)]">
        <div className="flex flex-col gap-[18px]">
          <div id="paramGroups">
            {GROUPS.map((grp) => (
              <Group className="mb-3.5" key={grp}>
                <GroupTitle>{grp}</GroupTitle>
                <Pills>
                  {PARAMS.filter((p) => p.grp === grp).map((p) => {
                    const on = sel.includes(p.k)
                    return (
                      <Pill data-k={p.k} pressed={on} key={p.k} onClick={() => togglePill(p.k)}>
                        {/* Unselected parameters get the default grey (--line) dot. */}
                        <PillDot color={on ? colorOf(p.k) : undefined} />
                        {p.label}
                      </Pill>
                    )
                  })}
                </Pills>
              </Group>
            ))}
          </div>
          <Group>
            <GroupTitle>Years</GroupTitle>
            <div className="flex flex-wrap items-center gap-2">
              <Select id="y0" aria-label="From year" value={y0} onChange={(e) => changeY0(+e.target.value)}>
                {YEARS.map((y) => (
                  <option value={y} key={y}>
                    {y}
                  </option>
                ))}
              </Select>
              <span className="text-muted">to</span>
              <Select id="y1" aria-label="To year" value={y1} onChange={(e) => changeY1(+e.target.value)}>
                {YEARS.map((y) => (
                  <option value={y} key={y}>
                    {y}
                  </option>
                ))}
              </Select>
            </div>
            <Pills id="quickYears">
              {QUICK.map(([q, label]) => (
                <Pill data-q={q} pressed={quickOn(q, y0, y1)} key={q} onClick={() => quick(q)}>
                  {label}
                </Pill>
              ))}
            </Pills>
          </Group>
          <Group>
            <GroupTitle>How to show them</GroupTitle>
            <Seg id="viewSeg" role="group" aria-label="Chart layout">
              {VIEWS.map(([v, label]) => (
                <SegButton data-v={v} pressed={view === v} key={v} onClick={() => changeView(v)}>
                  {label}
                </SegButton>
              ))}
            </Seg>
            <Toggle id="smooth" checked={smooth} onChange={(e) => setSmooth(e.target.checked)}>
              Show 12-month average
            </Toggle>
            <p className="text-[13px] text-muted" id="viewHelp">
              {HELP[view]}
            </p>
          </Group>
        </div>
        <div className="flex min-w-0 flex-col gap-3">
          <Readout id="readout" aria-live="polite">
            {readout}
          </Readout>
          <div className="flex flex-col gap-3.5" id="panels" ref={panelsRef}>
            {panels}
          </div>
        </div>
      </div>
    </Card>
  )
}
