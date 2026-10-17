import { motion, useReducedMotion } from 'framer-motion'

/*
  Full-screen boot loader shown while main.jsx loads the city list (the store's
  bootstrap) and the app code. Sections load their own data later, with the
  compact in-card loader (SectionLoader.jsx), which reuses LeafMark below.

  It must not import anything that reads the data (lib/store's city list
  and time axis, lib/months and the modules built on them): it renders before bootstrap() has finished.

  index.html shows a static copy of this screen (same logo, sizes and colours)
  before any JS runs, so the hand-over to React is invisible. Keep the two in
  step when changing either.

  It is fixed over the page, so when it fades out the app is already rendered
  underneath: a crossfade with no layout jump and no added wait.
*/

const EASE = 'easeInOut'

// failed: loading (or, from Boot's error boundary, rendering) the app failed;
// shows `message` and a Reload button instead of the progress animation.
export default function Loader({ failed = false, message = 'Could not load the data.' }) {
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
        <LeafMark size={56} animate={animate} />

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

        <p role={failed ? 'alert' : 'status'} className="max-w-[420px] text-center text-[15px] text-muted">
          {failed ? `${message} Please reload the page.` : 'Loading satellite data…'}
        </p>
        {failed && (
          // A plain button: this screen must not depend on the app's UI kit
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="cursor-pointer rounded-full border-0 bg-accent px-4 py-[9px] font-body text-[14px] leading-[normal] font-semibold text-on-accent hover:brightness-[1.06]"
          >
            Reload
          </button>
        )}
      </div>
    </motion.div>
  )
}

// The app's leaf logo. While `animate`, the whole SVG sways a few degrees
// around its centre (only the leaf visibly turns, the circle is round) while
// the circle breathes. Shared with the in-card SectionLoader.
export function LeafMark({ size = 56, animate = true, className }) {
  return (
    <motion.svg
      width={size}
      height={size}
      viewBox="0 0 30 30"
      aria-hidden="true"
      className={className ? `overflow-visible ${className}` : 'overflow-visible'}
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
  )
}
