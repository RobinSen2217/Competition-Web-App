import { useEffect, useState } from 'react'
import { createBaseMap } from '../../lib/map/basemap'

// Owns the Leaflet map's lifetime. The map instance is kept in state (not just a
// ref) so that every effect that adds layers to it re-runs once it exists.
// Under StrictMode the mount effect runs twice; map.remove() in the cleanup frees
// the container so the second L.map() call does not throw "Map container is
// already initialized".
export default function useBaseMap(elRef, labOn) {
  const [base, setBase] = useState(null)

  useEffect(() => {
    const b = createBaseMap(elRef.current)
    setBase(b)
    return () => {
      b.map.remove()
      setBase(null)
    }
  }, [elRef])

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
