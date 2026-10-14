import { useCallback, useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import { kmToSlider, sliderToKm, squareAround } from '../../lib/map/geometry'

/*
  State and map layers of the area planner: a draggable centre pin and the
  square it defines, used to pick coordinates for a new study area.
  Returns { plan, hwSlider, toggle, moveTo, setSlider }.
*/
export default function useAreaPlanner(map) {
  const [plan, setPlan] = useState({ on: false, lat: 0, lon: 0, hw: 5 })
  // The raw slider position is kept separately from plan.hw: hw is snapped to
  // round values, and deriving the slider from it would make the thumb jump.
  const [hwSlider, setHwSlider] = useState(() => kmToSlider(5))
  const layers = useRef(null)

  // Create the rectangle and pin once per map; they are only added while planning.
  useEffect(() => {
    if (!map) return
    const rect = L.rectangle([[0, 0], [0, 0]], { pane: 'shapes', color: '#4FB3FF', weight: 2.5, fillColor: '#4FB3FF', fillOpacity: 0.08, interactive: false })
    // The pin is plain HTML inside Leaflet's marker, so it is styled with Tailwind
    // classes in the string: a light-blue dot with a white ring
    const pin = L.marker([0, 0], {
      draggable: true,
      title: 'Drag to move the area',
      icon: L.divIcon({ className: '', html: '<div class="size-[18px] cursor-grab rounded-full border-[3px] border-white bg-[#4FB3FF] shadow-[0_1px_6px_rgba(0,0,0,.5)]"></div>', iconSize: [18, 18], iconAnchor: [9, 9] }),
    })
    pin.on('drag', (e) => {
      const ll = e.target.getLatLng()
      setPlan((p) => ({ ...p, lat: ll.lat, lon: ll.lng }))
    })
    layers.current = { rect, pin }
    return () => {
      rect.remove()
      pin.remove()
      pin.off()
      layers.current = null
    }
  }, [map])

  // Keep the shapes in sync with the plan
  useEffect(() => {
    const l = layers.current
    if (!l) return
    l.rect.setBounds(squareAround(plan.lat, plan.lon, plan.hw))
    // While the pin is being dragged it already sits at this position; setting
    // it again would fight the drag, so only move it when it is elsewhere.
    if (!l.pin.getLatLng().equals(L.latLng(plan.lat, plan.lon))) l.pin.setLatLng([plan.lat, plan.lon])
  }, [map, plan.lat, plan.lon, plan.hw])

  useEffect(() => {
    const l = layers.current
    if (!map || !l || !plan.on) return
    l.rect.addTo(map)
    l.pin.addTo(map)
    return () => {
      l.rect.remove()
      l.pin.remove()
    }
  }, [map, plan.on])

  // Starting puts the area in the middle of the current view and syncs the slider
  const toggle = useCallback(() => {
    if (!map) return
    if (plan.on) {
      setPlan((p) => ({ ...p, on: false }))
      return
    }
    const c = map.getCenter()
    setHwSlider(kmToSlider(plan.hw))
    setPlan((p) => ({ ...p, on: true, lat: c.lat, lon: c.lng }))
  }, [map, plan.on, plan.hw])

  const moveTo = useCallback((ll) => setPlan((p) => ({ ...p, lat: ll.lat, lon: ll.lng })), [])

  const setSlider = useCallback((v) => {
    setHwSlider(v)
    setPlan((p) => ({ ...p, hw: sliderToKm(v) }))
  }, [])

  return { plan, hwSlider, toggle, moveTo, setSlider }
}
