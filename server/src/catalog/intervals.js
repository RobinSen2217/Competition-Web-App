// Time intervals the API knows how to express. Each entry says how a time value
// is written for that interval, so query validation and responses stay generic.
// To add an interval (e.g. daily or the MODIS 16-day composite), add an entry
// here, teach the provider to produce series for it and list it in each area's
// coverage.intervals; routes need no change.
//
// Fields:
//   format, pattern, example  how a time is written (used in error messages)
//   steps(from, to)           number of times from..to inclusive (both valid
//                             times), used to size a response before fetching it
//   timeseries                true when /timeseries offers the interval. Layers
//                             also use intervals to describe their times (e.g.
//                             yearly NDVI images) without that implying a
//                             yearly series exists.
//
// Time strings are chosen so that plain string comparison sorts them
// chronologically, which is what range selection relies on.

const year = (t) => Number(t.slice(0, 4))

const INTERVALS = {
  monthly: {
    id: 'monthly',
    label: 'Monthly',
    format: 'YYYY-MM',
    pattern: /^\d{4}-(0[1-9]|1[0-2])$/,
    example: '2020-06',
    steps: (from, to) => (year(to) - year(from)) * 12 + Number(to.slice(5, 7)) - Number(from.slice(5, 7)) + 1,
    timeseries: true,
  },
  yearly: {
    id: 'yearly',
    label: 'Yearly',
    format: 'YYYY',
    pattern: /^\d{4}$/,
    example: '2020',
    steps: (from, to) => year(to) - year(from) + 1,
    timeseries: false, // only layer times today; no yearly series in the data
  },
  // daily: { id: 'daily', label: 'Daily', format: 'YYYY-MM-DD', pattern: /^\d{4}-\d{2}-\d{2}$/, example: '2020-06-15',
  //   steps: (from, to) => (Date.parse(to) - Date.parse(from)) / 86400000 + 1, timeseries: true },
  // '16-day': { id: '16-day', label: '16-day composite', format: 'YYYY-DDD', pattern: /^\d{4}-\d{3}$/, example: '2020-161',
  //   steps: ..., timeseries: true },
}

const DEFAULT_INTERVAL = 'monthly'

const getInterval = (id) => (Object.hasOwn(INTERVALS, id) ? INTERVALS[id] : null)
const intervalIds = () => Object.keys(INTERVALS)
// Intervals /timeseries accepts (the default for ?interval= validation).
const timeseriesIntervalIds = () => intervalIds().filter((id) => INTERVALS[id].timeseries)

// Index window [lo, hi) of the sorted `times` that fall within from..to
// (inclusive, either end optional). A range outside the data yields an empty window.
function timeWindow(times, from, to) {
  let lo = 0
  while (lo < times.length && from !== undefined && times[lo] < from) lo++
  let hi = times.length
  while (hi > lo && to !== undefined && times[hi - 1] > to) hi--
  return [lo, hi]
}

// Number of times from..to inclusive at an interval; 0 when either end is
// missing or the range is empty.
function countTimes(intervalId, from, to) {
  if (from == null || to == null || from > to) return 0
  return getInterval(intervalId).steps(from, to)
}

module.exports = { INTERVALS, DEFAULT_INTERVAL, getInterval, intervalIds, timeseriesIntervalIds, timeWindow, countTimes }
