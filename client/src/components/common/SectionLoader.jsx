import { motion, useReducedMotion } from 'framer-motion'
import { cx, noteCls } from '../../styles/classes'
import { Btn } from '../ui'
import { LeafMark } from './Loader'

/*
  Loading states inside the page, in the look of the boot loader (Loader.jsx):
  the leaf logo and a thin sliding bar, made compact to sit inside a card.

  - <SectionLoader>  the body of a card while its data loads (or failed, with
                     a "Try again" button). Give it the body's usual height so
                     the card doesn't jump when the content arrives.
  - <Skeleton>       one grey block with a light sweeping across, for drawing
                     the rough shape of what is coming (rows, a chart, chips).
  - <CardSkeleton>   a whole card placeholder: header bars plus a SectionLoader.
                     LazySection shows it (static) until a section mounts, and
                     (animated) while a React.lazy section's code loads.

  Only opacity/transform animate, and nothing loops with "reduce motion" on
  (the loops are dropped entirely; MotionConfig alone would keep their fades).
  The colours are design tokens, so they follow light/dark and the blue
  disaster theme.
*/

const EASE = 'easeInOut'

// The sweep: a soft band of the --line colour gliding across a block. --line is
// darker than --surface2 in light mode and lighter in dark mode, so the band
// shows in both. It moves by its own width (transform only).
function Sheen() {
  return (
    <motion.span
      aria-hidden="true"
      className="pointer-events-none absolute inset-y-0 left-0 w-1/2 bg-[linear-gradient(90deg,transparent,color-mix(in_srgb,var(--line)_85%,transparent),transparent)]"
      initial={{ x: '-100%' }}
      animate={{ x: '200%' }}
      transition={{ duration: 1.6, ease: EASE, repeat: Infinity }}
    />
  )
}

/**
 * Grey placeholder block. Size and shape come from className
 * (e.g. "h-[14px] w-[40%] rounded-full").
 * @param {{ className?: string, animate?: boolean }} props  animate defaults to on
 *   (always off with reduce motion)
 */
export function Skeleton({ className, animate = true }) {
  const move = !useReducedMotion() && animate
  return (
    <span aria-hidden="true" className={cx('relative block overflow-hidden rounded-[10px] bg-surface2', className)}>
      {move && <Sheen />}
    </span>
  )
}

/**
 * Loading (or failed) state for a card's body.
 * @param {{ label?: string, className?: string, error?: Error | null,
 *   onRetry?: () => void, animate?: boolean }} props
 *   label: what is loading, read out by screen readers ("Loading rainfall…").
 *   className: size of the area, normally the body's usual height (h-[340px]).
 *   error: show the failure message and, with onRetry, a "Try again" button.
 *   animate: false for a still placeholder (nothing announced either).
 */
export function SectionLoader({ label = 'Loading…', className, error, onRetry, animate = true }) {
  const move = !useReducedMotion() && animate
  if (error) {
    return (
      <div className={cx('flex min-h-[160px] w-full items-center justify-center', className)}>
        <div className={cx(noteCls, 'flex max-w-[460px] flex-col items-start gap-3')} role="alert">
          <span>
            This part could not be loaded.{' '}
            {error.message ? <span className="break-words">({error.message})</span> : null}
          </span>
          {onRetry && (
            <Btn soft onClick={onRetry}>
              Try again
            </Btn>
          )}
        </div>
      </div>
    )
  }
  return (
    <div className={cx('relative flex min-h-[160px] w-full flex-col items-center justify-center gap-3 overflow-hidden rounded-[14px] bg-surface2', className)}>
      {move && <Sheen />}
      <LeafMark size={30} animate={move} className="relative" />
      {/* Same thin indeterminate bar as the boot loader, shorter */}
      <span className="relative block h-[3px] w-[72px] overflow-hidden rounded-full bg-line" aria-hidden="true">
        {move && (
          <motion.span
            className="block h-full w-2/5 rounded-full bg-accent"
            initial={{ x: '-100%' }}
            animate={{ x: '250%' }}
            transition={{ duration: 1.2, ease: EASE, repeat: Infinity }}
          />
        )}
      </span>
      {animate ? (
        <p role="status" className="relative text-[14px] text-muted">
          {label}
        </p>
      ) : (
        <p className="relative text-[14px] text-muted" aria-hidden="true">
          {label}
        </p>
      )}
    </div>
  )
}

/**
 * Placeholder with the shape of a Card: kicker, title and lede bars, then a
 * SectionLoader filling the rest. Carries the section's `id` (with the same
 * scroll margin as a Card) so #anchor links land on it before the real card
 * exists.
 * @param {{ ref?, id?: string, className?: string, style?: object, label?: string,
 *   animate?: boolean, error?: Error | null, onRetry?: () => void }} props
 *   className / style: sizing, normally the real card's height as a min-height.
 *   animate: false for a placeholder that is only waiting to be scrolled to
 *   (nothing is loading yet, so it is not marked busy either).
 */
export function CardSkeleton({ ref, id, className, style, label, animate = true, error, onRetry }) {
  return (
    <div
      ref={ref}
      id={id}
      style={style}
      // Busy only while something is actually loading: not for a placeholder
      // still waiting to be reached, and not once loading has failed
      aria-busy={animate && !error}
      className={cx('flex min-w-0 scroll-mt-[72px] max-[580px]:scroll-mt-[100px] flex-col gap-[18px] rounded-[22px] bg-surface p-[clamp(18px,3vw,30px)] shadow-card', className)}
    >
      <div className="flex flex-col gap-2.5">
        <Skeleton animate={false} className="h-[13px] w-[130px] rounded-full" />
        <Skeleton animate={false} className="h-[26px] w-[min(420px,80%)]" />
        <Skeleton animate={false} className="h-[14px] w-[min(640px,95%)] rounded-full" />
      </div>
      <SectionLoader label={label} animate={animate} error={error} onRetry={onRetry} className="flex-1" />
    </div>
  )
}
