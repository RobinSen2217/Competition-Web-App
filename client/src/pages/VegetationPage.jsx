import Footer from '../components/layout/Footer'
import Hero from '../components/sections/Hero'
import About from '../components/sections/About'
import Glance from '../components/sections/Glance'
import Sources from '../components/sections/Sources'
import Features from '../components/sections/Features'
import Why from '../components/sections/Why'
import Compare from '../components/sections/Compare'
import Science from '../components/sections/Science'
import Methods from '../components/sections/Methods'
import Faq from '../components/sections/Faq'
import Contact from '../components/sections/Contact'
import LazySection from '../components/common/LazySection'
import { SECTION_HEIGHTS } from '../lib/sectionHeights'
import { PageSection } from '../components/ui'

// The three heaviest sections are split into their own JS chunks (the map
// brings Leaflet). LazySection imports each when it comes near the viewport
// (`load`), with its error state and "Try again" if the download fails.
// Module-level functions, so they stay the same across renders.
const loadMap = () => import('../components/map/MapExplorer')
const loadPlot = () => import('../components/sections/PlotBuilder')
const loadForecast = () => import('../components/sections/ModelForecast')

// Placeholder heights: each card's real height by viewport width, measured
// (see lib/sectionHeights.js), so the page keeps its final length while
// sections mount and #anchor jumps land in the right place.
const H = SECTION_HEIGHTS

// The vegetation explorer ("/"). After the hero (title + city picker), the page
// is organised into eight parts, each a PageSection holding one or more cards.
// Links point at the cards' ids (about, glance, sources, features, why, compare,
// where, plot, mlforecast, science, methods, faq, contact); update Footer.jsx when
// renaming one.
//
// Data loads in reading order: startup fetched only the city list (lib/store.js
// bootstrap), and each data section is wrapped in a LazySection that mounts it
// ~800px before it scrolls into view; the section then loads what it needs,
// with an in-card loader meanwhile. Text-only sections render at once.
// The city can also be changed from the nav's picker (layout/CityPicker.jsx).
export default function VegetationPage() {
  return (
    <>
      {/* Page column: every block stacks with a 28px gap */}
      <main className="mx-auto flex max-w-[1180px] flex-col gap-7 px-5 pt-7 pb-16">
        {/* The city picked here drives every data section below. The hero
            loads only NDVI (every city) for its shelf, with its own skeleton. */}
        <Hero />
        <PageSection id="sec-about" title="About">
          <About />
        </PageSection>
        <PageSection id="sec-overview" title="Overview of data">
          <LazySection id="glance" heights={H.glance} label="Loading the city overview…">
            <Glance />
          </LazySection>
          <Sources />
        </PageSection>
        <PageSection id="sec-analysis" title="Data analysis">
          <LazySection id="features" heights={H.features} label="Loading the numbers…">
            <Features />
          </LazySection>
          <LazySection id="why" heights={H.why} label="Loading the drivers…">
            <Why />
          </LazySection>
          <LazySection id="compare" heights={H.compare} label="Loading the comparison…">
            <Compare />
          </LazySection>
        </PageSection>
        <PageSection id="sec-map" title="Map / Plot">
          {/* The map loads its basemap and the city's area detail itself (store hooks) */}
          <LazySection id="where" heights={H.where} label="Loading the map…" load={loadMap} />
          {/* Fetches only the selected parameters of the city itself */}
          <LazySection id="plot" heights={H.plot} label="Loading the plot builder…" load={loadPlot} />
        </PageSection>
        <PageSection id="sec-forecast" title="Forecast">
          {/* Loads its forecast itself (lib/forecasts.js), with its own loading state */}
          <LazySection id="mlforecast" heights={H.mlforecast} label="Loading the forecast…" load={loadForecast} />
        </PageSection>
        <PageSection id="sec-science" title="Science">
          <Science />
          <Methods />
        </PageSection>
        <PageSection id="sec-faq" title="FAQ">
          <Faq />
        </PageSection>
        <PageSection id="sec-contact" title="Contact us">
          <Contact />
        </PageSection>
      </main>
      <Footer />
    </>
  )
}
