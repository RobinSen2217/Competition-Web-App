// FAQ: native <details> disclosures, so they open and close without any state.
const QA = [
  ['What does a "good" NDVI look like for a desert city?', 'Much lower than for a forest. Built-up areas and open sand sit between 0.1 and 0.2 all year. Parks, tree-lined roads and irrigated fields push the box average up, especially after the monsoon. Compare a city with its own history rather than with a different climate.'],
  ['Why a 10 × 10 km box and not the whole district?', 'The box keeps the focus on the city where people live. District averages are dominated by farmland and desert outside the city. District-wide averaging is part of the Earth Engine pipeline being built.'],
  ['How reliable is the outlook?', 'It is a statistical baseline: usually close for one to three months, with the band widening after that. It cannot foresee an unusual monsoon. The physics-informed model is being built to do better, and this baseline is what it must beat.'],
  ['Does a link between rain and greenness prove rain caused it?', 'No. The "Why" section shows how closely greenness follows each factor after removing the seasons. Strong links are good evidence, but irrigation, land clearing and new construction can also move greenness, and those need land-cover maps to confirm.'],
  ['Why is the water index (NDWI) not in the list yet?', 'NDWI needs green and shortwave-infrared bands at fine resolution, which come from the Sentinel-2 pipeline in Google Earth Engine. It will be added together with the district-wide averages.'],
  ['Can my city be added?', 'Yes. The same steps work anywhere in India. New cities need their data extracted first, which takes a few minutes per city.'],
]

export default function Faq() {
  return (
    <section className="card" id="faq" aria-labelledby="faqT">
      <div className="head">
        <div>
          <span className="kicker">FAQ</span>
          <h2 id="faqT">Questions people ask</h2>
        </div>
      </div>
      <div>
        {QA.map(([q, a]) => (
          <details key={q}>
            <summary>{q}</summary>
            <p>{a}</p>
          </details>
        ))}
      </div>
    </section>
  )
}
