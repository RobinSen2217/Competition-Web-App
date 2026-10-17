import { useCallback, useMemo, useState } from 'react'
import { useEventTimeseries, useHazard, useHazardEvent, useHazardParameters } from '../../lib/hazards'
import { Card, CardHead, Kicker, Lede, Note, Pill, PillDot, Pills, Readout, ReadoutItem, ReadoutWhen, Seg, SegButton, Select, Swatch, Toggle } from '../ui'
import { SectionLoader } from '../common/SectionLoader'
import { cx } from '../../styles/classes'
import { useHazardPage } from './context'
import { Key, StaleChip } from './bits'
import DayChart from './DayChart'
import { dateLabel, dayNum, dayStr, fmtValue, isNumeric, listJoin, plural, rangeLabel, runsOf, seriesColor, uncertaintyFor, CARD_SCROLL } from './format'

/*
  "What was measured" (#parameters): the selected event's data, day by day.

  Two charts on one shared day axis (one y axis each: their units differ):
  1. Daily series (kind "series"), a group at a time (Rainfall, Data quality
     ...): the group's first series as bars, the others as lines, and a
     chooser for the rolling totals the API derives from them (3-day, 7-day:
     parameters with `derived: { from, op: 'rolling_sum', window }`).
  2. Observations (kind "observation"): one parameter at a time, each row a
     point at its own time (a satellite pass), with whiskers from its
     uncertainty when the hazard has one, and coloured / joined by a context
     column (passes of the same track see the same ground, so the data notes
     say to compare those).
  Boolean series (the reported flood period) shade both charts.

  Built from GET /hazards/:hazard/parameters only: groups, labels, units,
  decimals and derivations are the API's, so a new parameter appears here
  without a code change. Hover either chart for the day's values; the tables
  below give every number for screen readers and copying.
*/

const H_SERIES = 250
const H_OBS = 220

// Context columns that hold a timestamp ('2026-09-18 22:44'), which are not
// categories to group by
const TIME_LIKE = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/

export default function ParameterCharts() {
  const { hazard, eventId, events, eventsError, retryEvents } = useHazardPage()
  const paramsQ = useHazardParameters(hazard)
  const hazardQ = useHazard(hazard)
  const tsQ = useEventTimeseries(hazard, eventId, { keepPrevious: true })
  const evQ = useHazardEvent(hazard, eventId, { keepPrevious: true })
  const event = events?.find((e) => e.id === eventId)
  const ts = tsQ.data
  // While the next event loads, the previous one stays on screen, dimmed
  const shown = events?.find((e) => e.id === ts?.eventId) || event

  const failed = eventsError || paramsQ.error || (tsQ.status === 'error' ? tsQ.error : null)
  const retry = () => {
    if (eventsError) retryEvents()
    if (paramsQ.status === 'error') paramsQ.retry()
    if (tsQ.status === 'error') tsQ.retry()
  }
  const ready = paramsQ.data && ts

  return (
    <Card id="parameters" style={CARD_SCROLL} aria-labelledby="hzParT" aria-busy={!failed && (!ready || tsQ.stale)}>
      <CardHead>
        <Kicker>Measurements{event ? ` · ${event.name}` : ''}</Kicker>
        <h2 id="hzParT">What the satellites saw, day by day</h2>
        <Lede>{ledeText(paramsQ.data, event)}</Lede>
      </CardHead>
      {failed ? (
        <SectionLoader error={failed} onRetry={retry} className="h-[520px]" />
      ) : !ready ? (
        <SectionLoader label={event ? `Loading the data of ${event.name}…` : 'Loading the events…'} className="h-[640px]" />
      ) : (
        <div className="relative">
          <div className={cx('flex flex-col gap-[18px] transition-opacity duration-200', tsQ.stale && 'pointer-events-none opacity-45')} aria-hidden={tsQ.stale || undefined}>
            <Notes notes={evQ.data?.id === ts.eventId ? evQ.data.notes : null} />
            <Body params={paramsQ.data} ts={ts} event={shown} labelParameter={hazardQ.data?.forecast?.target?.labelParameter} />
          </div>
          {tsQ.stale && event && <StaleChip>Loading {event.name}…</StaleChip>}
        </div>
      )}
    </Card>
  )
}

