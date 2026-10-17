import { useEffect, useMemo, useRef, useState } from 'react'
import L from 'leaflet'
// Leaflet's stylesheet and the app's overrides travel with this lazily
// loaded chunk (FloodPage's LazySection `load`), as for the vegetation map.
import 'leaflet/dist/leaflet.css'
import '../../styles/leaflet.css'
import { getEventForecast, useEventLayers, useHazard } from '../../lib/hazards'
import { useResource } from '../../lib/store'
import { css } from '../../lib/theme'
import useThemeVersion from '../../hooks/useThemeVersion'
import { Btn, Card, CardHead, Group, GroupTitle, Kicker, Lede, Note, Seg, SegButton, Toggle } from '../ui'
import { SectionLoader } from '../common/SectionLoader'
import { cx } from '../../styles/classes'
import { useHazardPage } from './context'
import { Key, RoleTag, Stat } from './bits'
import { ROLES, listJoin, pct, plural, rangeLabel, roleOf, panelCls, panelTitle, CARD_SCROLL } from './format'

/*
  World map of the hazard's events (#map): each event's box (its bbox from
  the API) and a dot at its centre, since the boxes are tiny at world zoom.
  Clicking one selects it for the whole page. Colour by:
  - "Role in the model": training (out-of-fold), held-out test, left out;
  - "Danger days": the share of the event's days the default model flagged,
    one hue from light to dark. This needs every event's forecast, so it is
    loaded only when that view is picked (the forecasts are then cached for
    the forecast section too).
  The list beside the map does the same as the dots, for keyboard and screen
  reader users.

  The selected event's map layers (GET .../events/<id>/layers, loaded only
  for the selected event; most events have none) are drawn as image overlays
  under the boxes, with a panel below the map: a toggle, the legend, the
  numbers the API computed from the full-resolution source, and the API's own
  word on where the layer comes from. All of it is read from the layer (label,
  legend classes, stats per class), so a new layer or hazard needs no change.

  Basemap: OpenStreetMap tiles, darkened with a CSS filter in dark mode.
*/

// Leaflet pane of the event layers: between the tiles (200) and the event
// boxes (overlayPane, 400), so the boxes stay visible and clickable on top of
// an overlay, and without pointer events, so an overlay never eats a click.
const LAYER_PANE = 'hzLayers'

// Valid [[south, west], [north, east]]
const isBounds = (b) => Array.isArray(b) && b.length === 2 && b.every((p) => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite))

// 622.37 -> '622.4', 15.47 -> '15.5', 7208.61 -> '7,209'
const km2 = (v) => (Number.isFinite(v) ? `${v.toLocaleString('en', { maximumFractionDigits: v >= 1000 ? 0 : 1 })} km²` : '–')

// OpenStreetMap's standard tiles (free with attribution, no key). OSM has no
// dark style, so in dark mode the tile pane is inverted and hue-rotated back:
// land and water keep their hues, the background goes dark.
const TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'
const ATTRIBUTION = '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
const DARK_FILTER = 'invert(1) hue-rotate(180deg) brightness(0.95) contrast(0.85) saturate(0.6)'

// Dark tiles when the page is dark: an explicit data-theme wins, else the OS
function isDark() {
  const t = document.documentElement.getAttribute('data-theme')
  if (t) return t === 'dark'
  return matchMedia('(prefers-color-scheme: dark)').matches
}

// [w, s, e, n] -> Leaflet bounds
const boundsOf = (b) => L.latLngBounds([b[1], b[0]], [b[3], b[2]])

// Share of each event's days flagged as danger by the hazard's default model
async function dangerShares(hazard, events, model) {
  const out = {}
  await Promise.all(
    events
      .filter((e) => e.forecast?.available)
      .map(async (e) => {
        const fc = await getEventForecast(hazard, e.id)
        const cls = fc.models?.[model]?.class || []
        out[e.id] = cls.length ? cls.filter((c) => c === 'danger').length / cls.length : null
      }),
  )
  return out
}

