// Shared helpers of the hazard (Disaster) pages: UTC day arithmetic, date
// and number labels, and the vocabulary the API uses for events and
// parameters. Nothing here is specific to one hazard; the components in this
// folder are named after the flood page but read everything from the API's
// metadata (see lib/hazards.js).

export const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const DAY_MS = 86400000

/* ---- days ---- */

// Hazard series are daily on UTC days ('YYYY-MM-DD'). Charts place them on a
// plain day count (days since 1970-01-01), so gaps and ranges are arithmetic.
export const dayNum = (t) => Math.floor(Date.UTC(+t.slice(0, 4), +t.slice(5, 7) - 1, +t.slice(8, 10)) / DAY_MS)
export const dayStr = (n) => new Date(n * DAY_MS).toISOString().slice(0, 10)

// '2026-09-24' -> '24 Sep 2026' (or '24 Sep' without the year)
export function dateLabel(t, { year = true } = {}) {
  if (!/^\d{4}-\d{2}-\d{2}/.test(t || '')) return '–'
  const s = `${+t.slice(8, 10)} ${MON[+t.slice(5, 7) - 1]}`
  return year ? `${s} ${t.slice(0, 4)}` : s
}

// '2026-09-24', '2026-09-30' -> '24–30 Sep 2026'; spans across months or
// years keep what differs: '28 Aug – 23 Sep 2026', '1 Dec 2025 – 31 Jan 2026'.
export function rangeLabel(a, b) {
  if (!a || !b) return dateLabel(a || b)
  if (a === b) return dateLabel(a)
  if (a.slice(0, 4) !== b.slice(0, 4)) return `${dateLabel(a)} – ${dateLabel(b)}`
  if (a.slice(0, 7) !== b.slice(0, 7)) return `${dateLabel(a, { year: false })} – ${dateLabel(b)}`
  return `${+a.slice(8, 10)}–${dateLabel(b)}`
}

// '2025-11-24' -> 'Nov 2025'
export const monthLabel = (t) => (t ? `${MON[+t.slice(5, 7) - 1]} ${t.slice(0, 4)}` : '–')

// Inclusive number of days from a to b
export const daysBetween = (a, b) => dayNum(b) - dayNum(a) + 1

/* ---- numbers ---- */

// A parameter's value with its own display precision ('decimals' from the
// API) and unit. null / NaN = '–' (no data that day).
export function fmtValue(v, p, { unit = true } = {}) {
  if (v == null || (typeof v === 'number' && !Number.isFinite(v))) return '–'
  if (typeof v === 'boolean') return v ? 'yes' : 'no'
  if (typeof v !== 'number') return String(v)
  const s = v.toFixed(p?.decimals ?? 2)
  return unit && p?.unit ? `${s} ${p.unit}` : s
}

// Round axis step for a raw step x (1, 2 or 5 times a power of ten), as in
// lib/chart.js; repeated here so this folder does not load the monthly chart
// engine and its month axis.
export function niceStep(x) {
  const p = Math.pow(10, Math.floor(Math.log10(x)))
  const f = x / p
  return (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * p
}

export const fmtNum = (v, d = 2) => (v == null || !Number.isFinite(v) ? '–' : v.toFixed(d))
export const pct = (v, d = 0) => (v == null || !Number.isFinite(v) ? '–' : `${(v * 100).toFixed(d)}%`)
export const plural = (n, word, many = `${word}s`) => `${n} ${n === 1 ? word : many}`

// "a, b and c"
export function listJoin(items) {
  const a = items.filter(Boolean)
  if (a.length < 2) return a[0] || ''
  return `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}`
}

/* ---- API vocabulary ---- */

// How an event's forecast days were scored (events[].forecast.role and the
// forecast's evaluation.role). Labels and colours for the map, chips and
// legends; the long explanation comes from the API (evaluation.description).
// An unknown future role still shows, with its id as the label.
export const ROLES = {
  test: { label: 'Held-out test', short: 'Test', color: '--s3', text: 'Scored by the final model, which never saw it.' },
  out_of_fold: { label: 'Training (out-of-fold)', short: 'Training', color: '--s1', text: 'Scored by the cross-validation model that held it out.' },
  unseen: { label: 'Added later (unseen)', short: 'Unseen', color: '--s4', text: 'Scored by the final model, which never saw it.' },
  excluded: { label: 'Left out of the model', short: 'Excluded', color: '--faint', text: 'Not forecast; see the reason.' },
  not_scored: { label: 'Not scored', short: 'Not scored', color: '--faint', text: 'No model could score it.' },
}
export const NO_ROLE = { label: 'No forecast', short: 'No forecast', color: '--faint', text: '' }
export const roleOf = (event) => {
  const r = event?.forecast?.role
  if (!r) return NO_ROLE
  return ROLES[r] || { ...NO_ROLE, label: r.replace(/_/g, ' '), short: r.replace(/_/g, ' ') }
}

// Colours for things that are told apart by identity (chart series, models,
// groups of passes), in this fixed order. --s2 comes last: in the blue theme
// it sits too close to --s1. Validated for colour-blind separation (light and
// dark) with the dataviz palette checker.
export const SERIES_COLORS = ['--s1', '--s3', '--s4', '--s2']
export const seriesColor = (i) => (i < SERIES_COLORS.length ? SERIES_COLORS[i] : '--faint')

// Plottable value types of a parameter (booleans are drawn as shaded day ranges)
export const isNumeric = (p) => p.valueType === 'number' || p.valueType === 'integer'

// The "with whiskers" partner of an observation parameter: another one of the
// same group and unit that is an uncertainty (e.g. soil moisture +- its
// uncertainty). Matched by name, since the API has no explicit link.
export const uncertaintyFor = (p, params) =>
  params.find((q) => q.key !== p.key && q.kind === p.kind && q.group === p.group && q.unit === p.unit && /uncertaint/i.test(`${q.key} ${q.label}`)) || null

// Short label of a dataset: "GPM IMERG Late Run, daily, V07 (...)" -> "GPM IMERG Late Run"
export const datasetShort = (d) => (d?.name || d?.id || '').split(/[,(]/)[0].trim()

// Day ranges [[a, b], ...] (day numbers, inclusive) where flags[i] is true,
// for days[i] = first + i.
export function runsOf(flags, first) {
  const out = []
  let start = null
  flags.forEach((f, i) => {
    if (f && start == null) start = i
    if (!f && start != null) {
      out.push([first + start, first + i - 1])
      start = null
    }
  })
  if (start != null) out.push([first + start, first + flags.length - 1])
  return out
}

// Grey inner panels of the hazard cards and their small uppercase titles
export const panelCls = 'flex min-w-0 flex-col gap-3 rounded-[14px] bg-surface2 p-4'
export const panelTitle = 'text-[13px] font-semibold tracking-[.05em] text-muted uppercase'

// Scroll margin of the hazard cards: room for the nav plus the sticky event bar on #anchor jumps
export const CARD_SCROLL = { scrollMarginTop: 150 }
