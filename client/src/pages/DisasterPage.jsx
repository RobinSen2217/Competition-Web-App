import { Outlet } from 'react-router'

// The disaster module ("/disaster/*"): a layout for one sub-page per hazard
// (only /disaster/flood so far). It holds the page column shared by every
// hazard, the same column as the vegetation page; the hazard page renders
// inside it. While any of these pages is shown the palette is blue (see
// hooks/useModuleTheme.js and the "Module themes" part of index.css).
export default function DisasterPage() {
  return (
    <main className="mx-auto flex max-w-[1180px] flex-col gap-7 px-5 pt-7 pb-16">
      <Outlet />
    </main>
  )
}
