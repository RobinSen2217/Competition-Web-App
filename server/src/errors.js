// Error helpers shared by every route.
// All failures leave the API as {"error":{"status":<int>,"message":"..."}} with the
// same HTTP status, so clients (and Thunder Client tests) can rely on one shape.

class HttpError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

// Mounted after all routes: anything that reaches here matched no route.
function notFound(req, res, next) {
  next(new HttpError(404, `No route for ${req.method} ${req.path}`))
}

// Express recognises an error handler by its four arguments, so `next` must stay
// in the signature even though it is unused.
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  // Errors from Express itself or its middleware (e.g. a malformed URL) carry
  // `status`/`statusCode`; anything else is a bug in our code and becomes a 500.
  const status = Number(err.status || err.statusCode) || 500
  const safe = status >= 400 && status < 600 ? status : 500
  if (safe >= 500) console.error(err)
  // Never let a cache keep an error response around.
  res.set('Cache-Control', 'no-store')
  res.status(safe).json({
    error: {
      status: safe,
      // Do not leak internal error text for server faults.
      message: safe >= 500 ? 'Internal server error' : err.message,
    },
  })
}

module.exports = { HttpError, notFound, errorHandler }
