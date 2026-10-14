import { Card, CardHead, Kicker } from '../ui'

// Methods: the processing pipeline from raw satellite data to the forecast,
// with badges on the steps that are still being built.

// Numbered list: a CSS counter draws each step number in a pale green circle
// (the li's ::before), in a 34px column left of the text.
const stepsCls = 'm-0 flex list-none flex-col gap-3 p-0 [counter-reset:s]'
const stepCls =
  'grid grid-cols-[34px_minmax(0,1fr)] items-start gap-3 ' +
  'before:flex before:size-[30px] before:items-center before:justify-center before:rounded-full before:bg-accent-soft before:text-[14px] before:font-bold before:text-accent before:content-[counter(s)] before:[counter-increment:s]'
// Status badge after a step's text. The top border is a quirk kept from the
// original stylesheet, where a generic `.plan` divider rule also matched it.
const planCls = 'ml-1.5 rounded-full border-t border-line bg-warn-bg px-2 py-px text-[12px] font-semibold text-warn'

// One step: bold title on its own line, muted description, optional badge.
function Step({ title, plan, children }) {
  return (
    <li className={stepCls}>
      <div>
        <b className="block">{title}</b>
        <span className="text-muted">{children}</span>
        {plan && <span className={planCls}>{plan}</span>}
      </div>
    </li>
  )
}

export default function Methods() {
  return (
    <Card id="methods" aria-labelledby="metT">
      <CardHead>
        <Kicker>Methods</Kicker>
        <h2 id="metT">From satellite pixels to a forecast</h2>
      </CardHead>
      <ol className={stepsCls}>
        <Step title="Collect">
          Monthly satellite and climate records from 2010 for each city: vegetation (MODIS NDVI), land surface temperature day and night (MODIS), rainfall, air temperature, humidity, soil moisture, albedo, wind, UV and aerosol (NASA POWER).
        </Step>
        <Step title="Clean">
          Remove cloud-contaminated and missing pixels, average the rest over the measurement box, and keep the greenest scene of each month to reduce leftover cloud.
        </Step>
        <Step title="Turn into physical indicators">
          Radiative and thermal (albedo, absorbed sunlight, day–night temperature range), moisture (rainfall, soil water, dewpoint) and surface indicators (greenness, built-up signal).
        </Step>
        <Step title="Explain and forecast" plan="In development">
          Remove the seasonal cycle, relate greenness to weather with time delays, and project the next months. A physics-informed neural network that respects water and energy balance replaces the statistical baseline.
        </Step>
        <Step title="Speed up and share" plan="Planned">
          FPGA hardware for fast processing of large image stacks, and this web interface for everyone else.
        </Step>
      </ol>
    </Card>
  )
}
