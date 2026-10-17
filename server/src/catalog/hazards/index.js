// Hazard catalog: which hazard types the API offers and what their parameters
// mean. Like the other catalogs it holds meaning only; events, values and
// model results come from the hazard provider (src/providers/hazards.js,
// files in server/data/hazards/<hazard>/).
//
// To add a hazard (e.g. heatwave, drought): write ./<id>.js with the fields
// below, add it to HAZARDS, and put its dataset in server/data/hazards/<id>/
// (events.json + per-event CSVs, written by its importer in server/ml,
// forecaster/hazards). Routes and services need no change.
//
// Hazard fields:
//   id, label, description
//   interval              interval of its series (catalog/intervals.js), e.g. "daily"
//   parameters[]          key, label, unit, decimals, group, valueType ("number",
//                         "integer", "boolean"), kind ("series" | "observation"),
//                         table + column in the dataset, or derived: {from, op,
//                         window} (op "rolling_sum": that step and the window-1
//                         before it, like pandas rolling(window, min_periods=1).sum()),
//                         aggregation (series), source, dataset (id in events.json
//                         "datasets"), description
//   observationContext    table -> columns returned with each observation
//   forecast              { snapshot } (model/<snapshot>.json), or null when the
//                         hazard has no forecast

const HAZARDS = {
  flood: require('./flood'),
  // heatwave: require('./heatwave'),
}

// How a day of an event was scored (snapshot events.<id>.role). Generic
// model-evaluation terms, so every hazard's forecast reads the same.
const EVALUATION_ROLES = {
  test: 'Held-out test event: scored by the final model, which was trained without it.',
  out_of_fold: 'Training event: scored out-of-fold, by the cross-validation model that held this event out, so no model that saw it scores it.',
  unseen: 'Not used in training: scored by the final model.',
  excluded: 'Left out of the model on purpose; no forecast (see reason).',
  not_scored: 'Training event whose cross-validation fold could not be fit; no forecast.',
}

const getHazardDef = (id) => (typeof id === 'string' && Object.hasOwn(HAZARDS, id) ? HAZARDS[id] : null)
const hazardIds = () => Object.keys(HAZARDS)

// Public shape of a hazard parameter (fixed field order).
function presentHazardParameter(hazard, p) {
  const out = {
    key: p.key, label: p.label, unit: p.unit, decimals: p.decimals, group: p.group,
    kind: p.kind, valueType: p.valueType,
    intervals: p.kind === 'series' ? [hazard.interval] : [],
    aggregation: p.kind === 'series' ? p.aggregation : null,
    source: p.source, dataset: p.dataset ?? null,
    derived: p.derived ? { ...p.derived } : null,
    context: p.kind === 'observation' ? (hazard.observationContext?.[p.table] || []).map((c) => ({ key: c.key, label: c.label, valueType: c.valueType })) : null,
  }
  if (p.description) out.description = p.description
  return out
}

module.exports = { HAZARDS, EVALUATION_ROLES, getHazardDef, hazardIds, presentHazardParameter }
