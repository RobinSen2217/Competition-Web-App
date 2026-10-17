// The Earth Engine feature tables the forecasts read (src/forecast/tables.js):
// CSV parsing as pandas writes it, areas.json, missing files and re-reading
// after a new extraction.

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { createTableSource, parseTable } = require('../src/forecast/tables')
const { GEE_FIXTURES } = require('./support/forecast')

test('parses pandas output: blanks and NaN as null, dates trimmed, rows sorted by date', () => {
  const csv = 'Emissivity_31,date,NDVI,label\r\n0.97,2010-02-01 00:00:00,,"a,b"\r\n0.96,2010-01-01,0.21,nan\r\n'
  assert.deepEqual(parseTable(csv, 'x'), {
    columns: ['Emissivity_31', 'date', 'NDVI', 'label'],
    rows: [[0.96, '2010-01-01', 0.21, null], [0.97, '2010-02-01', null, null]],
  })
})

test('refuses a table without a date column or with ragged rows', () => {
  assert.throws(() => parseTable('NDVI\n0.2\n', 'x'), /no "date" column/)
  assert.throws(() => parseTable('date,NDVI\n2010-01-01\n', 'x'), /row 2 has 1 fields/)
  assert.throws(() => parseTable('date,NDVI\nJanuary,0.2\n', 'x'), /bad date/)
  assert.throws(() => parseTable('', 'x'), /empty/)
})

test('the fixture tables have the notebook\'s 33 columns', async () => {
  const t = await createTableSource({ dir: GEE_FIXTURES }).getTable('jaipur')
  assert.equal(t.columns.length, 33)
  assert.equal(t.columns[4], 'date')
  assert.equal(t.columns.at(-1), 'Precip_3mo_sum')
  assert.ok(!Number.isNaN(Date.parse(t.updated)))
})

test('missing table or area is null; unsafe ids are refused', async () => {
  const src = createTableSource({ dir: GEE_FIXTURES })
  assert.equal(await src.getTable('udaipur'), null)
  assert.equal(await src.getAreaConfig('atlantis'), null)
  assert.deepEqual(await src.getAreaConfig('jaisalmer'), { id: 'jaisalmer', name: 'Jaisalmer', lat: 26.911773, lon: 70.929989, halfWidthKm: 1, state: 'Rajasthan' })
  await assert.rejects(src.getTable('../secrets/key'), /Unsafe area id/)
  assert.equal(await createTableSource({ dir: path.join(os.tmpdir(), 'no-such-gee-dir') }).getAreaConfig('jaipur'), null)
})

test('a rewritten table is read again', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gee-tables-'))
  const file = path.join(dir, 'a.features.csv')
  fs.writeFileSync(file, 'date,NDVI\n2010-01-01,0.2\n')
  const src = createTableSource({ dir })
  const first = await src.getTable('a')
  assert.equal(await src.getTable('a'), first, 'unchanged file: cached')
  fs.writeFileSync(file, 'date,NDVI\n2010-01-01,0.2\n2010-02-01,0.25\n')
  fs.utimesSync(file, new Date('2030-01-01'), new Date('2030-01-01'))
  const second = await src.getTable('a')
  assert.equal(second.rows.length, 2)
  assert.equal(second.updated, '2030-01-01T00:00:00.000Z')
})
