import { useCallback, useMemo, useRef, useState } from 'react'
import useElementWidth from '../../hooks/useElementWidth'
import { useEventForecast, useHazard, useHazardParameters } from '../../lib/hazards'
import { Card, CardHead, Kicker, Lede, Note, Readout, ReadoutItem, ReadoutWhen, Seg, SegButton, Swatch, Toggle } from '../ui'
import { SectionLoader } from '../common/SectionLoader'
import { cx } from '../../styles/classes'
import { useHazardPage } from './context'
import { Key, RoleTag, StaleChip, Stat } from './bits'
import DayChart from './DayChart'
import { dateLabel, dayNum, dayStr, fmtNum, listJoin, pct, plural, rangeLabel, runsOf, seriesColor, panelCls, panelTitle, CARD_SCROLL } from './format'

/*
  "Forecast and danger days" (#forecast) for the selected event.

  For every day of the event, each model's probability of the hazard's
  target ("Flood within the next 3 days"), its threshold, and the resulting
  danger class from the API (`class`: danger when probability >= the model's
  exact threshold; never re-derived here). Next to it, what actually
  happened (`actual`, the target) and the reported period (`observed`), how
  the event was scored (held-out test, out-of-fold, excluded with the
  reason) and the scores.

  Models, labels, thresholds, the default model, the horizon and the target's
  wording all come from GET /hazards/:hazard (forecast) and the event's
  forecast, so a hazard with other models or another target needs no change.
  The caveat at the end is computed from the same scores, so it stays true
  if the model is rebuilt.
*/

// Plain names for the API's metric keys, in display order
const METRICS = [
  ['balancedAccuracy', 'Balanced accuracy', (v) => fmtNum(v)],
  ['recall', 'Floods caught (recall)', (v) => pct(v)],
  ['precision', 'Alarms that were right', (v) => pct(v)],
  ['predictedPositiveRate', 'Days flagged danger', (v) => pct(v)],
  ['actualPositiveRate', 'Days with the hazard ahead', (v) => pct(v)],
  ['rocAuc', 'ROC AUC', (v) => fmtNum(v)],
]

export default function ForecastPanel() {
  const { hazard, eventId, events, eventsError, retryEvents } = useHazardPage()
  const hzQ = useHazard(hazard)
  const paramsQ = useHazardParameters(hazard)
  const fcQ = useEventForecast(hazard, eventId, { keepPrevious: true })
  const event = events?.find((e) => e.id === eventId)
  const fc = fcQ.data
  const shown = events?.find((e) => e.id === fc?.eventId) || event
  const f = hzQ.data?.forecast

  // Models in the hazard's order; the default first selected
  const models = useMemo(() => {
    if (!f) return []
    const order = hzQ.data.provides?.forecast?.models?.map((m) => m.id) || Object.keys(f.models)
    return order.filter((id) => f.models[id]).map((id, i) => ({ id, ...f.models[id], color: seriesColor(i) }))
  }, [f, hzQ.data])
  const [picked, setPicked] = useState(null)
  const [compare, setCompare] = useState(false)
  const model = models.find((m) => m.id === picked) || models.find((m) => m.id === f?.defaultModel) || models[0]

  const failed = eventsError || hzQ.error || (fcQ.status === 'error' ? fcQ.error : null)
  const retry = () => {
    if (eventsError) retryEvents()
    if (hzQ.status === 'error') hzQ.retry()
    if (fcQ.status === 'error') fcQ.retry()
  }
  const ready = f && fc && model
  const target = f?.target?.label || 'the hazard'

  return (
    <Card id="forecast" style={CARD_SCROLL} aria-labelledby="hzFcT" aria-busy={!failed && (!ready || fcQ.stale)}>
      <CardHead
        aside={
          models.length > 1 && (
            <div className="flex-wrap items-center">
              <Seg role="group" aria-label="Forecast model">
                {models.map((m) => (
                  <SegButton key={m.id} pressed={m.id === model.id} onClick={() => setPicked(m.id)}>
                    {m.label}
                  </SegButton>
                ))}
              </Seg>
              <Toggle checked={compare} onChange={(e) => setCompare(e.target.checked)}>
                Compare with {models.length > 2 ? 'the other models' : `“${models.find((m) => m.id !== model.id)?.label}”`}
              </Toggle>
            </div>
          )
        }
      >
        <Kicker>Forecast{event ? ` · ${event.name}` : ''}</Kicker>
        <h2 id="hzFcT">Danger days, as the model saw them</h2>
        <Lede>
          {f
            ? `For every day, the chance of “${target.toLowerCase()}” given the data up to that day. A day is a danger day when that chance reaches the model's threshold (${listJoin(models.map((m) => `${pct(m.threshold)} for ${m.label.toLowerCase()}`))}).`
            : 'For every day, the model’s chance of the hazard soon, and whether that makes it a danger day.'}
        </Lede>
      </CardHead>
      {failed ? (
        <SectionLoader error={failed} onRetry={retry} className="h-[520px]" />
      ) : !ready ? (
        <SectionLoader label={event ? `Loading the forecast for ${event.name}…` : 'Loading the events…'} className="h-[640px]" />
      ) : (
        <div className="relative">
          <div className={cx('flex flex-col gap-[18px] transition-opacity duration-200', fcQ.stale && 'pointer-events-none opacity-45')} aria-hidden={fcQ.stale || undefined}>
            <Body f={f} fc={fc} event={shown} models={models} model={model} compare={compare} params={paramsQ.data} />
          </div>
          {fcQ.stale && event && <StaleChip>Loading {event.name}…</StaleChip>}
        </div>
      )}
    </Card>
  )
}