export default function EventMap() {
  const { hazard, events, eventId, setEventId, eventsError, retryEvents } = useHazardPage()
  const hz = useHazard(hazard)
  const f = hz.data?.forecast
  const theme = useThemeVersion()
  const [mode, setMode] = useState('role')
  const [follow, setFollow] = useState(false) // zoom to the selected event
  const model = f?.defaultModel
  const dangerQ = useResource(mode === 'danger' && events && model ? `hz:dangershare:${hazard}:${model}` : null, () => dangerShares(hazard, events, model))
  // The selected event's layers. No keepPrevious: while the next event's
  // layers load, the previous event's overlay must not stay on the map.
  // The event list names each event's layers (coverage.layers), so an event
  // without any costs no request; an API without that field is asked anyway.
  const listed = events?.find((e) => e.id === eventId)?.coverage?.layers
  const layersQ = useEventLayers(hazard, events && (!Array.isArray(listed) || listed.length) ? eventId : null)
  const [showLayers, setShowLayers] = useState(true)

  const elRef = useRef(null)
  const [map, setMap] = useState(null)
  const tilesRef = useRef(null)

  // The map, once the list is in (it needs a sized container)
  const ready = !!events
  useEffect(() => {
    if (!ready || !elRef.current) return
    const m = L.map(elRef.current, { worldCopyJump: true, minZoom: 1, maxZoom: 12, zoomSnap: 0.5 }).setView([20, 30], 2)
    m.attributionControl.setPrefix(false)
    const pane = m.createPane(LAYER_PANE)
    pane.style.zIndex = 350
    pane.style.pointerEvents = 'none'
    tilesRef.current = L.tileLayer(TILES, { maxZoom: 19, attribution: ATTRIBUTION }).addTo(m)
    setMap(m)
    return () => {
      m.remove()
      tilesRef.current = null
      setMap(null)
    }
  }, [ready])

  // Light or dark tiles with the theme
  useEffect(() => {
    const pane = map?.getPane('tilePane')
    if (pane) pane.style.filter = isDark() ? DARK_FILTER : ''
  }, [theme, map])

  // Fill colour of each event in the current mode (resolved CSS colours:
  // Leaflet writes them as SVG attributes)
  const shares = mode === 'danger' && dangerQ.status === 'ready' ? dangerQ.data : null
  const styleOf = useMemo(() => {
    void theme // re-read the colours on a theme change
    const bad = css('--bad'), faint = css('--faint')
    return (e) => {
      if (mode === 'danger') {
        const s = shares?.[e.id]
        if (s == null) return { color: faint, fillOpacity: 0.35 }
        return { color: bad, fillOpacity: 0.12 + 0.83 * s }
      }
      return { color: css(roleOf(e).color), fillOpacity: 0.8 }
    }
  }, [mode, shares, theme])

  // The events: a box and a centre dot each; the selected one larger and ringed in ink
  useEffect(() => {
    if (!map || !events) return
    const group = L.layerGroup().addTo(map)
    const ink = css('--ink'), surface = css('--surface')
    for (const e of events) {
      if (!Array.isArray(e.bbox) || e.bbox.length !== 4) continue
      const sel = e.id === eventId
      const st = styleOf(e)
      const tip = `<b>${escapeHtml(e.name)}</b><br>${escapeHtml(e.country?.name || '')} · ${escapeHtml(rangeLabel(e.period?.start, e.period?.end))}`
      L.rectangle(boundsOf(e.bbox), { color: sel ? ink : st.color, weight: sel ? 2.5 : 1.5, fillColor: st.color, fillOpacity: Math.min(0.35, st.fillOpacity) })
        .bindTooltip(tip, { sticky: true })
        .on('click', () => setEventId(e.id))
        .addTo(group)
      const c = e.center || { lat: (e.bbox[1] + e.bbox[3]) / 2, lon: (e.bbox[0] + e.bbox[2]) / 2 }
      L.circleMarker([c.lat, c.lon], { radius: sel ? 10 : 7, color: sel ? ink : surface, weight: sel ? 3 : 2, fillColor: st.color, fillOpacity: Math.max(st.fillOpacity, 0.3) })
        .bindTooltip(tip, { direction: 'top', offset: [0, -8] })
        .on('click', () => setEventId(e.id))
        .addTo(group)
    }
    return () => group.remove()
  }, [map, events, eventId, styleOf, setEventId])

  // The selected event's layer images, while the toggle is on. Their colours
  // are baked into the images (legend colour + opacity), so they need no
  // theme handling; an image that fails to load just leaves the map as it was.
  const layerList = layersQ.status === 'ready' ? layersQ.data : null
  useEffect(() => {
    if (!map || !showLayers || !layerList?.length) return
    const group = L.layerGroup().addTo(map)
    for (const l of layerList) {
      if (!l.imageSrc || !isBounds(l.bounds)) continue
      L.imageOverlay(l.imageSrc, l.bounds, { pane: LAYER_PANE, interactive: false, alt: l.label || l.id }).addTo(group)
    }
    return () => group.remove()
  }, [map, layerList, showLayers])

  // View: every event (at first, and when "Show all" is pressed; picking an
  // event then leaves the reader's pan and zoom alone), or following the
  // selected event while "Zoom to the event" is on
  useEffect(() => {
    if (!map || !events?.length || follow) return
    map.fitBounds(L.latLngBounds(events.filter((e) => e.bbox).map((e) => boundsOf(e.bbox))), { padding: [30, 30], maxZoom: 4 })
  }, [map, events, follow])
  useEffect(() => {
    const sel = follow && events?.find((e) => e.id === eventId)
    if (map && sel?.bbox) map.flyToBounds(boundsOf(sel.bbox), { padding: [40, 40], maxZoom: 9, duration: 0.8 })
  }, [map, events, eventId, follow])

  const roles = useMemo(() => {
    const out = new Map()
    for (const e of events || []) {
      const r = e.forecast?.role || 'none'
      out.set(r, (out.get(r) || 0) + 1)
    }
    return [...out.entries()]
  }, [events])

  return (
    <Card id="map" style={CARD_SCROLL} aria-labelledby="hzMapT">
      <CardHead
        aside={
          <div className="flex-wrap items-center">
            <Seg role="group" aria-label="Colour the events by">
              <SegButton pressed={mode === 'role'} onClick={() => setMode('role')}>Role in the model</SegButton>
              {f && <SegButton pressed={mode === 'danger'} onClick={() => setMode('danger')}>Danger days</SegButton>}
            </Seg>
          </div>
        }
      >
        <Kicker>Map</Kicker>
        <h2 id="hzMapT">Where the events happened</h2>
        <Lede>
          Each box is the area the event's data covers. Click a box or a dot to look at that event; the selected one is larger and ringed.
        </Lede>
      </CardHead>
      {eventsError ? (
        <SectionLoader error={eventsError} onRetry={retryEvents} className="h-[440px]" />
      ) : !events ? (
        <SectionLoader label="Loading the events…" className="h-[440px]" />
      ) : (
        <div className="grid items-start gap-[18px] min-[901px]:grid-cols-[minmax(0,1fr)_280px]">
          {/* isolate: Leaflet's panes and controls (z-index up to 1000) stay
              inside the map instead of rising over the sticky nav and event bar */}
          <div className="relative isolate overflow-hidden rounded-2xl bg-surface2">
            <div ref={elRef} role="region" aria-label={`World map of the ${hz.data?.label?.toLowerCase() || ''} events`} className="h-[440px] w-full max-[600px]:h-[340px]" />
            <div className="absolute top-3 right-3 z-[1000] flex gap-1.5">
              <button
                type="button"
                aria-pressed={follow}
                onClick={() => setFollow((x) => !x)}
                className="cursor-pointer rounded-full border border-line bg-surface px-3 py-1.5 font-body text-[13px] leading-[normal] font-semibold text-ink shadow-card hover:bg-surface2 aria-pressed:bg-accent aria-pressed:text-on-accent"
              >
                {follow ? 'Show all events' : 'Zoom to the event'}
              </button>
            </div>
            {mode === 'danger' && dangerQ.status === 'loading' && (
              <p role="status" className="absolute bottom-3 left-3 z-[1000] rounded-full bg-surface px-3 py-1.5 text-[13px] text-muted shadow-card">
                Loading every event's forecast…
              </p>
            )}
          </div>
          {layerList?.some((l) => isBounds(l.bounds)) && (
            // Right under the map on phones (before the event list), full width
            // under map and list on wide screens (the list keeps row 1, col 2)
            <div className="flex flex-col gap-3 min-[901px]:col-span-2 min-[901px]:row-start-2">
              {layerList.filter((l) => isBounds(l.bounds)).map((l) => (
                <LayerPanel
                  key={l.id}
                  layer={l}
                  shown={showLayers}
                  onShow={setShowLayers}
                  onZoom={(x) => {
                    // Shows it too. "follow" is left as it is: turning it off
                    // would refit the map to every event over this zoom.
                    setShowLayers(true)
                    map?.flyToBounds(x.bounds, { padding: [20, 20], duration: 0.8 })
                    elRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
                  }}
                />
              ))}
            </div>
          )}
          <aside className="flex flex-col gap-4 min-[901px]:col-start-2 min-[901px]:row-start-1 min-[901px]:max-h-[440px] min-[901px]:overflow-auto" aria-label="Events on the map">
            <Group>
              <GroupTitle>{mode === 'danger' ? 'Days flagged danger' : 'Role in the model'}</GroupTitle>
              {mode === 'danger' ? (
                <DangerLegend q={dangerQ} model={f?.models?.[model]?.label} />
              ) : (
                <ul className="flex flex-col gap-1 text-[13.5px]">
                  {roles.map(([r, n]) => (
                    <li key={r} className="flex items-center justify-between gap-2">
                      <RoleTag event={{ forecast: { role: r === 'none' ? null : r } }} long className="text-[13.5px] font-medium text-ink" />
                      <span className="font-mono text-muted">{n}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Group>
            <Group>
              <GroupTitle>Events</GroupTitle>
              <ul className="grid gap-1 min-[560px]:max-[900px]:grid-cols-2">
                {events.map((e) => {
                  const s = shares?.[e.id]
                  return (
                    <li key={e.id}>
                      <button
                        type="button"
                        aria-pressed={e.id === eventId}
                        onClick={() => setEventId(e.id)}
                        className={cx(
                          'flex w-full cursor-pointer items-center gap-2 rounded-xl border-[1.5px] px-2.5 py-1.5 text-left font-body text-[13.5px] leading-snug',
                          e.id === eventId ? 'border-accent bg-accent-soft font-semibold' : 'border-transparent bg-surface2 hover:border-line',
                        )}
                      >
                        <span
                          className="size-[10px] flex-none rounded-full"
                          aria-hidden="true"
                          style={{ background: mode === 'danger' ? (s == null ? 'var(--faint)' : `color-mix(in srgb, var(--bad) ${Math.round(12 + 83 * s)}%, transparent)`) : `var(${roleOf(e).color})` }}
                        />
                        <span className="min-w-0 flex-1">
                          {e.name} <span className="text-muted">· {e.country?.name}</span>
                        </span>
                        {mode === 'danger' && <span className="font-mono text-[12.5px] text-muted">{s == null ? '–' : pct(s)}</span>}
                      </button>
                    </li>
                  )
                })}
              </ul>
            </Group>
          </aside>
        </div>
      )}
    </Card>
  )
}

// One map layer of the selected event: show/hide, legend, its numbers (whole
// image and inside the event box, for every class the image draws) and where
// it comes from. Everything is the API's (layer.legend, layer.stats,
// layer.source); the stats are counted at full resolution on the server, not
// from the downsampled image.
function LayerPanel({ layer, shown, onShow, onZoom }) {
  const drawn = (layer.legend || []).filter((c) => c.color)
  const st = layer.stats || {}
  const box = st.eventBox
  const note = layer.source?.provenanceNote
  return (
    <section className={panelCls} aria-label={`Map layer: ${layer.label || layer.id}`}>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <h3 className={panelTitle}>Map layer · {layer.label || layer.id}</h3>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <Toggle checked={shown} onChange={(e) => onShow(e.target.checked)}>
            Show on the map
          </Toggle>
          {/* At the map's world view a layer is a few pixels wide */}
          <Btn soft onClick={() => onZoom(layer)}>
            Zoom to this layer
          </Btn>
        </div>
      </div>
      {drawn.length > 0 && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[13.5px] text-muted">
          {drawn.map((c) => (
            <Key key={c.key} swatch={<span className="size-3 flex-none rounded-[3px]" style={{ background: c.color, opacity: c.opacity ?? 1 }} aria-hidden="true" />}>
              {c.label}
            </Key>
          ))}
          {/* Classes drawn transparent are still named, so a blank area reads as "not water" or "no label", not "no data" */}
          {(layer.legend || []).some((c) => !c.color) && <span>Clear: {listJoin((layer.legend || []).filter((c) => !c.color).map((c) => c.label.toLowerCase()))}</span>}
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {drawn.map((c) => {
          const all = st.classes?.[c.key]
          const inBox = box?.classes?.[c.key]
          return [
            <Stat key={`${c.key}-all`} onPanel label={`${c.label}, whole image`} value={km2(all?.areaKm2)} hint={all ? `${fmtPct(all.pctOfKnown)} of the labelled area` : null} />,
            box && <Stat key={`${c.key}-box`} onPanel label={`${c.label}, inside the event box`} value={km2(inBox?.areaKm2)} hint={inBox ? `${fmtPct(inBox.pctOfKnown)} of the labelled area` : null} />,
          ]
        })}
      </div>
      <p className="text-[13px] text-muted">
        {layer.description}
        {Number.isFinite(st.unknownPct) && ` ${fmtPct(st.unknownPct)} of the image has no label.`}
      </p>
      {(note || layer.time == null) && <Note>{note || 'The day this layer shows is not known.'}</Note>}
    </section>
  )
}

// Percent values the API already gives in % (pctOfKnown, unknownPct)
const fmtPct = (v) => (Number.isFinite(v) ? `${v < 1 ? v.toFixed(2) : v.toFixed(1)}%` : '–')

function DangerLegend({ q, model }) {
  if (q.status === 'error') return <SectionLoader error={q.error} onRetry={q.retry} className="min-h-[120px]" />
  return (
    <div className="flex flex-col gap-1.5 text-[13px] text-muted">
      <span className="h-3 w-full rounded-full bg-[linear-gradient(90deg,color-mix(in_srgb,var(--bad)_12%,transparent),var(--bad))]" aria-hidden="true" />
      <span className="flex justify-between font-mono">
        <span>0%</span>
        <span>100%</span>
      </span>
      <span>
        Share of each event's days that {model ? `“${model}”` : 'the default model'} flagged as danger. Grey: no forecast ({ROLES.excluded.label.toLowerCase()}).
      </span>
      {q.status === 'ready' && <span>{plural(Object.keys(q.data).length, 'event')} with a forecast.</span>}
    </div>
  )
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
}
