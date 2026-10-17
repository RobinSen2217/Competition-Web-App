import { useSyncExternalStore } from 'react'

// Viewport width in CSS px (window.innerWidth, the width media queries use),
// re-read on resize. For sizes that must follow the layout's breakpoints in
// JS, such as the placeholder heights (lib/sectionHeights.js).
const subscribe = (fn) => {
  window.addEventListener('resize', fn)
  return () => window.removeEventListener('resize', fn)
}
const read = () => window.innerWidth

export default function useViewportWidth() {
  return useSyncExternalStore(subscribe, read, read)
}
