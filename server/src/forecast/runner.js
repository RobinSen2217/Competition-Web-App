// Runs the forecasting module ("black box", server/ml) for the forecast
// service. The service only knows this small interface, so the module can move
// behind something else later (an HTTP model service, a JS port of the model)
// without touching the service, and tests can pass a fake:
//
//   runner.run(request) -> Promise<response>   request/response: server/ml/README.md
//                                               and docs/API.md "Forecasts"
//   rejects with a RunnerError whose `code` is one of RUNNER_ERRORS
//
// The default implementation starts `python -m forecaster` per request, writes
// the request JSON to its stdin and reads one JSON response from its stdout.
// A process per request keeps the module stateless and crash-isolated; one run
// takes a few seconds, and the service caches results, so the start-up cost
// does not matter.

const { spawn } = require('node:child_process')
const path = require('node:path')
const { DEFAULT_FORECAST_TIMEOUT_MS } = require('../config')

const ML_DIR = path.join(__dirname, '..', '..', 'ml')
// The module's own virtual environment (see server/README.md, "Forecasts").
const DEFAULT_PYTHON = path.join(ML_DIR, '.venv', process.platform === 'win32' ? 'Scripts\\python.exe' : 'bin/python')

const RUNNER_ERRORS = {
  UNAVAILABLE: 'unavailable', // the module cannot be started (no python, package not installed)
  TIMEOUT: 'timeout', // it ran longer than the timeout and was stopped
  INVALID_INPUT: 'invalid_input', // it refused the request (exit 2)
  MODEL_FAILURE: 'model_failure', // it failed while running, or answered something unreadable
}

class RunnerError extends Error {
  constructor(code, message, { cause, stderr } = {}) {
    super(message, cause ? { cause } : undefined)
    this.name = 'RunnerError'
    this.code = code
    // Last lines the module logged; for the server log only, never for clients.
    if (stderr) this.stderr = stderr
  }
}

// At most `max` tasks at a time; the rest wait in order. Each run trains
// several models on all CPU cores it can get, so a burst of different
// requests (six cities at once) should queue rather than overload the machine.
function limiter(max) {
  let active = 0
  const waiting = []
  const next = () => {
    if (active >= max || !waiting.length) return
    active++
    const { task, resolve, reject } = waiting.shift()
    task().then(resolve, reject).finally(() => {
      active--
      next()
    })
  }
  return (task) => new Promise((resolve, reject) => {
    waiting.push({ task, resolve, reject })
    next()
  })
}

const tail = (text, max = 2000) => (text.length > max ? `...${text.slice(-max)}` : text)

/**
 * @param {{command?: string, args?: string[], cwd?: string, timeoutMs?: number,
 *          maxConcurrent?: number, maxOutputBytes?: number}} [options]
 *        command/args default to the module's venv python with `-m forecaster`;
 *        tests swap in a stand-in script.
 */
function createProcessRunner({
  command = DEFAULT_PYTHON,
  args = ['-m', 'forecaster'],
  cwd = ML_DIR,
  timeoutMs = DEFAULT_FORECAST_TIMEOUT_MS,
  maxConcurrent = 2,
  maxOutputBytes = 20 * 1024 * 1024,
} = {}) {
  const queue = limiter(maxConcurrent)

  function runOnce(request) {
    return new Promise((resolve, reject) => {
      let child
      try {
        // PYTHONHASHSEED pins Python's hash randomisation, one less source of
        // run-to-run differences (the module also fixes its own seeds).
        child = spawn(command, args, { cwd, env: { ...process.env, PYTHONHASHSEED: '0' }, stdio: ['pipe', 'pipe', 'pipe'] })
      } catch (err) {
        reject(new RunnerError(RUNNER_ERRORS.UNAVAILABLE, `Cannot start the forecasting module (${command}): ${err.message}`, { cause: err }))
        return
      }

      let stdout = ''
      let stderr = ''
      let size = 0
      let settled = false
      const finish = (fn, value) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        fn(value)
      }
      const fail = (code, message, extra) => {
        if (child.exitCode === null && !child.killed) child.kill('SIGKILL')
        finish(reject, new RunnerError(code, message, { stderr: tail(stderr), ...extra }))
      }

      const timer = setTimeout(() => {
        fail(RUNNER_ERRORS.TIMEOUT, `The forecasting module did not answer within ${timeoutMs} ms`)
      }, timeoutMs)

      child.stdout.setEncoding('utf8')
      child.stderr.setEncoding('utf8')
      child.stdout.on('data', (chunk) => {
        size += Buffer.byteLength(chunk)
        if (size > maxOutputBytes) return fail(RUNNER_ERRORS.MODEL_FAILURE, `The forecasting module wrote more than ${maxOutputBytes} bytes`)
        stdout += chunk
      })
      // Keep only the end: it holds the traceback when something goes wrong.
      child.stderr.on('data', (chunk) => { stderr = tail(stderr + chunk, 8000) })

      // ENOENT/EACCES: the interpreter is missing or not executable.
      child.on('error', (err) => {
        fail(RUNNER_ERRORS.UNAVAILABLE, `Cannot start the forecasting module (${command}): ${err.code || err.message}`, { cause: err })
      })

      child.on('close', (exitCode, signal) => {
        if (settled) return
        let body = null
        try {
          body = stdout.trim() ? JSON.parse(stdout) : null
        } catch {
          // handled below: unreadable output is a model failure
        }
        const reported = body && body.error && typeof body.error.message === 'string' ? body.error.message : null
        if (exitCode === 0 && body && !body.error) return finish(resolve, body)
        if (exitCode === 2) return fail(RUNNER_ERRORS.INVALID_INPUT, reported || 'The forecasting module refused the request')
        // Python exits 1 with nothing on stdout when the package itself is
        // missing; that is a setup problem, not a model failure.
        if (exitCode === 1 && !body && /No module named/.test(stderr)) {
          return fail(RUNNER_ERRORS.UNAVAILABLE, 'The forecasting module is not installed in this Python environment')
        }
        const how = signal ? `was stopped by ${signal}` : exitCode === 0 ? 'answered with unreadable output' : `exited with code ${exitCode}`
        return fail(RUNNER_ERRORS.MODEL_FAILURE, reported || `The forecasting module ${how}`)
      })

      // The child may exit before reading everything (e.g. a bad interpreter);
      // the close handler reports that, so a broken pipe here is not an error.
      child.stdin.on('error', () => {})
      child.stdin.end(JSON.stringify(request))
    })
  }

  return {
    name: 'process',
    run: (request) => queue(() => runOnce(request)),
  }
}

module.exports = { createProcessRunner, RunnerError, RUNNER_ERRORS, DEFAULT_PYTHON, ML_DIR }
