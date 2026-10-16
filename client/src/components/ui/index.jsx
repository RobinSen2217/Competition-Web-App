/*
  Shared building blocks of the design, styled with Tailwind. Sections compose
  these instead of repeating long class lists, so a change to e.g. how a pill
  looks happens in one place.

  Conventions used across the app:
  - Font sizes are pixel values (text-[14px]) because Tailwind's named sizes
    also set a line-height; the page inherits 1.55 from <body>.
  - Controls that set their whole font (buttons, selects) also use
    leading-[normal], matching the CSS `font:` shorthand of the original design.

  Motion (framer-motion): Card and the PageSection heading fade up the first
  time they scroll into view (see common/Reveal.jsx), and Pill, SegButton and Btn
  shrink slightly while pressed. Only opacity and transform are animated, so no
  layout moves. The props API of every component is unchanged.
*/

import { motion } from 'framer-motion'
// Class-string helpers (cx, noteCls, rangeCls, selectCls) live in styles/classes.js.
import { cx, noteCls, selectCls } from '../../styles/classes'
import Reveal from '../common/Reveal'

// Re-exported so sections can reveal their own blocks with the same motion.
export { default as Reveal } from '../common/Reveal'

// Press feedback shared by the buttons: a small, quick shrink while held.
const TAP = { scale: 0.97 }
const TAP_TRANSITION = { duration: 0.15, ease: 'easeOut' }

/* ---- section cards ---- */

// White rounded panel holding one section. `id`/aria props go on the <section>.
// Fades up on first scroll into view. Safe for the map and chart cards: only
// opacity/transform animate, so their measured width is right from the start.
export function Card({ className, children, ...props }) {
  return (
    <Reveal
      as="section"
      className={cx('flex min-w-0 scroll-mt-[72px] flex-col gap-[18px] rounded-[22px] bg-surface p-[clamp(18px,3vw,30px)] shadow-card', className)}
      {...props}
    >
      {children}
    </Reveal>
  )
}

// Title block of a card (kicker, heading, lede) with optional controls on the right.
// Every direct <div> child, including a div passed as `aside`, becomes a column of
// at most 720px, as in the original design; aside controls therefore stack.
export function CardHead({ children, aside }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2 [&>div]:flex [&>div]:max-w-[720px] [&>div]:min-w-0 [&>div]:flex-col [&>div]:gap-1.5">
      <div>{children}</div>
      {aside}
    </div>
  )
}

// Small green uppercase label above a heading.
export function Kicker({ className, children, ...props }) {
  return (
    <span className={cx('text-[13px] font-semibold tracking-[.06em] text-accent uppercase', className)} {...props}>
      {children}
    </span>
  )
}

// Muted intro paragraph under a heading.
export function Lede({ className, children, ...props }) {
  return (
    <p className={cx('max-w-[66ch] text-muted', className)} {...props}>
      {children}
    </p>
  )
}

/* ---- status ---- */

const CHIP_TONES = {
  good: 'bg-good-bg text-good',
  warn: 'bg-warn-bg text-warn',
  bad: 'bg-bad-bg text-bad',
  neutral: 'bg-neutral-bg text-muted',
}

// Rounded status label with a coloured dot. tone: good | warn | bad | neutral.
export function Chip({ tone = 'neutral', children }) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1.5 self-start rounded-full px-2.5 py-[3px] text-[12.5px] font-semibold whitespace-nowrap before:size-[7px] before:rounded-full before:bg-current before:content-['']",
        CHIP_TONES[tone],
      )}
    >
      {children}
    </span>
  )
}

/* ---- controls ---- */

// A labelled group of controls in a side rail: uppercase title, then the controls.
export function Group({ className, children, ...props }) {
  return (
    <div className={cx('flex flex-col gap-2', className)} {...props}>
      {children}
    </div>
  )
}
export function GroupTitle({ className, children, ...props }) {
  return (
    <span className={cx('text-[13px] font-semibold tracking-[.05em] text-muted uppercase', className)} {...props}>
      {children}
    </span>
  )
}

// Wrapping row of pills.
export function Pills({ className, children, ...props }) {
  return (
    <div className={cx('flex flex-wrap gap-1.5', className)} {...props}>
      {children}
    </div>
  )
}

// Toggle-style rounded button; `pressed` drives aria-pressed and the selected look.
// The hover border is skipped when pressed so the accent border stays.
export function Pill({ pressed = false, className, children, ...props }) {
  return (
    <motion.button
      type="button"
      whileTap={TAP}
      transition={TAP_TRANSITION}
      aria-pressed={pressed}
      className={cx(
        'inline-flex cursor-pointer items-center gap-[7px] rounded-full border-[1.5px] border-line bg-surface2 px-3 py-1.5 font-body text-[14px] leading-[normal] font-medium text-ink transition-[background,border-color] duration-150',
        'hover:[&:not([aria-pressed=true])]:border-faint aria-pressed:border-accent aria-pressed:bg-accent-soft aria-pressed:font-semibold',
        className,
      )}
      {...props}
    >
      {children}
    </motion.button>
  )
}

