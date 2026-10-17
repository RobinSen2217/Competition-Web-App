import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Tailwind and the design tokens. Leaflet's CSS (and our overrides for it) is
// imported by components/map/MapExplorer.jsx, so it ships in the map's lazy chunk.
import './index.css'
import { bootstrap } from './lib/store'
import Boot from './Boot'

// Startup loads only the city list (lib/store.js bootstrap(): one small
// request, or the static fallback). Every section then fetches its own data
// when it nears the viewport, showing an in-card loader meanwhile.
//
// Modules that read the city list or the time axis at import time (lib/months.js
// builds YEARS from M) must not load before bootstrap()
// has finished. So App.jsx (and through it every component and lib module) is
// imported dynamically, only after it. Do not add static imports here other
// than CSS, React, lib/store and Boot (which, with the Loader, must itself stay
// free of data imports).
//
// (The import cannot start in parallel: importing evaluates those modules.)
// Loading starts right away, while React already shows the loader. Before any
// JS runs, #root shows a static copy of the loader from index.html.
const appReady = bootstrap().then(() => import('./App.jsx'))

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Boot appReady={appReady} />
  </StrictMode>,
)
