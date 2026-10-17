// Helpers for the one error a code-split app sees in production that is not a
// bug: the browser failing to download a lazily imported chunk. Used by the
// error boundaries (components/common/ErrorBoundary.jsx, LazySection.jsx).
// No imports, so Boot.jsx may use it before the data has loaded.

/**
 * True when `e` is the browser failing to download a JS/CSS chunk of a
 * dynamic import(), which is what React.lazy throws when e.g. the site was
 * redeployed and the old chunk file (with its old content hash) is gone.
 * The message differs per browser; Vite's own preload helper adds the CSS one.
 */
export function isChunkError(e) {
  const m = String(e?.message || '')
  return (
    e?.name === 'ChunkLoadError' ||
    /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Unable to preload CSS/i.test(m)
  )
}

/**
 * Reloads the page, landing on the element with this id when given (a #hash
 * mounts that section at once, see LazySection), so the reader keeps their
 * place. The sensible retry after a chunk error: the fresh index.html points
 * at the new chunk files.
 */
export function reloadPage(id) {
  if (id) window.history.replaceState(window.history.state, '', `#${id}`)
  window.location.reload()
}
