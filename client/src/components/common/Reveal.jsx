import { motion } from 'framer-motion'
import { REVEAL_VIEWPORT, fadeUp } from './motionPresets'

/*
  Fade-up reveal used across the site: an element starts slightly lower and
  transparent and settles into place the first time it scrolls into view.

  Only opacity and transform are animated, never size, so the element keeps its
  final layout box from the first frame. That matters for the cards holding the
  Leaflet map and the charts: they measure their container width on mount, and a
  height/width animation would make them measure the wrong size. A transform
  does not change clientWidth, so they measure correctly while it plays.

  With <MotionConfig reducedMotion="user"> at the root, users who ask for reduced
  motion get the opacity fade only, without the movement.
*/

// Element types Reveal can render. Looked up once here rather than with
// motion[as] during render, so each render reuses the same component.
const TAGS = {
  div: motion.div,
  section: motion.section,
  header: motion.header,
  li: motion.li,
  ul: motion.ul,
  p: motion.p,
}

// <Reveal as="section" delay={0.1} className="..."> ... </Reveal>
// Every other prop (id, aria-*, data-*, ref ...) goes to the element.
export default function Reveal({ as = 'div', delay = 0, children, ...props }) {
  const Tag = TAGS[as] || motion.div
  return (
    <Tag initial="hidden" whileInView="shown" viewport={REVEAL_VIEWPORT} variants={fadeUp} custom={delay} {...props}>
      {children}
    </Tag>
  )
}
