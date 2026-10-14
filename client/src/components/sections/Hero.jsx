import { useMemo } from 'react'
import { CITY_IDS, DATA, ser } from '../../lib/data'
import { ndviStatus } from '../../lib/stats'
import { css } from '../../lib/theme'
import { useApp } from '../../state/appContext'
import useThemeVersion from '../../hooks/useThemeVersion'
import Sparkline from '../common/Sparkline'
import { Chip, Kicker, Lede } from '../ui'

// City card button. The original used `all:unset`, so the native button look is
// stripped here explicitly (appearance, left-aligned text); font and colour are
// already inherited through Tailwind's preflight. The 2px transparent border
// turns accent when the card's city is selected, and the card lifts on hover.
// Focus uses the global :focus-visible outline, with the card's own radius.
const cardCls =
  'flex cursor-pointer appearance-none flex-col gap-1 rounded-[18px] border-2 border-transparent bg-surface px-3.5 pt-3.5 pb-2.5 text-left shadow-card ' +
  'transition-[transform,border-color] duration-150 ease-[ease] hover:transform-[translateY(-2px)] aria-pressed:border-accent'

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
    <section className="flex scroll-mt-[72px] flex-col gap-3.5 pt-2" id="home">
      <Kicker>Satellite vegetation and climate explorer</Kicker>
      <h1>A physics-informed Earth observation and AI platform to assess the environmental effects on local population health</h1>
      <Lede className="text-[18px]">See how green each city is, how that has changed since 2010, what weather drives it, and where it is heading. Pick a city to begin.</Lede>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(170px,1fr))] gap-3" id="shelf" role="group" aria-label="Choose a city">
        {CITY_IDS.map((c) => {
          const d = DATA.cities[c], st = status[c]
          return (
            <button key={c} type="button" className={cardCls} aria-pressed={c === city} onClick={() => setCity(c)}>
              <b className="font-display text-[20px] font-semibold">{d.name}</b>
              <span className="text-[13px] text-muted">{d.state}</span>
              <Chip tone={st.chip[0]}>{st.chip[1]}</Chip>
              <Sparkline className="mt-1 block h-[34px] w-full" data={ser(c, 'ndvi')} color={s1} />
            </button>
          )
        })}
      </div>
    </section>
  )
}
