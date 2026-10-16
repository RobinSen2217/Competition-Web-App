import { motion, useReducedMotion } from 'framer-motion'

/*
  Full-screen boot loader shown while main.jsx loads the data and the app code.

  It must not import anything that reads the data (lib/data and the modules
  built on it): it renders before initData() has finished.

  index.html shows a static copy of this screen (same logo, sizes and colours)
  before any JS runs, so the hand-over to React is invisible. Keep the two in
  step when changing either.

  It is fixed over the page, so when it fades out the app is already rendered
  underneath: a crossfade with no layout jump and no added wait.
*/

const EASE = 'easeInOut'

export default function Loader({ failed = false }) {
  // Looping animations are skipped entirely for reduced motion; MotionConfig
  // alone would still run the opacity part of every loop.
  // Nothing moves once loading has failed either: the message is final.
  const animate = !useReducedMotion() && !failed

  return (
    <motion.div
      // No fade-in: it replaces the identical static screen from index.html.
      initial={false}
      // pointer-events off at once so the app underneath is usable during the fade.
      exit={{ opacity: 0, pointerEvents: 'none', transition: { duration: 0.3, ease: 'easeOut' } }}
      className="fixed inset-0 z-[3000] grid place-items-center bg-page px-4"
    >
      <div className="flex flex-col items-center gap-4">
        {/* Same logo as the nav. The whole SVG sways a few degrees around its
            centre (only the leaf visibly turns, the circle is round) while the
            circle breathes. */}
        <motion.svg
          width="56"
          height="56"
          viewBox="0 0 30 30"
          aria-hidden="true"
          className="overflow-visible"
          animate={animate ? { rotate: [-6, 6, -6] } : undefined}
          transition={{ duration: 2.4, ease: EASE, repeat: Infinity }}
        >
          <motion.circle
            cx="15"
            cy="15"
            r="14"
            fill="var(--accent-soft)"
            animate={animate ? { scale: [1, 1.06, 1] } : undefined}
            transition={{ duration: 1.8, ease: EASE, repeat: Infinity }}
          />
          <path d="M9 20c0-7 5-11 13-12-1 8-5 13-12 13" fill="var(--accent)" />
          <path d="M10 21c3-4 6-7 10-10" stroke="var(--surface)" strokeWidth="1.4" fill="none" strokeLinecap="round" />
        </motion.svg>

        {/* Thin indeterminate progress bar: a short accent segment sliding across */}
        <div className="h-[3px] w-[120px] overflow-hidden rounded-full bg-line" aria-hidden="true">
          {animate && (
            <motion.div
              className="h-full w-2/5 rounded-full bg-accent"
              initial={{ x: '-100%' }}
              animate={{ x: '250%' }}
              transition={{ duration: 1.2, ease: EASE, repeat: Infinity }}
            />
          )}
        </div>

        <p role="status" className="text-center text-[15px] text-muted">
          {failed ? 'Could not load the data. Please reload the page.' : 'Loading satellite data…'}
        </p>
      </div>
    </motion.div>
  )
}
