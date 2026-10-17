import { useCallback, useEffect, useMemo, useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { DATA } from '../../lib/data'
import { loadForecast, NOT_EXTRACTED } from '../../lib/forecasts'
import { MON } from '../../lib/months'
import { css } from '../../lib/theme'
import { useApp } from '../../state/appContext'
import Chart from '../common/Chart'
import { Btn, Card, CardHead, Kicker, Lede, Readout, ReadoutItem, ReadoutWhen, Seg, SegButton, Swatch, Toggle } from '../ui'
import { cx, noteCls } from '../../styles/classes'

/*
  "Machine-learning forecast" card, under the baseline Outlook.
  Shows the 12-month NDVI forecast of the team notebook's three models (Ridge,
  neural network, gradient boosting), run by the server's forecasting module
  (server/ml) or read from its saved snapshot (lib/forecasts.js). The models
  work on the notebook's Google Earth Engine data: Landsat NDVI over a small
  box around the city centre, which is not the city-wide MODIS greenness of
  the other charts, so the chart plots the model's own observed series and
  says so. Until a city's Earth Engine data has been extracted there is no
  forecast, and the card says that calmly instead of showing an error. Besides the
  forecast it shows how well each model did on data it never saw (one month
  ahead, and as a whole forecast re-run on the last 12 months), which inputs
  it leans on most, and the assumptions behind the numbers, so the forecast is
  never presented without its caveats.
*/

// Display order and colours of the models. Labels from the response win; these
// are the fallback and the button texts. s1 stays reserved for "observed".
const MODELS = [
  { k: 'ridge', label: 'Ridge regression', color: '--s2' },
  { k: 'nn', label: 'Neural network', color: '--s4' },
  { k: 'gbm', label: 'Gradient boosting', color: '--s3' },
]
const ALL = 'all'
// Months of observations shown before the forecast, as in Outlook.
const HISTORY = 36
const TOP_DRIVERS = 5

// The chart's x axis is an absolute month count (year * 12 + month), not an
// index into DATA.months: the forecast runs past the end of the site's data and
// the response may be issued from a slightly different month than DATA ends.
const mIdx = (t) => +t.slice(0, 4) * 12 + (+t.slice(5, 7) - 1)
const idxLabel = (x) => MON[x % 12] + ' ' + Math.floor(x / 12)
const tLabel = (t) => (t ? idxLabel(mIdx(t)) : '–')
const fmt = (v, d = 2) => (v == null || !isFinite(v) ? '–' : v.toFixed(d))
const pct = (r2) => Math.round(r2 * 100)
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`
const cityName = (id) => DATA?.cities?.[id]?.name || id
// The box the model's data covers, e.g. "2 × 2 km" (from the response)
const boxLabel = (data) => (typeof data?.provenance?.areaKm === 'string' ? data.provenance.areaKm : null)
const COUNT = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine']
// '2026-10-16T20:15:16Z' -> '16 Oct 2026' (the date as written, no time zone shift)
const dateLabel = (iso) => (/^\d{4}-\d{2}-\d{2}/.test(iso || '') ? `${+iso.slice(8, 10)} ${MON[+iso.slice(5, 7) - 1]} ${iso.slice(0, 4)}` : null)

// What the two accuracy scores are. R² is computed on NDVI levels (observed vs
// predicted greenness), so it says how much of the ups and downs the model
// captured, not how well it caught month-to-month changes.
const TEST_LABEL = "One month ahead, using the actual weather and last month's NDVI"
const hindLabel = (n) => `${n}-month forecast re-run on the last ${n} months (typical weather)`

// "explained 63% of the ups and downs in greenness". R² below zero means worse
// than always using the average; "explained -12%" would confuse.
function explained(r2) {
  if (r2 < 0) return 'did worse than just using the average greenness'
  return `explained ${r2 < 0.25 ? 'only ' : ''}${pct(r2)}% of the ups and downs in greenness`
}
// The same as a short figure for the stat boxes and the table
const explainedShort = (r2) => (r2 == null ? '–' : r2 < 0 ? 'worse than average' : `${pct(r2)}%`)

// Plain-language reading of one model's test score (one step ahead, with the
// real weather and NDVI as inputs: an easier job than the forecast's).
function testSentence(test) {
  if (!test || test.r2 == null) return 'No test score is available for this model.'
  const when = `On ${tLabel(test.from)} – ${tLabel(test.to)}${test.n ? ` (${test.n} months)` : ''}, data the model never saw while learning,`
  return `${when} it ${explained(test.r2)}; its typical error was ±${fmt(test.rmse, 3)} NDVI.`
}

// Plain-language reading of the hindcast: the forecast run exactly as for the
// future (typical weather, its own predictions fed back) on months we know.
function hindcastSentence(h) {
  const times = h?.times || []
  if (!times.length || h.r2 == null) return 'Too few of these months have an observed value to score the re-run.'
  return `Forecasting ${tLabel(times[0])} – ${tLabel(times[times.length - 1])} as if those months were still ahead, it ${explained(h.r2)}; its typical error was ±${fmt(h.rmse, 3)} NDVI. This is the better guide to how far to trust the forecast.`
}

// The lede, from the response: how many models, how many years they learned
// from (start of training to the last observation) and how far they look.
function ledeText(data, models) {
  const tail = 'Future weather is assumed to be typical for each month, so this is the expected path, not a weather forecast.'
  if (!data || !models.length) {
    return `The models learn from this city's satellite and weather data how greenness follows rain, heat and the season, then look ahead. ${tail}`
  }
  const n = models.length
  const from = models.map((m) => m.metrics?.train?.from).filter(Boolean).sort()[0]
  const years = from ? Math.floor((mIdx(data.issued) - mIdx(from) + 1) / 12) : 0
  const history = years >= 1 ? `${plural(years, 'year')} of this city's` : "this city's"
  const who = `${COUNT[n] || n} ${n === 1 ? 'model' : 'models'}`
  return `${who} trained on ${history} satellite and weather data ${n === 1 ? 'learns' : 'learn'} how greenness follows rain, heat and the season, then ${n === 1 ? 'looks' : 'look'} ${plural(data.forecastTimes.length, 'month')} ahead. ${tail}`
}

