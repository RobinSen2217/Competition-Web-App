import { useEffect, useState } from 'react'
import { createBaseMap } from '../../lib/map/basemap'

// Owns the Leaflet map's lifetime. The map instance is kept in state (not just a
// ref) so that every effect that adds layers to it re-runs once it exists.
// `mosaics` (lib/store.js useBasemap()) loads on demand: until it is in, there
// is no map (null) and the caller shows a loader over the empty container.
// Under StrictMode the mount effect runs twice; map.remove() in the cleanup frees
// the container so the second L.map() call does not throw "Map container is
// already initialized".
export default function useBaseMap(elRef, mosaics, labOn) {
  const [base, setBase] = useState(null)

  useEffect(() => {
    if (!mosaics || !elRef.current) return
    const b = createBaseMap(elRef.current, mosaics)
    setBase(b)
    return () => {
      b.map.remove()
      setBase(null)
    }
  }, [elRef, mosaics])

  // Show the right photo mosaics / label sheets for the current view
  useEffect(() => {
    if (!base) return
    const sync = () => base.sync(labOn)
    sync()
    base.map.on('zoomend moveend', sync)
    return () => {
      base.map.off('zoomend moveend', sync)
    }
  }, [base, labOn])

  return base?.map ?? null
}
