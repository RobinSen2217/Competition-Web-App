import { Card, CardHead, Kicker } from '../ui'

// FAQ: native <details> disclosures, so they open and close without any state.
const QA = [
  ['What does a "good" NDVI look like for a desert city?', 'Much lower than for a forest. Built-up areas and open sand sit between 0.1 and 0.2 all year. Parks, tree-lined roads and irrigated fields push the box average up, especially after the monsoon. Compare a city with its own history rather than with a different climate.'],
  ['Why a 10 × 10 km box and not the whole district?', 'The box keeps the focus on the city where people live. District averages are dominated by farmland and desert outside the city. District-wide averaging is part of the Earth Engine pipeline being built.'],
  ['How reliable is the forecast?', 'It depends on the city. The forecast panel shows two scores for every model: how well it predicted one month ahead on data it never saw, and how it did when its 12-month forecast was re-run on the last 12 months. The second is the better guide. Future weather is assumed to be typical, so an unusual monsoon will surprise it.'],
  ['Does a link between rain and greenness prove rain caused it?', 'No. The "Why" section shows how closely greenness follows each factor after removing the seasons. Strong links are good evidence, but irrigation, land clearing and new construction can also move greenness, and those need land-cover maps to confirm.'],
  ['Why is the water index (NDWI) not in the list yet?', 'NDWI needs green and shortwave-infrared bands at fine resolution, which come from the Sentinel-2 pipeline in Google Earth Engine. It will be added together with the district-wide averages.'],
  ['Can my city be added?', 'Yes. The same steps work anywhere in India. New cities need their data extracted first, which takes a few minutes per city.'],
]

// Grey rounded box per question; consecutive boxes are 8px apart.
const detailsCls = 'rounded-[14px] bg-surface2 px-4 py-3 [details+&]:mt-2'
// Question row. The browser's disclosure triangle is hidden and replaced by a
// "+" on the right that turns into "–" while the answer is open.
const summaryCls =
  'flex cursor-pointer list-none justify-between gap-3 font-semibold [&::-webkit-details-marker]:hidden ' +
  "after:text-[20px] after:leading-none after:text-accent after:content-['+'] [details[open]_&]:after:content-['–']"

export default function Faq() {
  return (
    <Card id="faq" aria-labelledby="faqT">
      <CardHead>
        <Kicker>FAQ</Kicker>
        <h2 id="faqT">Questions people ask</h2>
      </CardHead>
      <div>
        {QA.map(([q, a]) => (
          <details key={q} className={detailsCls}>
            <summary className={summaryCls}>{q}</summary>
            <p className="mt-2 max-w-[72ch] text-[15px] text-muted">{a}</p>
          </details>
        ))}
      </div>
    </Card>
  )
}