// Coloured dot inside a pill (e.g. the series colour of a selected parameter).
export function PillDot({ color }) {
  return <span className="size-[9px] rounded-full bg-line" style={color ? { background: color } : undefined} />
}

// Segmented control: a pill-shaped track of mutually exclusive buttons.
export function Seg({ className, children, ...props }) {
  return (
    <div className={cx('inline-flex flex-wrap gap-1 rounded-full border border-line bg-surface2 p-1', className)} {...props}>
      {children}
    </div>
  )
}
export function SegButton({ pressed = false, className, children, ...props }) {
  return (
    <motion.button
      type="button"
      whileTap={TAP}
      transition={TAP_TRANSITION}
      aria-pressed={pressed}
      className={cx(
        'cursor-pointer rounded-full border-0 bg-transparent px-[13px] py-1.5 font-body text-[13.5px] leading-[normal] font-semibold text-muted',
        'aria-pressed:bg-surface aria-pressed:text-ink aria-pressed:shadow-[0_1px_3px_rgba(0,0,0,.12)]',
        className,
      )}
      {...props}
    >
      {children}
    </motion.button>
  )
}

// Rounded action button; `soft` is the pale green variant.
export function Btn({ soft = false, className, children, ...props }) {
  return (
    <motion.button
      type="button"
      whileTap={TAP}
      transition={TAP_TRANSITION}
      className={cx(
        'inline-flex cursor-pointer items-center gap-2 rounded-full border-0 px-4 py-[9px] font-body text-[14px] leading-[normal] font-semibold hover:brightness-[1.06]',
        soft ? 'bg-accent-soft text-accent' : 'bg-accent text-on-accent',
        className,
      )}
      {...props}
    >
      {children}
    </motion.button>
  )
}

export function Select({ className, children, ...props }) {
  return (
    <select className={cx(selectCls, className)} {...props}>
      {children}
    </select>
  )
}

// Checkbox with a label. The margin is the browser default checkbox margin.
export function Toggle({ children, className, ...inputProps }) {
  return (
    <label className={cx('inline-flex cursor-pointer items-center gap-2 text-[14px] text-muted', className)}>
      <input type="checkbox" className="m-[3px_3px_3px_4px] size-4 accent-accent" {...inputProps} />
      {children}
    </label>
  )
}

/* ---- readouts and notes ---- */

// Grey strip of values for the hovered month: <ReadoutWhen> then <ReadoutItem>s.
export function Readout({ className, children, ...props }) {
  return (
    <div className={cx('flex min-h-[46px] flex-wrap items-baseline gap-x-[18px] gap-y-1.5 rounded-[14px] bg-surface2 px-3.5 py-2.5', className)} {...props}>
      {children}
    </div>
  )
}
export function ReadoutWhen({ className, children, ...props }) {
  return (
    <span className={cx('min-w-[86px] text-[15px] font-bold', className)} {...props}>
      {children}
    </span>
  )
}
// One label/value pair. Values go in <b>, which is styled as a mono number.
export function ReadoutItem({ className, children, ...props }) {
  return (
    <span className={cx('inline-flex items-center gap-[7px] text-[14px] text-muted [&_b]:font-mono [&_b]:font-medium [&_b]:text-ink', className)} {...props}>
      {children}
    </span>
  )
}
// Series colour dot used in readouts.
export function Swatch({ color }) {
  return <i className="inline-block size-[9px] rounded-full" style={{ background: color }} />
}

// Muted grey info box.
export function Note({ className, children, ...props }) {
  return (
    <p className={cx(noteCls, className)} {...props}>
      {children}
    </p>
  )
}

/* ---- page structure ---- */

// One top-level part of a page (About, Data Analysis ...): a large heading with
// a rule, then that part's cards. `id` names the heading for aria-labelledby;
// in-page links point at the cards' own ids.
// Only the heading row reveals here; the cards below reveal themselves, so
// nothing fades twice (nested opacity would make cards appear late and dim).
export function PageSection({ id, title, children }) {
  return (
    <section className="flex flex-col gap-7" aria-labelledby={id}>
      <Reveal className="flex items-center gap-4 pt-4">
        <h2 id={id} className="text-[clamp(26px,3vw,34px)] whitespace-nowrap">
          {title}
        </h2>
        <span className="h-px flex-1 bg-line" aria-hidden="true" />
      </Reveal>
      {children}
    </section>
  )
}
