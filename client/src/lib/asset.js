// URL of a file in public/, e.g. asset('/map/region.jpg').
// The site may be served from a sub-path (GitHub Pages serves it under
// /<repo-name>/), so public paths must be prefixed with Vite's base URL instead
// of being used as absolute '/...' paths. BASE_URL always ends with '/'.
export const asset = (path) => import.meta.env.BASE_URL + path.replace(/^\//, '')
