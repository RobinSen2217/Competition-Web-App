import { motion, useReducedMotion } from 'framer-motion'
import { Card, CardHead, Chip, Kicker, Lede } from '../components/ui'

// The flood hazard page ("/disaster/flood"), rendered inside DisasterPage's page
// column. There is no flood data or model yet, so this is an honest placeholder:
// what the page is for and what is planned, with no figures or results.
// The palette is blue on every disaster page; the classes below are the usual
// tokens (text-accent, bg-accent-soft ...) and simply pick up the blue values.

// What the page will show, in plain words. No numbers until there is data.
const PLANNED = [
  {
    title: 'Flood extent from satellite radar',
    text: 'Maps of where water has spread after heavy rain. Radar sees through cloud, so it works during the monsoon too.',
  },
  {
    title: 'Rainfall and river signals',
    text: 'Recent rainfall over each city and the rivers around it, to show when conditions build towards a flood.',
  },
  {
    title: 'Model predictions',
    text: 'Areas that a flood model expects to be at risk, explained alongside how far those predictions can be trusted.',
  },
]

export default function FloodPage() {
  return (
    <>
      <Card aria-labelledby="floodT" className="overflow-hidden">
        <div className="grid items-center gap-6 min-[820px]:grid-cols-[minmax(0,1fr)_minmax(0,380px)]">
          <div className="flex min-w-0 flex-col gap-3">
            <Kicker>Disaster · Flood</Kicker>
            <h1 id="floodT">Flood monitoring</h1>
            <Lede>
              Flood risk, flood extent and model predictions for the cities will appear here. This part of the app is still being built.
            </Lede>
            <Chip tone="neutral">Coming soon</Chip>
          </div>
          <WaterArt />
        </div>
      </Card>

      <Card aria-labelledby="floodPlanT">
        <CardHead>
          <Kicker>Coming soon</Kicker>
          <h2 id="floodPlanT">What this page will show</h2>
          <Lede>Each part will follow the city picked on the vegetation page.</Lede>
        </CardHead>
        <ul className="grid gap-3 min-[760px]:grid-cols-3">
          {PLANNED.map((p) => (
            <li key={p.title} className="flex flex-col gap-1.5 rounded-[16px] bg-surface2 px-4 py-3.5">
              <span className="flex items-center gap-2 text-[15px] font-semibold text-ink">
                <span className="size-2 flex-none rounded-full bg-accent" aria-hidden="true" />
                {p.title}
              </span>
              <span className="text-[14px] text-muted">{p.text}</span>
            </li>
          ))}
        </ul>
      </Card>
    </>
  )
}

// Decorative water scene: a cloud over three layers of gently drifting waves.
// Each wave is drawn two periods wide (period 200 in viewBox units) and slides
// left by exactly one period on a loop, so the repeat is seamless. Hidden from
// screen readers; with "reduce motion" on, the waves stay still.
function WaterArt() {
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