function Body({ f, fc, event, models, model, compare, params }) {
  const [hover, setHover] = useState(null)
  const onHover = useCallback((d) => setHover((h) => (h === d ? h : d)), [])
  const ev = fc.evaluation || {}
  const labelKey = fc.target?.labelParameter
  const labelParam = params?.find((p) => p.key === labelKey)
  const periodName = labelParam?.label || 'Reported period'

  if (!fc.available) {
    return (
      <>
        <Scoring fc={fc} event={event} />
        <div className="flex min-h-[200px] items-center justify-center rounded-[14px] bg-surface2 p-6">
          <p className="max-w-[520px] text-center text-[15px] text-muted">
            No forecast for this event{ev.reason ? ' (the reason is above)' : ''}. Its data is still shown in the charts above.
          </p>
        </div>
        <Caveat f={f} models={models} />
      </>
    )
  }

  const first = dayNum(fc.times[0])
  const n = fc.times.length
  const x1 = first + n - 1
  const m = fc.models[model.id]
  const others = compare ? models.filter((x) => x.id !== model.id && fc.models[x.id]) : []
  const observed = fc.observed?.[labelKey] || []
  const danger = (m.class || []).map((c) => c === 'danger')

  const layers = [
    { type: 'shade', ranges: runsOf(danger, first), color: '--bad', opacity: 0.12 },
    { type: 'rug', ranges: runsOf(observed.map(Boolean), first), color: '--accent' },
    ...others.map((o) => ({ type: 'line', color: o.color, width: 1.75, opacity: 0.8, dash: true, pts: fc.models[o.id].probability.map((y, i) => ({ x: first + i + 0.5, y })) })),
    ...others.map((o) => ({ type: 'hline', y: fc.models[o.id].threshold, color: o.color, label: null })),
    { type: 'hline', y: m.threshold, color: '--ink', label: `Threshold ${pct(m.threshold)}` },
    {
      type: 'line',
      color: model.color,
      width: 2.25,
      dots: true,
      // A danger day's dot is drawn larger in the danger colour, so the class
      // is visible on the line itself, not only in the shading
      pts: m.probability.map((y, i) => ({ x: first + i + 0.5, y, color: danger[i] ? '--bad' : undefined, r: danger[i] ? 3.5 : 2.5 })),
    },
  ]

  return (
    <>
      <Scoring fc={fc} event={event} model={m} />
      <Outcome fc={fc} m={m} model={model} event={event} />
      <ForecastReadout hover={hover} first={first} fc={fc} models={[model, ...others]} periodName={periodName} labelKey={labelKey} />
      <DayChart
        x0={first}
        x1={x1}
        height={260}
        layers={layers}
        yMin={0}
        yMax={1}
        yFmt={(v) => `${Math.round(v * 100)}%`}
        hover={hover}
        onHover={onHover}
        aria={`Daily probability of ${fc.target?.label?.toLowerCase() || 'the hazard'} by ${[model, ...others].map((x) => x.label).join(' and ')}, ${rangeLabel(fc.times[0], fc.times[n - 1])}; ${m.summary?.dangerDays ?? 0} of ${n} days are danger days`}
      />
      <div className="flex flex-wrap gap-x-[18px] gap-y-1.5 text-[13px] text-muted" aria-hidden="true">
        <Key swatch={<span className="h-[3px] w-5 rounded-full" style={{ background: `var(${model.color})` }} />}>{model.label}</Key>
        {others.map((o) => (
          <Key key={o.id} swatch={<span className="w-5 border-t-[2.5px] border-dashed" style={{ borderColor: `var(${o.color})` }} />}>
            {o.label} (threshold {pct(o.threshold)})
          </Key>
        ))}
        <Key swatch={<span className="w-5 border-t-[2px] border-dashed border-ink" />}>Threshold</Key>
        <Key swatch={<span className="h-3 w-5 rounded-[3px] bg-bad opacity-30" />}>Danger day</Key>
        <Key swatch={<span className="h-[5px] w-5 rounded-full bg-accent" />}>{periodName}</Key>
      </div>
      <Calendar fc={fc} first={first} models={[model, ...others]} hover={hover} onHover={onHover} periodName={periodName} labelKey={labelKey} />
      <Scores m={m} model={model} fc={fc} />
      <Caveat f={f} models={models} />
      <Table fc={fc} models={[model, ...others]} labelKey={labelKey} periodName={periodName} />
    </>
  )
}

