import { useMemo } from 'react'
import { CITIES, CITY_IDS, useTimeseries } from '../../lib/store'
import { ndviStatus } from '../../lib/stats'
import { css } from '../../lib/theme'
import { useApp } from '../../state/appContext'
import useThemeVersion from '../../hooks/useThemeVersion'
import Sparkline from '../common/Sparkline'
import { Skeleton } from '../common/SectionLoader'
import { cx, noteCls } from '../../styles/classes'
import { Btn, Chip, Kicker, Lede } from '../ui'

// City card button. The original used `all:unset`, so the native button look is
// stripped here explicitly (appearance, left-aligned text); font and colour are
// already inherited through Tailwind's preflight. The 2px transparent border
// turns accent when the card's city is selected, and the card lifts on hover.
// Focus uses the global :focus-visible outline, with the card's own radius.
const cardCls =
  'flex cursor-pointer appearance-none flex-col gap-1 rounded-[18px] border-2 border-transparent bg-surface px-3.5 pt-3.5 pb-2.5 text-left shadow-card ' +
  'transition-[transform,border-color] duration-150 ease-[ease] hover:transform-[translateY(-2px)] aria-pressed:border-accent'

// NDVI of every city: all the shelf draws. One request at startup; later
// sections asking for NDVI reuse it from the store's cache.
const SHELF_PARAMS = ['ndvi']

// Landing section: title, intro and the "shelf" of city cards. Each card shows
// the city's latest greenness status and a 3-year NDVI sparkline; clicking one
// selects that city for the whole page.
//
// The title and the city buttons render at once (names come from the startup
// city list), so a city can be picked before the greenness arrives; only each
// card's chip and sparkline wait for the data (see ShelfSkeleton).
export default function Hero() {
  const { city, setCity } = useApp()
  const { data, status, error, retry } = useTimeseries({ areas: '*', parameters: SHELF_PARAMS })
  // Subscribing re-renders this component on a theme change, so the css()
  // colour read below always matches the active palette.
  useThemeVersion()

  // Status chips depend only on the loaded series, so compute them once per load.
  const chips = useMemo(
    () => data && Object.fromEntries(CITY_IDS.map((c) => [c, data[c]?.ndvi ? ndviStatus(data[c].ndvi).chip : null])),
    [data],
  )

  if (status !== 'ready') return <HeroSkeleton error={status === 'error' ? error : null} onRetry={retry} />

  const s1 = css('--s1')

  return (
    <HeroFrame>
      {CITY_IDS.map((c) => {
        const d = CITIES[c], chip = chips[c]
        return (
          <button key={c} type="button" className={cardCls} aria-pressed={c === city} onClick={() => setCity(c)}>
            <b className="font-display text-[20px] font-semibold">{d.name}</b>
            <span className="text-[13px] text-muted">{d.state}</span>
            {/* A city without NDVI keeps the card's height with a neutral chip */}
            <Chip tone={chip ? chip[0] : 'neutral'}>{chip ? chip[1] : 'No data'}</Chip>
            <Sparkline className="mt-1 block h-[34px] w-full" data={data[c]?.ndvi || []} color={s1} />
          </button>
        )
      })}
    </HeroFrame>
  )
}

// The hero while the shelf's NDVI series load. Names and states are known from
// the startup city list, so the cards are already real buttons: a city can be
// picked before its status arrives. Only the chip and sparkline are
// placeholders, in their real sizes, so nothing moves when the data comes in.
// After a failed load the placeholders stand still and a note under the shelf
// offers a retry.
function HeroSkeleton({ error = null, onRetry }) {
  const { city, setCity } = useApp()
  const animate = !error
  return (
    <HeroFrame busy={!error}>
      {CITY_IDS.map((c) => {
        const d = CITIES[c]
        return (
          <button key={c} type="button" className={cardCls} aria-pressed={c === city} onClick={() => setCity(c)}>
            <b className="font-display text-[20px] font-semibold">{d.name}</b>
            <span className="text-[13px] text-muted">{d.state}</span>
            <Skeleton animate={animate} className="h-[25px] w-[130px] self-start rounded-full" />
            <Skeleton animate={animate} className="mt-1 h-[34px] w-full rounded-[8px]" />
          </button>
        )
      })}
      {error && (
        <div className={cx(noteCls, 'col-span-full flex flex-wrap items-center gap-3')} role="alert">
          <span>
            The cities' greenness could not be loaded. <span className="break-words">({error.message})</span>
          </span>
          {onRetry && (
            <Btn soft onClick={onRetry}>
              Try again
            </Btn>
          )}
        </div>
      )}
    </HeroFrame>
  )
}

// Title, intro and the shelf grid, shared by the hero and its loading state.
function HeroFrame({ busy = false, children }) {
  return (
    <section className="flex scroll-mt-[72px] max-[580px]:scroll-mt-[100px] flex-col gap-3.5 pt-2" id="home">
      <Kicker>Satellite vegetation and climate explorer</Kicker>
      <h1>A physics-informed Earth observation and AI platform to assess the environmental effects on local population health</h1>
      <Lede className="text-[18px]">See how green each city is, how that has changed since 2010, what weather drives it, and where it is heading. Pick a city to begin.</Lede>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(170px,1fr))] gap-3" id="shelf" role="group" aria-label="Choose a city" aria-busy={busy}>
        {children}
      </div>
      {busy && (
        <span role="status" className="sr-only">
          Loading each city's greenness…
        </span>
      )}
    </section>
  )
}
