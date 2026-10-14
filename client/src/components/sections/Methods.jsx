// Methods: the processing pipeline from raw satellite data to the forecast,
// with badges on the steps that are still being built.
export default function Methods() {
  return (
    <section className="card" id="methods" aria-labelledby="metT">
      <div className="head">
        <div>
          <span className="kicker">Methods</span>
          <h2 id="metT">From satellite pixels to a forecast</h2>
        </div>
      </div>
      <ol className="steps">
        <li>
          <div>
            <b>Collect</b>
            <span className="muted">Monthly satellite and climate records from 2010 for each city: vegetation (MODIS NDVI), land surface temperature day and night (MODIS), rainfall, air temperature, humidity, soil moisture, albedo, wind, UV and aerosol (NASA POWER).</span>
          </div>
        </li>
        <li>
          <div>
            <b>Clean</b>
            <span className="muted">Remove cloud-contaminated and missing pixels, average the rest over the measurement box, and keep the greenest scene of each month to reduce leftover cloud.</span>
          </div>
        </li>
        <li>
          <div>
            <b>Turn into physical indicators</b>
            <span className="muted">Radiative and thermal (albedo, absorbed sunlight, day–night temperature range), moisture (rainfall, soil water, dewpoint) and surface indicators (greenness, built-up signal).</span>
          </div>
        </li>
        <li>
          <div>
            <b>Explain and forecast</b>
            <span className="muted">Remove the seasonal cycle, relate greenness to weather with time delays, and project the next months. A physics-informed neural network that respects water and energy balance replaces the statistical baseline.</span>
            <span className="plan">In development</span>
          </div>
        </li>
        <li>
          <div>
            <b>Speed up and share</b>
            <span className="muted">FPGA hardware for fast processing of large image stacks, and this web interface for everyone else.</span>
            <span className="plan">Planned</span>
          </div>
        </li>
      </ol>
    </section>
  )
}