// How this event's days were scored (role, explanation, fold)
function Scoring({ fc, event, model }) {
  const { events } = useHazardPage()
  const ev = fc.evaluation || {}
  const nameOf = (id) => (id === event?.id ? 'this event' : events?.find((e) => e.id === id)?.name || id)
  const foldNames = model?.foldEvents?.length ? model.foldEvents.map(nameOf) : null
  return (
    <div className="flex flex-col gap-1.5 rounded-[14px] bg-surface2 px-4 py-3">
      <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="text-[13px] font-semibold tracking-[.05em] text-muted uppercase">How this event was scored</span>
        <RoleTag event={{ forecast: { role: ev.role } }} long />
      </span>
      <p className="text-[14px]">
        {ev.description}
        {model?.fold != null && foldNames
          ? ` Cross-validation fold ${model.fold + 1}, which held out ${foldNames.length > 1 ? `${listJoin(foldNames)} together` : foldNames[0]}.`
          : ''}
      </p>
      {ev.reason && <p className="text-[14px] text-muted">{ev.reason}</p>}
    </div>
  )
}

// The event in one sentence plus hit / false alarm / miss counts
function Outcome({ fc, m, model, event }) {
  const n = fc.times.length
  const s = m.summary || {}
  let hit = 0, falseAlarm = 0, miss = 0, quiet = 0, known = 0
  fc.times.forEach((_, i) => {
    const a = fc.actual?.[i]
    if (a == null) return
    known++
    const d = m.class?.[i] === 'danger'
    if (d && a) hit++
    else if (d) falseAlarm++
    else if (a) miss++
    else quiet++
  })
  const start = event?.period?.start
  const lead = s.firstDanger && start ? dayNum(start) - dayNum(s.firstDanger) : null
  const leadText =
    lead == null
      ? ''
      : lead > 0
        ? ` The reported period began on ${dateLabel(start, { year: false })}, ${plural(lead, 'day')} after the first danger day.`
        : lead === 0
          ? ` The reported period began the same day.`
          : ` The reported period had begun ${plural(-lead, 'day')} earlier, on ${dateLabel(start, { year: false })}.`
  return (
    <div className="flex flex-col gap-3">
      <p className="text-[16px]">
        <b>{model.label}</b> flagged <b>{plural(s.dangerDays ?? 0, 'danger day')}</b> out of {n}
        {s.firstDanger ? ` (first ${dateLabel(s.firstDanger, { year: false })}, last ${dateLabel(s.lastDanger, { year: false })})` : ''}.{leadText}
      </p>
      <div className="flex flex-wrap gap-2">
        <Stat label="Alarm, hazard came" value={String(hit)} />
        <Stat label="False alarm" value={String(falseAlarm)} />
        <Stat label="Missed" value={String(miss)} />
        <Stat label="Quiet, rightly" value={String(quiet)} />
      </div>
      {known < n && (
        <p className="text-[13px] text-muted">
          {plural(n - known, 'day')} at the end cannot be scored: the {fc.horizonDays} days after them are not in the data.
        </p>
      )}
    </div>
  )
}

