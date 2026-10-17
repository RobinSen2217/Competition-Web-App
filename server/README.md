# Competition Web App: server

Express 5 API that serves the website's data: areas (cities), monthly climate
and vegetation series, district outlines, map layers with their per-pixel
values, basemap metadata, machine-learning forecasts of vegetation
greenness, and hazard events (floods) with their daily rainfall, soil
moisture passes and a 3-day flood forecast with danger classes. The API is versioned under **`/api/v1`** and
documented in **[docs/API.md](docs/API.md)** (conventions, every endpoint,
error codes, planned endpoints, how to extend it).

For now the data comes from the JSON files in `data/` (the same data the website
used to bundle). The forecasts are the exception: they run on Earth Engine
tables downloaded by `npm run gee:extract` (see [Forecasts](#forecasts)), and
the hazards are read from `data/hazards/`, written by the Python package in
`ml/` (see [Hazards](#hazards)).
Nothing else is pulled live from NASA or Earth Engine yet; see
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
| `FORECAST_MODE` | `live` | `live`: run the forecasting module, falling back to saved snapshots if it cannot run; `snapshot`: never start Python, serve snapshots only (see [Forecasts](#forecasts)) |
| `FORECAST_PYTHON` | `ml/.venv/bin/python` | Python interpreter with the forecasting module installed |
| `FORECAST_TIMEOUT_MS` | `60000` | A forecast run taking longer is stopped (and the snapshot served, if any) |
| `FORECAST_RETRY_AFTER_MS` | `60000` | After a run that could not start or timed out, the same request (area and query) goes straight to the snapshot for this long; `0` = always try the module |
| `GEE_PROJECT` | `miicproject2` | Google Cloud project for the Earth Engine login of `npm run gee:*` (see [Forecasts](#forecasts)) |
| `GEE_SERVICE_ACCOUNT_KEY` | unset | Path to a service-account JSON key, relative to `server/` (keep it in `secrets/`, git-ignored; never commit it). Unset = your `earthengine authenticate` login |
| `GEE_CREDENTIALS` | unset | Personal login as an env var: the contents of `~/.config/earthengine/credentials` (after `earthengine authenticate`). Used when no service-account key is set; keep it secret |

**Why 5050 and not 5000:** on macOS the AirPlay Receiver listens on port 5000, and requests to `localhost:5000` reach it instead (an empty `403` from `AirTunes`). If you change `PORT`, also change the proxy in `client/vite.config.js` and `@baseUrl` in `api.http` (and `baseUrl` in the Postman collection). The server checks at startup that it really answers on its port and prints a warning if not.

## Layout

```
index.js                 loads .env, starts listening, checks the port really answers
src/app.js               builds the app: CORS, /api/v1 router, 404 and error handlers (no listen)
src/config.js            settings from the environment (PORT, CORS_ORIGINS, DATA_PROVIDER, FORECAST_*, GEE_*)
src/http/                HTTP plumbing shared by all routes
  respond.js             ok(res, data, meta) envelope, Cache-Control policies
  errors.js              HttpError + error codes, 404/405 handlers, JSON error handler
  query.js               query conventions: lists, "*", repeats, interval, from/to, include
  route.js               getOnly(): GET/HEAD route with 405 for other methods
src/routes/v1/           one file per resource: health, parameters, areas, timeseries,
                         layers, forecasts, hazards, basemap; index.js mounts them under /api/v1
src/services/            logic between routes and provider, one file per resource:
                         catalog validation, "*" resolution, includes, interval checks
src/catalog/             what things mean, declarative and easy to extend:
  parameters.js          labels, units, aggregation of every parameter
  layers.js              what each map layer means (title, source, value scale/unit)
  intervals.js           time intervals and their time formats (monthly series, daily hazard
                         series, yearly layer times)
  hazards/               hazard types: index.js (registry, evaluation roles) + one file per
                         hazard (flood.js: its parameters, tables/columns, forecast snapshot)
src/providers/           where the numbers come from
  types.js               the provider contract (JSDoc), all methods async
  files.js               reads data/ once at startup and adapts it to the contract
  index.js               picks the provider from DATA_PROVIDER
  hazards.js             the hazard provider: reads data/hazards/<hazard>/ (events.json,
                         per-event CSVs, model snapshots, layers.json + layer images),
                         re-reads files when they change
src/util/csv.js          CSV parser shared by the Earth Engine tables and the hazard tables
src/catalog/forecasts.js forecastable parameters, their input series, models, horizon limits
src/forecast/            how forecasts are computed and saved
  runner.js              runs the forecasting module (python -m forecaster) per request;
                         replaceable by any object with run(request) -> Promise<response>
  snapshots.js           reads, trims and writes saved forecasts (data/forecasts/)
  tables.js              reads the Earth Engine feature tables (data/gee/) the forecasts run on
ml/                      the forecasting module and the hazard import/models (Python, own README and tests)
scripts/build-forecasts.js  npm run forecasts:build: saves a forecast snapshot per area with a table
scripts/gee.js           npm run gee:check / gee:extract: the Earth Engine pipeline in ml/ with .env credentials
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
| `GET /api/v1/areas/:areaId/forecasts[?parameters=ndvi&horizon=12&models=ridge,nn,gbm]` | NDVI forecast by three ML models, with accuracy, back-test and drivers |
| `GET /api/v1/basemap` | satellite mosaics (bounds, zoom, image paths) |
| `GET /api/v1/hazards[/:hazard]` | hazard types (flood) and what each provides; one with its dataset and model scores |
| `GET /api/v1/hazards/:hazard/parameters[/:key]` | what can be plotted for an event: daily series and irregular observations |
| `GET /api/v1/hazards/:hazard/events[?country=&bbox=&include=layers]` | events with country, period, bbox, cause, coverage (incl. layer ids), forecast status |
| `GET /api/v1/hazards/:hazard/events/:eventId[?include=layers]` | one event with notes, summary and sources |
| `GET /api/v1/hazards/:hazard/events/:eventId/layers[/:layerId]` | the event's map layers (e.g. the reference water extent): bounds, legend, stats, source, image url |
| `GET /api/v1/hazards/:hazard/events/:eventId/layers/:layerId/image` | the layer's overlay PNG (cached for a day) |
| `GET /api/v1/hazards/:hazard/events/:eventId/timeseries[?parameters=&from=&to=]` | daily rainfall and flood-period flag, soil moisture passes |
| `GET /api/v1/hazards/:hazard/events/:eventId/forecast[?models=&from=&to=]` | per day: flood probability, threshold and danger class per model, actual outcome, scores |

Success: `{ "data": ..., "meta": {...} }`. Errors:
`{ "error": { "status", "code", "message", "details"? } }` with codes
`not_found`, `invalid_parameter`, `invalid_query`, `unsupported_interval`,
`method_not_allowed`, `insufficient_data`, `internal_error`, `model_failure`,
`forecast_unavailable`. Data responses send
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
| `forecasts.test.js` | `/forecasts` with a fake module and fake Earth Engine tables (`test/fixtures/gee`): validation, the table sent to the module, areas without a table (`no_gee_data`), caching, snapshot mode and fallback, error mapping |
| `forecast-tables.test.js` | reading the feature tables: CSV as pandas writes it, `areas.json`, re-reading after an extraction |
| `forecast-runner.test.js` | the process runner against a stand-in script: stdin/stdout contract, exit codes, timeout, queueing |
| `forecast-integration.test.js` | the real Python module on the fake tables through the API, and that it is deterministic (skips without `ml/.venv`) |
| `hazards.test.js` | every `/hazards` endpoint on the committed flood dataset, cross-checked with its files and model snapshot: filters (`country`, `bbox`), series and observations, derived rain totals equal to the model inputs, danger classes, out-of-fold vs test roles, Nepal excluded, every error, a dataset without a model (`503 no_model`) or without data, re-reading changed files; event layers (records, stats, the PNG with cache headers and 304, any kind and number of layers, paths that would leave the folder refused) |

The tables in `test/fixtures/gee/` are **synthetic** (seasonal curves and seeded
noise in the notebook's exact 33-column layout, written by
`node test/fixtures/gee/make-fixtures.js`), never real satellite data.

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
is a Postman v2.1 collection (Service, Areas, Timeseries, Layers, Forecasts, Hazards, Basemap and
Errors folders) that these apps import for free. Requests use the `{{baseUrl}}`
variable, default `http://localhost:5050`. Thunder Client can import it too, but
importing collections needs a paid Thunder Client plan.

## Forecasts

`GET /api/v1/areas/:areaId/forecasts` forecasts monthly NDVI up to 24 months
ahead (12 by default, as in the notebook) exactly the way the team's Colab
notebook `GEE_Data_Pipeline_Lat_Long_08_10_26` does: the same Earth Engine
data over a 2 × 2 km box around each area's centre, the same physics
features, and the same three models (Ridge regression, neural network,
gradient boosting). The site's own data (`data/climate.json`) is **not** used
for forecasts. Reference: [docs/API.md](docs/API.md#get-areasareaidforecasts).

It works in two steps, both in the Python package in `ml/` (the "black box";
see [ml/README.md](ml/README.md) for its JSON contract and how it follows the
notebook cell by cell):

1. **Extract** (`npm run gee:extract`, occasionally, needs an Earth Engine
   login): downloads each area's monthly feature table from Google Earth
   Engine into `data/gee/<areaId>.features.csv`, column for column the
   notebook's final CSV. The areas and their boxes are listed in
   `data/gee/areas.json`.
2. **Forecast** (every request, no Earth Engine needed): the server sends the
   area's table to `python -m forecaster` on stdin and reads the answer from
   stdout, so the Node side never knows how the models work.

An area without a table answers `503 forecast_unavailable` with
`details.reason: "no_gee_data"`, and the website says its forecast will
appear once its data has been extracted.

**Set up Python once** (3.12; the venv stays inside `ml/` and is git-ignored;
`requirements.txt` includes the `earthengine-api`):

```sh
cd server/ml
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
```

**Earth Engine login.** The datasets are public, but Earth Engine needs a
login under a Google Cloud project (the notebook's is `miicproject2`). Two
ways, set in `.env` (see `.env.example`):

| Variable | Default | Meaning |
| --- | --- | --- |
| `GEE_PROJECT` | `miicproject2` | Cloud project the Earth Engine requests run under |
| `GEE_SERVICE_ACCOUNT_KEY` | unset | Path (relative to `server/`) to a service-account JSON key, e.g. `secrets/gee-key.json`. Unset = your own login from `earthengine authenticate` |
| `GEE_CREDENTIALS` | unset | Personal login as an env var: the contents of `~/.config/earthengine/credentials` (after `earthengine authenticate`). Used when no service-account key is set; keep it secret |

- **Server / shared setup:** the project owner creates a service account in
  Google Cloud Console for the project (IAM & Admin, Service Accounts) with
  the role *Earth Engine Resource Viewer*, with the Earth Engine API enabled,
  and sends its JSON key securely. Save it as `server/secrets/gee-key.json`
  and set `GEE_SERVICE_ACCOUNT_KEY=secrets/gee-key.json`. `server/secrets/` is
  git-ignored: **never commit a key** (or paste it into an issue or chat).
- **Your own machine:** `ml/.venv/bin/earthengine authenticate` once, with a
  Google account that has access to the project; leave the key unset.

Then:

```sh
npm run gee:check                          # can we log in? one tiny request
npm run gee:extract                        # every area in data/gee/areas.json (slow: minutes per area)
npm run gee:extract -- --area jaisalmer    # one area
npm run gee:extract -- --end 2026-10-01    # data up to (not including) that month; default: this month
npm run forecasts:build                    # refresh the saved forecasts from the new tables
```

Commit the new `data/gee/*.features.csv` (data, no secrets) together with the
rebuilt snapshots.

**Live forecasts.** With the venv in place, `npm run dev` serves live
forecasts for every area that has a table. The first request for an area takes
a few seconds (the models train); the result is cached in memory until that
area's table is rewritten (no restart needed). Use `FORECAST_PYTHON` for
another interpreter.

**Saved forecasts.** `npm run forecasts:build` runs the module for every area
that has a table, at the longest horizon (24 months) with every model, and
writes `data/forecasts/<areaId>.ndvi.json` plus a copy in
`client/public/data/forecasts/` (the website's fallback when the API is not
reachable, e.g. on static hosting). Areas without a table are skipped and
listed. Re-run it after every extraction, then commit both folders. The API
serves these files when it cannot compute live:

- `FORECAST_MODE=live` (default): run the module; if Python or the package is
  missing, the run times out or fails, serve the saved forecast instead
  (`data.source` is `"snapshot"`, `meta.fallback` says why). A run that could
  not start or timed out is remembered for `FORECAST_RETRY_AFTER_MS`, so the
  same request meanwhile gets the saved forecast at once.
- `FORECAST_MODE=snapshot`: never start Python. For a host without Python;
  only the saved forecasts can be served, cut to the requested horizon and
  models. A saved forecast holds 24 months and every model, so it answers any
  valid request; areas without one get `503 forecast_unavailable`.

Saved forecasts made before the Earth Engine pipeline (from `climate.json`)
were deleted and are ignored if one turns up again (they lack `provenance`).
Without Python and without saved forecasts, `/forecasts` answers
`503 forecast_unavailable`; every other endpoint works as before.

## Hazards

`/api/v1/hazards` is the Disaster module. Today it serves **floods**: 10
events from the team notebook `flood_disaster.ipynb` with their daily
satellite rainfall (GPM IMERG) and NISAR soil moisture passes, and the
notebook's Part B forecast: two Random Forests ("rainfall only",
"rainfall + soil moisture") giving, for every day, the probability of the
flood within the next 3 days and a **danger** class when it reaches the
model's threshold (0.55 / 0.75, chosen out-of-fold as in the notebook).
Reference: [docs/API.md, Hazards](docs/API.md#hazards).

Unlike the NDVI forecast, nothing runs per request: both steps run once in
`ml/` (see [ml/README.md, Hazards](ml/README.md#hazards)) and write files the
API reads (`data/hazards/flood/`):

```sh
cd server/ml
# 1. the team's extracted folders (from rainfall.zip and soil_moisture.zip) -> data/hazards/flood/
./hazards-python -m forecaster.hazards import flood --rainfall /path/to/rainfall --soil /path/to/soil_moisture
# 2. the model -> data/hazards/flood/model/forecast.json
./hazards-python -m forecaster.hazards build flood
# 3. (optional) map layers: the notebook's <event>_water_reference.tif files
#    -> data/hazards/flood/layers.json + events/<event>/layers/water-reference.png
./hazards-python -m forecaster.hazards import flood --layers /path/to/folder-with-tifs
```

Step 3 keeps only the derived overlay PNGs (a few hundred KB each) and their
stats; the source GeoTIFFs are not committed, so keep them to rebuild.

The hazard step has its **own Python environment**, `ml/.venv-hazards`
(`requirements-hazards.txt`): the notebook's numbers need scikit-learn 1.8
(1.9 changed how random forests sample), and the NDVI module stays on its own
pins. On an Apple Silicon Mac create it as x86-64, like Colab, to get the
notebook's numbers bit for bit (`arch -x86_64 python3.12 -m venv .venv-hazards`,
then `arch -x86_64 .venv-hazards/bin/pip install -r requirements-hazards.txt`).
`./hazards-python` then runs it under Rosetta by itself, so the commands above
work unchanged with either venv; see the ml README for what differs on arm64. The server needs neither: the committed files are enough.
Commit `data/hazards/` after an import or a build; the running server picks
the files up without a restart.

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
| `data/gee/areas.json` | `[{ id, name, lat, lon, halfWidthKm, state }]`: the box each area's Earth Engine table is extracted for (centres from `climate.json`; Jaisalmer's is the notebook's) | read by `npm run gee:extract` and `/forecasts` |
| `data/gee/<id>.features.csv` | the notebook's monthly feature table, written by `npm run gee:extract` (versioned by its own file time, not part of `dataUpdated`) | the input of `/areas/:id/forecasts` |
| `data/forecasts/<id>.<param>.json` | saved forecasts written by `npm run forecasts:build` (not data: rebuilding them does not change `dataUpdated`) | `/areas/:id/forecasts` when the module cannot run |
| `data/hazards/<hazard>/events.json` | the hazard's events (country, period, bbox, cause, coverage, sources), its tables and their columns, source datasets; written by the hazard import in `ml/` (read by `src/providers/hazards.js`, re-read when it changes, not part of `/health` `dataUpdated`) | `/hazards`, `/hazards/:hazard/events[/:eventId]` |
| `data/hazards/<hazard>/events/<eventId>/*.csv` | per-event tables; flood: `daily.csv` (rain, flood-period flag) and `soil_passes.csv` (satellite passes) | `/hazards/:hazard/events/:eventId/timeseries` |
| `data/hazards/<hazard>/model/forecast.json` | the hazard model's results for every event and day, written by `python -m forecaster.hazards build <hazard>` | `/hazards/:hazard[/events/:eventId/forecast]` |
| `data/hazards/<hazard>/layers.json` | optional map layers per event: label, kind, bounds, legend, stats (native resolution), source, image size and hash; written by `import <hazard> --layers` | `/hazards/:hazard/events/:eventId/layers[/:layerId]`, `coverage.layers`, `include=layers` |
| `data/hazards/<hazard>/events/<eventId>/layers/<layerId>.png` | a layer's overlay image (EPSG:4326, the record's bounds) | `/hazards/:hazard/events/:eventId/layers/:layerId/image` |
| `data/hazards/<hazard>/README.md` | what the dataset holds, generated with it | |

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