export default function ModelForecast() {
  const { city } = useApp()
  const reduceMotion = useReducedMotion()
  const [mode, setMode] = useState('gbm')
  const [showHind, setShowHind] = useState(false)
  // Bumped by "Try again"; part of the request key so the effect re-runs
  const [attempt, setAttempt] = useState(0)
  const reqKey = city + '#' + attempt
  // The result is tagged with the request it answers, so a city switch shows the
  // loader at once (stale key) without resetting state inside the effect.
  const [res, setRes] = useState({ key: null })
  useEffect(() => {
    let live = true
    loadForecast(city).then(
      (r) => live && setRes({ key: reqKey, ...r }),
      (e) => live && setRes({ key: reqKey, error: e }),
    )
    // A late answer for a city no longer selected is ignored
    return () => {
      live = false
    }
  }, [city, reqKey])
  const ready = res.key === reqKey
  const data = ready ? res.data : null

  // Models present in the response, in display order (a response may hold fewer)
  const models = useMemo(
    () => (data ? MODELS.filter((m) => data.models[m.k]).map((m) => ({ ...m, ...data.models[m.k], label: data.models[m.k].label || m.label })) : []),
    [data],
  )
  const single = models.find((m) => m.k === mode)
  // "Compare all" (or a model the response lacks) shows every model. Memoised so
  // the chart options keep their identity and a hover does not redraw the SVG.
  const shown = useMemo(() => (single ? [single] : models), [single, models])
  const compare = !single
  // Drivers and the summary need one model; in compare mode use the one that
  // scored best on unseen data, and say so.
  const focus = single || [...models].sort((a, b) => (b.metrics?.test?.r2 ?? -Infinity) - (a.metrics?.test?.r2 ?? -Infinity))[0]

  // Hover is tagged with what was on screen (as in Outlook), so it clears itself on any change
  const viewKey = reqKey + '|' + mode + '|' + showHind
  const [hoverState, setHoverState] = useState({ key: '', x: null })
  const hover = hoverState.key === viewKey ? hoverState.x : null
  const onHover = useCallback((x) => setHoverState((prev) => (prev.key === viewKey && prev.x === x ? prev : { key: viewKey, x })), [viewKey])

  // Observed values by absolute month: the model's own series (response.history,
  // Landsat NDVI over the box), not the site's MODIS series, which is a different
  // measurement with a different level. The hindcast's observed values fill in
  // if a response has no history.
  const observed = useMemo(() => {
    if (!data) return new Map()
    const out = new Map()
    for (const m of models) (m.hindcast?.times || []).forEach((t, i) => out.set(mIdx(t), m.hindcast.observed?.[i] ?? null))
    const h = data.history
    if (h && Array.isArray(h.times)) h.times.forEach((t, i) => h.observed?.[i] != null && out.set(mIdx(t), h.observed[i]))
    return out
  }, [data, models])

  const xIssued = data ? mIdx(data.issued) : 0
  const x0 = xIssued - (HISTORY - 1)
  const x1 = data ? mIdx(data.forecastTimes[data.forecastTimes.length - 1]) : 0

  const options = useCallback((w) => {
    const hist = []
    for (let x = x0; x <= Math.min(xIssued, x1); x++) hist.push({ x, y: observed.get(x) ?? null })
    const xt = []
    // Every January and July; January only on narrow screens, where both would collide
    for (let x = x0; x <= x1; x++) if (x % 12 === 0 || (x % 12 === 6 && w >= 560)) xt.push([x, MON[x % 12] + " '" + String(Math.floor(x / 12)).slice(2)])
    const series = [{ name: 'Observed (Landsat)', color: css('--s1'), w: 2.4, pts: hist, end: true }]
    for (const m of shown) {
      const col = css(m.color)
      if (showHind && m.hindcast?.times?.length)
        series.push({ name: m.label + ' hindcast', color: col, w: 1.8, op: 0.8, pts: m.hindcast.times.map((t, i) => ({ x: mIdx(t), y: m.hindcast.predicted?.[i] ?? null })) })
      // Starts at the last observation so the forecast joins the observed line
      series.push({ name: m.label, color: col, w: 2.4, dash: true, pts: [{ x: xIssued, y: observed.get(xIssued) ?? null }, ...data.forecastTimes.map((t, i) => ({ x: mIdx(t), y: m.forecast?.[i] ?? null }))] })
    }
    return {
      aria: `Vegetation greenness (Landsat NDVI${boxLabel(data) ? ` over a ${boxLabel(data)} box` : ''}): last ${HISTORY} months observed and ${data.forecastTimes.length}-month forecast by ${shown.map((m) => m.label).join(', ')}`,
      series,
      x0,
      x1,
      xTicks: xt,
      yFmt: (v) => v.toFixed(2),
      vline: xIssued,
      shade: [[xIssued, x1]],
    }
  }, [data, shown, showHind, observed, x0, x1, xIssued])

  // Readout: hovered month (observed / hindcast / forecast values), or the end of the forecast
  let readout = null
  if (data && shown.length) {
    const fcAt = (m, x) => {
      const i = data.forecastTimes.findIndex((t) => mIdx(t) === x)
      return i < 0 ? null : m.forecast?.[i]
    }
    const hindAt = (m, x) => {
      const i = (m.hindcast?.times || []).findIndex((t) => mIdx(t) === x)
      return i < 0 ? null : m.hindcast.predicted?.[i]
    }
    if (hover != null && hover > xIssued) {
      readout = (
        <>
          <ReadoutWhen>{idxLabel(hover)}</ReadoutWhen>
          {shown.map((m) => (
            <ReadoutItem key={m.k}><Swatch color={`var(${m.color})`} />{compare ? m.label : 'Forecast'} <b>{fmt(fcAt(m, hover))}</b></ReadoutItem>
          ))}
        </>
      )
    } else if (hover != null) {
      readout = (
        <>
          <ReadoutWhen>{idxLabel(hover)}</ReadoutWhen>
          <ReadoutItem><Swatch color="var(--s1)" />Observed <b>{fmt(observed.get(hover))}</b></ReadoutItem>
          {showHind &&
            shown.map((m) => hindAt(m, hover) != null && (
              <ReadoutItem key={m.k}><Swatch color={`var(${m.color})`} />{compare ? m.label : 'Hindcast'} <b>{fmt(hindAt(m, hover))}</b></ReadoutItem>
            ))}
        </>
      )
    } else {
      const xe = x1
      readout = (
        <>
          <ReadoutWhen>By {idxLabel(xe)}</ReadoutWhen>
          {shown.map((m) => (
            <ReadoutItem key={m.k}><Swatch color={`var(${m.color})`} />{m.label} <b>{fmt(fcAt(m, xe))}</b></ReadoutItem>
          ))}
          <ReadoutItem>now <b>{fmt(observed.get(xIssued))}</b> ({tLabel(data.issued)})</ReadoutItem>
        </>
      )
    }
  }

  const loading = !ready
  // No Earth Engine data for this city yet: a normal state, not an error
  const notYet = ready && res.error?.code === NOT_EXTRACTED
  const failed = ready && res.error && !notYet

  return (
    <Card id="mlforecast" aria-labelledby="mlT" aria-busy={loading}>
      <CardHead
        aside={
          // Nothing to switch between until there is a forecast
          !notYet && (
          <div className="flex-wrap items-center">
            <Seg id="mlModel" role="group" aria-label="Forecast model">
              {MODELS.map((m) => (
                <SegButton key={m.k} data-model={m.k} pressed={mode === m.k} onClick={() => setMode(m.k)}>{m.label}</SegButton>
              ))}
              <SegButton data-model={ALL} pressed={mode === ALL} onClick={() => setMode(ALL)}>Compare all</SegButton>
            </Seg>
            <Toggle checked={showHind} onChange={(e) => setShowHind(e.target.checked)}>Show hindcast (last 12 months re-predicted)</Toggle>
          </div>
          )
        }
      >
        <Kicker>Machine-learning forecast</Kicker>
        <h2 id="mlT">What the models expect for greenness</h2>
        <Lede>{ledeText(data, models)}</Lede>
      </CardHead>

      {loading ? (
        <ForecastSkeleton animate={!reduceMotion} />
      ) : notYet ? (
        <NotExtracted city={cityName(city)} />
      ) : failed ? (
        <div className="relative flex h-[340px] w-full items-center justify-center">
          <div className={cx(noteCls, 'flex max-w-[460px] flex-col items-start gap-3')} role="alert">
            <span>The model forecast for this city could not be loaded. {res.error?.message ? `(${res.error.message})` : ''}</span>
            <Btn soft onClick={() => setAttempt((n) => n + 1)}>Try again</Btn>
          </div>
        </div>
      ) : (
        <>
          <Readout id="mlRead">{readout}</Readout>
          <Chart options={options} hover={hover} onHover={onHover} tall />
          <Legend shown={shown} showHind={showHind} />
          <SourceNote data={data} city={cityName(city)} />
          <div className="grid gap-[18px] md:grid-cols-2">
            {compare ? <CompareTable models={models} /> : <Accuracy m={single} />}
            <Drivers m={focus} note={compare && focus ? `Shown for ${focus.label}, the best scorer on unseen data.` : null} />
          </div>
          <Assumptions data={data} source={res.source} generated={res.generated} fallback={res.fallback} />
        </>
      )}
    </Card>
  )
}

