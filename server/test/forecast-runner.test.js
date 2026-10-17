// The process runner (src/forecast/runner.js) against a stand-in module
// (support/fake-forecaster.js, run with node instead of python): the
// stdin/stdout contract, exit codes, timeouts and concurrency.

const { test, describe } = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { createProcessRunner, RunnerError } = require('../src/forecast/runner')
const { fakeResponse } = require('./support/forecast')

const STAND_IN = path.join(__dirname, 'support', 'fake-forecaster.js')
const runnerWith = (options = {}) => createProcessRunner({ command: process.execPath, args: [STAND_IN], cwd: __dirname, ...options })

const request = (id = 'jaipur') => ({
  version: 2, area: { id, name: id, center: { lat: 0, lon: 0 }, halfWidthKm: 1 }, interval: 'monthly',
  columns: ['date', 'NDVI', 'AirTemp_C'], rows: [['2026-01-01', 0.3, 20.1], ['2026-02-01', 0.31, 22.4], ['2026-03-01', null, 26]],
  target: 'NDVI', horizon: 2, models: ['ridge'], options: { testFraction: 0.2, seed: 42, lags: 2 },
})

async function rejectsWith(promise, code, pattern) {
  await assert.rejects(promise, (err) => {
    assert.ok(err instanceof RunnerError, String(err))
    assert.equal(err.code, code)
    if (pattern) assert.match(err.message, pattern)
    return true
  })
}

describe('process runner', () => {
  test('writes the request to stdin and parses the response from stdout', async () => {
    const res = await runnerWith().run(request())
    assert.deepEqual(res, fakeResponse(request()))
  })

  test('exit 2 is invalid_input with the module message', async () => {
    await rejectsWith(runnerWith().run(request('refuse')), 'invalid_input', /horizon must be 1\.\.24/)
  })

  test('exit 1 is model_failure; stderr is kept for the log', async () => {
    await assert.rejects(runnerWith().run(request('crash')), (err) => {
      assert.equal(err.code, 'model_failure')
      assert.match(err.stderr, /ValueError: boom/)
      return true
    })
  })

  test('a missing package is unavailable, not a model failure', async () => {
    await rejectsWith(runnerWith().run(request('no-module')), 'unavailable', /not installed/)
  })

  test('unreadable output is model_failure', async () => {
    await rejectsWith(runnerWith().run(request('garbage')), 'model_failure', /unreadable/)
  })

  test('a missing interpreter is unavailable', async () => {
    await rejectsWith(createProcessRunner({ command: path.join(__dirname, 'no-such-python') }).run(request()), 'unavailable', /ENOENT/)
  })

  test('a run past the timeout is stopped and reported as timeout', async () => {
    const started = Date.now()
    await rejectsWith(runnerWith({ timeoutMs: 300 }).run(request('hang')), 'timeout', /300 ms/)
    assert.ok(Date.now() - started < 5000)
  })

  test('runs beyond maxConcurrent wait their turn', async () => {
    const runner = runnerWith({ maxConcurrent: 1, timeoutMs: 400 })
    // The hanging run holds the only slot until its timeout; the next one
    // must still succeed afterwards (its own timeout starts when it starts).
    const results = await Promise.allSettled([runner.run(request('hang')), runner.run(request())])
    assert.equal(results[0].status, 'rejected')
    assert.equal(results[0].reason.code, 'timeout')
    assert.equal(results[1].status, 'fulfilled')
  })
})
