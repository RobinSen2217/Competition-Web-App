// CSV parsing shared by the readers of server/data CSV files (the Earth
// Engine feature tables in src/forecast/tables.js and the hazard event tables
// in src/providers/hazards.js). No dependency: the files are small and plain.

// RFC 4180 CSV -> array of string arrays. pandas never quotes these numeric
// tables, but a quoted field must not split the row if it ever does.
function parseCsv(text) {
  const rows = []
  let row = []
  let field = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++ }
      else if (ch === '"') quoted = false
      else field += ch
    } else if (ch === '"') quoted = true
    else if (ch === ',') { row.push(field); field = '' }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(field)
      if (row.length > 1 || row[0] !== '') rows.push(row)
      row = []
      field = ''
    } else field += ch
  }
  row.push(field)
  if (row.length > 1 || row[0] !== '') rows.push(row)
  return rows
}

module.exports = { parseCsv }
