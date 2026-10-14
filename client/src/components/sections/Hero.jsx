import { useMemo } from 'react'
import { CITY_IDS, DATA, ser } from '../../lib/data'
import { ndviStatus } from '../../lib/stats'
import { css } from '../../lib/theme'
import { useApp } from '../../state/appContext'
import useThemeVersion from '../../hooks/useThemeVersion'
import Sparkline from '../common/Sparkline'

// Landing section: title, intro and the "shelf" of city cards. Each card shows
// the city's latest greenness status and a 3-year NDVI sparkline; clicking one
// selects that city for the whole page.
export default function Hero() {
  const { city, setCity } = useApp()
  // Subscribing re-renders this component on a theme change, so the css()
  // colour read below always matches the active palette.
  useThemeVersion()

  // Status chips depend only on the bundled data, so compute them once.
  const status = useMemo(() => Object.fromEntries(CITY_IDS.map((c) => [c, ndviStatus(c)])), [])

  const s1 = css('--s1')

  return (
    <section className="hero" id="home">
      <span className="kicker">Satellite vegetation and climate explorer</span>
      <h1>A physics-informed Earth observation and AI platform to assess the environmental effects on local population health</h1>
      <p className="lede">See how green each city is, how that has changed since 2010, what weather drives it, and where it is heading. Pick a city to begin.</p>
      <div className="shelf" id="shelf" role="group" aria-label="Choose a city">
        {CITY_IDS.map((c) => {
          const d = DATA.cities[c], st = status[c]
          return (
            <button key={c} type="button" className="citycard" aria-pressed={c === city} onClick={() => setCity(c)}>
              <b>{d.name}</b>
              <span className="st">{d.state}</span>
              <span className={'chip ' + st.chip[0]}>{st.chip[1]}</span>
              <Sparkline data={ser(c, 'ndvi')} color={s1} />
            </button>
          )
        })}
      </div>
    </section>
  )
}
