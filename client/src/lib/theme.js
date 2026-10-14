// Reads a CSS custom property from :root, e.g. css('--accent').
// Values depend on the active theme, so anything that bakes colours into SVG or
// Leaflet layers must re-run when useThemeVersion() changes.
export const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim()
