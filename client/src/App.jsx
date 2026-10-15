import { useEffect } from 'react'
import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation } from 'react-router'
import AppProvider from './state/AppProvider'
import Nav from './components/layout/Nav'
import VegetationPage from './pages/VegetationPage'
import DisasterPage from './pages/DisasterPage'

// Two pages under one nav bar:
//   /          vegetation explorer
//   /disaster  disaster module
// Unknown paths go back to the vegetation page. On Vercel, client/vercel.json
// rewrites every path to index.html so /disaster works when opened directly.
export default function App() {
  return (
    <AppProvider>
      <BrowserRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<VegetationPage />} />
            <Route path="disaster" element={<DisasterPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AppProvider>
  )
}

// Shared frame: the nav bar above whichever page is active.
function Layout() {
  return (
    <>
      <ScrollToTop />
      <Nav />
      <Outlet />
    </>
  )
}

// Switching tabs starts the new page at the top. Links to a section (#plot)
// are left alone so the browser can scroll to that section.
function ScrollToTop() {
  const { pathname, hash } = useLocation()
  useEffect(() => {
    if (!hash) window.scrollTo(0, 0)
  }, [pathname, hash])
  return null
}
