import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Tailwind and the design tokens first, then Leaflet's own CSS and our
// overrides for the elements Leaflet creates (must come after leaflet.css).
import './index.css'
import 'leaflet/dist/leaflet.css'
import './styles/leaflet.css'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
