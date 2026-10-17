import { Suspense, createElement, lazy, useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router'
import { CardSkeleton } from './SectionLoader'
import ErrorBoundary from './ErrorBoundary'
import { isChunkError, reloadPage } from '../../lib/chunkError'
import { heightAt } from '../../lib/sectionHeights'
import useViewportWidth from '../../hooks/useViewportWidth'

/*
  Mounts a section only when it comes near the viewport, so the page loads its
  data (and, for code-split sections, its code) in reading order instead of all
  at startup.

    <LazySection id="glance" heights={H.glance} label="Loading the city overview…">
      <Glance />
    </LazySection>
    // Code-split: pass the import instead of children
    <LazySection id="plot" heights={H.plot} label="Loading the plot builder…" load={() => import('../components/sections/PlotBuilder')} />

  - Until then it renders a still CardSkeleton with the section's `id` and the
    real card's height at the current viewport width (`heights`, a table from
    lib/sectionHeights.js), so the page keeps its final length (no jumps while sections
    mount above you) and #anchor links have something to land on.
  - It mounts ROOT_MARGIN (800px) before the section scrolls into view, so the
    data is usually there by the time the reader arrives. Once mounted it stays
    mounted (state such as chosen parameters survives scrolling away).
  - `load`: the section's module (default export) is imported at mount, with
    the same skeleton (animated) while the code downloads. Keep the function
    stable (define it at module level) or the section remounts.
  - Errors: a section that throws while rendering, or whose code fails to
    download (the site was redeployed and the old chunk is gone, or the network
    dropped), shows the skeleton's error state with "Try again" instead of
    taking the whole page down. For a failed download "Try again" imports the
    code again; if that fails too it reloads the page at this section (the new
    index.html knows the new chunk names). Any other error just re-renders it.
  - When the URL's #hash names this section (a link like #plot, a footer link,
    or opening the page with it), it mounts at once and keeps the section
    aligned while content above it settles (see keepInView).
  - The real card must carry the same id (Card id="plot"): the skeleton's id
    disappears when the section mounts, so ids are never duplicated.
*/

const ROOT_MARGIN = '800px 0px'

const targets = (id, hash) => !!id && hash === `#${id}`

// One React.lazy component per `load` function, made on first use and kept
// for the page's lifetime (so leaving the page and coming back does not
// download or remount anything twice). A retry after a failed download
// deletes the entry, because a lazy component that failed once stays failed.
const lazies = new Map()
function lazyFor(load) {
  if (!lazies.has(load)) lazies.set(load, lazy(load))
  return lazies.get(load)
}

// Messages for the error card. A failed download gets a plain explanation
// instead of the browser's message (a long chunk URL).
const CODE_ERROR = new Error('its code could not be downloaded; the site may have been updated since you opened it')

export default function LazySection({ id, heights, className, label = 'Loading…', rootMargin = ROOT_MARGIN, load, children }) {
  const { hash } = useLocation()
  // Without IntersectionObserver (very old browsers) mount everything at once
  const [mounted, setMounted] = useState(() => typeof IntersectionObserver === 'undefined' || targets(id, window.location.hash))
  const ref = useRef(null)
  const vw = useViewportWidth()
  // Bumped by "Try again": remounts the error boundary (and so the section)
  const [attempt, setAttempt] = useState(0)
  const [retrying, setRetrying] = useState(false)
  // Mount on approach
  useEffect(() => {
    if (mounted || !ref.current) return
    const io = new IntersectionObserver((list) => list.some((e) => e.isIntersecting) && setMounted(true), { rootMargin })
    io.observe(ref.current)
    return () => io.disconnect()
  }, [mounted, rootMargin])

  // Mount when the hash names this section. React Router's location covers
  // in-app navigation; the hashchange listener covers plain <a href="#id">
  // links in browsers whose fragment jumps don't reach the router.
  useEffect(() => {
    const check = () => {
      if (!targets(id, window.location.hash)) return
      setMounted(true)
      keepInView(id)
    }
    check()
    window.addEventListener('hashchange', check)
    return () => window.removeEventListener('hashchange', check)
  }, [id, hash])

  const retry = async (error) => {
    if (load && isChunkError(error)) {
      setRetrying(true)
      try {
        // Try the download once more (a dropped connection); if the browser
        // still cannot get the file, only a reload with the new index.html helps.
        await load()
      } catch {
        reloadPage(id)
        return
      }
      // A lazy component that failed once stays failed: make a new one
      lazies.delete(load)
      setRetrying(false)
    }
    setAttempt((n) => n + 1)
  }

  // min-height inline: the measured height for this exact width (see heightAt)
  const style = heights ? { minHeight: heightAt(heights, vw) } : undefined
  const placeholder = (props) => <CardSkeleton ref={ref} id={id} className={className} style={style} label={label} {...props} />

  if (!mounted) return placeholder({ animate: false })
  if (retrying) return placeholder({ animate: true })
  return (
    <ErrorBoundary
      key={attempt}
      fallback={({ error }) => placeholder({ error: load && isChunkError(error) ? CODE_ERROR : error, onRetry: () => retry(error) })}
    >
      {/* createElement: the component comes from the lazyFor cache, not
          from this render (the JSX form trips the static-components lint) */}
      <Suspense fallback={placeholder({ animate: true })}>{load ? createElement(lazyFor(load)) : children}</Suspense>
    </ErrorBoundary>
  )
}

/*
  Keeps the element with this id at its scroll position (top + its
  scroll-margin) for a short while after an anchor jump. Sections above it
  mount and swap loaders for content in that time, which can push it down;
  browsers with scroll anchoring compensate on their own, Safari does not.

  It never fights a scroll in progress: it acts only once scrolling has been
  idle for 150 ms (so the browser's smooth anchor scroll finishes first), and
  it stops for good at the reader's first wheel, touch, key or pointer press.
*/
const KEEP_MS = 2500
const IDLE_MS = 150
const USER_INPUT = ['wheel', 'touchstart', 'keydown', 'pointerdown']
let stopKeeping = null

function keepInView(id) {
  stopKeeping?.()
  const t0 = performance.now()
  let lastScroll = 0, raf = 0
  const onScroll = () => {
    lastScroll = performance.now()
  }
  const stop = () => {
    cancelAnimationFrame(raf)
    window.removeEventListener('scroll', onScroll)
    USER_INPUT.forEach((t) => window.removeEventListener(t, stop))
    if (stopKeeping === stop) stopKeeping = null
  }
  const tick = (now) => {
    if (now - t0 > KEEP_MS) return stop()
    const el = document.getElementById(id)
    if (el && now - lastScroll > IDLE_MS) {
      const want = parseFloat(getComputedStyle(el).scrollMarginTop) || 0
      const off = el.getBoundingClientRect().top - want
      // 'instant': the page sets scroll-behavior: smooth, which would make
      // every small correction a visible glide
      if (Math.abs(off) > 2) window.scrollBy({ top: off, behavior: 'instant' })
    }
    raf = requestAnimationFrame(tick)
  }
  window.addEventListener('scroll', onScroll, { passive: true })
  USER_INPUT.forEach((t) => window.addEventListener(t, stop, { passive: true }))
  stopKeeping = stop
  raf = requestAnimationFrame(tick)
}
