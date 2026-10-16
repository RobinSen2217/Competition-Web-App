import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Tailwind and the design tokens first, then Leaflet's own CSS and our
// overrides for the elements Leaflet creates (must come after leaflet.css).
import './index.css'
import 'leaflet/dist/leaflet.css'
import './styles/leaflet.css'
import { initData } from './lib/data'

// Data modules must not be imported before initData() has finished: the data
// exports in lib/data.js are filled in by initData(), and modules such as
// lib/months.js read them at import time. So App.jsx (and through it every
// component and lib module) is imported dynamically, only after the data is in.
// Do not add static imports here other than CSS, React and lib/data.
// Until then #root shows the small loading message from index.html.
await initData()
const { default: App } = await import('./App.jsx')

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