function ForecastReadout({ hover, first, fc, models, periodName, labelKey }) {
  const i = hover == null ? -1 : hover - first
  if (i < 0 || i >= fc.times.length) {
    return (
      <Readout>
        <ReadoutWhen>{rangeLabel(fc.times[0], fc.times[fc.times.length - 1])}</ReadoutWhen>
        <ReadoutItem className="text-[13px]">Hover or tap the chart or the strip for one day</ReadoutItem>
      </Readout>
    )
  }
  const a = fc.actual?.[i]
  return (
    <Readout>
      <ReadoutWhen>{dateLabel(dayStr(hover))}</ReadoutWhen>
      {models.map((mm) => {
        const r = fc.models[mm.id]
        return (
          <ReadoutItem key={mm.id}>
            <Swatch color={`var(${mm.color})`} />
            {mm.label} <b>{pct(r.probability?.[i])}</b>
            <span className={r.class?.[i] === 'danger' ? 'font-semibold text-bad' : ''}>{r.class?.[i] === 'danger' ? 'danger' : 'no danger'}</span>
          </ReadoutItem>
        )
      })}
      <ReadoutItem>
        {fc.target?.label || 'Target'}: <b>{a == null ? 'unknown' : a ? 'yes' : 'no'}</b>
      </ReadoutItem>
      {fc.observed?.[labelKey]?.[i] && <ReadoutItem>{periodName}</ReadoutItem>}
    </Readout>
  )
}