// "Daily rainfall and data quality, and soil moisture at each pass, over the
// event's box from 17 Sep to 30 Sep 2026 (14 days)."
function ledeText(params, event) {
  if (!params) return 'The daily series and the observations over the area of the event.'
  const groups = (kind) => [...new Set(params.filter((p) => p.kind === kind && isNumeric(p)).map((p) => p.group.toLowerCase()))]
  const series = groups('series')
  const obs = groups('observation')
  const what = [series.length && `daily ${listJoin(series)}`, obs.length && `${listJoin(obs)} at each observation`].filter(Boolean).join(', and ')
  const p = event?.period
  const when = p?.windowStart ? `, ${rangeLabel(p.windowStart, p.windowEnd)} (${plural(event.coverage?.days ?? 0, 'day')})` : ''
  return `${what.charAt(0).toUpperCase() + what.slice(1)}, over the area of the event${when}. The reported flood period is shaded. Days are UTC days.`
}

function Notes({ notes }) {
  if (!notes?.length) return null
  return (
    <div className="flex flex-col gap-2">
      {notes.map((n) => (
        <Note key={n}>{n}</Note>
      ))}
    </div>
  )
}

/* ---- the parameter model: what can be drawn, from the metadata ---- */

// Series groups (one per group + unit, so a chart never mixes units), each
// with its base series and the windows its derived series offer.
function seriesGroups(params) {
  const numeric = params.filter((p) => p.kind === 'series' && isNumeric(p))
  const out = []
  for (const p of numeric) {
    const id = `${p.group}|${p.unit}`
    let g = out.find((x) => x.id === id)
    if (!g) out.push((g = { id, group: p.group, unit: p.unit, bases: [], derived: [] }))
    ;(p.derived ? g.derived : g.bases).push(p)
  }
  for (const g of out) {
    // A group name used for two units gets the unit added to its button
    g.label = out.filter((x) => x.group === g.group).length > 1 && g.unit ? `${g.group} (${g.unit})` : g.group
    const wins = new Map()
    for (const d of g.derived) {
      const { op, window: w } = d.derived
      if (!Number.isFinite(w)) continue
      const id = `${op}:${w}`
      if (!wins.has(id)) wins.set(id, { id, op, w, label: op === 'rolling_sum' ? `${w}-day total` : `${w}-day ${op.replace(/^rolling_/, '')}` })
    }
    g.windows = [{ id: 'daily', label: 'Daily' }, ...[...wins.values()].sort((a, b) => a.w - b.w || a.id.localeCompare(b.id))]
    // A derived series without its base in the group (unusual) is shown as a base
    for (const d of g.derived) if (!g.bases.some((b) => b.key === d.derived.from) && !g.bases.includes(d)) g.bases.push(d)
  }
  return out
}

// The series to draw for a base in a window: its derived twin, or itself for 'daily'
function inWindow(g, base, win) {
  if (win.id === 'daily') return base
  return g.derived.find((d) => d.derived.from === base.key && d.derived.op === win.op && d.derived.window === win.w) || null
}

// Context columns that group observations (track, orbit direction, phase ...):
// few distinct values, not timestamps
function groupColumns(p, obs) {
  return (p.context || []).filter((c) => {
    const vals = obs?.context?.[c.key]
    if (!vals?.length) return false
    if (vals.some((x) => typeof x === 'string' && TIME_LIKE.test(x))) return false
    return new Set(vals.map(String)).size <= 6
  })
}

