// Stand-in for `python -m forecaster` in the runner tests: reads one JSON
// request from stdin and behaves according to request.area.id (or the first
// command-line argument, when the area must stay a real one, as in the API
// tests), so every exit path of the real module can be produced without Python.

const { fakeResponse } = require('./forecast')

let input = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (c) => { input += c })
process.stdin.on('end', () => {
  const req = JSON.parse(input)
  const out = (body) => process.stdout.write(JSON.stringify(body))
  switch (process.argv[2] || req.area.id) {
    case 'refuse':
      out({ error: { code: 'invalid_input', message: 'horizon must be 1..24' } })
      process.exit(2)
      break
    case 'too-few':
      out({ error: { code: 'invalid_input', message: 'Only 20 month(s) have every input; need at least 24 for training and 2 for testing.' } })
      process.exit(2)
      break
    case 'crash':
      process.stderr.write('Traceback (most recent call last):\n  ValueError: boom\n')
      out({ error: { code: 'model_failure', message: 'ValueError: boom' } })
      process.exit(1)
      break
    case 'no-module':
      process.stderr.write("/usr/bin/python3: No module named forecaster\n")
      process.exit(1)
      break
    case 'garbage':
      process.stdout.write('not json')
      break
    case 'hang':
      setTimeout(() => {}, 60000)
      break
    default:
      process.stderr.write('training...\n') // logs go to stderr and must not disturb stdout
      out(fakeResponse(req))
  }
})
