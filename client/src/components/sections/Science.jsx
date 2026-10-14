import { useState } from 'react'
import { rangeCls } from '../../styles/classes'
import { Card, CardHead, Kicker, Lede, Pill, Pills, Readout, ReadoutItem, ReadoutWhen } from '../ui'

// "The science": interactive NDVI explainer. Two sliders set how much red and
// near-infrared light a surface reflects; the NDVI value, a plain-language
// description and the colour of the leaf illustration follow. Preset pills
// load typical values for common surfaces.

// [label, red %, near-infrared %]
const SURF = [
  ['Healthy crop', 6, 50],
  ['Stressed crop', 12, 30],
  ['City park', 8, 35],
  ['Bare sand', 28, 34],
  ['Rooftops', 22, 25],
  ['Lake water', 6, 3],
]

// Rough NDVI classes used for the description.
const describe = (v) =>
  v < 0 ? 'Water or wet surface' : v < 0.15 ? 'Bare ground, sand or roofs' : v < 0.3 ? 'Sparse or stressed plants' : v < 0.5 ? 'Moderate vegetation' : 'Dense, healthy vegetation'

// Leaf fill: blue for water (NDVI < 0). Otherwise blend from dry tan to deep
// green. The scale runs over NDVI -0.1..0.8, so bare ground at 0 starts slightly
// past pure tan (t ≈ 0.11), and values above 0.8 stay full green.
function leafBackground(v) {
  if (v < 0) return 'linear-gradient(135deg,#5B8FB0,#2F5E80)'
  const t = Math.max(0, Math.min(1, (v + 0.1) / 0.9))
  const mix = (a, b) => Math.round(a + (b - a) * t)
  return `linear-gradient(135deg,rgb(${mix(214, 74)},${mix(190, 160)},${mix(140, 82)}),rgb(${mix(170, 30)},${mix(140, 110)},${mix(90, 60)}))`
}

// One slider: a label row (name left, value right) above the range input.
const sliderCls = 'flex flex-col gap-1'
const sliderLabelCls = 'flex justify-between text-[14px] text-muted'
const sliderValueCls = 'font-mono font-medium text-ink'

export default function Science() {
  // Reflectance in percent; defaults match the original page (a healthy leaf).
  const [red, setRed] = useState(8)
  const [nir, setNir] = useState(45)
  // NDVI = (NIR − Red) / (NIR + Red); both sliders have min 1, so no divide by zero.
  const v = (nir - red) / (nir + red)

  return (
    <Card id="science" aria-labelledby="sciT">
      <CardHead>
        <Kicker>The science</Kicker>
        <h2 id="sciT">How a satellite sees a healthy plant</h2>
        <Lede>Healthy leaves absorb red light for photosynthesis and strongly reflect near-infrared light. NDVI compares the two. Move the sliders, or try a surface.</Lede>
      </CardHead>
      {/* Controls on the left, leaf on the right; the leaf drops below them on phones */}
      <div className="grid grid-cols-[minmax(0,1fr)_150px] items-center gap-[18px] max-[521px]:grid-cols-[minmax(0,1fr)]">
        <div className="flex flex-col gap-3.5">
          <div className={sliderCls}>
            <label className={sliderLabelCls} htmlFor="red">
              Red light reflected <b className={sliderValueCls} id="redV">{red}%</b>
            </label>
            <input type="range" className={rangeCls} id="red" min="1" max="60" value={red} onChange={(e) => setRed(+e.target.value)} />
          </div>
          <div className={sliderCls}>
            <label className={sliderLabelCls} htmlFor="nir">
              Near-infrared reflected <b className={sliderValueCls} id="nirV">{nir}%</b>
            </label>
            <input type="range" className={rangeCls} id="nir" min="1" max="60" value={nir} onChange={(e) => setNir(+e.target.value)} />
          </div>
          <Pills id="surfaces">
            {SURF.map(([label, r, n]) => (
              // A preset reads as selected only while both sliders still match it.
              <Pill key={label} pressed={r === red && n === nir} onClick={() => { setRed(r); setNir(n) }}>
                {label}
              </Pill>
            ))}
          </Pills>
          <Readout>
            <ReadoutWhen>NDVI</ReadoutWhen>
            <ReadoutItem>
              <b className="text-[22px]" id="ndviV">{v.toFixed(2)}</b>
            </ReadoutItem>
            <ReadoutItem id="ndviTxt">{describe(v)}</ReadoutItem>
          </Readout>
          <p className="text-[13px] text-muted">NDVI = (NIR − Red) ÷ (NIR + Red). It runs from −1 to +1: water is below 0, bare sand and roofs sit near 0.1, and dense crops or forest reach 0.6–0.9.</p>
        </div>
        {/* Leaf shape: two opposite corners fully rounded, the other two nearly square, tilted a little */}
        <div
          className="size-[150px] rounded-[50%_4%_50%_4%] shadow-[inset_0_0_0_1px_rgba(0,0,0,.08)] transition-[background] duration-250 ease-[ease] transform-[rotate(-12deg)]"
          id="leaf"
          aria-hidden="true"
          style={{ background: leafBackground(v) }}
        />
      </div>
    </Card>
  )
}
