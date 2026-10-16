// Declares a read-only resource on a router: GET (and HEAD, which Express
// answers with the GET handler) runs `handler`; any other method on the same
// path is a 405 method_not_allowed with an Allow header, instead of a
// misleading 404. When write endpoints arrive (e.g. POST /areas), give the
// route its own .post() before the .all().
//
// Express 5 forwards rejected promises to the error handler, so async
// handlers can simply throw HttpErrors.

const { methodNotAllowed } = require('./errors')

function getOnly(router, path, handler) {
  router.route(path).get(handler).all(methodNotAllowed(['GET', 'HEAD']))
}

// The services object built for this app (see app.js).
const servicesOf = (req) => req.app.locals.services

module.exports = { getOnly, servicesOf }
