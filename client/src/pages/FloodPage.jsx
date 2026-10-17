import { useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router'
import { useHazard, useHazardEvents } from '../lib/hazards'
import LazySection from '../components/common/LazySection'
import { PageSection } from '../components/ui'
import { HazardContext } from '../components/flood/context'
import HazardIntro from '../components/flood/HazardIntro'
import EventBar from '../components/flood/EventBar'
import { FLOOD_HEIGHTS as H } from '../components/flood/heights'

// The flood hazard page ("/disaster/flood"), rendered inside DisasterPage's
// page column (blue theme). Past flood events, each with its daily satellite
// rainfall and soil-moisture passes, and the notebook's model that marks each
// day as "danger" or not, with how that was scored.
//
// Nothing below is flood-specific except the HAZARD id: every section reads
// labels, units, parameters, models and thresholds from the API's hazard
// metadata (lib/hazards.js), so another hazard page is this file with another id.
//
// Data loads in reading order, as on the vegetation page: the intro loads the
// hazard and its event list; every other section sits in a LazySection that
// mounts it (and downloads its code: the map brings Leaflet) ~800px before it
// scrolls into view, and the section then loads the selected event's data
// with an in-card loader. Switching events reloads only what the mounted
// sections show, and each event is fetched once per visit.
const HAZARD = 'flood'

// Module-level, so LazySection gets the same function on every render
const loadMap = () => import('../components/flood/EventMap')
const loadParameters = () => import('../components/flood/ParameterCharts')
const loadForecast = () => import('../components/flood/ForecastPanel')
const loadMethod = () => import('../components/flood/MethodSources')

// The event shown first: the first held-out test event (the honest example of
// the model on data it never saw), else the first with a forecast, else the first.
function defaultEvent(events) {
  return (events.find((e) => e.forecast?.role === 'test') || events.find((e) => e.forecast?.available) || events[0])?.id ?? null
}

export default function FloodPage() {
  const [params, setParams] = useSearchParams()
  const eventsQ = useHazardEvents(HAZARD)
  const hazardQ = useHazard(HAZARD)

  // Oldest first, so the picker reads as a timeline
  const events = useMemo(
    () => (eventsQ.data ? [...eventsQ.data].sort((a, b) => (a.period?.start || '').localeCompare(b.period?.start || '') || a.id.localeCompare(b.id)) : undefined),
    [eventsQ.data],
  )
  // The event is kept in the URL (?event=<id>): shareable, survives a reload.
  // An unknown id (an old link) falls back to the default.
  const wanted = params.get('event')
  const eventId = events ? (events.some((e) => e.id === wanted) ? wanted : defaultEvent(events)) : null
  const setEventId = useCallback(
    (id) =>
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          next.set('event', id)
          return next
        },
        // replace: switching events is browsing within the page, not a new
        // page for the back button; preventScrollReset keeps the reader's place
        { replace: true, preventScrollReset: true },
      ),
    [setParams],
  )

  const ctx = useMemo(
    () => ({ hazard: HAZARD, eventId, setEventId, events, eventsStatus: eventsQ.status, eventsError: eventsQ.error, retryEvents: eventsQ.retry }),
    [eventId, setEventId, events, eventsQ.status, eventsQ.error, eventsQ.retry],
  )

  // A hazard without a forecast gets no forecast section; while the hazard is
  // still loading the section stays (it shows its own loader).
  const hasForecast = hazardQ.status !== 'ready' || !!hazardQ.data?.forecast

  return (
    <HazardContext value={ctx}>
      <HazardIntro />
      {/* Sticks under the nav, so the event can be changed from anywhere on the page */}
      <EventBar />
      <PageSection id="sec-hz-map" title="Where">
        <LazySection id="map" heights={H.map} label="Loading the map…" load={loadMap} />
      </PageSection>
      <PageSection id="sec-hz-params" title="What was measured">
        <LazySection id="parameters" heights={H.parameters} label="Loading the measurements…" load={loadParameters} />
      </PageSection>
      {hasForecast && (
        <PageSection id="sec-hz-forecast" title="Forecast and danger days">
          <LazySection id="forecast" heights={H.forecast} label="Loading the forecast…" load={loadForecast} />
        </PageSection>
      )}
      <PageSection id="sec-hz-method" title="Method and sources">
        <LazySection id="method" heights={H.method} label="Loading the method…" load={loadMethod} />
      </PageSection>
    </HazardContext>
  )
}