// Position of each observation on the day axis: its UTC time of day when a
// context column carries it (two passes on one day then sit apart), else noon.
function obsX(obs) {
  const ctx = obs.context || {}
  const col = Object.values(ctx).find((vals) => vals.length === obs.times.length && vals.every((x, i) => typeof x === 'string' && TIME_LIKE.test(x) && x.slice(0, 10) === obs.times[i]))
  return obs.times.map((t, i) => {
    const d = dayNum(t)
    if (!col) return d + 0.5
    const [hh, mm] = col[i].slice(11, 16).split(':').map(Number)
    return d + (hh * 60 + mm) / 1440
  })
}

/* ---- the charts ---- */

function Body({ params, ts, event, labelParameter }) {
  const groups = useMemo(() => seriesGroups(params), [params])
  const bools = useMemo(() => params.filter((p) => p.kind === 'series' && p.valueType === 'boolean' && ts.series[p.key]), [params, ts])
  const obsParams = useMemo(() => params.filter((p) => p.kind === 'observation' && isNumeric(p) && ts.observations[p.key]), [params, ts])

  // Choices survive event switches (keys, not objects)
  const [groupId, setGroupId] = useState(null)
  const [winId, setWinId] = useState('daily')
  const [hidden, setHidden] = useState(() => new Set())
  const [shadeOff, setShadeOff] = useState(() => new Set())
  const [obsKey, setObsKey] = useState(null)
  const [whiskers, setWhiskers] = useState(true)
  const [groupBy, setGroupBy] = useState(undefined) // undefined = the first column that groups; '' = none
  const [hover, setHover] = useState(null)
  const onHover = useCallback((d) => setHover((h) => (h === d ? h : d)), [])

  const g = groups.find((x) => x.id === groupId) || groups[0]
  const win = g?.windows.find((w) => w.id === winId) || g?.windows[0]
  const bases = g ? g.bases.filter((b) => ts.series[b.key] || ts.series[inWindow(g, b, win)?.key]) : []
  const drawn = bases
    .map((b, i) => ({ base: b, p: inWindow(g, b, win), color: seriesColor(i), bars: i === 0 }))
    .filter((s) => s.p && ts.series[s.p.key] && !hidden.has(s.base.key))

  const op = obsParams.find((p) => p.key === obsKey) || obsParams[0]
  const obs = op ? ts.observations[op.key] : null
  const partner = op ? uncertaintyFor(op, obsParams) : null
  const unc = partner && whiskers ? ts.observations[partner.key] : null
  const cols = op ? groupColumns(op, obs) : []
  const col = groupBy === undefined ? cols[0] : cols.find((c) => c.key === groupBy)

  // Shared day axis: the series window and every observation
  const first = dayNum(ts.times[0])
  const xs = obs ? obsX(obs) : []
  const x0 = Math.min(first, ...xs.map(Math.floor))
  const x1 = Math.max(first + ts.times.length - 1, ...xs.map(Math.floor))

  const shades = bools
    .filter((p) => !shadeOff.has(p.key))
    .map((p, i) => ({ type: 'shade', ranges: runsOf(ts.series[p.key].map(Boolean), first), color: i === 0 ? '--accent' : seriesColor(2 + i), opacity: 0.13, p }))

  const seriesLayers = [
    ...shades,
    ...drawn.map((s) =>
      s.bars
        ? { type: 'bars', color: s.color, pts: ts.series[s.p.key].map((y, i) => ({ x: first + i, y })) }
        : { type: 'line', color: s.color, dots: true, pts: ts.series[s.p.key].map((y, i) => ({ x: first + i + 0.5, y })) },
    ),
  ]

  // Observation groups: values of the grouping column in order of appearance
  const cats = col ? [...new Set(obs.context[col.key].map(String))] : []
  const catColor = (i) => (col ? seriesColor(cats.indexOf(String(obs.context[col.key][i]))) : '--s1')
  // A quantity that is never negative in this event (soil moisture, a share)
  // keeps its whiskers at 0: a large uncertainty must not draw an impossible
  // negative value and stretch the axis below zero.
  const nonNeg = !!obs && obs.values.every((y) => y == null || y >= 0)
  const pts = obs
    ? obs.values.map((y, i) => {
        const u = unc?.values?.[i]
        const lo = u != null && y != null ? y - u : null
        return { x: xs[i], y, lo: lo != null && nonNeg ? Math.max(0, lo) : lo, hi: u != null && y != null ? y + u : null, color: catColor(i) }
      })
    : []
  // Other observations recorded on the same rows (same passes) in another
  // unit, e.g. how much of the box a pass covered: shown with each pass in the readout
  const siblings = obs
    ? obsParams.filter((q) => q.key !== op.key && q.key !== partner?.key && q.unit !== op.unit && ts.observations[q.key]?.times?.join() === obs.times.join())
    : []
  const obsLayers = [
    ...shades,
    // Thin lines joining the passes of one group, under the points
    ...cats.map((c, ci) => ({
      type: 'line',
      color: seriesColor(ci),
      width: 1.25,
      opacity: 0.55,
      hover: false,
      pts: pts.filter((_, i) => String(obs.context[col.key][i]) === c && pts[i].y != null),
    })),
    { type: 'points', color: '--s1', pts },
  ]

  const yUnit = drawn[0]?.p.unit ?? g?.unit
  const obsDecimals = op?.decimals ?? 2

  return (
    <>
      <DayReadout hover={hover} first={first} ts={ts} drawn={drawn} shades={shades} op={op} obs={obs} unc={unc} col={col} catColor={catColor} siblings={siblings} />

      {/* ---- chart 1: daily series ---- */}
      {g && (
        <section className="flex flex-col gap-3" aria-labelledby="hzSerT">
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <h3 id="hzSerT">
              {g.label}
              {yUnit ? <span className="font-body text-[14px] font-normal text-muted"> ({yUnit}{win.id === 'daily' ? ' per day' : win.op === 'rolling_sum' ? ` over ${win.w} days` : `, ${win.label}`})</span> : null}
            </h3>
            <div className="flex flex-wrap items-center gap-2">
              {groups.length > 1 && (
                <Seg role="group" aria-label="Series group">
                  {groups.map((x) => (
                    <SegButton key={x.id} pressed={x.id === g.id} onClick={() => setGroupId(x.id)}>
                      {x.label}
                    </SegButton>
                  ))}
                </Seg>
              )}
              {g.windows.length > 1 && (
                <Seg role="group" aria-label="Totals over">
                  {g.windows.map((w) => (
                    <SegButton key={w.id} pressed={w.id === win.id} onClick={() => setWinId(w.id)}>
                      {w.label}
                    </SegButton>
                  ))}
                </Seg>
              )}
            </div>
          </div>
          {(bases.length > 1 || bools.length > 0) && (
            <Pills role="group" aria-label="Shown series">
              {bases.length > 1 &&
                bases.map((b, i) => (
                  <Pill
                    key={b.key}
                    pressed={!hidden.has(b.key)}
                    onClick={() =>
                      setHidden((h) => {
                        const n = new Set(h)
                        if (n.has(b.key)) n.delete(b.key)
                        else n.add(b.key)
                        return n
                      })
                    }
                  >
                    <PillDot color={!hidden.has(b.key) ? `var(${seriesColor(i)})` : undefined} />
                    {b.label}
                  </Pill>
                ))}
              {bools.map((p) => (
                <Pill
                  key={p.key}
                  pressed={!shadeOff.has(p.key)}
                  onClick={() =>
                    setShadeOff((s) => {
                      const n = new Set(s)
                      if (n.has(p.key)) n.delete(p.key)
                      else n.add(p.key)
                      return n
                    })
                  }
                >
                  <span className="h-3 w-4 rounded-[3px] bg-accent opacity-40" aria-hidden="true" />
                  {p.label}
                </Pill>
              ))}
            </Pills>
          )}
          <DayChart
            x0={x0}
            x1={x1}
            height={H_SERIES}
            layers={seriesLayers}
            zero
            yFmt={(v) => String(+v.toFixed(2))}
            hover={hover}
            onHover={onHover}
            aria={`${g.label} per day for ${event?.name || 'the event'}: ${drawn.map((s) => s.p.label).join(', ')}`}
            empty="No series of this group for this event."
          />
          <div className="flex flex-wrap gap-x-[18px] gap-y-1.5 text-[13px] text-muted" aria-hidden="true">
            {drawn.map((s) => (
              <Key key={s.p.key} swatch={s.bars ? <span className="h-3 w-2.5 rounded-t-[3px]" style={{ background: `var(${s.color})` }} /> : <span className="h-[3px] w-5 rounded-full" style={{ background: `var(${s.color})` }} />}>
                {s.p.label}
              </Key>
            ))}
            {shades.map((s) => (
              <Key key={s.p.key} swatch={<span className="h-3 w-5 rounded-[3px] bg-accent opacity-40" />}>
                {s.p.label}
              </Key>
            ))}
          </div>
          <About items={[...drawn.map((s) => s.p), ...shades.map((s) => s.p)]} labelParameter={labelParameter} />
        </section>
      )}

      {/* ---- chart 2: observations ---- */}
      {op && (
        <section className="flex flex-col gap-3" aria-labelledby="hzObsT">
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <h3 id="hzObsT">
              {op.group}
              <span className="font-body text-[14px] font-normal text-muted">
                {' '}
                ({plural(obs.values.filter((x) => x != null).length, 'observation')}
                {op.unit ? `, ${op.unit}` : ''})
              </span>
            </h3>
            <div className="flex flex-wrap items-center gap-2">
              {obsParams.length > 1 && (
                <Select aria-label="Observation shown" value={op.key} onChange={(e) => setObsKey(e.target.value)} className="max-w-full">
                  {[...new Set(obsParams.map((p) => p.group))].map((grp) => (
                    <optgroup key={grp} label={grp}>
                      {obsParams
                        .filter((p) => p.group === grp)
                        .map((p) => (
                          <option key={p.key} value={p.key}>
                            {p.label}
                          </option>
                        ))}
                    </optgroup>
                  ))}
                </Select>
              )}
              {cols.length > 0 && (
                <Select aria-label="Colour the observations by" value={col?.key ?? ''} onChange={(e) => setGroupBy(e.target.value)}>
                  <option value="">One colour</option>
                  {cols.map((c) => (
                    <option key={c.key} value={c.key}>
                      By {c.label.toLowerCase()}
                    </option>
                  ))}
                </Select>
              )}
            </div>
          </div>
          {partner && (
            <Toggle checked={whiskers} onChange={(e) => setWhiskers(e.target.checked)}>
              Show ± {partner.label.toLowerCase()}
            </Toggle>
          )}
          <DayChart
            x0={x0}
            x1={x1}
            height={H_OBS}
            layers={obsLayers}
            yFmt={(v) => v.toFixed(Math.min(obsDecimals, 2))}
            hover={hover}
            onHover={onHover}
            aria={`${op.label} for ${event?.name || 'the event'}, ${plural(obs.values.length, 'observation')}`}
            empty={`No ${op.label.toLowerCase()} values for this event.`}
          />
          <div className="flex flex-wrap gap-x-[18px] gap-y-1.5 text-[13px] text-muted" aria-hidden="true">
            {col
              ? cats.map((c, i) => (
                  <Key key={c} swatch={<span className="size-[10px] rounded-full" style={{ background: `var(${seriesColor(i)})` }} />}>
                    {col.label} {c}
                  </Key>
                ))
              : <Key swatch={<span className="size-[10px] rounded-full bg-s1" />}>{op.label}</Key>}
            {unc && <Key swatch={<span className="h-3 w-[9px] border-y-[1.5px] border-muted bg-[linear-gradient(var(--muted),var(--muted))] bg-[length:1.5px_100%] bg-center bg-no-repeat" />}>± {partner.label.toLowerCase()}</Key>}
            {shades.map((s) => (
              <Key key={s.p.key} swatch={<span className="h-3 w-5 rounded-[3px] bg-accent opacity-40" />}>
                {s.p.label}
              </Key>
            ))}
          </div>
          <About items={[op, unc ? partner : null].filter(Boolean)} />
        </section>
      )}

      <Tables ts={ts} drawn={drawn} bools={bools} op={op} obs={obs} partner={unc ? partner : null} unc={unc} />
    </>
  )
}

