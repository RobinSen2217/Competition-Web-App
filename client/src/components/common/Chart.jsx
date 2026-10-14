import { useLayoutEffect, useRef } from 'react'
import { drawChart } from '../../lib/chart'
import useElementWidth from '../../hooks/useElementWidth'
import useThemeVersion from '../../hooks/useThemeVersion'
import { cx } from '../../styles/classes'

/*
  React wrapper around drawChart.
  - options: (width) => chart options (see lib/chart.js). Memoise it with useCallback
    so the chart only redraws when its inputs change, not on every hover.
  - hover:   x value to highlight (shared crosshair across panels), or null.
  - onHover: called with the x under the pointer, or null on leave.
  - tall:    340px instead of 180px.
*/
export default function Chart({ options, hover = null, onHover, tall = false }) {
  const elRef = useRef(null)
  const apiRef = useRef(null)
  const onHoverRef = useRef(onHover)
  const hoverRef = useRef(hover)
  const drawn = useRef(null) // inputs of the last draw, to skip identical redraws
  const width = useElementWidth(elRef)
  const theme = useThemeVersion()
  const hasHover = !!onHover

  // Mirror the latest onHover/hover into refs on every commit, so the draw effect
  // can use them without listing them as deps (a new onHover identity or a hover
  // move must not rebuild the SVG). drawChart's pointer listener calls through
  // onHoverRef, and after a redraw (width, theme or options change) the current
  // crosshair is re-applied from hoverRef. Keep this effect above the draw effect
  // so the refs are fresh when it runs.
  useLayoutEffect(() => {
    onHoverRef.current = onHover
    hoverRef.current = hover
  })

  useLayoutEffect(() => {
    const el = elRef.current
    const w = el.clientWidth || 600
    // The width state starts at 0 and catches up right after mount; that update
    // would otherwise draw the same chart a second time.
    const d = drawn.current
    if (d && d.options === options && d.w === w && d.theme === theme && d.hasHover === hasHover) return
    drawn.current = { options, w, theme, hasHover }
    const o = options(w)
    apiRef.current = drawChart(el, hasHover ? { ...o, onHover: (x) => onHoverRef.current?.(x) } : o)
    apiRef.current?.setHover(hoverRef.current)
  }, [options, width, theme, hasHover])

  useLayoutEffect(() => {
    apiRef.current?.setHover(hover)
  }, [hover])

  // The SVG is injected by drawChart, so it is styled from the container.
  // data-chart marks chart containers for the PNG export.
  return (
    <div
      ref={elRef}
      data-chart=""
      className={cx('relative w-full', tall ? 'h-[340px]' : 'h-[180px]', '[&_svg]:block [&_svg]:size-full [&_svg]:touch-pan-y [&_svg]:overflow-visible')}
    />
  )
}
