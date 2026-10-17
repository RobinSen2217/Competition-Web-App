// Flood hazard: what its parameters mean and where they live in the dataset
// written by `python -m forecaster.hazards import flood` (server/data/hazards/
// flood/events.json, tables "daily" and "soil_passes"; columns documented
// there). The forecast is the flood notebook's model, saved by
// `python -m forecaster.hazards build flood` as model/forecast.json.
//
// Parameter fields (see ./index.js for the full list):
//   kind "series"       one value per day of the event, from `table`/`column`,
//                       or `derived` from another series (rolling sums as the
//                       model's inputs); aligned with the response's `times`
//   kind "observation"  irregular rows (one per satellite pass) with a value
//                       and the table's `context` columns (track, phase, ...)

const RAIN = { group: 'Rainfall', unit: 'mm', decimals: 1, valueType: 'number', aggregation: 'sum', source: 'GPM IMERG Late Run V07', dataset: 'gpm_imerg_late_v07' }
const SOIL = { group: 'Soil moisture', valueType: 'number', source: 'NISAR L3 SME2 (provisional)', dataset: 'nisar_l3_sme2_v1', table: 'soil_passes', kind: 'observation' }

module.exports = {
  id: 'flood',
  label: 'Flood',
  description:
    'Flood events with daily satellite rainfall over each event box and the NISAR soil moisture passes over the same box, ' +
    'and a forecast of the flood within the next 3 days (danger when the probability reaches the model threshold), ' +
    'from the team notebook flood_disaster.ipynb.',
  interval: 'daily',

  parameters: [
    { ...RAIN, key: 'rain_box_mm', label: 'Rainfall (box average)', kind: 'series', table: 'daily', column: 'rain_box_mm',
      description: 'Rain averaged over the event box on the UTC day. A satellite estimate (IMERG Late Run), not corrected with rain gauges. Forecast input box_1d.' },
    { ...RAIN, key: 'rain_wettest_cell_mm', label: 'Rainfall (wettest cell)', kind: 'series', table: 'daily', column: 'rain_wettest_cell_mm',
      description: 'Rain in the wettest ~10 km IMERG cell of the box that day. Forecast input wet_1d.' },
    { ...RAIN, key: 'rain_box_3d_mm', label: 'Rainfall, last 3 days (box)', kind: 'series', derived: { from: 'rain_box_mm', op: 'rolling_sum', window: 3 },
      description: 'Box-average rain of that day and the 2 before it (fewer at the start of the event). Forecast input box_3d.' },
    { ...RAIN, key: 'rain_box_7d_mm', label: 'Rainfall, last 7 days (box)', kind: 'series', derived: { from: 'rain_box_mm', op: 'rolling_sum', window: 7 },
      description: 'Box-average rain of that day and the 6 before it (fewer at the start of the event). Forecast input box_7d.' },
    { ...RAIN, key: 'rain_wettest_3d_mm', label: 'Rainfall, last 3 days (wettest cell)', kind: 'series', derived: { from: 'rain_wettest_cell_mm', op: 'rolling_sum', window: 3 },
      description: 'Wettest-cell rain of that day and the 2 before it. Forecast input wet_3d.' },
    { ...RAIN, key: 'rain_wettest_7d_mm', label: 'Rainfall, last 7 days (wettest cell)', kind: 'series', derived: { from: 'rain_wettest_cell_mm', op: 'rolling_sum', window: 7 },
      description: 'Wettest-cell rain of that day and the 6 before it. Forecast input wet_7d.' },
    { key: 'in_flood_period', label: 'Reported flood period', group: 'Flood', unit: '', decimals: 0, valueType: 'boolean', aggregation: 'max',
      kind: 'series', table: 'daily', column: 'in_flood_period', source: 'Event reports (see the event sources)', dataset: null,
      description: 'true on the days of the reported flood period, false on the lead-up days before it. The label the forecast learns from.' },
    { key: 'rain_cells_with_data', label: 'IMERG cells with data', group: 'Data quality', unit: 'cells', decimals: 0, valueType: 'integer', aggregation: 'mean',
      kind: 'series', table: 'daily', column: 'cells_with_data', source: 'GPM IMERG Late Run V07', dataset: 'gpm_imerg_late_v07',
      description: 'Number of IMERG cells in the box with a value that day.' },

    { ...SOIL, key: 'soil_moisture', label: 'Soil moisture (recommended)', unit: 'm³/m³', decimals: 3, column: 'mean_sm_recommended_only',
      description: "Box mean of NISAR's recommended soil-moisture retrievals on that pass (dense vegetation left out); the value the forecast uses. Flooded land, open water and towns have no value." },
    { ...SOIL, key: 'soil_moisture_all', label: 'Soil moisture (all retrievals)', unit: 'm³/m³', decimals: 3, column: 'mean_sm',
      description: 'Box mean of every soil-moisture retrieval on that pass, including those NASA does not recommend.' },
    { ...SOIL, key: 'soil_moisture_median', label: 'Soil moisture (median)', unit: 'm³/m³', decimals: 3, column: 'median_sm', description: 'Box median soil moisture on that pass.' },
    { ...SOIL, key: 'soil_moisture_p10', label: 'Soil moisture (10th percentile)', unit: 'm³/m³', decimals: 3, column: 'p10_sm', description: 'Drier end of the box (10th percentile) on that pass.' },
    { ...SOIL, key: 'soil_moisture_p90', label: 'Soil moisture (90th percentile)', unit: 'm³/m³', decimals: 3, column: 'p90_sm', description: 'Wetter end of the box (90th percentile) on that pass.' },
    { ...SOIL, key: 'soil_uncertainty', label: 'Soil moisture uncertainty', unit: 'm³/m³', decimals: 3, column: 'mean_uncertainty',
      description: "NASA's mean uncertainty estimate for the pass. Forecast input soil_uncertainty." },
    { ...SOIL, key: 'soil_coverage_pct', label: 'Soil moisture coverage', unit: '%', decimals: 1, column: 'coverage_pct',
      description: 'Share of the event box with a soil-moisture value on that pass. Each track sees a different part of the box, so compare passes of the same track. Forecast input soil_coverage_pct.' },
  ],

  // Columns that describe each observation, returned next to its value.
  observationContext: {
    soil_passes: [
      { key: 'utc_time', label: 'Time (UTC)', valueType: 'string' },
      { key: 'local_time', label: 'Local time', valueType: 'string' },
      { key: 'track', label: 'Track', valueType: 'integer' },
      { key: 'direction', label: 'Orbit direction', valueType: 'string' },
      { key: 'phase', label: 'Phase', valueType: 'string' },
      { key: 'in_reported_flood_period', label: 'In the reported flood period', valueType: 'boolean' },
    ],
  },

  // The model snapshot (model/<snapshot>.json in the dataset folder). Models,
  // thresholds, metrics and per-day results all come from it.
  forecast: { snapshot: 'forecast' },
}
