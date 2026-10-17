import Footer from '../components/layout/Footer'
import Hero from '../components/sections/Hero'
import About from '../components/sections/About'
import Glance from '../components/sections/Glance'
import Sources from '../components/sections/Sources'
import Features from '../components/sections/Features'
import Why from '../components/sections/Why'
import Compare from '../components/sections/Compare'
import MapExplorer from '../components/map/MapExplorer'
import PlotBuilder from '../components/sections/PlotBuilder'
import Outlook from '../components/sections/Outlook'
import ModelForecast from '../components/sections/ModelForecast'
import Science from '../components/sections/Science'
import Methods from '../components/sections/Methods'
import Faq from '../components/sections/Faq'
import Contact from '../components/sections/Contact'
import { PageSection } from '../components/ui'

// The vegetation explorer ("/"). After the hero (title + city picker), the page
// is organised into eight parts, each a PageSection holding one or more cards.
// Links point at the cards' ids (about, glance, sources, features, why, compare,
// where, plot, outlook, mlforecast, science, methods, faq, contact); update Footer.jsx when
// renaming one.
export default function VegetationPage() {
  return (
    <>
      {/* Page column: every block stacks with a 28px gap */}
      <main className="mx-auto flex max-w-[1180px] flex-col gap-7 px-5 pt-7 pb-16">
        {/* The city picked here drives every data section below */}
        <Hero />
        <PageSection id="sec-about" title="About">
          <About />
        </PageSection>
        <PageSection id="sec-overview" title="Overview of data">
          <Glance />
          <Sources />
        </PageSection>
        <PageSection id="sec-analysis" title="Data analysis">
          <Features />
          <Why />
          <Compare />
        </PageSection>
        <PageSection id="sec-map" title="Map / Plot">
          <MapExplorer />
          <PlotBuilder />
        </PageSection>
        <PageSection id="sec-forecast" title="Forecast">
          <Outlook />
          <ModelForecast />
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
