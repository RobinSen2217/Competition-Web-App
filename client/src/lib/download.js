// Saves a Blob or a string as a file using the browser's normal download.
// Strings are wrapped in a Blob of the given type (CSV by default, as the
// original app only ever saved CSV text or a PNG Blob).
export function saveFile(filename, data, type = 'text/csv') {
  const url = URL.createObjectURL(data instanceof Blob ? data : new Blob([data], { type }))
  // A temporary <a download> is the only cross-browser way to trigger a save
  // without a server; it has to be in the document for Firefox to honour click().
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Revoke later, not immediately: some browsers start the download asynchronously
  // and would otherwise find the object URL already gone.
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}
