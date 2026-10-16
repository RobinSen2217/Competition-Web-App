// Test helper: starts the real app on an ephemeral port and offers get(),
// which returns status, headers and parsed JSON. Lives outside *.test.js so
// `npm test` does not run it as a suite.

const assert = require('node:assert/strict')
const path = require('node:path')
const { createApp } = require('../../src/app')

const DATA = path.join(__dirname, '..', '..', 'data')
const readData = (rel) => require(path.join(DATA, rel))

async function startServer(options) {
  const server = createApp(options).listen(0)
  await new Promise((resolve) => server.once('listening', resolve))
  const base = `http://127.0.0.1:${server.address().port}`
  const get = async (urlPath, init) => {
    const res = await fetch(base + urlPath, init)
    const text = await res.text()
    return { status: res.status, headers: res.headers, body: text ? JSON.parse(text) : null }
  }
  const close = () => new Promise((resolve) => server.close(resolve))
  return { get, close, base }
}

// Checks the error envelope, its code and the no-store header.
function assertError(res, status, code) {
  assert.equal(res.status, status, JSON.stringify(res.body))
  assert.ok(res.body && res.body.error, 'error envelope')
  assert.equal(res.body.error.status, status)
  assert.equal(res.body.error.code, code)
  assert.equal(typeof res.body.error.message, 'string')
  assert.ok(res.body.error.message.length > 0)
  assert.equal(res.body.data, undefined)
  assert.equal(res.headers.get('cache-control'), 'no-store')
}

// Checks the success envelope and returns the payload.
function assertOk(res) {
  assert.equal(res.status, 200, JSON.stringify(res.body)?.slice(0, 300))
  assert.ok(res.body && Object.hasOwn(res.body, 'data'), 'data envelope')
  assert.deepEqual(Object.keys(res.body).filter((k) => k !== 'data' && k !== 'meta'), [])
  return res.body.data
}

module.exports = { startServer, assertError, assertOk, readData, DATA }
