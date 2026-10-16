// Checks that server/data is still an exact copy of what the website used to
// bundle. If the client copies are removed later, these tests skip themselves.

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const SERVER = path.join(__dirname, '..', 'data')
const CLIENT = path.join(__dirname, '..', '..', 'client')

const pairs = [
  ...['climate', 'boundaries', 'mapmeta', 'rasters'].map((f) => [
    path.join(SERVER, `${f}.json`), path.join(CLIENT, 'src', 'data', `${f}.json`),
  ]),
  ...fs.readdirSync(path.join(SERVER, 'pixels')).map((f) => [
    path.join(SERVER, 'pixels', f), path.join(CLIENT, 'public', 'map', 'raster', path.basename(f, '.json'), 'values.json'),
  ]),
]

for (const [server, client] of pairs) {
  test(`${path.relative(SERVER, server)} matches the client copy`, { skip: !fs.existsSync(client) && 'client copy gone' }, () => {
    assert.ok(fs.readFileSync(server).equals(fs.readFileSync(client)))
  })
}
