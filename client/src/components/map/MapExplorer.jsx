import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import L from 'leaflet'
import { BOUND, CITY_IDS, DATA, RAS, loadPixelValues } from '../../lib/data'
import { FIRST_YEAR, LAST_YEAR } from '../../lib/months'
import { css } from '../../lib/theme'
import { store } from '../../lib/storage'
import { boxB, pixelAt, REGION_CENTER } from '../../lib/map/geometry'
import { layerDef, mainSrc, notForCity, srcFor } from '../../lib/map/layers'
import { pixelPopupHtml, pointPopupHtml } from '../../lib/map/popups'
import { useApp } from '../../state/appContext'
import useThemeVersion from '../../hooks/useThemeVersion'
import useBaseMap from './useBaseMap'
import useYearPlayer from './useYearPlayer'
import useAreaPlanner from './useAreaPlanner'
import MapRail from './MapRail'
import AreaPlanner from './AreaPlanner'

/*
  Map explorer (section#where). A Leaflet map of the selected city on a
  self-hosted satellite basemap, with the district outline, the 10 × 10 km
  measurement box and markers for the other cities. Data layers (greenness by
  year, change, summer heat, Sentinel-2 extras) can be played through the years,
  swiped against each other, and clicked to inspect a single pixel. An area
  planner turns a dragged square into notebook settings.

  React renders the markup and holds the UI state; Leaflet objects are created
  and torn down imperatively in effects keyed on that state.
*/

const NO_OVERLAY = { main: null, left: null, swipe: false, followsYear: false, city: null }
// The swipe divider stays a little inside the edges so the handle is always grabbable
const clampX = (x) => Math.min(0.97, Math.max(0.03, x))

