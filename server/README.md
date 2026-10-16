# Competition Web App: server

Express 5 API that serves the website's data: areas (cities), monthly climate
and vegetation series, district outlines, map layers with their per-pixel
values, and basemap metadata. The API is versioned under **`/api/v1`** and
documented in **[docs/API.md](docs/API.md)** (conventions, every endpoint,
error codes, planned endpoints, how to extend it).

For now the data comes from the JSON files in `data/` (the same data the website
used to bundle). Nothing is pulled live from NASA or Earth Engine yet; see
[Later: live data](#later-live-data). The code is built so a live source plugs
in as another *provider* without touching routes.

## Run it

Requires Node 22 (the repo pins it in `.nvmrc`; Node 20+ works for the server).

```sh
nvm use               # from the repo root
cd server
npm install
npm run dev           # restarts on file changes (nodemon)
npm start             # plain node
npm test              # node:test suite, starts the app on a random port
```

The API listens on `http://localhost:5050`. The client's Vite dev server
(`npm run dev` in `client/`) proxies `/api` there.

### Settings (`.env`)

Copy `.env.example` to `.env` (not committed) and adjust:

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `5050` | Port to listen on |
| `CORS_ORIGINS` | unset = any origin (`*`) | Comma-separated origins allowed to call the API from a browser, e.g. `http://localhost:5173,https://your-site.vercel.app` |
| `DATA_PROVIDER` | `files` | Where the data comes from (see `src/providers/index.js`); only `files` exists today |
| `TIMESERIES_MAX_VALUES` | `500000` | Largest `/timeseries` response (areas x parameters x times); bigger requests get `400 invalid_query` |

**Why 5050 and not 5000:** on macOS the AirPlay Receiver listens on port 5000, and requests to `localhost:5000` reach it instead (an empty `403` from `AirTunes`). If you change `PORT`, also change the proxy in `client/vite.config.js` and `@baseUrl` in `api.http` (and `baseUrl` in the Postman collection). The server checks at startup that it really answers on its port and prints a warning if not.

## Layout

```
index.js                 loads .env, starts listening, checks the port really answers
src/app.js               builds the app: CORS, /api/v1 router, 404 and error handlers (no listen)
src/config.js            settings from the environment (PORT, CORS_ORIGINS, DATA_PROVIDER)
src/http/                HTTP plumbing shared by all routes
  respond.js             ok(res, data, meta) envelope, Cache-Control policies
  errors.js              HttpError + error codes, 404/405 handlers, JSON error handler
  query.js               query conventions: lists, "*", repeats, interval, from/to, include
  route.js               getOnly(): GET/HEAD route with 405 for other methods
src/routes/v1/           one file per resource: health, parameters, areas, timeseries,
                         layers, basemap; index.js mounts them under /api/v1
src/services/            logic between routes and provider, one file per resource:
                         catalog validation, "*" resolution, includes, interval checks
src/catalog/             what things mean, declarative and easy to extend:
  parameters.js          labels, units, aggregation of every parameter
  layers.js              what each map layer means (title, source, value scale/unit)
  intervals.js           time intervals and their time formats (monthly series, yearly layer times)
src/providers/           where the numbers come from
  types.js               the provider contract (JSDoc), all methods async
  files.js               reads data/ once at startup and adapts it to the contract
  index.js               picks the provider from DATA_PROVIDER
docs/API.md              API reference
data/                    the data files (see "Data files")
test/                    node:test suites (npm test); test/support/ holds helpers
api.http                 every request, for the VS Code REST Client extension
collections/             Postman v2.1 collection (Postman, Bruno, Insomnia)
```

A request flows `routes/v1` (parse HTTP) -> `services` (validate against
`catalog`, resolve `*`) -> `providers` (fetch raw numbers) and back as
`{ "data": ..., "meta": ... }`. See [docs/API.md, How to add](docs/API.md#how-to-add)
for adding a parameter, area, layer, provider or interval.

## Endpoints

Full reference with examples: [docs/API.md](docs/API.md).

| Endpoint | Returns |
| --- | --- |
| `GET /api/v1/health` | service status, versions, data timestamp |
| `GET /api/v1/parameters[/:key]` | parameter metadata (label, unit, aggregation, intervals) |
| `GET /api/v1/areas[?type=&include=boundary,layers]` | areas with region, center and coverage |
| `GET /api/v1/areas/:areaId[?include=]` | one area |
| `GET /api/v1/areas/:areaId/boundary` | district outline (GeoJSON Feature) |
| `GET /api/v1/timeseries?areas=&type=&parameters=&from=&to=&interval=` | series for many areas (size-limited) |
| `GET /api/v1/areas/:areaId/timeseries` | series for one area |
| `GET /api/v1/areas/:areaId/layers[/:layerId]` | map layers (bounds, times, image paths, values link) |
| `GET /api/v1/areas/:areaId/layers/:layerId/values[?time=]` | per-pixel integer grids behind a layer |
| `GET /api/v1/basemap` | satellite mosaics (bounds, zoom, image paths) |

Success: `{ "data": ..., "meta": {...} }`. Errors:
`{ "error": { "status", "code", "message", "details"? } }` with codes
`not_found`, `invalid_parameter`, `invalid_query`, `unsupported_interval`,
`method_not_allowed`, `internal_error`. Data responses send
`Cache-Control: public, max-age=300`; `/health` and errors send `no-store`.
The old unversioned endpoints (`/api/climate`, `/api/cities/...`, `/api/map/...`)
were removed when v1 was introduced.

## Tests

`npm test` runs `test/*.test.js` with `node:test` against the real app on a
random port:

| File | Covers |
| --- | --- |
| `v1.test.js` | every endpoint: envelopes, filters, `*`, merged repeats, clipping, includes, layer values |
| `http.test.js` | every error code, cache and CORS headers, 404/405, removed old endpoints |
| `providers.test.js` | the provider contract: services pass area records, the files provider handles unknown (custom) areas, `layers.extra.json` |
| `equivalence.test.js` | nothing lost: `climate.json`, boundaries, raster metadata, pixel grids and `mapmeta.json` rebuilt from v1 responses equal the files |
| `data.test.js` | `data/` is still byte-identical to the client's bundled copies (skips once those are gone) |

## Testing the API by hand

Start the server first (`npm run dev`). Then use any of these; all are free.

**VS Code: REST Client extension (recommended).** Install "REST Client"
(publisher Huachao Mao, id `humao.rest-client`), open `api.http` and click
**Send Request** above any request. The file has every endpoint plus an example
of every error code, each with the status to expect. `@baseUrl` at the top sets
the server address (change it for another `PORT` or a deployed URL). JetBrains
IDEs run the same file with their built-in HTTP client.

**A browser.** Every endpoint is a GET, so you can open e.g.
http://localhost:5050/api/v1/areas/jaipur/timeseries?parameters=ndvi&from=2024-01 directly.

**Postman, Bruno or Insomnia.** `collections/competition-web-app.postman_collection.json`
is a Postman v2.1 collection (Service, Areas, Timeseries, Layers, Basemap and
Errors folders) that these apps import for free. Requests use the `{{baseUrl}}`
variable, default `http://localhost:5050`. Thunder Client can import it too, but
importing collections needs a paid Thunder Client plan.

## Data files

The files provider (`src/providers/files.js`) reads these once at startup and
adapts them to the generic model; the files themselves keep their original shapes.

| File | Contents | Served as |
| --- | --- | --- |
| `data/climate.json` | `{ months, cities: { id: { name, state, lat, lon, series } } }` | `/areas`, `/timeseries` |
| `data/boundaries.json` | `{ id: GeoJSON geometry }` | `/areas/:id/boundary`, `include=boundary` |
| `data/rasters.json` | raster bounds and image paths per city | `/areas/:id/layers` |
| `data/pixels/<id>.json` | per-pixel grids per city | `/areas/:id/layers/:layerId/values` |
| `data/layers.extra.json` | `{ id: [layer record] }`: extra layers of an area that are not in `rasters.json` (today the Sentinel-2 images of Jaisalmer) | `/areas/:id/layers` |
| `data/mapmeta.json` | basemap mosaic bounds and zoom | `/basemap` |

These started as byte-identical copies of `client/src/data/*.json` and
`client/public/map/raster/<id>/values.json`; `test/data.test.js` checks they
still match while the client copies exist. `layers.extra.json` has no client
copy (the client keeps its own fallback constants in `lib/map/layers.js`). In `rasters.json` the `values` field
is ignored (the grids come from `pixels/`).

To update the data, replace the files and restart the server. Keep the shapes
above. To add a parameter, area, layer or interval, see
[docs/API.md, How to add](docs/API.md#how-to-add).

## Later: live data

The plan is to replace the static files with data pulled from the original
sources, while the website keeps reading the same API. Findings so far:

- **Weather (NASA POWER).** The monthly point API
  (`https://power.larc.nasa.gov/api/temporal/monthly/point`, `community=AG`, no
  key needed) reproduces the site's weather series **exactly** with:

  | Site key | POWER parameter |
  | --- | --- |
  | `rain` | `PRECTOTCORR` (mm/day) x days in the month |
  | `tair` | `T2M` |
  | `tmax` | `T2M_MAX` |
  | `tmin` | `T2M_MIN` |
  | `dew` | `T2MDEW` |
  | `rh` | `RH2M` |
  | `wind` | `WS2M` |
  | `sm_top` | `GWETTOP` x 100 |
  | `sm_root` | `GWETROOT` x 100 |
  | `albedo` | `ALLSKY_SRF_ALB` |
  | `uv` | `ALLSKY_SFC_UV_INDEX` |
  | `aod` | `AOD_55` |
  | `sun` | `ALLSKY_SFC_SW_DWN` (MJ/m²/day) |

  One request per city for all parameters and years takes about 1–2 s.

- **NDVI (MODIS MOD13Q1).** The ORNL DAAC MODIS subset REST API
  (`https://modis.ornl.gov/rst/api/v1/MOD13Q1/subset?latitude=..&longitude=..&band=250m_16_days_NDVI&startDate=AYYYYDDD&endDate=..&kmAboveBelow=5&kmLeftRight=5`,
  header `Accept: application/json`; up to about 10 dates per request, about 25 s
  per request) returns the same 41 x 41 grid as the site's rasters. The site's
  monthly NDVI is, for each month, the **maximum** over that month's 16-day
  composites of the box mean of all valid pixels (value > -3000, scale 0.0001,
  no QC filtering). Verified exactly for Jaipur, Jul–Sep 2026.

- **Land surface temperature (MODIS MOD11A2).** Same API, bands
  `LST_Day_1km` / `LST_Night_1km`, scale 0.02 K, then convert to °C. The monthly
  aggregation rule is **not verified yet**.

- **Approach.** Backfill everything once, then fetch only new months on a
  schedule, write them into the data files, and keep serving files to the
  frontend so a slow or failed upstream request never reaches a visitor.
