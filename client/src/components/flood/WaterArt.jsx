import { motion, useReducedMotion } from 'framer-motion'

// Decorative water scene: a cloud over three layers of gently drifting waves.
// Each wave is drawn two periods wide (period 200 in viewBox units) and slides
// left by exactly one period on a loop, so the repeat is seamless. Hidden from
// screen readers; with "reduce motion" on, the waves stay still.
export default function WaterArt() {
  const reduce = useReducedMotion()
  return (
    <div className="relative h-[180px] overflow-hidden rounded-[18px] bg-accent-soft min-[820px]:h-[220px]" aria-hidden="true">
      <svg className="absolute inset-0 size-full" viewBox="0 0 400 220" preserveAspectRatio="xMidYMax slice">
        <g fill="var(--surface)" opacity=".85">
          <circle cx="268" cy="62" r="20" />
          <circle cx="292" cy="54" r="26" />
          <circle cx="318" cy="66" r="18" />
          <rect x="250" y="62" width="84" height="22" rx="11" />
        </g>
        <Wave y={128} amp={7} fill="var(--accent)" opacity={0.18} duration={11} reduce={reduce} />
        <Wave y={150} amp={8} fill="var(--accent)" opacity={0.32} duration={8} reduce={reduce} reverse />
        <Wave y={174} amp={6} fill="var(--accent)" opacity={0.55} duration={6} reduce={reduce} />
      </svg>
    </div>
  )
}

// One wave band from height y to the bottom, 800 units wide (four periods).
function Wave({ y, amp, fill, opacity, duration, reduce, reverse = false }) {
  let d = `M0 ${y}`
  for (let x = 0; x < 800; x += 200) {
    d += ` q50 ${-amp} 100 0 t100 0`
  }
  d += ' V220 H0 Z'
  const from = reverse ? -200 : 0
  return (
    <motion.path
      d={d}
      fill={fill}
      opacity={opacity}
      initial={{ x: from }}
      animate={reduce ? { x: from } : { x: [from, from === 0 ? -200 : 0] }}
      transition={reduce ? { duration: 0 } : { duration, ease: 'linear', repeat: Infinity }}
    />
  )
}
