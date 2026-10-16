# Competition Web App: server

Express 5 API that serves the website's data: cities, monthly climate and
vegetation series, district outlines and map raster metadata. For now it serves
the JSON files in `data/` (the same data the website used to bundle). Nothing is
pulled live from NASA or Earth Engine yet; see [Later: live data](#later-live-data).

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

**Why 5050 and not 5000:** on macOS the AirPlay Receiver listens on port 5000, and requests to `localhost:5000` reach it instead (an empty `403` from `AirTunes`). If you change `PORT`, also change the proxy in `client/vite.config.js` and `baseUrl` in the Thunder Client collection. The server checks at startup that it really answers on its port and prints a warning if not.

## Layout

```
index.js            loads .env, starts listening
src/app.js          builds the Express app (CORS, cache headers, routes, errors); no listen
src/data.js         loads data/ once at startup, city lookups, parameter metadata
src/errors.js       HttpError, 404 handler, JSON error handler
src/routes/
  meta.js           /api/health, /api/parameters, /api/climate
  cities.js         /api/cities and /api/cities/:cityId/...
  map.js            /api/boundaries, /api/map/mosaics, /api/map/rasters
data/               the data files (see "Data files")
test/               node:test suites (npm test)
thunder/            Postman v2.1 collection for Thunder Client
```

## Endpoints

All responses are JSON. Data endpoints send `Cache-Control: public, max-age=300`;
`/api/health` and errors send `no-store`. Only `GET` is supported.

| Endpoint | Returns |
| --- | --- |
| `GET /api/health` | service status, data timestamp, counts |
| `GET /api/parameters` | metadata for every series key |
| `GET /api/cities` | all cities |
| `GET /api/cities/:cityId` | one city, its parameter keys and month range |
| `GET /api/cities/:cityId/series` | monthly series, filterable (see below) |
| `GET /api/cities/:cityId/boundary` | district outline (GeoJSON geometry) |
| `GET /api/cities/:cityId/rasters` | raster bounds, image paths, pixels link |
| `GET /api/cities/:cityId/pixels` | per-pixel values behind the raster images |
| `GET /api/climate` | every city with all series (website startup) |
| `GET /api/boundaries` | `{ cityId: geometry }` for every city |
| `GET /api/map/mosaics` | bounds and zoom of every basemap mosaic |
| `GET /api/map/rasters` | `{ cityId: <rasters object> }` for every city |

City ids: `jaipur`, `jodhpur`, `jaisalmer`, `bikaner`, `udaipur`, `delhi`.
Months run from `2010-01` to `2026-09` (201 months).

### Examples (trimmed)

`GET /api/health`

```json
{ "status": "ok", "service": "competition-web-app-api", "dataUpdated": "2026-10-14T17:40:46.681Z", "cities": 6, "months": 201 }
```

`dataUpdated` is the newest modification time among the files in `data/`.

`GET /api/parameters`

```json
{ "parameters": [
  { "key": "ndvi", "label": "Vegetation greenness", "unit": "", "decimals": 2, "group": "Land and surface", "source": "MODIS MOD13Q1", "isSum": false },
  { "key": "rain", "label": "Rainfall", "unit": "mm", "decimals": 0, "group": "Water", "source": "NASA POWER", "isSum": true },
  { "key": "sun", "label": "Sunshine", "unit": "MJ/m²/day", "decimals": 1, "group": "Weather and air", "source": "NASA POWER", "isSum": false },
  ...
] }
```

Keys: `ndvi`, `lst_day`, `lst_night`, `rain`, `tair`, `tmax`, `tmin`, `dew`, `rh`,
`wind`, `sm_top`, `sm_root`, `albedo`, `uv`, `aod`, `sun`. `isSum` marks amounts
that add up over time (rain).

`GET /api/cities`

```json
{ "cities": [ { "id": "jaipur", "name": "Jaipur", "state": "Rajasthan", "lat": 26.9124, "lon": 75.7873 }, ... ] }
```

`GET /api/cities/jaipur`

```json
{ "id": "jaipur", "name": "Jaipur", "state": "Rajasthan", "lat": 26.9124, "lon": 75.7873,
  "parameters": ["ndvi", "lst_day", "lst_night", "rain", ...],
  "months": { "first": "2010-01", "last": "2026-09", "count": 201 } }
```

`GET /api/cities/jaipur/series?params=ndvi,rain&from=2026-07&to=2026-09`

```json
{ "city": "jaipur", "from": "2026-07", "to": "2026-09",
  "months": ["2026-07", "2026-08", "2026-09"],
  "series": { "ndvi": [0.3183, 0.3672, 0.388], "rain": [139.5, 155, null] } }
```

Query parameters (all optional):

- `params`: comma-separated keys from `/api/parameters`. Default: all.
- `from`, `to`: `YYYY-MM`, inclusive. Default: the full range. A range reaching
  outside the data is clipped to the months that exist (possibly none).

`null` means no data for that month and is kept as `null`.

`GET /api/cities/jaipur/boundary`

```json
{ "type": "Polygon", "coordinates": [[[76.0876, 27.8479], [76.0976, 27.8232], ...]] }
```

`GET /api/cities/jaipur/rasters`

```json
{ "ndviBounds": [[26.86875, 75.73956], [26.95417, 75.83535]],
  "lstBounds": [[26.86667, 75.73559], [26.95833, 75.83839]],
  "years": { "2010": "/map/raster/jaipur/ndvi-2010.png", ..., "2026": "/map/raster/jaipur/ndvi-2026.png" },
  "change": "/map/raster/jaipur/change.png",
  "lstDay": "/map/raster/jaipur/lst-day.png",
  "lstNight": "/map/raster/jaipur/lst-night.png",
  "pixels": "/api/cities/jaipur/pixels" }
```

The image paths are static files served by the website (`client/public`), not by
this API. `pixels` points at the endpoint below.

`GET /api/cities/jaipur/pixels`

```json
{ "yearVals": { "2010": [[489, 394, 394, ...], ...], ... },
  "changeVals": [[...], ...],
  "lstDayVals": [[...], ...],
  "lstNightVals": [[...], ...] }
```

Integers: NDVI x 1000 (`yearVals` and `changeVals`, 41 x 41 grids), land surface
temperature x 10 in °C (`lstDayVals`, `lstNightVals`, 11 x 11). `null` = no data.

`GET /api/climate`

```json
{ "months": ["2010-01", ...],
  "cities": { "jaipur": { "name": "Jaipur", "state": "Rajasthan", "lat": 26.9124, "lon": 75.7873,
                          "series": { "ndvi": [...], "rain": [...], ... } }, ... } }
```

`GET /api/boundaries` returns `{ "jaipur": { "type": "Polygon", ... }, ... }`,
`GET /api/map/rasters` returns `{ "jaipur": { ...same as /rasters above }, ... }`,
and `GET /api/map/mosaics` returns `data/mapmeta.json` as is:

```json
{ "region": [ { "id": "region", "z": 7, "bounds": [[21.94, 67.5], [31.95, 81.56]], "labels": true }, ... ],
  "jaipur": [ { "id": "jaipur_10", "z": 10, "bounds": [...], "labels": true }, ... ], ... }
```

### Errors

Every error has the matching HTTP status and this body:

```json
{ "error": { "status": 404, "message": "Unknown city \"atlantis\". See /api/cities for valid ids." } }
```

| Status | When |
| --- | --- |
| `400` | unknown or empty `params`, a month not in `YYYY-MM` form, `from` after `to`, a query value given twice |
| `404` | unknown city, unknown route (including anything not under `/api`, and non-GET methods) |
| `500` | a bug; the message is generic and the details go to the server log |

## Testing in Thunder Client

`thunder/competition-web-app.postman_collection.json` is a Postman v2.1
collection with one request per endpoint plus example errors, grouped into
Meta, Cities, Bulk and Errors folders. Each request's description says the
status to expect.

1. Start the server (`npm run dev`).
2. In VS Code open the Thunder Client sidebar, go to **Collections**, open the
   menu (the "≡" icon) and choose **Import**, then pick the collection file
   (choose the Postman format if asked).
3. Requests use the collection variable `{{baseUrl}}`, which defaults to
   `http://localhost:5050`. Change it in the collection's settings if the server
   runs elsewhere (another `PORT`, or a deployed URL).

## Data files

| File | Contents | Served by |
| --- | --- | --- |
| `data/climate.json` | `{ months, cities: { id: { name, state, lat, lon, series } } }` | `/api/climate`, `/api/cities...`, `/api/parameters` |
| `data/boundaries.json` | `{ id: GeoJSON geometry }` | `/api/boundaries`, `/api/cities/:id/boundary` |
| `data/mapmeta.json` | basemap mosaic bounds and zoom | `/api/map/mosaics` |
| `data/rasters.json` | raster bounds and image paths per city | `/api/map/rasters`, `/api/cities/:id/rasters` |
| `data/pixels/<id>.json` | per-pixel grids per city | `/api/cities/:id/pixels` |

These started as byte-identical copies of `client/src/data/*.json` and
`client/public/map/raster/<id>/values.json`; `test/data.test.js` checks they
still match while the client copies exist.

To update the data, replace the files and restart the server (they are read once
at startup). Keep the shapes above. In `rasters.json` the `values` field of each
city is ignored; the API replaces it with the `pixels` link. A new series key in
`climate.json` appears in the API automatically; add its label and unit to
`PARAMETER_META` in `src/data.js` (and `client/src/lib/params.js`). To add a city,
add it to all four files plus `data/pixels/<id>.json`, and put its images under
`client/public/map/raster/<id>/` and `client/public/map/`.

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
