// Entry point: loads .env, builds the app and starts listening.
// The app itself lives in src/app.js so tests can start it on their own port.

require('dotenv').config({ quiet: true })
const { createApp } = require('./src/app')
const { loadConfig } = require('./src/config')

const PORT = loadConfig().port

createApp().listen(PORT, async () => {
  console.log(`Server running on port ${PORT}`)
  // Another program can answer on the same port even though listen()
  // succeeded (e.g. macOS AirPlay Receiver on 5000, replying with empty 403s).
  // Ask ourselves for /api/v1/health to catch that.
  try {
    const res = await fetch(`http://localhost:${PORT}/api/v1/health`)
    const body = await res.json()
    if (body?.data?.service !== 'competition-web-app-api') throw new Error('unexpected reply')
  } catch {
    console.warn(
      `Warning: http://localhost:${PORT} is answered by another program, not this API. ` +
        'On macOS turn off System Settings > General > AirDrop & Handoff > AirPlay Receiver, ' +
        'or set PORT to a free port in server/.env.',
    )
  }
})