// Key to the line styles, which the chart itself does not label.
function Legend({ shown, showHind }) {
  const item = 'inline-flex items-center gap-2'
  return (
    <div className="flex flex-wrap gap-x-[18px] gap-y-1.5 text-[13px] text-muted" aria-hidden="true">
      <span className={item}><span className="h-[3px] w-5 rounded-full bg-s1" />Observed (Landsat)</span>
      {shown.map((m) => (
        <span key={m.k} className={item}>
          <span className="w-5 border-t-[2.5px] border-dashed" style={{ borderColor: `var(${m.color})` }} />
          {m.label} forecast
        </span>
      ))}
      {showHind && <span className={item}><span className="h-[2px] w-5 rounded-full bg-faint" />Thin solid lines: hindcast</span>}
      <span className={item}><span className="h-3 w-5 rounded-sm bg-surface2 ring-1 ring-line" />Forecast period</span>
    </div>
  )
}

// Where the plotted "observed" line comes from. Needed because the rest of
// the page shows MODIS greenness for the whole city, and this line (the
// model's own input) sits at another level: without the note the two charts
// would look like they contradict each other.
function SourceNote({ data, city }) {
  const datasets = data.provenance?.datasets || []
  const landsat = datasets.some((d) => d.startsWith('LANDSAT/'))
  const box = boxLabel(data)
  return (
    <p className="text-[13px] text-muted">
      The observed line is the models' own data: {landsat ? 'Landsat NDVI (30 m pixels)' : 'satellite NDVI'} averaged over{' '}
      {box ? `a ${box} box` : 'a small box'} around the centre of {city}, from Google Earth Engine. It is a different measurement from the
      city-wide MODIS greenness shown elsewhere on this page, so its level and month-to-month swings differ from those charts.
    </p>
  )
}