// Compact day strip: one row per shown model (danger or not), then what
// happened (the target) and the reported period. Columns line up with the
// days; long events scroll sideways on narrow screens.
function Calendar({ fc, first, models, hover, onHover, periodName, labelKey }) {
  const n = fc.times.length
  const rows = [
    ...models.map((mm) => ({
      key: mm.id,
      label: `Danger · ${mm.label}`,
      cell: (i) => {
        const c = fc.models[mm.id].class?.[i]
        return c === 'danger' ? { bg: 'var(--bad)', t: 'danger' } : c ? { bg: 'var(--line)', t: 'no danger' } : { t: 'no value' }
      },
    })),
    {
      key: 'actual',
      label: `${fc.target?.label || 'Target'} (what happened)`,
      cell: (i) => {
        const a = fc.actual?.[i]
        return a == null ? { t: 'unknown' } : a ? { bg: 'var(--accent)', t: 'yes' } : { bg: 'var(--line)', t: 'no' }
      },
    },
    {
      key: 'observed',
      label: periodName,
      cell: (i) => (fc.observed?.[labelKey]?.[i] ? { bg: 'color-mix(in srgb, var(--accent) 45%, transparent)', t: 'yes' } : { bg: 'var(--line)', t: 'no' }),
    },
  ]
  // Day labels every k days (1, 2, 3, 7 or 14) so they never collide: about
  // 52px per label at the strip's actual width
  const ref = useRef(null)
  const w = useElementWidth(ref, 100)
  const minCell = 9
  const cellW = Math.max(w, n * (minCell + 2)) / n
  const k = [1, 2, 3, 7, 14, 28].find((s) => s * cellW >= 52) || 56
  // Days a label covers; one that would run past the strip's end is left out
  const labelDays = Math.ceil(44 / cellW)
  return (
    <section aria-labelledby="hzCalT" className="flex flex-col gap-2">
      <h3 id="hzCalT" className={panelTitle}>Day by day</h3>
      <div ref={ref} className="overflow-x-auto pb-1">
        <div className="flex flex-col gap-2" style={{ minWidth: n * (minCell + 2) }} onPointerLeave={() => onHover(null)}>
          {rows.map((r) => (
            <div key={r.key} className="flex flex-col gap-1">
              <span className="text-[13px] text-muted">{r.label}</span>
              <div className="flex gap-[2px]" aria-hidden="true">
                {fc.times.map((t, i) => {
                  const c = r.cell(i)
                  return (
                    <span
                      key={t}
                      title={`${dateLabel(t)}: ${c.t}`}
                      onPointerEnter={() => onHover(first + i)}
                      onPointerDown={() => onHover(first + i)}
                      className={cx('h-[18px] flex-1 rounded-[4px]', !c.bg && 'border border-dashed border-line', hover === first + i && 'ring-2 ring-ink')}
                      style={c.bg ? { background: c.bg } : undefined}
                    />
                  )
                })}
              </div>
            </div>
          ))}
          <div className="flex gap-[2px] font-mono text-[11px] text-muted" aria-hidden="true">
            {fc.times.map((t, i) => (
              <span key={t} className="relative h-[14px] flex-1">
                {i % k === 0 && i + labelDays <= n && <span className="absolute left-0 whitespace-nowrap">{dateLabel(t, { year: false })}</span>}
              </span>
            ))}
          </div>
        </div>
      </div>
      <p className="sr-only">
        {models.map((mm) => `${mm.label}: ${fc.models[mm.id].summary?.dangerDays ?? 0} danger days of ${n}.`).join(' ')} The table below lists every day.
      </p>
    </section>
  )
}

// This event's scores next to the model's overall ones
function Scores({ m, model, fc }) {
  const e = m.metrics?.event
  const t = m.metrics?.test
  const o = m.metrics?.outOfFold
  const role = fc.evaluation?.role
  return (
    <div className="grid gap-[18px] md:grid-cols-2">
      <div className={panelCls}>
        <h3 className={panelTitle}>This event · {model.label}</h3>
        {e ? (
          <>
            <div className="flex flex-wrap gap-2">
              {METRICS.filter(([k]) => e[k] != null).map(([k, label, f]) => (
                <Stat onPanel key={k} label={label} value={f(e[k])} />
              ))}
            </div>
            <p className="text-[13px] text-muted">
              Over {plural(e.rows, 'day')} with a known outcome
              {role === 'out_of_fold' ? ', each scored by the cross-validation model that did not see this event' : ''}. Balanced accuracy 0.5 is no
              better than a coin toss.{e.rocAuc == null ? ' ROC AUC needs days of both kinds, which this event does not have.' : ''}
            </p>
          </>
        ) : (
          <p className="text-[14px] text-muted">Too few days with a known outcome to score this event.</p>
        )}
      </div>
      <div className={panelCls}>
        <h3 className={panelTitle}>The model overall · {model.label}</h3>
        {t && (
          <div className="flex flex-wrap gap-2">
            <Stat onPanel label="Test: balanced accuracy" value={fmtNum(t.balancedAccuracy)} hint={`${plural(t.rows, 'held-out day')}`} />
            <Stat onPanel label="Test: floods caught" value={pct(t.recall)} />
            <Stat onPanel label="Test: days flagged" value={pct(t.predictedPositiveRate)} hint={`vs ${pct(t.actualPositiveRate)} with the hazard ahead`} />
            {o && <Stat onPanel label="Out-of-fold: balanced accuracy" value={fmtNum(o.balancedAccuracy)} hint={`${plural(o.rows, 'training day')}`} />}
          </div>
        )}
        <p className="text-[13px] text-muted">
          Test: the days of the held-out events, scored by the final model. Out-of-fold: the training days, each scored by a model that did not
          see its event; these chose the threshold ({pct(m.threshold)}).
        </p>
      </div>
    </div>
  )
}

