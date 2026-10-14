import AppProvider from './state/AppProvider'
import Nav from './components/layout/Nav'
import Footer from './components/layout/Footer'
import Hero from './components/sections/Hero'
import Glance from './components/sections/Glance'
import MapExplorer from './components/map/MapExplorer'
import PlotBuilder from './components/sections/PlotBuilder'
import Why from './components/sections/Why'
import Outlook from './components/sections/Outlook'
import Compare from './components/sections/Compare'
import Intro from './components/sections/Intro'
import Science from './components/sections/Science'
import Methods from './components/sections/Methods'
import Sources from './components/sections/Sources'
import Faq from './components/sections/Faq'

// One long page. Each section has an in-page anchor id: home, glance, where, plot,
// why, outlook, compare, intro, science, methods, sources, faq. Nav.jsx (links and
// scroll highlighting) and Footer.jsx each list a subset of these ids, so update
// them too when renaming a section.
export default function App() {
  return (
    <AppProvider>
      <Nav />
      {/* Page column: every section stacks with a 28px gap */}
      <main className="mx-auto flex max-w-[1180px] flex-col gap-7 px-5 pt-7 pb-16">
        {/* City picker and the data-driven sections all follow the selected city */}
        <Hero />
        <Glance />
        <MapExplorer />
        <PlotBuilder />
        <Why />
        <Outlook />
        <Compare />
        {/* Background reading */}
        <Intro />
        <Science />
        <Methods />
        <Sources />
        <Faq />
      </main>
      <Footer />
    </AppProvider>
  )
}
