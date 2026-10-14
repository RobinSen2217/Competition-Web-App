// Class strings shared by React components and by code that builds HTML strings
// (chart.js, Leaflet popups), so both render the same design.

// Join class names, skipping falsy values.
export const cx = (...c) => c.filter(Boolean).join(' ')

// Muted grey info box.
export const noteCls = 'rounded-xl bg-surface2 px-3.5 py-2.5 text-[14px] text-muted'

// Dropdown. leading-[normal] matches the `font:` shorthand of the original design.
export const selectCls = 'rounded-xl border-[1.5px] border-line bg-surface2 px-2.5 py-[7px] font-body text-[14px] leading-[normal] font-medium text-ink'

// Range slider. The 2px margin is the browser default that Tailwind's preflight removes.
export const rangeCls = 'm-[2px] w-full accent-accent'