// Shown instead of the forecast while a city has no Earth Engine data. Not an
// error (nothing failed and retrying will not help), so no alert role, no
// warning colours and no "Try again".
function NotExtracted({ city }) {
  return (
    <div className="flex min-h-[200px] w-full items-center justify-center rounded-[14px] bg-surface2 p-6">
      <p className="max-w-[460px] text-center text-[15px] text-muted">
        The model forecast for {city} will appear here once its Earth Engine data has been extracted.
      </p>
    </div>
  )
}

const panelCls = 'flex min-w-0 flex-col gap-3 rounded-[14px] bg-surface2 p-4'
const panelTitle = 'text-[13px] font-semibold tracking-[.05em] text-muted uppercase'

// A value that is a phrase rather than a number (e.g. "worse than average")
// gets a smaller, proportional font so it fits the box.
function Stat({ label, value }) {
  const words = /[a-z]{3}/.test(value)
  return (
    <div className="flex min-w-[96px] flex-1 flex-col gap-0.5 rounded-xl bg-surface px-3 py-2">
      <span className="text-[12.5px] text-muted">{label}</span>
      <b className={words ? 'text-[14px] font-semibold' : 'font-mono text-[18px] font-medium'}>{value}</b>
    </div>
  )
}

const scoreTitle = 'text-[13px] font-semibold'