// The honest reading, computed from the model's own scores
export function Caveat({ f, models }) {
  const tests = models.map((m) => m.test).filter(Boolean)
  const span = (key, fmt) => {
    const vals = tests.map((t) => t[key]).filter((v) => v != null)
    if (!vals.length) return '–'
    const lo = Math.min(...vals), hi = Math.max(...vals)
    return fmt(lo) === fmt(hi) ? fmt(lo) : `${fmt(lo)}–${fmt(hi)}`
  }
  const split = f.split || {}
  const data = f.data || {}
  const excluded = split.excludedEvents?.length || 0
  return (
    <Note className="text-[14px]">
      <b className="text-ink">Read this as a research result about past events, not a warning service.</b> The models were fitted to these events
      only: {plural(data.trainRows ?? 0, 'training day')} from {plural(split.trainEvents?.length ?? 0, 'event')}, checked on{' '}
      {plural(data.testRows ?? 0, 'day')} of {plural(split.testEvents?.length ?? 0, 'event')} they never saw
      {excluded ? `, with ${plural(excluded, 'event')} left out` : ''}. They raise the alarm on most days: on the held-out days they flagged{' '}
      {span('predictedPositiveRate', (v) => pct(v))} of days as danger and caught {span('recall', (v) => pct(v))} of the days with the hazard ahead,
      with a balanced accuracy of {span('balancedAccuracy', (v) => fmtNum(v))} (0.5 is a coin toss).
    </Note>
  )
}

// Every day as a table, for screen readers and copying
function Table({ fc, models, labelKey, periodName }) {
  const th = 'border-b border-line px-2 py-1.5 text-left text-[12.5px] font-semibold whitespace-nowrap text-muted'
  const td = 'border-b border-line px-2 py-1 font-mono text-[13px] whitespace-nowrap'
  return (
    <details className="text-[14px]">
      <summary className="cursor-pointer text-[13px] text-muted">Show every day as a table</summary>
      <div className="mt-2 max-h-[360px] overflow-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th scope="col" className={th}>Day (UTC)</th>
              {models.map((m) => (
                <th key={m.id} scope="col" className={th}>
                  {m.label}
                </th>
              ))}
              <th scope="col" className={th}>{fc.target?.label || 'Target'}</th>
              <th scope="col" className={th}>{periodName}</th>
            </tr>
          </thead>
          <tbody>
            {fc.times.map((t, i) => (
              <tr key={t}>
                <th scope="row" className={cx(td, 'text-left font-normal')}>{t}</th>
                {models.map((m) => {
                  const r = fc.models[m.id]
                  return (
                    <td key={m.id} className={td}>
                      {pct(r.probability?.[i])} {r.class?.[i] === 'danger' ? 'danger' : 'no danger'}
                    </td>
                  )
                })}
                <td className={td}>{fc.actual?.[i] == null ? 'unknown' : fc.actual[i] ? 'yes' : 'no'}</td>
                <td className={td}>{fc.observed?.[labelKey]?.[i] ? 'yes' : 'no'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  )
}
