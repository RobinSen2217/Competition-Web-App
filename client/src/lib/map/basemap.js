import L from 'leaflet'
import { CITY_IDS, MAPMETA } from '../data'
import { REGION_CENTER } from './geometry'

/*
  Creates the Leaflet map with its own satellite basemap. There is no tile server:
  the photo is a stack of pre-rendered JPEG mosaics (one regional pair plus three
  zoom levels per city) with transparent place-name PNGs on top. sync() shows only
  the mosaics that are useful at the current zoom and near the current view, so
  the browser never loads all of them at once.

  Panes, bottom to top: base (200) photo, index (250) data layers,
  labels (300) place names, shapes (400) district/box/markers/planner.
*/
export function createBaseMap(el) {
  const map = L.map(el, {
    minZoom: 5,
    maxZoom: 17,
    zoomSnap: 0.5,
    wheelPxPerZoomLevel: 100,
    maxBounds: L.latLngBounds(MAPMETA.region[0].bounds).pad(0.1),
  }).setView(REGION_CENTER, 6)
  map.attributionControl.setPrefix(false).addAttribution('Imagery © Esri, Maxar, Earthstar Geographics · Boundaries: geoBoundaries')
  L.control.scale({ imperial: false, position: 'bottomright' }).addTo(map)
  for (const [i, p] of ['base', 'labels', 'shapes'].entries()) map.createPane(p).style.zIndex = 200 + i * 100
  // Labels sit above the data layers but must not swallow clicks meant for the map
  map.getPane('labels').style.pointerEvents = 'none'
  map.createPane('index').style.zIndex = 250

  // minZ: lowest zoom at which a photo mosaic is worth showing.
  // z: native zoom of a label sheet (labels are only legible near it).
  const base = [], labels = []
  const addMosaic = (meta, minZ) => {
    base.push({ l: L.imageOverlay(`/map/${meta.id}.jpg`, meta.bounds, { pane: 'base', interactive: false }), minZ })
    if (meta.labels) labels.push({ l: L.imageOverlay(`/map/${meta.id}_lab.png`, meta.bounds, { pane: 'labels', interactive: false }), z: meta.z })
  }
  addMosaic(MAPMETA.region[0], 0)
  addMosaic(MAPMETA.region[1], 7)
  CITY_IDS.forEach((c) => {
    const [a, b, d] = MAPMETA[c]
    addMosaic(a, 9)
    addMosaic(b, 12)
    addMosaic(d, 14)
  })

  const toggle = (l, want) => {
    if (want === map.hasLayer(l)) return
    if (want) l.addTo(map)
    else map.removeLayer(l)
  }
  // Called on every zoomend/moveend and when "Place names" changes.
  function sync(labOn) {
    // Pad the view so mosaics just off-screen are already loaded when panning
    const z = map.getZoom(), vb = map.getBounds().pad(0.3)
    base.forEach((b) => toggle(b.l, z >= b.minZ && vb.intersects(b.l.getBounds())))
    // Of the label sheets in view and within roughly a zoom level of their native
    // scale, show only the most detailed one so place names never double up.
    const cand = labels.filter((l) => l.z <= z + 1 && z <= l.z + 1.25 && vb.intersects(l.l.getBounds()))
    const bestZ = Math.max(-1, ...cand.map((l) => l.z))
    labels.forEach((l) => toggle(l.l, labOn && cand.includes(l) && l.z === bestZ))
  }

  return { map, sync }
}