// One model: two scores, each in words plus two numbers. The test score (one
// month ahead with the real inputs) is the usual one; the hindcast (a whole
// forecast re-run on the last months) is how the forecast itself would fare.
function Accuracy({ m }) {
  const test = m.metrics?.test
  const train = m.metrics?.train
  const hind = m.hindcast
  return (
    <div className={panelCls}>
      <h3 className={panelTitle}>How accurate is it?</h3>
      <section className="flex flex-col gap-2">
        <h4 className={scoreTitle}>{TEST_LABEL}</h4>
        <div className="flex flex-wrap gap-2">
          <Stat label="Explained" value={explainedShort(test?.r2)} />
          <Stat label="Typical error" value={test?.rmse == null ? '–' : `±${fmt(test.rmse, 3)}`} />
        </div>
        <p className="text-[14px]">{testSentence(test)}</p>
      </section>
      <section className="flex flex-col gap-2">
        <h4 className={scoreTitle}>{hindLabel(hind?.times?.length || 12)}</h4>
        <div className="flex flex-wrap gap-2">
          <Stat label="Explained" value={explainedShort(hind?.r2)} />
          <Stat label="Typical error" value={hind?.rmse == null ? '–' : `±${fmt(hind.rmse, 3)}`} />
        </div>
        <p className="text-[14px]">{hindcastSentence(hind)}</p>
      </section>
      {train?.r2 != null && (
        <p className="text-[13px] text-muted">
          On the {tLabel(train.from)} – {tLabel(train.to)} data it learned from, it explained {pct(train.r2)}%. A large gap between this and the
          one-month-ahead score would mean it memorised rather than learned.
        </p>
      )}
    </div>
  )
}

