import { useEffect, useRef } from 'react'
import { useHazard } from '../../lib/hazards'
import { Card, Kicker, Lede, Note } from '../ui'
import { SectionLoader, Skeleton } from '../common/SectionLoader'
import { cx } from '../../styles/classes'
import { useHazardPage } from './context'
import { RoleTag, Stat } from './bits'
import { datasetShort, listJoin, monthLabel, plural, rangeLabel } from './format'
import WaterArt from './WaterArt'

/*
  Top of a hazard page (#events): what the page is, a few numbers about the
  data, and the event picker. Every word that depends on the data (the
  hazard's name, the period, the datasets, the forecast's question) comes from
  GET /hazards/:hazard and its event list, so it reads right for any hazard.
  Not lazy: it is the first thing on the page. Loads the hazard (shared with
  the forecast and method sections) and the event list (shared with the
  whole page through the context).
*/
export default function HazardIntro() {
  const { hazard, events, eventsStatus, eventsError, retryEvents } = useHazardPage()
  const hz = useHazard(hazard)
  const d = hz.data
  const label = d?.label || hazard
  const name = label.toLowerCase()

  return (
    <Card id="events" aria-labelledby="hzT" aria-busy={hz.status === 'loading' || eventsStatus === 'loading'} className="overflow-hidden">
      <div className="grid items-center gap-6 min-[820px]:grid-cols-[minmax(0,1fr)_minmax(0,340px)]">
        <div className="flex min-w-0 flex-col gap-3">
          <Kicker>Disaster · {label}</Kicker>
          <h1 id="hzT">Past {name}s, day by day</h1>
          {hz.status === 'error' ? (
            <SectionLoader error={hz.error} onRetry={hz.retry} className="min-h-[120px]" />
          ) : d ? (
            <>
              <Lede>{ledeText(d, events)}</Lede>
              <Numbers d={d} events={events} />
            </>
          ) : (
            <IntroSkeleton />
          )}
        </div>
        <WaterArt />
      </div>
      {d?.forecast && (
        <Note>
          A research result about past {name}s, not a warning service: the model was fitted to these events only. How it was checked, and
          how often it raises the alarm, is shown with the forecast below.
        </Note>
      )}
      <Picker events={events} status={eventsStatus} error={eventsError} retry={retryEvents} name={name} />
    </Card>
  )
}

// "10 flood events from Nov 2025 to Oct 2026 in 8 countries. For each: ..."
function ledeText(d, events) {
  const n = d.provides?.events?.count ?? events?.length
  const cov = d.coverage || {}
  const countries = cov.countries?.length
  const when = cov.from && cov.to ? ` from ${monthLabel(cov.from)} to ${monthLabel(cov.to)}` : ''
  const where = countries ? ` in ${plural(countries, 'country', 'countries')}` : ''
  const sources = (d.dataset?.datasets || []).map(datasetShort).filter(Boolean)
  const data = sources.length ? `the daily data of ${listJoin(sources)} over the area of the event` : 'its daily data over the area of the event'
  const fc = d.forecast
  const q = fc?.target?.label ? `“${fc.target.label}?”` : null
  const model = fc ? `, and a model's answer for every day${q ? ` to ${q}` : ''}: danger or not` : ''
  return `${n != null ? plural(n, `${d.label.toLowerCase()} event`) : `${d.label} events`}${when}${where}. For each one, ${data}${model}.`
}

function Numbers({ d, events }) {
  const days = events?.reduce((s, e) => s + (e.coverage?.days || 0), 0)
  const models = d.forecast ? Object.keys(d.forecast.models || {}).length : 0
  return (
    <div className="flex flex-wrap gap-2">
      <Stat label="Events" value={String(d.provides?.events?.count ?? events?.length ?? '–')} />
      <Stat label="Countries" value={String(d.coverage?.countries?.length ?? '–')} />
      <Stat label="Days of data" value={days ? String(days) : '–'} />
      {models > 0 && <Stat label="Forecast models" value={String(models)} />}
    </div>
  )
}

function IntroSkeleton() {
  return (
    <div className="flex flex-col gap-2.5" aria-hidden="true">
      <Skeleton className="h-[16px] w-[95%] rounded-full" />
      <Skeleton className="h-[16px] w-[88%] rounded-full" />
      <Skeleton className="h-[16px] w-[60%] rounded-full" />
      <div className="mt-1 flex gap-2">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-[56px] flex-1" />
        ))}
      </div>
    </div>
  )
}

// The event cards. Phones: one row that scrolls sideways (ten stacked cards
// would push everything else far down). Wider: a grid.
function Picker({ events, status, error, retry, name }) {
  const { eventId, setEventId } = useHazardPage()
  const rowRef = useRef(null)

  // Keep the selected card in view in the sideways row (when it was picked
  // elsewhere: the bar, the map). Scrolls the row only, never the page.
  useEffect(() => {
    const row = rowRef.current
    const el = row?.querySelector('[aria-pressed="true"]')
    if (!row || !el || row.scrollWidth <= row.clientWidth) return
    const left = el.offsetLeft - row.offsetLeft
    if (left < row.scrollLeft || left + el.offsetWidth > row.scrollLeft + row.clientWidth) row.scrollTo({ left: left - 12, behavior: 'smooth' })
  }, [eventId, events])

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="text-[21px]">Pick an event</h2>
        <span className="text-[13px] text-muted">Every section below follows the event you pick.</span>
      </div>
      {status === 'error' ? (
        <SectionLoader error={error} onRetry={retry} className="h-[150px]" />
      ) : !events ? (
        <div className="flex gap-3 overflow-hidden" aria-hidden="true">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-[150px] w-[250px] flex-none min-[640px]:flex-1" />
          ))}
        </div>
      ) : (
        <ul
          ref={rowRef}
          aria-label={`${name} events`}
          className={cx(
            // Sideways row on phones; the padding keeps the focus ring and shadows unclipped
            '-mx-1 flex snap-x snap-mandatory gap-3 overflow-x-auto px-1 pt-1 pb-2',
            'min-[640px]:mx-0 min-[640px]:grid min-[640px]:grid-cols-[repeat(auto-fill,minmax(240px,1fr))] min-[640px]:overflow-visible min-[640px]:px-0 min-[640px]:pt-0 min-[640px]:pb-0',
          )}
        >
          {events.map((e) => (
            <li key={e.id} className="flex w-[250px] flex-none snap-start min-[640px]:w-auto">
              <EventCard event={e} selected={e.id === eventId} onSelect={() => setEventId(e.id)} />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function EventCard({ event: e, selected, onSelect }) {
  const where = [e.country?.name, e.admin].filter(Boolean).join(' · ')
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={cx(
        'flex w-full cursor-pointer flex-col items-start gap-1.5 rounded-[16px] border-[1.5px] bg-surface2 px-3.5 py-3 text-left font-body transition-[border-color,background] duration-150',
        selected ? 'border-accent bg-accent-soft' : 'border-transparent hover:border-line',
      )}
    >
      <span className="flex w-full items-center justify-between gap-2">
        <span className="min-w-0 truncate text-[12.5px] font-semibold tracking-[.04em] text-muted uppercase">{where}</span>
        <RoleTag event={e} />
      </span>
      <span className="line-clamp-2 text-[15px] leading-snug font-semibold text-ink">{e.name}</span>
      <span className="font-mono text-[13px] text-ink">{rangeLabel(e.period?.start, e.period?.end)}</span>
      <span className={cx('line-clamp-2 text-[13px]', 'text-muted', !e.cause && 'italic')}>{e.cause || 'Cause not given in the sources'}</span>
    </button>
  )
}