// Values under the pointer, or a summary of the event when not hovering
function DayReadout({ hover, first, ts, drawn, shades, op, obs, unc, col, catColor, siblings }) {
  const i = hover == null ? -1 : hover - first
  const inSeries = i >= 0 && i < ts.times.length
  if (hover == null) {
    // Peak of the first shown series and the number of observations
    const s = drawn[0]
    let peak = null
    if (s) ts.series[s.p.key].forEach((y, j) => y != null && (peak == null || y > ts.series[s.p.key][peak]) && (peak = j))
    return (
      <Readout aria-live="off">
        <ReadoutWhen>{rangeLabel(ts.times[0], ts.times[ts.times.length - 1])}</ReadoutWhen>
        {s && peak != null && (
          <ReadoutItem>
            <Swatch color={`var(${s.color})`} />
            Highest {s.p.label.toLowerCase()} <b>{fmtValue(ts.series[s.p.key][peak], s.p)}</b> on {dateLabel(ts.times[peak], { year: false })}
          </ReadoutItem>
        )}
        {op && (
          <ReadoutItem>
            <b>{obs.values.filter((v) => v != null).length}</b> {op.group.toLowerCase()} observations
          </ReadoutItem>
        )}
        <ReadoutItem className="text-[13px]">Hover or tap a chart for one day</ReadoutItem>
      </Readout>
    )
  }
  const day = dayStr(hover)
  const passes = obs ? obs.times.map((t, j) => (t === day ? j : -1)).filter((j) => j >= 0) : []
  const timeCol = obs && Object.entries(obs.context || {}).find(([, vals]) => vals.every((x) => typeof x === 'string' && TIME_LIKE.test(x)))?.[0]
  return (
    <Readout>
      <ReadoutWhen>{dateLabel(day)}</ReadoutWhen>
      {inSeries &&
        drawn.map((s) => (
          <ReadoutItem key={s.p.key}>
            <Swatch color={`var(${s.color})`} />
            {s.p.label} <b>{fmtValue(ts.series[s.p.key][i], s.p)}</b>
          </ReadoutItem>
        ))}
      {inSeries &&
        shades.map((s) =>
          ts.series[s.p.key][i] ? (
            <ReadoutItem key={s.p.key}>
              <span className="h-3 w-4 rounded-[3px] bg-accent opacity-40" />
              {s.p.label}
            </ReadoutItem>
          ) : null,
        )}
      {!inSeries && <ReadoutItem>Before the daily series start</ReadoutItem>}
      {passes.map((j) => (
        <ReadoutItem key={j}>
          <Swatch color={`var(${catColor(j)})`} />
          {op.label}
          {timeCol ? ` ${obs.context[timeCol][j].slice(11, 16)} UTC` : ''}
          {col ? ` (${col.label.toLowerCase()} ${obs.context[col.key][j]})` : ''}{' '}
          <b>
            {fmtValue(obs.values[j], op, { unit: false })}
            {unc?.values?.[j] != null && obs.values[j] != null ? ` ± ${fmtValue(unc.values[j], op, { unit: false })}` : ''}
            {op.unit ? ` ${op.unit}` : ''}
          </b>
          {siblings.map((q) => (
            <span key={q.key}>
              {' '}
              · {q.label.toLowerCase()} <b>{fmtValue(ts.observations[q.key].values[j], q)}</b>
            </span>
          ))}
        </ReadoutItem>
      ))}
    </Readout>
  )
}

