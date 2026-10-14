import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Stylesheet order matters: Tailwind (layered) -> Leaflet -> app styles (override both).
import './index.css'
import 'leaflet/dist/leaflet.css'
import './styles/app.css'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