export default function MapExplorer() {
  const { city, setCity, focusSeq } = useApp()
  const theme = useThemeVersion()

  /* ---- UI state ---- */
  const [layer, setLayer] = useState(() => store.get('mlayer', 'green'))
  // A city-specific layer (Sentinel-2 for Jaisalmer) can't follow the user to
  // another city: fall back to greenness. Adjusting state during render (rather
  // than in an effect) means no frame is ever drawn with the invalid layer. It
  // is not persisted, matching the original.
  if (notForCity(layer, city)) setLayer('green')
  const [year, setYear] = useState(LAST_YEAR)
  const [ya, setYa] = useState(FIRST_YEAR)
  const [yb, setYb] = useState(LAST_YEAR)
  const [swipe, setSwipe] = useState(false)
  const [op, setOp] = useState(80)
  const [show, setShow] = useState({ labOn: true, allOn: true, pixOn: true })

  const d = layerDef(layer), isYear = d.id === 'green'
  // The swipe divider is shown only when there is an overlay for it to cut
  // (the original hid it when no main overlay existed).
  const hasOverlay = d.id !== 'none' && !!mainSrc(city, d.id, { swipe, year, yb })

  /* ---- refs to DOM nodes that Leaflet handlers update directly ---- */
  const mapEl = useRef(null)
  const curRef = useRef(null)
  const swipeElRef = useRef(null)
  const handleRef = useRef(null)

  const map = useBaseMap(mapEl, show.labOn)
  const { playing, start, stop } = useYearPlayer(year, setYear)
  const planner = useAreaPlanner(map)

  // Cursor coordinates. mousemove fires dozens of times a second, so the chip's
  // text is written straight to the DOM instead of going through React state,
  // which would re-render the whole section (rail included) on every move.
  useEffect(() => {
    if (!map) return
    const onMove = (e) => {
      if (curRef.current) curRef.current.textContent = `${e.latlng.lat.toFixed(4)}°N  ${e.latlng.lng.toFixed(4)}°E`
    }
    map.on('mousemove', onMove)
    return () => {
      map.off('mousemove', onMove)
    }
  }, [map])

  /* ---- city outline, measurement box and camera ---- */
  const distRef = useRef(null)
  useEffect(() => {
    if (!map) return
    const coral = css('--coral')
    const dist = L.geoJSON(BOUND[city], { pane: 'shapes', style: { color: coral, weight: 2.5, fill: true, fillOpacity: 0.04, fillColor: coral }, interactive: false }).addTo(map)
    const box = L.rectangle(boxB(city), { pane: 'shapes', color: '#F2C14E', weight: 2.5, dashArray: '6 5', fill: true, fillOpacity: 0.06, interactive: false }).addTo(map)
    distRef.current = dist
    return () => {
      dist.remove()
      box.remove()
      distRef.current = null
    }
  }, [map, city])

  // Camera: frame the box with some surroundings. Runs on every city pick, even
  // re-picking the current city (focusSeq bumps on each setCity), which recentres
  // the map and stops the year player, as in the original. Jump on first load,
  // fly afterwards.
  const fittedMap = useRef(null)
  useEffect(() => {
    if (!map) return
    stop()
    const target = L.latLngBounds(boxB(city)).pad(0.6)
    if (fittedMap.current !== map) {
      map.fitBounds(target)
      fittedMap.current = map
    } else {
      map.flyToBounds(target, { duration: 0.8 })
    }
  }, [map, city, focusSeq, stop])

  // The district colour is a theme token; restyle in place so a theme switch
  // doesn't move the map.
  useEffect(() => {
    const coral = css('--coral')
    distRef.current?.setStyle({ color: coral, fillColor: coral })
  }, [theme])

  // Markers for the other cities; clicking one selects it (and the map flies there).
  useEffect(() => {
    if (!map || !show.allOn) return
    const group = L.layerGroup().addTo(map)
    CITY_IDS.filter((x) => x !== city).forEach((x) => {
      const c = DATA.cities[x]
      L.circleMarker([c.lat, c.lon], { pane: 'shapes', radius: 7, color: '#fff', weight: 2, fillColor: '#1F6B47', fillOpacity: 1 })
        .bindTooltip(c.name, { direction: 'top', offset: [0, -6] })
        .on('click', () => setCity(x))
        .addTo(group)
    })
    return () => {
      group.remove()
    }
  }, [map, city, show.allOn, setCity])

  /* ---- data layer overlays ---- */
  // Current overlays plus how they were built, read by the year/opacity effects
  // and by updateSwipe (which also runs from Leaflet move events).
  const overlayRef = useRef(NO_OVERLAY)
  // Latest year/opacity for building new overlays. Changing either adjusts the
  // existing overlay in place instead of rebuilding it, which avoids a flash of
  // the bare photo while the new image loads. These effects are declared before
  // the build effect so the refs are fresh when it runs in the same commit.
  const yearRef = useRef(year)
  useEffect(() => {
    yearRef.current = year
    const o = overlayRef.current
    if (o.main && o.followsYear) o.main.setUrl(srcFor(o.city, 'green', year).url)
  }, [year])
  const opRef = useRef(op)
  useEffect(() => {
    opRef.current = op
    const o = overlayRef.current
    o.main?.setOpacity(op / 100)
    o.left?.setOpacity(op / 100)
  }, [op])

  // Swipe compare: the main overlay is clipped so it only shows right of the
  // divider, revealing what's under it on the left (the other year's overlay, or
  // the photo). clip-path works in the image's own pixels, so the divider's
  // screen x is converted to an offset from the image's left edge (the image is
  // panned/scaled by Leaflet and may extend past either side of the map), then
  // clamped to the image width. Runs on every map move/zoom so the cut stays put.
  // The divider position is a ref: dragging updates the DOM directly, without
  // re-rendering React on each pointer move.
  const swipeXRef = useRef(0.5)
  const updateSwipe = useCallback(() => {
    const { main, swipe: on } = overlayRef.current
    if (!map || !main) return
    const img = main.getElement()
    if (!img) return
    if (!on) {
      img.style.clipPath = ''
      return
    }
    const mc = map.getContainer().getBoundingClientRect(), x = mc.width * swipeXRef.current
    if (swipeElRef.current) swipeElRef.current.style.left = x + 'px'
    const ir = img.getBoundingClientRect(), cut = Math.max(0, Math.min(ir.width, mc.left + x - ir.left))
    img.style.clipPath = `inset(0 0 0 ${cut}px)`
    handleRef.current?.setAttribute('aria-valuenow', Math.round(swipeXRef.current * 100))
  }, [map])

  useEffect(() => {
    if (!map) return
    const ev = 'move zoom zoomend moveend resize viewreset'
    map.on(ev, updateSwipe)
    return () => {
      map.off(ev, updateSwipe)
    }
  }, [map, updateSwipe])

  // (Re)build the overlays whenever what is shown changes. Greenness in swipe
  // mode shows two years (ya left, yb right); otherwise one image follows the
  // year slider (greenness) or is static (other layers).
  useEffect(() => {
    if (!map) return
    const def = layerDef(layer), yearLayer = def.id === 'green'
    if (def.id === 'none') {
      updateSwipe()
      return
    }
    // Sharp pixels: nearest-neighbour scaling so each coarse MODIS cell reads as
    // a crisp square instead of a blur. The Sentinel-2 JPEGs are always smoothed.
    const className = show.pixOn && !def.img ? 'pixel-crisp' : ''
    const opts = { pane: 'index', opacity: opRef.current / 100, className, interactive: false }
    const main = mainSrc(city, def.id, { swipe, year: yearRef.current, yb })
    if (!main) {
      updateSwipe()
      return
    }
    let left = null
    if (yearLayer && swipe) {
      const ls = srcFor(city, 'green', ya)
      left = L.imageOverlay(ls.url, ls.b, opts).addTo(map)
    }
    // Added after `left` so it sits on top; the swipe clip reveals `left` beneath
    const mainL = L.imageOverlay(main.url, main.b, opts).addTo(map)
    overlayRef.current = { main: mainL, left, swipe, followsYear: yearLayer && !swipe, city }
    updateSwipe()
    return () => {
      mainL.remove()
      left?.remove()
      overlayRef.current = NO_OVERLAY
    }
  }, [map, city, layer, swipe, ya, yb, show.pixOn, updateSwipe])

  // Swipe handle: pointer drag (map panning is paused so the drag doesn't also
  // move the map) and arrow keys in 5 % steps.
  const dragging = useRef(false)
  const onHandleDown = (e) => {
    if (!map) return
    dragging.current = true
    e.currentTarget.setPointerCapture(e.pointerId)
    map.dragging.disable()
    e.preventDefault()
  }
  const onHandleMove = (e) => {
    if (!dragging.current || !map) return
    const mc = map.getContainer().getBoundingClientRect()
    swipeXRef.current = clampX((e.clientX - mc.left) / mc.width)
    updateSwipe()
  }
  const onHandleEnd = () => {
    if (!dragging.current) return
    dragging.current = false
    map?.dragging.enable()
  }
  const onHandleKey = (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    swipeXRef.current = clampX(swipeXRef.current + (e.key === 'ArrowLeft' ? -0.05 : 0.05))
    updateSwipe()
    e.preventDefault()
  }

  /* ---- pixel inspector and map clicks ---- */
  // Per-pixel values are a separate download per city. Prefetch on city change so
  // a click can usually open its popup at once; failures are ignored here and
  // retried on click.
  const pixVals = useRef({ city: null, vals: null })
  useEffect(() => {
    let live = true
    loadPixelValues(city).then(
      (vals) => {
        if (live) pixVals.current = { city, vals }
      },
      () => {},
    )
    return () => {
      live = false
    }
  }, [city])

  // A click whose popup is waiting on a fetch is cancelled by any later click or
  // by a change of city, layer or planning mode, so a late response can't open a
  // popup that no longer matches what the map shows.
  const clickSeq = useRef(0)
  useEffect(() => {
    clickSeq.current++
  }, [city, layer, planner.plan.on])

  // The click handler needs the latest city/layer/year/plan. Rather than
  // re-binding the Leaflet listener whenever any of them changes, the listener
  // calls whatever function this ref holds, refreshed after every render.
  const onClickRef = useRef(null)
  useLayoutEffect(() => {
    onClickRef.current = (e, alive) => {
      // While planning, a click moves the planned area instead of inspecting
      if (planner.plan.on) {
        planner.moveTo(e.latlng)
        return
      }
      const ll = e.latlng
      const seq = ++clickSeq.current
      const current = () => alive() && seq === clickSeq.current
      const open = (html) => L.popup({ maxWidth: 260 }).setLatLng(ll).setContent(html).openOn(map)
      const px = pixelAt(ll, layer, RAS[city])
      if (!px) {
        open(pointPopupHtml(ll, city))
        return
      }
      const build = (vals) => (vals ? pixelPopupHtml({ layerId: layer, row: px.row, col: px.col, vals, year }) : pointPopupHtml(ll, city))
      if (pixVals.current.city === city) {
        open(build(pixVals.current.vals))
        return
      }
      // Values not here yet: wait for them, or fall back to the coordinate popup
      loadPixelValues(city).then(
        (vals) => current() && open(build(vals)),
        () => current() && open(pointPopupHtml(ll, city)),
      )
    }
  })
  useEffect(() => {
    if (!map) return
    // `alive` stops a late pixel-value fetch from opening a popup on a removed map
    let alive = true
    const onClick = (e) => onClickRef.current?.(e, () => alive)
    map.on('click', onClick)
    return () => {
      alive = false
      map.off('click', onClick)
    }
  }, [map])

  /* ---- rail handlers ---- */
  const onLayer = (id) => {
    setLayer(id)
    store.set('mlayer', id)
    stop()
  }
  const onSwipe = (on) => {
    setSwipe(on)
    stop()
  }
  // Playing needs the single-year view, so it turns swipe off first
  const onPlay = () => {
    if (playing) {
      stop()
      return
    }
    if (swipe) setSwipe(false)
    start()
  }
  const onShow = (k, v) => setShow((s) => ({ ...s, [k]: v }))

  const fitBox = () => map?.flyToBounds(boxB(city), { padding: [30, 30], duration: 0.8 })
  const fitDist = () => distRef.current && map?.flyToBounds(distRef.current.getBounds(), { padding: [20, 20], duration: 0.8 })
  const fitRegion = () => map?.flyTo(REGION_CENTER, 6.5, { duration: 0.8 })

  return (
    <section className="card" id="where" aria-labelledby="mapT">
      <div className="head">
        <div>
          <span className="kicker">Map explorer</span>
          <h2 id="mapT">See where the city is greening or browning</h2>
          <p className="lede">Satellite numbers are averaged over the dashed yellow square, a 10 × 10 km box on the city centre, and the red line is the district. Turn on a layer to see every 250 m pixel, play the years, swipe between two years, or tap a pixel to see its own history.</p>
        </div>
      </div>
      <div className="mapbench">
        <div className="mapwrap">
          {/* Leaflet owns everything inside #map; React never renders children here */}
          <div id="map" ref={mapEl} role="application" aria-label="Satellite map of the selected city" />
          <div className="maptools">
            <button type="button" id="fitBox" onClick={fitBox}>Measurement box</button>
            <button type="button" id="fitDist" onClick={fitDist}>District</button>
            <button type="button" id="fitRegion" onClick={fitRegion}>Region</button>
          </div>
          {/* left and aria-valuenow are set by updateSwipe; React only gives the initial values */}
          <div className="swipe" id="swipe" ref={swipeElRef} hidden={!(swipe && hasOverlay)}>
            <span className="slab" id="swipeL" style={{ right: 10 }}>{isYear ? String(ya) : 'Photo'}</span>
            <span className="slab" id="swipeR" style={{ left: 10 }}>{isYear ? String(yb) : d.label}</span>
            <span
              className="handle"
              id="swipeHandle"
              ref={handleRef}
              role="slider"
              tabIndex={0}
              aria-label="Compare position"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={50}
              onPointerDown={onHandleDown}
              onPointerMove={onHandleMove}
              onPointerUp={onHandleEnd}
              onPointerCancel={onHandleEnd}
              onKeyDown={onHandleKey}
            >
              ⇔
            </span>
          </div>
          <span className="mapchip" id="mapcur" ref={curRef}>Move over the map</span>
        </div>
        <MapRail
          city={city}
          layer={layer}
          onLayer={onLayer}
          year={year}
          onYear={setYear}
          playing={playing}
          onPlay={onPlay}
          op={op}
          onOp={setOp}
          swipe={swipe}
          onSwipe={onSwipe}
          ya={ya}
          yb={yb}
          onYa={setYa}
          onYb={setYb}
          show={show}
          onShow={onShow}
        >
          <AreaPlanner plan={planner.plan} hwSlider={planner.hwSlider} onToggle={planner.toggle} onSlider={planner.setSlider} />
        </MapRail>
      </div>
      <div className="legendrow">
        <span><span className="sw" style={{ borderColor: 'var(--coral)' }} />District boundary</span>
        <span><span className="sq" />Measurement box (10 × 10 km)</span>
        <span id="pixPanel" className="xs" />
      </div>
    </section>
  )
}
