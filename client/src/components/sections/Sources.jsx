// Data sources: one row per measure with its provider, resolution and time span.
// The "Covers" dates describe the bundled dataset and must be updated with it.
const ROWS = [
  ['Vegetation greenness (NDVI)', 'NASA MODIS Terra MOD13Q1, via ORNL DAAC', '250 m, 16-day composites; monthly greenest scene, averaged over the box', 'Jan 2010 to Sep 2026'],
  ['Land surface temperature, day and night', 'NASA MODIS Terra MOD11A2, via ORNL DAAC', '1 km, 8-day; monthly mean of clear pixels', 'Jan 2010 to Sep 2026'],
  ['Rainfall, air temperature, dewpoint, humidity, wind', 'NASA POWER (MERRA-2 reanalysis)', 'About 50 km grid, monthly; rainfall bias-corrected', 'Jan 2010 to Aug 2026'],
  ['Soil moisture, surface and root zone', 'NASA POWER (MERRA-2)', 'Soil wetness as % of saturation', 'Jan 2010 to Aug 2026'],
  ['Albedo, UV index, sunshine, aerosol', 'NASA POWER (CERES and MERRA-2)', 'About 50–100 km grid, monthly', 'Jan 2010 to Jun 2026'],
  ['Map imagery and place names', 'Esri World Imagery, World Boundaries and Places', 'Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community', 'Current'],
  ['District boundaries', 'geoBoundaries (gbOpen, ADM2)', 'Simplified for the web', 'Current'],
]

export default function Sources() {
  return (
    <section className="card" id="sources" aria-labelledby="srcT">
      <div className="head">
        <div>
          <span className="kicker">Data sources</span>
          <h2 id="srcT">Where every number comes from</h2>
        </div>
      </div>
      {/* .tw scrolls the table sideways on narrow screens */}
      <div className="tw">
        <table>
          <thead>
            <tr>
              <th>Measure</th>
              <th>Source</th>
              <th>Detail</th>
              <th>Covers</th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map((r) => (
              <tr key={r[0]}>
                {r.map((cell, i) => (
                  <td key={i}>{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="note">Climate values from NASA POWER describe a grid cell tens of kilometres wide, so they represent the wider area around the city. The satellite values describe the 10 × 10 km box itself.</p>
    </section>
  )
}
