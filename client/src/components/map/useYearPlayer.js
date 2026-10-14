import { useCallback, useEffect, useRef, useState } from 'react'
import { FIRST_YEAR, LAST_YEAR } from '../../lib/months'

// Plays the greenness layer through the years, one step per tick, and stops on
// the last year. Returns { playing, start, stop }.
export default function useYearPlayer(year, setYear) {
  const [playing, setPlaying] = useState(false)
  const timer = useRef(null)
  // The year the next tick advances from. A ref rather than the `year` state so
  // the interval callback never sees a stale closure; it also follows manual
  // slider moves made while playing, as the original did.
  const cursor = useRef(year)
  useEffect(() => {
    cursor.current = year
  }, [year])

  const stop = useCallback(() => {
    clearInterval(timer.current)
    timer.current = null
    setPlaying(false)
  }, [])

  const start = useCallback(() => {
    clearInterval(timer.current)
    // Starting from the end replays from the first year. The cursor goes one
    // before it so the first tick lands on FIRST_YEAR; the slider is not moved
    // to that out-of-range year.
    if (cursor.current >= LAST_YEAR) cursor.current = FIRST_YEAR - 1
    setPlaying(true)
    const delay = matchMedia('(prefers-reduced-motion: reduce)').matches ? 1600 : 850
    timer.current = setInterval(() => {
      const y = cursor.current >= LAST_YEAR ? FIRST_YEAR : cursor.current + 1
      cursor.current = y
      setYear(y)
      if (y === LAST_YEAR) stop()
    }, delay)
  }, [setYear, stop])

  // Never leave an interval running after unmount
  useEffect(() => () => clearInterval(timer.current), [])

  return { playing, start, stop }
}