// What each drawn parameter is and where it comes from, folded away
function About({ items, labelParameter }) {
  if (!items.length) return null
  return (
    <details className="text-[13px] text-muted">
      <summary className="cursor-pointer">About these numbers</summary>
      <dl className="mt-1.5 flex flex-col gap-1.5">
        {items.map((p) => (
          <div key={p.key}>
            <dt className="inline font-semibold text-ink">{p.label}</dt>
            <dd className="inline">
              {' '}
              — {p.description}
              {p.source ? ` Source: ${p.source}.` : ''}
              {p.key === labelParameter ? ' The forecast below learns from this.' : ''}
            </dd>
          </div>
        ))}
      </dl>
    </details>
  )
}

// Every number of both charts, for screen readers and copying
function Tables({ ts, drawn, bools, op, obs, partner, unc }) {
  const th = 'border-b border-line px-2 py-1.5 text-left text-[12.5px] font-semibold whitespace-nowrap text-muted'
  const td = 'border-b border-line px-2 py-1 font-mono text-[13px] whitespace-nowrap'
  const ctxCols = op?.context || []
  return (
    <details className="text-[14px]">
      <summary className="cursor-pointer text-[13px] text-muted">Show the numbers as tables</summary>
      <div className="mt-2 flex flex-col gap-4">
        <div className="max-h-[360px] overflow-auto">
          <table className="w-full border-collapse">
            <caption className="pb-1 text-left text-[13px] font-semibold">Daily series</caption>
            <thead>
              <tr>
                <th scope="col" className={th}>Day (UTC)</th>
                {drawn.map((s) => (
                  <th key={s.p.key} scope="col" className={th}>
                    {s.p.label}
                    {s.p.unit ? ` (${s.p.unit})` : ''}
                  </th>
                ))}
                {bools.map((p) => (
                  <th key={p.key} scope="col" className={th}>{p.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ts.times.map((t, i) => (
                <tr key={t}>
                  <th scope="row" className={cx(td, 'text-left font-normal')}>{t}</th>
                  {drawn.map((s) => (
                    <td key={s.p.key} className={td}>{fmtValue(ts.series[s.p.key][i], s.p, { unit: false })}</td>
                  ))}
                  {bools.map((p) => (
                    <td key={p.key} className={td}>{fmtValue(ts.series[p.key][i], p)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {op && (
          <div className="max-h-[360px] overflow-auto">
            <table className="w-full border-collapse">
              <caption className="pb-1 text-left text-[13px] font-semibold">{op.label}</caption>
              <thead>
                <tr>
                  <th scope="col" className={th}>Day (UTC)</th>
                  <th scope="col" className={th}>{op.label}{op.unit ? ` (${op.unit})` : ''}</th>
                  {partner && <th scope="col" className={th}>± {partner.label}</th>}
                  {ctxCols.map((c) => (
                    <th key={c.key} scope="col" className={th}>{c.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {obs.times.map((t, i) => (
                  <tr key={i}>
                    <th scope="row" className={cx(td, 'text-left font-normal')}>{t}</th>
                    <td className={td}>{fmtValue(obs.values[i], op, { unit: false })}</td>
                    {partner && <td className={td}>{fmtValue(unc.values[i], partner, { unit: false })}</td>}
                    {ctxCols.map((c) => (
                      <td key={c.key} className={td}>{fmtValue(obs.context?.[c.key]?.[i], c)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </details>
  )
}
