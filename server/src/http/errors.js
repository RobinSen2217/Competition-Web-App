// HttpError and the error/404/405 middleware. Every failure leaves the API as
//   {"error": {"status": <int>, "code": "<snake_case>", "message": "...", "details"?: {...}}}
// with the same HTTP status. `code` is the stable, machine-readable part: clients
// should branch on it, never on `message` (which is for humans and may change).

const CODES = {
  NOT_FOUND: 'not_found', // unknown route or resource (area, layer, time, parameter by path)
  INVALID_PARAMETER: 'invalid_parameter', // unknown parameter key in a query
  INVALID_QUERY: 'invalid_query', // malformed or unsupported query value
  UNSUPPORTED_INTERVAL: 'unsupported_interval', // interval the API (or that data) does not offer
  METHOD_NOT_ALLOWED: 'method_not_allowed', // known path, wrong HTTP method
  INSUFFICIENT_DATA: 'insufficient_data', // valid request, but the area has too little data for it (e.g. a forecast)
  INTERNAL_ERROR: 'internal_error', // a bug; details go to the server log only
  MODEL_FAILURE: 'model_failure', // the forecasting module failed on this request
  FORECAST_UNAVAILABLE: 'forecast_unavailable', // the module cannot run now and no saved forecast matches
}

class HttpError extends Error {
  constructor(status, code, message, details) {
    super(message)
    this.status = status
    this.code = code
    if (details !== undefined) this.details = details
  }
}

// Shorthands so call sites read as intent, e.g. `throw notFound('...')`.
const notFound = (message, details) => new HttpError(404, CODES.NOT_FOUND, message, details)
const invalidQuery = (message, details) => new HttpError(400, CODES.INVALID_QUERY, message, details)
const invalidParameter = (message, details) => new HttpError(400, CODES.INVALID_PARAMETER, message, details)
const unsupportedInterval = (message, details) => new HttpError(400, CODES.UNSUPPORTED_INTERVAL, message, details)
const insufficientData = (message, details) => new HttpError(422, CODES.INSUFFICIENT_DATA, message, details)
const modelFailure = (message, details) => new HttpError(502, CODES.MODEL_FAILURE, message, details)
const forecastUnavailable = (message, details) => new HttpError(503, CODES.FORECAST_UNAVAILABLE, message, details)

// Mounted after all routes: anything that reaches here matched no path.
function notFoundHandler(req, res, next) {
  next(notFound(`No route for ${req.method} ${req.path}. See /api/v1/health and docs/API.md.`))
}

// Attached with .all() after a route's handlers: the path exists, the method does not.
function methodNotAllowed(allowed = ['GET', 'HEAD']) {
  return (req, res, next) => {
    res.set('Allow', allowed.join(', '))
    next(new HttpError(405, CODES.METHOD_NOT_ALLOWED, `${req.method} is not supported on ${req.baseUrl}${req.path}`, { allowed }))
  }
}

// Express recognises an error handler by its four arguments, so `next` must stay
// in the signature even though it is unused.
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  // Errors raised by Express or body/URL parsing carry `status` but no `code`.
  const raw = Number(err.status || err.statusCode) || 500
  const status = raw >= 400 && raw < 600 ? raw : 500
  // An HttpError was written for the client, even a 5xx one (e.g. 503
  // forecast_unavailable); anything else that fails is a bug whose text must
  // not leak, so it becomes a generic 500 and goes to the log.
  const deliberate = err instanceof HttpError
  if (status >= 500 && !deliberate) console.error(err)
  let code
  if (deliberate) code = err.code
  else if (status >= 500) code = CODES.INTERNAL_ERROR
  else if (status === 404) code = CODES.NOT_FOUND
  else if (status === 405) code = CODES.METHOD_NOT_ALLOWED
  else code = CODES.INVALID_QUERY // e.g. a malformed percent-encoding in the URL
  const body = {
    status,
    code,
    message: status >= 500 && !deliberate ? 'Internal server error' : err.message,
  }
  if ((status < 500 || deliberate) && err.details !== undefined) body.details = err.details
  // Never let a cache keep an error response around.
  res.set('Cache-Control', 'no-store')
  res.status(status).json({ error: body })
}

module.exports = {
  CODES, HttpError, notFound, invalidQuery, invalidParameter, unsupportedInterval,
  insufficientData, modelFailure, forecastUnavailable,
  notFoundHandler, methodNotAllowed, errorHandler,
}