// Compare mode: the models' two scores side by side ("explained" is R² on
// NDVI levels, "error" the RMSE).
function CompareTable({ models }) {
  // Tight padding so all five columns fit a phone screen without scrolling
  const th = 'border-b border-line px-[3px] py-1.5 text-left text-[12px] font-semibold text-muted sm:px-1.5 sm:text-[12.5px]'
  const group = 'border-b border-line px-[3px] pt-1.5 text-left text-[12px] font-semibold sm:px-1.5 sm:text-[12.5px]'
  const td = 'border-b border-line px-[3px] py-1.5 font-mono text-[12px] sm:px-1.5 sm:text-[13.5px]'
  // A phrase instead of a number (negative R²) wraps in the normal font
  const r2Cell = (r2) => <td className={r2 != null && r2 < 0 ? cx(td, 'font-sans text-[12px] sm:text-[12.5px]') : td}>{explainedShort(r2)}</td>
  const test = models.find((m) => m.metrics?.test)?.metrics.test
  const n = models.find((m) => m.hindcast?.times?.length)?.hindcast.times.length || 12
  return (
    <div className={panelCls}>
      <h3 className={panelTitle}>How accurate is each?</h3>
      {/* Outside the scroll box so it always wraps to the panel's width */}
      <p id="mlCmpNote" className="text-[13px] text-muted">
        {TEST_LABEL}: scored on {test ? `${tLabel(test.from)} – ${tLabel(test.to)}` : 'the most recent data'}, which the models never saw while
        learning. {hindLabel(n)}: the better guide to how far to trust the forecast. Explained: share of the ups and downs in greenness the model
        captured; error: its typical error in NDVI.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse" aria-describedby="mlCmpNote">
          <thead>
            <tr>
              <td />
              <th scope="colgroup" colSpan={2} className={group}>1 month ahead</th>
              <th scope="colgroup" colSpan={2} className={group}>{n}-month re-run</th>
            </tr>
            <tr>
              <th scope="col" className={th}>Model</th>
              <th scope="col" className={th}>Explained</th>
              <th scope="col" className={th}>Error</th>
              <th scope="col" className={th}>Explained</th>
              <th scope="col" className={th}>Error</th>
            </tr>
          </thead>
          <tbody>
            {models.map((m) => (
              <tr key={m.k}>
                <th scope="row" className="border-b border-line px-[3px] py-1.5 text-left text-[13px] font-semibold sm:px-1.5 sm:text-[14px]">
                  <span className="inline-flex items-center gap-2">
                    {/* The swatch costs a column's width on phones; the names are enough there */}
                    <span className="hidden sm:contents"><Swatch color={`var(${m.color})`} /></span>
                    <span>{m.label}</span>
                  </span>
                </th>
                {r2Cell(m.metrics?.test?.r2)}
                <td className={td}>±{fmt(m.metrics?.test?.rmse, 3)}</td>
                {r2Cell(m.hindcast?.r2)}
                <td className={td}>±{fmt(m.hindcast?.rmse, 3)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// Top inputs by permutation importance (drop in test R² when the input is shuffled).
function Drivers({ m, note }) {
  const top = (m?.importance || []).slice().sort((a, b) => b.value - a.value).slice(0, TOP_DRIVERS)
  // Negative importance (shuffling helped) draws no bar; the number still shows
  const max = Math.max(...top.map((d) => d.value), 1e-9)
  return (
    <div className={panelCls}>
      <h3 className={panelTitle}>What drives the forecast</h3>
      <p className="text-[13px] text-muted">
        How much the score on unseen data drops when one input is scrambled. Longer bar, more reliance.{note ? ` ${note}` : ''}
      </p>
      {top.length ? (
        <ul className="flex flex-col gap-2">
          {top.map((d) => (
            <li key={d.feature} className="flex flex-col gap-1">
              <span className="flex justify-between gap-3 text-[14px]">
                <span className="min-w-0">{d.label || d.feature}</span>
                <b className="font-mono font-medium">{fmt(d.value, 3)}</b>
              </span>
              <span className="h-2 w-full overflow-hidden rounded-full bg-line" aria-hidden="true">
                <span className="block h-full rounded-full" style={{ width: `${Math.max(0, d.value / max) * 100}%`, background: `var(${m.color})` }} />
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[14px] text-muted">No importance scores in this forecast.</p>
      )}
    </div>
  )
}

// Why a saved forecast was served although the API was reached (meta.fallback)
const FALLBACK = {
  unavailable: 'the live model is not available',
  timeout: 'the live model took too long',
  model_failure: 'the live model failed',
  invalid_input: 'the live model could not use the data',
  no_gee_data: 'the server does not have this city\'s Earth Engine data',
}

function Assumptions({ data, source, generated, fallback }) {
  // `source` is the server's data.source: only 'live' is a fresh model run;
  // the server's saved forecast and the site's bundled copy are both snapshots.
  const saved = [dateLabel(generated) && `from ${dateLabel(generated)}`, FALLBACK[fallback] && `because ${FALLBACK[fallback]}`].filter(Boolean).join(', ')
  return (
    <div className="flex flex-col gap-2 text-[14px] text-muted">
      {data.assumptions?.length > 0 && (
        <ul className="flex list-disc flex-col gap-1 pl-5">
          {data.assumptions.map((a) => (
            <li key={a}>{a}</li>
          ))}
        </ul>
      )}
      <p className="flex flex-wrap gap-x-4 gap-y-1 text-[13px]">
        <span>Issued {tLabel(data.issued)}</span>
        <span>Source: {source === 'live' ? 'live model' : `saved snapshot${saved ? ` (${saved})` : ''}`}</span>
        {data.modelVersion && <span>Model version {data.modelVersion}</span>}
      </p>
      <Provenance p={data.provenance} />
    </div>
  )
}

// Which data the model ran on: Google Earth Engine datasets, the box, when.
// The dataset ids are long, so they fold away behind a summary line.
function Provenance({ p }) {
  if (!p) return null
  const datasets = Array.isArray(p.datasets) ? p.datasets : []
  const when = dateLabel(p.generated)
  const summary = [
    `Data: Google Earth Engine${datasets.length ? `, ${plural(datasets.length, 'dataset')}` : ''}`,
    p.areaKm && `${p.areaKm} box`,
    when && `computed ${when}`,
  ].filter(Boolean).join(' · ')
  if (!datasets.length) return <p className="text-[13px]">{summary}</p>
  return (
    <details className="text-[13px]">
      <summary className="cursor-pointer">{summary}</summary>
      <p className="mt-1.5">
        The team notebook's pipeline{p.pipeline ? ` (${p.pipeline.replace(/^GEE notebook /, '')})` : ''}, run for this city. Datasets:
      </p>
      <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-1 font-mono text-[12px]">
        {datasets.map((d) => (
          <li key={d}>{d}</li>
        ))}
      </ul>
    </details>
  )
}

// Placeholder with the panel's final layout (readout strip, tall chart, two
// panels), so nothing jumps when the forecast arrives. Only opacity pulses.
function ForecastSkeleton({ animate }) {
  const pulse = animate ? { animate: { opacity: [0.55, 1, 0.55] }, transition: { duration: 1.4, ease: 'easeInOut', repeat: Infinity } } : {}
  const block = 'rounded-[14px] bg-surface2'
  return (
    <div className="flex flex-col gap-[18px]">
      <p role="status" className="text-[14px] text-muted">Running the forecast models…</p>
      <motion.div className={cx(block, 'h-[46px]')} {...pulse} />
      <motion.div className={cx(block, 'relative h-[340px] overflow-hidden')} {...pulse}>
        {/* A faint sketch of a line so the box reads as "chart coming" */}
        <svg className="absolute inset-0 size-full" viewBox="0 0 100 40" preserveAspectRatio="none" aria-hidden="true">
          <path d="M0 28 C10 20 15 30 25 24 S40 14 50 22 S65 30 75 20 S90 16 100 22" fill="none" stroke="var(--line)" strokeWidth="1.2" vectorEffect="non-scaling-stroke" />
        </svg>
      </motion.div>
      <div className="grid gap-[18px] md:grid-cols-2">
        <motion.div className={cx(block, 'h-[150px]')} {...pulse} />
        <motion.div className={cx(block, 'h-[150px]')} {...pulse} />
      </div>
    </div>
  )
}
