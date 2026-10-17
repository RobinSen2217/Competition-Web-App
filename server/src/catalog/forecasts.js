// Forecast catalog: which parameters can be forecast, the models offered and
// the request limits. Like the other catalogs it holds meaning only; the
// numbers come from the area's Earth Engine feature table (src/forecast/tables.js)
// and the predictions from the forecasting module (server/ml).
//
// To make another parameter forecastable: teach the module (server/ml) to
// accept that table column as a target, then add an entry to TARGETS.
// Routes and services need no change.
// To offer another model: add it to the module first, then to MODELS.

// API parameter key -> how the module forecasts it. `column` is the target's
// column in the feature table (the notebook's names, e.g. Landsat "NDVI");
// `intervals` are the intervals the module can forecast it at.
const TARGETS = {
  ndvi: {
    key: 'ndvi',
    column: 'NDVI',
    intervals: ['monthly'],
    // Fewer observed target values than this and the chronological train/test
    // split leaves too little to train or score on (the notebook used ~16 years).
    minObserved: 36,
  },
}

// Model ids the module understands, in the order responses list them.
const MODELS = {
  ridge: { id: 'ridge', label: 'Ridge regression' },
  nn: { id: 'nn', label: 'Neural network' },
  gbm: { id: 'gbm', label: 'Gradient boosting' },
}

// Used when ?parameters= is left out, so the common request stays short.
const DEFAULT_TARGET = 'ndvi'

// Months (steps of the interval) to forecast. 12 is the notebook's N_FORECAST;
// the module refuses more than 24: past two years a climatology-driven
// recursive forecast says little.
const HORIZON = { min: 1, max: 24, default: 12 }

// The notebook's TEST_FRAC, SEED and N_LAGS, fixed so the same table always
// gives the same forecast (see server/ml).
const MODEL_OPTIONS = { testFraction: 0.2, seed: 42, lags: 2 }

const getTarget = (key) => (Object.hasOwn(TARGETS, key) ? TARGETS[key] : null)
const targetKeys = () => Object.keys(TARGETS)
const modelIds = () => Object.keys(MODELS)

module.exports = { TARGETS, MODELS, DEFAULT_TARGET, HORIZON, MODEL_OPTIONS, getTarget, targetKeys, modelIds }
