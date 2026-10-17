# Competition Web App API v1

Reference for the HTTP API in `server/`. Base path: **`/api/v1`**. All
endpoints are `GET` (and `HEAD`) and return JSON. The data comes from a
pluggable *provider*; today that is the JSON files in `server/data` (see
[How to add](#how-to-add) for live sources).

- [Conventions](#conventions)
- [Endpoints](#endpoints): [health](#get-health), [parameters](#get-parameters),
  [areas](#get-areas), [boundary](#get-areasareaidboundary),
  [timeseries](#get-timeseries), [layers](#get-areasareaidlayers),
  [layer values](#get-areasareaidlayerslayeridvalues),
  [forecasts](#get-areasareaidforecasts), [basemap](#get-basemap)
- [Hazards](#hazards) (Disaster module): [hazard types](#get-hazards),
  [parameters](#get-hazardshazardparameters), [events](#get-hazardshazardevents),
  [event series](#get-hazardshazardeventseventidtimeseries),
  [forecast and danger classes](#get-hazardshazardeventseventidforecast)
- [Planned](#planned)
- [How to add](#how-to-add)

## Conventions

### Envelopes

Every success response:

```json
{ "data": <payload>, "meta": { ... } }
```

`data` is the resource (object or array). `meta` is optional and holds facts
about the response rather than the resource: counts, the time range actually
returned, units, the range that was requested. New `meta` fields may appear at
any time; clients should ignore ones they do not know.

Every error response has the matching HTTP status and:

```json
{ "error": { "status": 400, "code": "invalid_parameter", "message": "Unknown parameter(s): bogus",
             "details": { "unknown": ["bogus"], "valid": ["ndvi", "..."] } } }
```

Branch on `code`, never on `message` (which is for humans and may change).
`details` is optional and differs per error.

| Status | `code` | When |
| --- | --- | --- |
| 400 | `invalid_parameter` | a `parameters` list names an unknown parameter key (or, for forecasts, one that cannot be forecast; for a hazard event series, one the hazard does not have) |
| 400 | `invalid_query` | a query value is malformed or unsupported: missing required `areas`, empty list, bad month, `from` after `to`, unknown `include`, a single-value key repeated with different values, `time` on a static layer or not in the layer's time format, a `/timeseries` response over the size limit, a forecast `horizon` out of range, an unknown forecast model (also a hazard forecast model), more than one forecast parameter, a malformed hazard `bbox`, a malformed URL |
| 400 | `unsupported_interval` | `interval` is not offered (by `/timeseries`, by a parameter named in `parameters`, by a requested area, or by a hazard: its series are `daily`); `details.supported` lists what is |
| 404 | `not_found` | unknown route, area, parameter (in the path), layer, layer time, a layer without values, or an unknown hazard, hazard event or hazard parameter |
| 405 | `method_not_allowed` | a known path with a method other than GET/HEAD; the `Allow` header and `details.allowed` list the allowed ones |
| 422 | `insufficient_data` | the request is valid but the area has too little data for it (a forecast needs enough months in the area's feature table) |
| 500 | `internal_error` | a bug; the message is generic and the details go to the server log |
| 502 | `model_failure` | the forecasting model failed for this request (details in the server log) |
| 503 | `forecast_unavailable` | no forecast can be given now: the area's Earth Engine data has not been extracted yet (`details.reason: "no_gee_data"`), or the forecasting model cannot run (not installed, timed out, or turned off) and no saved forecast covers the request; or a hazard's model has not been built yet (`details.reason: "no_model"`) |

### Query parameters

- **Lists** are comma-separated: `?parameters=ndvi,rain`. Repeated keys are
  merged (`?parameters=ndvi&parameters=rain` is the same). Duplicates and
  spaces are dropped. An empty list (`?parameters=`) is `invalid_query`.
- **`*` means all**: `?areas=*`, `?parameters=*`, `?include=*`, `?type=*`.
  A list containing `*` also means all.
- **Single values** (`from`, `to`, `interval`, `time`, `bbox`) may be repeated only if
  every copy is identical; otherwise `invalid_query`. An empty value counts as absent.
- **Unknown query parameters are ignored**, so clients can send extras safely.
- **Time values** are strings whose format depends on the interval
  (`src/catalog/intervals.js`): daily `YYYY-MM-DD` (UTC days), monthly
  `YYYY-MM`, yearly `YYYY`. Area time series are monthly; hazard event series
  are daily; a layer names the interval of its `times` in `interval` (today
  `yearly`, e.g. `"2020"`). Time strings sort chronologically as plain
  strings. A value in the wrong format is `400 invalid_query` with
  `details.format` and `details.example`.
- **`from` / `to`** are inclusive and optional. A range reaching outside the
  data is clipped to what exists (possibly nothing, which is still `200`).

### Headers

| Header | Value |
| --- | --- |
| `Cache-Control` | `public, max-age=300` on data; `no-store` on `/health` and every error |
| `Access-Control-Allow-Origin` | `*` by default; with `CORS_ORIGINS` set, the matching origin only |
| `Allow` | on `405` responses |

### Ids and missing values

Ids (`areaId`, `layerId`, parameter keys, hazard ids, event ids) are stable,
lowercase and URL-safe.
`null` in a series or grid means "no data" and is never replaced or dropped.

## Endpoints

| Endpoint | Returns |
| --- | --- |
| `GET /api/v1/health` | service status, versions, data timestamp |
| `GET /api/v1/parameters` | every parameter |
| `GET /api/v1/parameters/:key` | one parameter |
| `GET /api/v1/areas` | every area (`?type=`, `?include=`) |
| `GET /api/v1/areas/:areaId` | one area (`?include=`) |
| `GET /api/v1/areas/:areaId/boundary` | outline as a GeoJSON Feature |
| `GET /api/v1/timeseries` | series for many areas (`?areas=` required, `?type=`) |
| `GET /api/v1/areas/:areaId/timeseries` | series for one area |
| `GET /api/v1/areas/:areaId/layers` | map layers of an area |
| `GET /api/v1/areas/:areaId/layers/:layerId` | one layer |
| `GET /api/v1/areas/:areaId/layers/:layerId/values` | the numbers behind a layer |
| `GET /api/v1/areas/:areaId/forecasts` | model forecasts of a parameter (`?parameters=ndvi&horizon=&models=`) |
| `GET /api/v1/basemap` | satellite basemap mosaics |
| `GET /api/v1/hazards` | hazard types and what each provides |
| `GET /api/v1/hazards/:hazard` | one hazard with its dataset and forecast model |
| `GET /api/v1/hazards/:hazard/parameters` | the hazard's parameters (`/parameters/:key` for one) |
| `GET /api/v1/hazards/:hazard/events` | the hazard's events (`?country=`, `?bbox=`, `?include=layers`) |
| `GET /api/v1/hazards/:hazard/events/:eventId` | one event with notes and sources (`?include=layers`) |
| `GET /api/v1/hazards/:hazard/events/:eventId/layers` | the event's map layers (`/layers/:layerId` for one) |
| `GET /api/v1/hazards/:hazard/events/:eventId/layers/:layerId/image` | a layer's overlay image (PNG), not JSON |
| `GET /api/v1/hazards/:hazard/events/:eventId/timeseries` | the event's daily series and irregular observations (`?parameters=&from=&to=`) |
| `GET /api/v1/hazards/:hazard/events/:eventId/forecast` | per day: probability, threshold and danger class per model, the outcome, scores (`?models=&from=&to=`) |

Current data: six areas of type `city` (`jaipur`, `jodhpur`, `jaisalmer`,
`bikaner`, `udaipur`, `delhi`), 16 monthly parameters from `2010-01` to `2026-09`
(201 months). Examples below are trimmed (`...`).

### GET /health

```json
{ "data": { "status": "ok", "service": "competition-web-app-api", "version": "1.0.0",
            "apiVersion": "v1", "provider": "files", "dataUpdated": "2026-10-14T17:40:46.681Z" } }
```

`dataUpdated`: for the files provider, the newest modification time of the
data files. `provider` names the active data provider. Never cached.

### GET /parameters

```json
{ "data": [
    { "key": "ndvi", "label": "Vegetation greenness", "unit": "", "decimals": 2, "group": "Land and surface",
      "source": "MODIS MOD13Q1", "aggregation": "max", "intervals": ["monthly"],
      "description": "Normalized difference vegetation index. The monthly value is the greenest 16-day composite of the month ..." },
    { "key": "rain", "label": "Rainfall", "unit": "mm", "decimals": 0, "group": "Water",
      "source": "NASA POWER", "aggregation": "sum", "intervals": ["monthly"], "description": "..." },
    ...
  ],
  "meta": { "count": 16 } }
```

| Field | Meaning |
| --- | --- |
| `key` | id used in `parameters=` and in series objects |
| `unit` | display unit (`""` = unitless); `sun` is `MJ/m²/day` |
| `decimals` | sensible display precision |
| `group` | heading to group parameters under |
| `aggregation` | how finer values combine into one interval value: `mean`, `sum` (amounts such as rain), `max` (NDVI: greenest composite of the month) |
| `intervals` | intervals this parameter is offered at |

Keys: `ndvi`, `lst_day`, `lst_night`, `rain`, `tair`, `tmax`, `tmin`, `dew`,
`rh`, `wind`, `sm_top`, `sm_root`, `albedo`, `uv`, `aod`, `sun`.

`GET /parameters/rain` returns one such object; an unknown key is `404 not_found`.

### GET /areas

Query: `type` (list, optional: filter by area type), `include` (list,
optional: `boundary`, `layers` or `*`; anything else is `invalid_query`).

```json
{ "data": [
    { "id": "jaipur", "type": "city", "name": "Jaipur",
      "region": { "state": "Rajasthan", "country": "IN" },
      "center": { "lat": 26.9124, "lon": 75.7873 },
      "coverage": { "intervals": ["monthly"], "from": "2010-01", "to": "2026-09",
                    "parameters": ["ndvi", "lst_day", ...] } },
    ...
  ],
  "meta": { "count": 6 } }
```

`coverage.parameters` lists the keys with at least one value for that area.
With `include=boundary` each area gets `boundary` (a GeoJSON geometry); with
`include=layers` it gets `layers` (array of [Layer](#get-areasareaidlayers)).

`GET /areas/jaipur?include=boundary` returns one area. Unknown id: `404 not_found`.

### GET /areas/:areaId/boundary

```json
{ "data": { "type": "Feature",
            "properties": { "areaId": "jaipur", "name": "Jaipur", "level": "district" },
            "geometry": { "type": "Polygon", "coordinates": [[[76.0876, 27.8479], ...]] } } }
```

### GET /timeseries

| Query | Required | Default | Meaning |
| --- | --- | --- | --- |
| `areas` | yes | | area ids, or `*` |
| `type` | no | `*` | area types; filters `areas=*` like on `/areas` (ids listed by name are returned as asked) |
| `parameters` | no | `*` | parameter keys |
| `interval` | no | `monthly` | anything else is `unsupported_interval` today (`yearly` exists only for layer times) |
| `from`, `to` | no | full range | inclusive, interval format (`YYYY-MM`) |

`GET /api/v1/timeseries?areas=jaipur,delhi&parameters=ndvi,rain&from=2026-07`

```json
{ "data": { "interval": "monthly",
            "times": ["2026-07", "2026-08", "2026-09"],
            "areas": { "jaipur": { "ndvi": [0.3183, 0.3672, 0.388], "rain": [139.5, 155, null] },
                       "delhi":  { "ndvi": [0.4466, 0.5192, 0.4847], "rain": [333.25, 312.17, null] } } },
  "meta": { "from": "2026-07", "to": "2026-09", "count": 3, "parameters": ["ndvi", "rain"],
            "units": { "ndvi": "", "rain": "mm" }, "requested": { "from": "2026-07", "to": null } } }
```

- Every array lines up with `times`. `null` = no value for that time; a
  parameter an area has no data for at all is all `null`.
- `meta.from` / `meta.to` are the first and last time actually returned
  (`null` when the clipped range is empty); `meta.requested` echoes `from`/`to`
  when given.
- Areas come back in request order (`*` = data order); parameters in request
  order (`*` = catalog order).
- Unknown area: `404 not_found` (`details.unknown`). Unknown parameter:
  `400 invalid_parameter` (`details.unknown`, `details.valid`).
- Each parameter lists its `intervals` (see `/parameters`). A parameter named
  in `parameters` that is not offered at `interval` is
  `400 unsupported_interval` with
  `details: { "interval": "monthly", "parameter": "x", "supported": ["daily"] }`;
  with `parameters=*` such parameters are left out instead. (Every parameter
  is monthly today.)
- **Size limit.** A response may hold at most **500,000 values**, counted as
  areas x parameters x times, where times is the requested `from`..`to`
  clipped to the areas' coverage. Over the limit is `400 invalid_query` with
  `details: { "limit": 500000, "requested": 612000 }`; ask for fewer areas or
  parameters or a shorter range. The server setting `TIMESERIES_MAX_VALUES`
  changes the limit. Everything today is 6 x 16 x 201 = 19,296 values.

`?areas=*&parameters=*` returns everything. The website loads
`?areas=*&type=city&parameters=*&interval=monthly` at startup.

### GET /areas/:areaId/timeseries

Same query without `areas`; `data.series` replaces `data.areas`:

```json
{ "data": { "interval": "monthly", "times": ["2026-07", "2026-08", "2026-09"],
            "series": { "ndvi": [0.3183, 0.3672, 0.388], "rain": [139.5, 155, null] } },
  "meta": { "from": "2026-07", "to": "2026-09", "count": 3, ... } }
```

### GET /areas/:areaId/layers

```json
{ "data": [
    { "id": "ndvi-peak", "title": "Greenness (monsoon peak)", "parameter": "ndvi", "kind": "raster",
      "resolution": "250m", "source": "MODIS MOD13Q1", "description": "...",
      "bounds": [[26.86875, 75.73956], [26.95417, 75.83535]],
      "interval": "yearly", "times": ["2010", "2011", ..., "2026"],
      "image": { "urlTemplate": "/map/raster/jaipur/ndvi-{time}.png" },
      "values": { "href": "/api/v1/areas/jaipur/layers/ndvi-peak/values", "scale": 0.001, "unit": "", "width": 41, "height": 41 } },
    { "id": "ndvi-change", ..., "interval": null, "times": null,
      "image": { "url": "/map/raster/jaipur/change.png" },
      "values": { "href": "...", "scale": 0.001, "unit": "", "width": 41, "height": 41 } },
    { "id": "lst-day-summer", "parameter": "lst_day", "resolution": "1km", ...,
      "image": { "url": "/map/raster/jaipur/lst-day.png" },
      "values": { "href": "...", "scale": 0.1, "unit": "°C", "width": 11, "height": 11 } },
    { "id": "lst-night-summer", ... }
  ],
  "meta": { "count": 4 } }
```

| Field | Meaning |
| --- | --- |
| `bounds` | `[[south, west], [north, east]]` in degrees |
| `interval` | interval the `times` are written in (`"yearly"`: `YYYY`), or `null` for a static layer |
| `times` | times the layer exists for, or `null` for a static layer |
| `image` | `urlTemplate` (replace `{time}` with one of `times`) for timed layers, `url` for static ones. These are **static website paths** (files in `client/public`), not API URLs |
| `values` | where the numbers behind the image are, or `null` for an image-only layer. Grid values are stored integers: multiply by `scale` to get `unit` |
| `parameter` | the related parameter key, or `null` |

Layers today (every city): `ndvi-peak` (timed 2010–2026, monsoon-peak NDVI),
`ndvi-change` (static: 2023–25 minus 2010–12 monsoon peak), `lst-day-summer`
and `lst-night-summer` (static: April–June 2022–2026 mean, °C). Jaisalmer also
has `s2-ndvi`, `s2-ndwi`, `s2-ndbi` (Sentinel-2, 10 m, around Gadisar Lake,
`image.url` `/map/s2_ndvi.jpg` etc., `values: null`; these come from
`data/layers.extra.json`).

`GET /areas/:areaId/layers/:layerId` returns one layer; unknown: `404 not_found`.

### GET /areas/:areaId/layers/:layerId/values

| Layer | Query | `data.values` |
| --- | --- | --- |
| timed | `?time=2020` | the grid for that time (`data.time` echoes it). `time` must be in the layer's `interval` format (`YYYY` for yearly), else `400 invalid_query` (`details.format`); a well-formed time not in `times` is `404 not_found` (`details.times`) |
| timed | none | `{ "2010": grid, ..., "2026": grid }` (`data.times` lists them) |
| static | none | the grid |
| static | `?time=...` | `400 invalid_query` (a static layer has one grid, so a time is a client mistake) |
| `values: null` | any | `404 not_found` |

`GET /api/v1/areas/jaipur/layers/ndvi-peak/values?time=2020`

```json
{ "data": { "layerId": "ndvi-peak", "areaId": "jaipur", "scale": 0.001, "unit": "", "width": 41, "height": 41,
            "bounds": [[26.86875, 75.73956], [26.95417, 75.83535]], "time": "2020",
            "values": [[500, 351, 351, ...], ...] } }
```

A grid is `height` rows (north to south) of `width` integers (west to east);
`null` = no data. NDVI here is `500 x 0.001 = 0.5`.

### GET /areas/:areaId/forecasts

Forecast of one parameter for one area by machine-learning models, with each
model's accuracy, a back-test and what drives it. Today the forecastable
parameter is `ndvi` (vegetation greenness), predicted month by month by the
three models of the team's Earth Engine notebook
(`GEE_Data_Pipeline_Lat_Long_08_10_26`: Ridge regression, a small neural
network, gradient boosting).

**Where the numbers come from.** Not from the site's own data
(`/timeseries`, `climate.json`): the forecast runs the notebook's pipeline.
`npm run gee:extract` downloads, for each area in `server/data/gee/areas.json`,
the notebook's monthly feature table from Google Earth Engine over a
2 × 2 km box around the area's centre (`halfWidthKm` 1), from January 2010:
Landsat 5/7/8/9 NDVI and NDWI (30 m), ERA5-Land weather (~9 km), MODIS land
surface temperature, emissivity and albedo, Sentinel-5P aerosol index, SMAP
soil moisture, Dynamic World land use, TerraClimate drought index, ESA
WorldCover, OpenLandMap soil texture and WorldPop population, plus the
notebook's physics features (vapour pressure deficit, net radiation, ...).
It is saved as `server/data/gee/<areaId>.features.csv`, column for column the
notebook's final CSV. The API sends that table to the forecasting module
`server/ml` (Python, see its README) and returns its answer. So this NDVI is
Landsat over the box, not the MODIS city-wide NDVI of `/timeseries`; the two
differ in level and detail.

An area whose table has not been extracted yet has no forecast:
`503 forecast_unavailable` with `details.reason: "no_gee_data"` (see the
errors below). Clients should present that as "not available yet".

| Query | Default | Meaning |
| --- | --- | --- |
| `parameters` | `ndvi` | **one** forecastable parameter key. Two or `*` is `invalid_query`; a key that exists but cannot be forecast (e.g. `rain`) or an unknown key is `invalid_parameter` (`details.valid` lists forecastable keys) |
| `horizon` | `12` | number of steps (months) to forecast, a whole number from 1 to 24 (12 is the notebook's) |
| `models` | `*` | `ridge`, `nn`, `gbm` (list, or `*` for all). Unknown: `invalid_query` (`details.allowed`). Returned in that order whatever the request order |
| `interval` | `monthly` | the only interval forecasts exist at today; anything else is `unsupported_interval` |

`GET /api/v1/areas/jaisalmer/forecasts?parameters=ndvi&horizon=12&models=ridge,nn,gbm`

```json
{ "data": {
    "area": "jaisalmer", "target": "ndvi", "interval": "monthly",
    "issued": "2026-08",
    "forecastTimes": ["2026-09", "2026-10", "2026-11", ..., "2027-08"],
    "models": {
      "ridge": {
        "label": "Ridge regression",
        "forecast": [0.1311, 0.12429, 0.11883, ...],
        "hindcast": { "times": ["2025-09", ..., "2026-08"], "observed": [0.1428, ...], "predicted": [0.13387, ...],
                      "r2": 0.2211, "rmse": 0.01707 },
        "metrics": { "train": { "r2": 0.9208, "rmse": 0.00932, "from": "2010-03", "to": "2023-02", "n": 150 },
                     "test":  { "r2": 0.6327, "rmse": 0.01262, "from": "2023-03", "to": "2026-08", "n": 37 } },
        "importance": [ { "feature": "NDVI_lag1", "label": "Last month's NDVI", "value": 0.1229 },
                        { "feature": "evopration_demand", "label": "Evaporative demand", "value": 0.042 }, ... ] },
      "nn": { "label": "Neural network", ... },
      "gbm": { "label": "Gradient boosting", ... } },
    "history": { "times": ["2010-01", "2010-02", ..., "2026-08"], "observed": [0.1172, null, ..., 0.1391] },
    "features": [ { "key": "AirTemp_C", "label": "Air temperature", "unit": "°C" }, ...,
                  { "key": "NDVI_lag1", "label": "Last month's NDVI", "unit": "" } ],
    "assumptions": [ "NDVI is the Landsat 5/7/8/9 average (30 m pixels) over a 2 × 2 km box around the centre.", ... ],
    "modelVersion": "gee-notebook-2026-10-08",
    "dataUntil": { "NDVI": "2026-08", ... },
    "provenance": { "pipeline": "GEE notebook GEE_Data_Pipeline_Lat_Long_08_10_26",
                    "datasets": ["MODIS/061/MOD11A2", ..., "LANDSAT/LC09/C02/T1_L2", "ECMWF/ERA5_LAND/MONTHLY_AGGR", ...],
                    "areaKm": "2 × 2 km", "generated": "2026-10-17T09:15:16Z" },
    "source": "live" },
  "meta": { "parameters": ["ndvi"], "horizon": 12, "models": ["ridge", "nn", "gbm"], "units": { "ndvi": "" },
            "generated": "2026-10-17T09:15:16.254Z", "dataUpdated": "2026-10-17T08:05:24.989Z" } }
```

| Field | Meaning |
| --- | --- |
| `target` | the parameter key asked for (`ndvi`); the table column behind it is the notebook's Landsat `NDVI` |
| `issued` | the last month the models could use (target and every input present); the forecast starts the month after it, as in the notebook |
| `forecastTimes` | the `horizon` forecast times, in the interval's format |
| `models.<id>.forecast` | predicted values, aligned with `forecastTimes`, in the parameter's unit (`meta.units`) |
| `models.<id>.hindcast` | back-test as in the notebook: the model refit without the last 12 usable months and asked to forecast them the same way (typical weather, its own predictions fed back). `observed` vs `predicted` shows how a forecast like this one fared; `r2`/`rmse` score it |
| `models.<id>.metrics` | accuracy on a chronological split: `train` = the first 80% of usable months, `test` = the last 20%, which the model did not see while training (scored with the actual weather and last month's NDVI). `n` months, `from`/`to` the range |
| `models.<id>.importance` | permutation importance on the test months: how much test R² drops when that input is shuffled (30 repeats), every input, largest first. Near 0 or negative = the model does not rely on it |
| `history` | the target's whole observed series from the table (`null` where Landsat had no clear view), for plotting next to the forecast |
| `features` | every model input (`feature` keys above) with a label and unit |
| `assumptions` | plain-language caveats to show next to the forecast |
| `modelVersion` | identifies the algorithm and its output; changes when the module's method or its texts change |
| `dataUntil` | last month with a value, per table column used |
| `provenance` | `pipeline` (the notebook), `datasets` (Earth Engine collection ids the table comes from), `areaKm` (the box), `generated` (when the module ran) |
| `source` | `live` (computed by the module for this request, or cached from an earlier identical one) or `snapshot` (a saved forecast, see below) |
| `meta.generated` | when the forecast was computed |
| `meta.dataUpdated` | the version of the area's feature table it was computed from (when that file was last written) |
| `meta.fallback` | only on a snapshot served instead of a live run: why (`unavailable`, `timeout`, `model_failure`, `invalid_input`, or `no_gee_data` when the server has the snapshot but not the table) |

**How the forecast works** (exactly notebook cell 54). Each model learns this
month's NDVI from this month's weather and surface-energy features, the
season and the NDVI of the previous two months. Months missing any of these
are left out. Future weather is not known, so each future month uses that
calendar month's average over the history (climatology), and each predicted
NDVI becomes the "previous month" input of the next step. The same table
always gives the same forecast (fixed seeds).

**Speed and caching.** A live run trains the models and takes a few seconds.
The result is kept in server memory per area, parameter, horizon, models and
table version, so repeated requests return at once, and identical requests
arriving during a run share it. A new extraction (the CSV is rewritten)
computes afresh; no restart needed.

**Saved forecasts (snapshots).** `npm run forecasts:build` saves the largest
forecast (horizon 24, the maximum, and every model) of every area that has a
feature table as `server/data/forecasts/<areaId>.<parameter>.json` (and a copy
for the website in `client/public/data/forecasts/`); areas without a table
are skipped and listed. The file is a complete response of this endpoint with
`source: "snapshot"`. Snapshots without `provenance` (made before the Earth
Engine pipeline, from the site's own data) are ignored. The server serves a
snapshot, cut down to the requested models and horizon, when it cannot
compute live:

- `FORECAST_MODE=live` (default): compute live; if the module is not
  installed, times out (`FORECAST_TIMEOUT_MS`, default 60 s) or fails, serve
  the snapshot (`meta.fallback` says why). A run that could not start or
  timed out is remembered for `FORECAST_RETRY_AFTER_MS` (default 60 s) per
  area and query; during that time the same request is answered from the
  snapshot at once (same `meta.fallback`) instead of waiting for another run.
- `FORECAST_MODE=snapshot`: never start Python; serve snapshots only (e.g. a
  host without Python).

A snapshot covers a request when it has every requested model and at least
`horizon` months, which a snapshot from `forecasts:build` always does (`meta`
then describes the request, `meta.generated` when the snapshot was computed).
Otherwise:

| Status | `code` | When |
| --- | --- | --- |
| 503 | `forecast_unavailable` | **not extracted yet:** the area has no feature table (and no snapshot). `details: { "areaId", "parameter", "reason": "no_gee_data", "saved": null }`. Also in snapshot mode when neither a snapshot nor a table exists |
| 503 | `forecast_unavailable` | the module cannot run (not installed, timed out, snapshot mode) and no snapshot covers the request. `details: { "areaId", "parameter", "saved": { "horizon": 12, "models": [...] } \| null }` |
| 502 | `model_failure` | the module failed on this request and no snapshot covers it (same `details`) |
| 422 | `insufficient_data` | the area's table has fewer than 36 months with the target (`details: { "areaId", "parameter", "observed", "required" }`), or the module refused the data, e.g. too few months with every input; the message then carries the module's reason and no snapshot covers the request (`details: { "areaId", "parameter", "saved" }`) |
| 404 | `not_found` | unknown area |

Clients should treat 502/503 as "no forecast right now" and may retry later;
`reason: "no_gee_data"` will not change until someone runs the extraction.

### GET /basemap

```json
{ "data": { "mosaics": [
    { "id": "region", "areaId": "region", "zoom": 7, "bounds": [[21.943, 67.5], [31.952, 81.5625]],
      "image": "/map/region.jpg", "labels": "/map/region_lab.png" },
    { "id": "jaipur_15", "areaId": "jaipur", "zoom": 15, "bounds": [...], "image": "/map/jaipur_15.jpg", "labels": null },
    ...
  ] },
  "meta": { "count": 20 } }
```

`areaId` is `"region"` for the regional mosaics, otherwise an area id. `image`
and `labels` (place-name overlay, or `null`) are static website paths. Which
mosaic to show at which zoom is up to the client.

## Hazards

The Disaster module. A **hazard** (today `flood`) has **events**: one place
and period each, with a bbox. During an event the API has **parameters**:
regular **series**, one value per day of the event (rainfall), and irregular
**observations**, rows at their own times (soil moisture satellite passes).
A hazard can have a **forecast**: per day of an event, each model's
probability of the hazard within its horizon, the model's threshold and the
resulting **danger class** (`danger` when probability >= threshold), next to
what actually happened and the model's scores. An event can have map
**layers**: overlay images in EPSG:4326 with bounds, legend and stats (today
the observed reference water of three flood events).

The endpoints are the same for every hazard; what is hazard-specific lives in
`src/catalog/hazards/<hazard>.js` (parameter meanings) and in the hazard's
dataset in `server/data/hazards/<hazard>/` (see [How to add](#how-to-add)).

**Flood today.** 10 flood events of 2025-2026 (Mozambique, China, Pakistan,
USA x2, Nepal, India x2, Thailand, Bangladesh) from the team notebook
`flood_disaster.ipynb`: daily satellite rainfall over each event box (NASA
GPM IMERG Late Run V07, 0.1°, UTC days, from 7 days before the reported
flood period to its end) and the NISAR L3 SME2 soil moisture passes over the
same box (provisional product, 200 m, from 12 days before). The forecast is
the notebook's Part B: "flood within the next 3 days" by two Random Forests,
**Rainfall only** (`rain`, threshold 0.55) and **Rainfall + soil moisture**
(`rain_soil`, threshold 0.75, the default for danger zones), with the
thresholds chosen on out-of-fold balanced accuracy. The files are written by
`server/ml` (`python -m forecaster.hazards import flood` and `build flood`,
see its README "Hazards"); the API only reads them, so no Python runs per
request. The model results reproduce every number the notebook printed
(records 221, thresholds, out-of-fold and held-out test scores);
`GET /hazards/flood` shows that check (`forecast.provenance.notebookCheck`).

What the forecast is and is not: it is fitted to these 10 historical events
(176 training days, 45 test days), on box rainfall that for river floods
(Limpopo, Ganga, Ravi/Chenab) shows only the local part of the water. It
flags most days as danger (held-out test: 96-98% predicted positive, recall
1.0, balanced accuracy 0.54 / 0.58). Present it as a research result about
past events, not as a warning service.

### GET /hazards

```json
{ "data": [
    { "id": "flood", "label": "Flood", "description": "Flood events with daily satellite rainfall ...", "interval": "daily",
      "provides": {
        "events": { "count": 10, "href": "/api/v1/hazards/flood/events" },
        "parameters": { "count": 15, "series": ["rain_box_mm", "rain_wettest_cell_mm", "rain_box_3d_mm", ..., "in_flood_period", "rain_cells_with_data"],
                        "observations": ["soil_moisture", "soil_moisture_all", ..., "soil_coverage_pct"], "href": "/api/v1/hazards/flood/parameters" },
        "timeseries": { "intervals": ["daily"], "href": "/api/v1/hazards/flood/events/{eventId}/timeseries" },
        "forecast": { "available": true, "horizonDays": 3,
                      "target": { "key": "flood_within_3_days", "labelParameter": "in_flood_period", "label": "Flood within the next 3 days", "definition": "..." },
                      "classes": ["danger", "no_danger"], "defaultModel": "rain_soil",
                      "models": [ { "id": "rain", "label": "Rainfall only", "threshold": 0.55 },
                                  { "id": "rain_soil", "label": "Rainfall + soil moisture", "threshold": 0.75 } ],
                      "modelVersion": "flood-notebook-partb-2026-10-17", "href": "/api/v1/hazards/flood/events/{eventId}/forecast" },
        "layers": { "count": 3, "events": 3, "ids": ["water-reference"], "kinds": ["mask"],
                    "href": "/api/v1/hazards/flood/events/{eventId}/layers" } },
      "coverage": { "from": "2025-11-24", "to": "2026-10-07", "countries": ["BD", "CN", "IN", "MZ", "NP", "PK", "TH", "US"] },
      "dataUpdated": "2026-10-17T09:42:25.490Z" } ],
  "meta": { "count": 1 } }
```

`provides.forecast` is `null` for a hazard without a forecast and
`{ "available": false, "reason": "no_model" }` while its model has not been
built. `provides.layers`: how many map layers there are over all events
(`count`), on how many events, their ids and kinds (`count: 0` when there are
none). `dataUpdated` is when the hazard's dataset was last written.

### GET /hazards/:hazard

The same object plus:

| Field | Meaning |
| --- | --- |
| `dataset` | `description`, `generated`, `tables` (each table's `kind` and column meanings), `datasets` (source datasets: `id`, `name`, `doi`, `url`, `resolution`, `citation`), `notes` (things to know about the data). `null` without a dataset |
| `forecast` | the model, without the per-day results: `target`, `classes` (with `label`, `rule`, `description`), `horizonDays`, `features` (inputs with label and unit), `data` (rows, records with a target, positive rate, per-event days / flood-label rate / soil-data fraction), `split` (`trainEvents`, `testEvents`, `excludedEvents` with the reason), and per model in `models.<id>`: `label`, `features`, `threshold` (rounded) and `thresholdExact` (the float compared with), `params`, `oof` (out-of-fold `balancedAccuracy`, `rows`, the cross-validation `folds` and the full threshold `sweep`), `test` (held-out scores, see below), `importance` (Random Forest feature importance, largest first); `provenance` (notebook, cells, datasets, environment, `notebookCheck`) |

Unknown hazard: `404 not_found` with `details: { "hazard", "valid" }`.

### GET /hazards/:hazard/parameters

```json
{ "data": [
    { "key": "rain_box_mm", "label": "Rainfall (box average)", "unit": "mm", "decimals": 1, "group": "Rainfall",
      "kind": "series", "valueType": "number", "intervals": ["daily"], "aggregation": "sum",
      "source": "GPM IMERG Late Run V07", "dataset": "gpm_imerg_late_v07", "derived": null, "context": null,
      "description": "Rain averaged over the event box on the UTC day ... Forecast input box_1d." },
    { "key": "rain_box_3d_mm", ..., "derived": { "from": "rain_box_mm", "op": "rolling_sum", "window": 3 } },
    { "key": "in_flood_period", "label": "Reported flood period", "valueType": "boolean", ... },
    { "key": "soil_moisture", "label": "Soil moisture (recommended)", "unit": "m³/m³", "decimals": 3, "group": "Soil moisture",
      "kind": "observation", "valueType": "number", "intervals": [], "aggregation": null,
      "source": "NISAR L3 SME2 (provisional)", "dataset": "nisar_l3_sme2_v1", "derived": null,
      "context": [ { "key": "utc_time", "label": "Time (UTC)", "valueType": "string" }, { "key": "track", ... }, ... ],
      "description": "..." },
    ... ],
  "meta": { "count": 15 } }
```

| Field | Meaning |
| --- | --- |
| `kind` | `series`: one value per day of the event, aligned with `times`. `observation`: irregular rows with their own times |
| `valueType` | `number`, `integer`, `boolean` (`in_flood_period`) or `string` |
| `derived` | how a series is computed from another one, or `null`. `rolling_sum` over `window` days = that day and the `window - 1` before it, fewer at the start of the event (like pandas `rolling(window, min_periods=1).sum()`), missing days skipped. These equal the model's inputs |
| `context` | for observations: the columns returned with each one |
| `dataset` | id of the source dataset in `GET /hazards/:hazard` `dataset.datasets` |

Flood keys. Series: `rain_box_mm`, `rain_wettest_cell_mm`, `rain_box_3d_mm`,
`rain_box_7d_mm`, `rain_wettest_3d_mm`, `rain_wettest_7d_mm` (mm),
`in_flood_period` (boolean: inside the reported flood period),
`rain_cells_with_data`. Observations (one per satellite pass):
`soil_moisture` (box mean of NASA's *recommended* retrievals, the model's
input), `soil_moisture_all`, `soil_moisture_median`, `soil_moisture_p10`,
`soil_moisture_p90` (m³/m³), `soil_uncertainty` (m³/m³), `soil_coverage_pct`
(% of the box with a value; passes of different tracks see different ground).

`GET /hazards/flood/parameters/soil_moisture` returns one; unknown key: `404 not_found`.

### GET /hazards/:hazard/events

| Query | Meaning |
| --- | --- |
| `country` | list of ISO 3166-1 alpha-2 codes or country names, case-insensitive (`?country=IN,BD`, `?country=india`); `*` or absent = all. An unknown one matches nothing (200, empty) |
| `bbox` | `west,south,east,north` in degrees (WGS84): events whose bbox overlaps it, edges included. `west > east` crosses the antimeridian. Not 4 numbers, out of range or `south > north`: `400 invalid_query` (`details.format`, `details.example`) |
| `include` | `layers` (or `*`): embed each event's full layer objects as `layers` (as [`/layers`](#get-hazardshazardeventseventidlayers) returns them). Another value: `400 invalid_query` |

`GET /api/v1/hazards/flood/events?country=IN` (one of two shown)

```json
{ "data": [
    { "id": "07_india_bihar_bhagalpur", "hazard": "flood", "name": "Bihar Ganga floods (Sultanganj - Bhagalpur reach)",
      "country": { "code": "IN", "name": "India" }, "admin": "Bihar", "place": "Sultanganj - Bhagalpur",
      "period": { "reported": "4-23 Sep (Ganga above danger mark at Bhagalpur)", "start": "2026-09-04", "end": "2026-09-23",
                  "windowStart": "2026-08-28", "windowEnd": "2026-09-23", "soilWindowStart": "2026-08-23" },
      "bbox": [86.7, 25.1, 87.3, 25.5], "center": { "lat": 25.3, "lon": 87 },
      "cause": "Ganga river flood (above the danger mark at Bhagalpur); much of the water came from rain upstream, outside the box",
      "coverage": { "interval": "daily", "parameters": ["rain_box_mm", ..., "soil_coverage_pct"], "days": 27, "from": "2026-08-28",
                    "to": "2026-09-23", "floodDays": 20, "soilPasses": 6, "soilPassesRecommended": 6,
                    "soilFrom": "2026-08-24", "soilTo": "2026-09-17", "layers": ["water-reference"] },
      "forecast": { "available": true, "role": "test", "href": "/api/v1/hazards/flood/events/07_india_bihar_bhagalpur/forecast" } },
    ... ],
  "meta": { "count": 2 } }
```

| Field | Meaning |
| --- | --- |
| `period` | `start`/`end`: the hazard's own period (the reported flood period); `reported`: as the sources word it; `windowStart`/`windowEnd`: the days the series cover; `soilWindowStart`: where the soil moisture search started |
| `bbox` | `[west, south, east, north]` in degrees: the extent of the event's rainfall grid (the 0.1° IMERG cells covering the event box, so slightly larger than the box). `center` is its middle. Note the order differs from layer `bounds` (`[[south, west], [north, east]]`) |
| `cause` | what caused it, from the event sources, or `null` when they do not say |
| `coverage` | `parameters`: keys with data for this event; `layers`: ids of its map layers (`[]` when none); the rest are counts from the dataset (days, flood days, soil passes, ...) |
| `forecast` | `null` (the hazard has no forecast), `{ "available": true, "role", "href" }`, or `{ "available": false, "role", "reason" }`, e.g. Nepal: `role: "excluded"` (a glacier collapse, not rain; the notebook leaves it out of the model). `role` is explained [below](#get-hazardshazardeventseventidforecast) |

Events come in dataset order (by id). Nepal (`05_nepal_trishuli`) is kept as data.

### GET /hazards/:hazard/events/:eventId

One event, plus `notes` (event-specific things to know, e.g. "River flood:
... much of the water came from rain upstream"), `summary` (the source's
totals: rain in the 7 days before and during the flood, wettest day, soil
passes before/during, mean soil moisture), `attributes` (other dataset fields,
e.g. `rainDriven`, `bboxSource`), `sources` (each source dataset with
`citation`, `doi`, `url` and the source `files` the data came from) and
`links` (`timeseries`, `forecast`, `layers`). `?include=layers` adds
`layers` (the full layer objects), as on the list. Unknown event:
`404 not_found` with `details: { "hazard", "eventId" }`.

### GET /hazards/:hazard/events/:eventId/timeseries

| Query | Default | Meaning |
| --- | --- | --- |
| `parameters` | `*` | parameter keys of the hazard (series and observations mixed). Unknown: `400 invalid_parameter` (`details.unknown`, `details.valid`) |
| `interval` | the hazard's (`daily`) | anything else is `unsupported_interval` |
| `from`, `to` | the whole event | inclusive UTC days, `YYYY-MM-DD` |

`GET /api/v1/hazards/flood/events/07_india_bihar_bhagalpur/timeseries?parameters=rain_box_mm,rain_box_3d_mm,in_flood_period,soil_moisture&from=2026-09-01&to=2026-09-05`

```json
{ "data": { "hazard": "flood", "eventId": "07_india_bihar_bhagalpur", "interval": "daily",
            "times": ["2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04", "2026-09-05"],
            "series": { "rain_box_mm": [11.33, 12.52, 4.45, 4.57, 12.19],
                        "rain_box_3d_mm": [19.37, 30.19, 28.3, 21.54, 21.21],
                        "in_flood_period": [false, false, false, true, true] },
            "observations": {
              "soil_moisture": { "times": ["2026-09-02", "2026-09-05"], "values": [0.2628, 0.2243],
                                 "context": { "utc_time": ["2026-09-02 12:50", "2026-09-05 23:29"],
                                              "local_time": ["2026-09-02 18:20", "2026-09-06 04:59"],
                                              "track": [120, 170], "direction": ["DESCENDING", "ASCENDING"],
                                              "phase": ["before", "during"], "in_reported_flood_period": [false, true] } } } },
  "meta": { "from": "2026-09-01", "to": "2026-09-05", "count": 5,
            "parameters": ["rain_box_mm", "rain_box_3d_mm", "in_flood_period", "soil_moisture"],
            "units": { "rain_box_mm": "mm", "rain_box_3d_mm": "mm", "in_flood_period": "", "soil_moisture": "m³/m³" },
            "observations": { "soil_moisture": 2 }, "requested": { "from": "2026-09-01", "to": "2026-09-05" } } }
```

- `series` arrays line up with `times` (the event's days, clipped to
  `from`..`to`); `null` = no value that day. Derived series are computed on
  the whole event first, so a 3-day total on `from` counts the days before it.
- `observations.<key>`: `times` (UTC date of each pass), `values` and
  `context` arrays, all the same length, in time order (passes on the same
  day in the dataset's order). A pass without a value is `null`, not dropped
  (e.g. no recommended retrieval). Plot them as points over the daily series.
- Both objects are always present (empty when no parameter of that kind was asked for).
- `meta` as on `/timeseries`, plus `observations` (number of rows per key).
  A range outside the event is `200` with empty arrays.

### GET /hazards/:hazard/events/:eventId/forecast

| Query | Default | Meaning |
| --- | --- | --- |
| `models` | `*` | model ids (`rain`, `rain_soil`). Unknown: `400 invalid_query` (`details.allowed`). Returned in the hazard's model order |
| `from`, `to` | the whole event | inclusive UTC days, cut the per-day arrays |
| `interval` | the hazard's | anything else is `unsupported_interval` |

`GET /api/v1/hazards/flood/events/07_india_bihar_bhagalpur/forecast?from=2026-09-01&to=2026-09-03`

```json
{ "data": {
    "hazard": "flood", "eventId": "07_india_bihar_bhagalpur", "interval": "daily", "available": true, "horizonDays": 3,
    "target": { "key": "flood_within_3_days", "column": "actual_flood_within_next_3_days", "labelParameter": "in_flood_period",
                "label": "Flood within the next 3 days", "definition": "1 if the reported flood period (in_flood_period) covers at least one of the next 3 calendar days, ..." },
    "classes": [ { "id": "danger", "label": "Danger", "rule": "probability >= threshold", "description": "..." },
                 { "id": "no_danger", "label": "No danger signal", "rule": "probability < threshold", "description": "..." } ],
    "defaultModel": "rain_soil",
    "evaluation": { "role": "test", "description": "Held-out test event: scored by the final model, which was trained without it.", "reason": null },
    "times": ["2026-09-01", "2026-09-02", "2026-09-03"],
    "actual": [1, 1, 1],
    "observed": { "in_flood_period": [false, false, false] },
    "models": {
      "rain": { "label": "Rainfall only", "threshold": 0.55, "probability": [0.9661, 0.9266, 0.953], "class": ["danger", "danger", "danger"], ... },
      "rain_soil": {
        "label": "Rainfall + soil moisture", "threshold": 0.75,
        "probability": [0.8857, 0.9525, 0.9803], "class": ["danger", "danger", "danger"],
        "summary": { "dangerDays": 3, "firstDanger": "2026-09-01", "lastDanger": "2026-09-03" },
        "fold": null, "foldEvents": null,
        "metrics": {
          "event": { "rows": 24, "actualPositiveRate": 0.8333, "predictedPositiveRate": 0.9583, "balancedAccuracy": 0.625,
                     "precision": 0.8696, "recall": 1, "f1": 0.9302, "rocAuc": 0.725, "averagePrecision": 0.9332 },
          "test": { "threshold": 0.75, "rows": 45, "actualPositiveRate": 0.7333, "predictedPositiveRate": 0.9556, "accuracy": 0.7778,
                    "balancedAccuracy": 0.5833, "precision": 0.7674, "recall": 1, "f1": 0.8684, "rocAuc": 0.6919, "averagePrecision": 0.8741 },
          "outOfFold": { "balancedAccuracy": 0.8004, "rows": 176 } } } },
    "inputs": { "features": [ { "key": "box_1d", "label": "Rain over the box, that day", "unit": "mm" }, ..., { "key": "soil_pass_age_days", ... } ],
                "values": { "box_1d": [11.33, 12.52, 4.45], ..., "soil_pass_age_days": [1, 0, 1] } },
    "provenance": { "modelVersion": "flood-notebook-partb-2026-10-17", "notebook": "flood_disaster.ipynb (Part B, cells 28-39)",
                    "cells": { ... }, "datasets": [ ... ], "scoring": "...", "environment": { "scikitLearn": "1.8.0", "machine": "x86_64", ... },
                    "generated": "2026-10-17T09:46:32Z", "notebookCheck": { "applicable": true, "compared": 54, "matches": true, "mismatches": [] } } },
  "meta": { "models": ["rain", "rain_soil"], "from": "2026-09-01", "to": "2026-09-03", "count": 3,
            "generated": "2026-10-17T09:46:32Z", "modelVersion": "flood-notebook-partb-2026-10-17",
            "dataUpdated": "2026-10-17T09:46:32.310Z", "requested": { "from": "2026-09-01", "to": "2026-09-03" } } }
```

(Metrics shortened to 4 decimals here; the API sends full floats.)

| Field | Meaning |
| --- | --- |
| `available` | `false` when the event has no forecast; then `times`, `actual` and each model's arrays are empty and `evaluation.reason` says why |
| `times` | every day of the event with the series (cut to `from`..`to`); the arrays below line up with it |
| `actual` | the target on that day: `1` if the flood period covers at least one of the next `horizonDays` days, else `0`; `null` for the last 3 days of an event (the days after are not in the data) |
| `observed` | the day's own label, keyed by `target.labelParameter` (`in_flood_period`) |
| `models.<id>.probability` | probability of the target, 0-1 |
| `models.<id>.class` | the **danger classification**: `danger` when `probability >= threshold` (the model's exact threshold, `thresholdExact` in `GET /hazards/flood`), else `no_danger`. Use this rather than comparing yourself |
| `models.<id>.threshold` | the model's threshold, chosen on out-of-fold balanced accuracy (0.55 rain only, 0.75 with soil moisture) |
| `models.<id>.summary` | danger days within the returned range, first and last |
| `models.<id>.fold`, `foldEvents` | for `out_of_fold` events: which cross-validation fold scored the event and which events it held out; else `null` |
| `models.<id>.metrics.event` | this event's days with a known `actual` (the whole event, not cut by `from`/`to`): `rows`, actual / predicted positive rates, balanced accuracy, precision, recall, F1, ROC AUC and average precision (`null` when the event has one class only). For test events these are the notebook's per-event table |
| `models.<id>.metrics.test` | the model's scores on all held-out test days (the notebook's overall table: 45 days) |
| `models.<id>.metrics.outOfFold` | the out-of-fold balanced accuracy at the threshold, over the 176 training days |
| `inputs` | the model inputs per day (rainfall sums, latest soil pass and its age, `null` where no pass was within 24 days), for the chosen models' features |
| `provenance` | where the model comes from and the check against the notebook's printed numbers |

**`evaluation.role`: how a day was scored**, so no event is scored by a
model that saw it:

| `role` | Meaning |
| --- | --- |
| `test` | one of the 3 held-out test events (Guangxi, Bhagalpur, Bangkok): the final model, trained on the 6 training events |
| `out_of_fold` | a training event: the cross-validation model that held this event out (GroupKFold, 5 folds over whole events), i.e. the notebook's out-of-fold probabilities, which also chose the thresholds |
| `unseen` | an event with no target rows (so it could not train), not a test event: the final model, which never saw it. A new event with target rows becomes a training event on the next `build` (see "New events for a hazard") |
| `excluded` | left out on purpose (Nepal: a glacier collapse, not rain); `available: false` |
| `not_scored` | a training event whose fold could not be fit; `available: false` |

| Status | `code` | When |
| --- | --- | --- |
| 503 | `forecast_unavailable` | the hazard's model has not been built (`model/forecast.json` missing): `details: { "hazard", "eventId", "reason": "no_model" }` |
| 404 | `not_found` | unknown hazard or event, or a hazard without a forecast |
| 400 | `invalid_query` | unknown model, bad `from`/`to` |

### GET /hazards/:hazard/events/:eventId/layers

The event's map layers: images to lay over a web map (e.g. Leaflet
`L.imageOverlay(apiBase + layer.url, layer.bounds)`), each with what it shows,
its legend and numbers computed from the full-resolution source.
`/layers/:layerId` returns one. Every hazard and any number or kind of layer
use the same shape; the dataset's importer writes the meaning (label, legend,
description, source) with the layer, so a new layer needs no server change.

**Flood today:** `water-reference` on the three held-out test events
(`02_china_guangxi`, `07_india_bihar_bhagalpur`, `09_thailand_bangkok`): the
reference water labels of the team notebook's Part A (NISAR HH/HV water
segmentation; "Prepared binary references: 0=non-water, 1=water,
255=unknown"), ~30 m (0.000269°) GeoTIFFs in EPSG:4326. The app does not
have the NISAR scenes, so Part A itself cannot be reproduced; these are shown
as the observed water. **The notebook does not say where the labels come from
or which day they show** (`source.origin` and `time` are `null`); it pairs
them with each event's flood-time NISAR scene, and one of its plots calls
value 1 "candidate new water", so they may be flood water only (in Bhagalpur
the main Ganga channel is not marked as water while the flooded plain is).

`GET /api/v1/hazards/flood/events/07_india_bihar_bhagalpur/layers/water-reference`

```json
{ "data": {
    "id": "water-reference", "hazard": "flood", "eventId": "07_india_bihar_bhagalpur",
    "label": "Reference water extent", "kind": "mask",
    "description": "Water in the reference labels that the team notebook (flood_disaster.ipynb, Part A) uses to train and score its NISAR HH/HV water segmentation: 1 = water, 0 = not water, 255 = unknown. Shown here as the observed water around the event; it is not an output of this app.",
    "time": null,
    "crs": "EPSG:4326",
    "bounds": [[24.8996827, 86.4999465], [25.6009076, 87.5003104]],
    "extent": [[24.8999522, 86.4999465], [25.6009076, 87.5000409]],
    "legend": [
      { "value": 1, "key": "water", "label": "Water", "color": "#1a5cff", "opacity": 0.8 },
      { "value": 0, "key": "not_water", "label": "Not water", "color": null, "opacity": 0 },
      { "value": 255, "key": "unknown", "label": "Unknown (no label)", "color": null, "opacity": 0 } ],
    "stats": {
      "pixels": 9652311, "totalAreaKm2": 7839.45, "knownAreaKm2": 7830.98, "unknownPct": 0.108,
      "classes": {
        "water": { "value": 1, "pixels": 766858, "areaKm2": 622.37, "pctOfKnown": 7.953 },
        "not_water": { "value": 0, "pixels": 8875041, "areaKm2": 7208.61, "pctOfKnown": 92.047 },
        "unknown": { "value": 255, "pixels": 10412, "areaKm2": 8.46 } },
      "eventBox": {
        "bbox": [86.7, 25.1, 87.3, 25.5], "pixels": 3307095, "totalAreaKm2": 2684.88, "knownAreaKm2": 2684.72, "unknownPct": 0.006,
        "classes": {
          "water": { "value": 1, "pixels": 462221, "areaKm2": 375.2, "pctOfKnown": 13.978 },
          "not_water": { "value": 0, "pixels": 2844670, "areaKm2": 2309.52, "pctOfKnown": 86.022 },
          "unknown": { "value": 255, "pixels": 204, "areaKm2": 0.17 } } },
      "width": 3711, "height": 2601,
      "pixelSizeDeg": [0.000269494585, 0.000269494585], "pixelSizeM": [27.1, 29.97],
      "method": "Counted at the native resolution; each pixel's area is R² · Δφ · Δλ · cos(φ) at its row centre, R = 6371.0088 km (mean Earth radius). Percentages of known pixels leave out the unknown ones." },
    "source": {
      "notebook": "flood_disaster.ipynb",
      "role": "Reference labels for Part A water segmentation (NISAR HH/HV); \"Prepared binary references: 0=non-water, 1=water, 255=unknown\"",
      "cells": "Part A: label inventory (cell 11), single-event check (12), EVENT_LABEL_FILES (14), multi-event dataset (30)",
      "origin": null, "date": null,
      "provenanceNote": "The notebook does not say where these labels come from or which day they show. ...",
      "file": "07_india_bihar_bhagalpur_water_reference.tif", "band": "water_label", "nodata": 255 },
    "notes": [
      "Covers a larger area than the event box; stats.eventBox gives the numbers inside the box.",
      "The image is downsampled with an \"any water\" rule, so thin water looks a little wider than it is; the stats are counted at the native ~30 m.",
      "Unknown pixels are transparent, like non-water ones; stats.unknownPct says how many there are." ],
    "url": "/api/v1/hazards/flood/events/07_india_bihar_bhagalpur/layers/water-reference/image?v=0e260e082c2a",
    "image": {
      "format": "png", "width": 1856, "height": 1301, "bytes": 114144, "downsample": 2, "resolutionDeg": 0.00053898917,
      "rule": "each image pixel covers 2 x 2 source pixels and shows the first class present in this order: Water, Not water",
      "url": "/api/v1/hazards/flood/events/07_india_bihar_bhagalpur/layers/water-reference/image?v=0e260e082c2a" },
    "links": { "self": "/api/v1/hazards/flood/events/07_india_bihar_bhagalpur/layers/water-reference" } } }
```

| Field | Meaning |
| --- | --- |
| `kind` | `mask`: classes, each image colour is a `legend` value; `raster`: a continuous quantity (none yet) |
| `time` | the moment the layer shows (`YYYY-MM-DD`), or `null` when unknown |
| `bounds` | the image's corners, `[[south, west], [north, east]]` in degrees (Leaflet's order; note an event `bbox` is `[west, south, east, north]`). It can reach up to `image.downsample` source pixels past `extent` on the east and south, where the image was padded to whole blocks |
| `extent` | the source raster's own corners, same order |
| `url` | the overlay image **on this API** (prefix the API's origin, unlike the area layers' website paths). `?v=` is the image's hash, so a rebuilt image gets a new URL; `image.url` is the same |
| `legend` | per class: source `value`, stable `key`, `label`, `color` (`#rrggbb`, `null` = drawn transparent) and `opacity` as drawn in the image. Water is `#1a5cff` at 0.8, chosen to read on light and dark basemaps |
| `stats` | from the full-resolution source, not the image: `pixels`, `totalAreaKm2`, `knownAreaKm2` (classified pixels), `unknownPct` (% of all pixels), `classes.<key>` (`pixels`, `areaKm2`, `pctOfKnown`: % of the known pixels), `eventBox` (the same inside the event `bbox`, by pixel centre; absent without a bbox), `width`/`height`, `pixelSizeDeg`, `pixelSizeM` (at the middle latitude), `method`. Areas use each pixel row's own size (pixels shrink with cos(latitude)) |
| `image` | the overlay: `format`, `width`/`height` (at most 2048 px on the long side), `bytes`, `downsample` (source pixels per image pixel, each way), `resolutionDeg`, `rule` (how a block of source pixels becomes one image pixel; for water "any water", so narrow channels stay visible) |
| `source` | where it comes from: the source `file`, `band`, `nodata`, and what the notebook says (`role`, `cells`); `origin`/`date` `null` when not stated |

Stats per event (`water-reference`, whole raster / inside the event box):

| Event | Water km² | Water % of known | Unknown % | Inside box: water km² (%) | Image |
| --- | --- | --- | --- | --- | --- |
| `02_china_guangxi` | 143.68 | 0.39 | 0.158 | 15.47 (0.543) | 1670 x 1673, 121 KB |
| `07_india_bihar_bhagalpur` | 622.37 | 7.953 | 0.108 | 375.2 (13.978) | 1856 x 1301, 111 KB |
| `09_thailand_bangkok` | 814.59 | 8.483 | 0.114 | 152.21 (5.074) | 1856 x 1486, 191 KB |

An event without layers returns `[]` (`200`). Unknown layer:
`404 not_found` with `details: { "hazard", "eventId", "layerId", "valid" }`;
unknown hazard or event: `404 not_found`.

### GET /hazards/:hazard/events/:eventId/layers/:layerId/image

The overlay image itself (`Content-Type: image/png`), not a JSON envelope.
`Cache-Control: public, max-age=86400` (a day, like the website's `/map`
rasters), with `ETag` and `Last-Modified`, so a revalidation is `304`. Use the
layer's `url` (with `?v=`) rather than building this path. Unknown hazard,
event or layer, or a layer whose image is missing: `404 not_found` (JSON).

## Planned

Not implemented yet; reserved so the API can grow without breaking v1 clients.

| Endpoint | Purpose |
| --- | --- |
| `POST /api/v1/areas` | create a custom area of interest from a bbox or GeoJSON polygon; returns an Area (`type: "custom"`) usable everywhere an `areaId` is accepted |
| more forecasts | more forecastable parameters (e.g. `lst_day`) and intervals on `GET /api/v1/areas/:areaId/forecasts`, same response shape |
| `GET /api/v1/areas/:areaId/hazards` | hazard events overlapping an area (the area's bbox against the events' `bbox`, as `?bbox=` does today) |
| live hazard data | events and series from live sources (e.g. today's IMERG rain) through another hazard provider, same responses |
| `interval=daily`, `interval=16-day` | other intervals for `/timeseries` |
| auth | required for write endpoints (`POST /areas`) only; reads stay public |

Extension points already in the code: `src/routes/v1/index.js` (new resource
files), `src/http/route.js` (add `.post()` to a route), `AREA_INCLUDES` in
`src/services/areas.js` (e.g. `include=hazards`), `src/catalog/intervals.js`
(commented 16-day entry), `src/catalog/hazards` (new hazards), `src/providers/index.js` (new providers),
and the provider contract, whose methods take area records rather than ids
so custom areas can live in their own area store.
A breaking change would go to a new `/api/v2` router alongside v1.

## How to add

The code is layered so each kind of change touches one place:

```
routes/v1/*      HTTP only: parse the query, call a service, send the envelope
services/*       validation against the catalogs, "*", includes, intervals
catalog/*        what things mean: parameters, layers, intervals, hazards (catalog/hazards/<hazard>.js)
providers/*      where the numbers come from (files today; providers/hazards.js for data/hazards)
forecast/*       how forecasts are computed: input tables (data/gee), runner for server/ml, snapshots
```

**A new parameter.** Add an entry to `PARAMETERS` in
`src/catalog/parameters.js` (key, label, unit, decimals, group, source,
aggregation) and make the provider return a series under that key (for the
files provider: add it to each city's `series` in `data/climate.json`). A key
that the data has but the catalog lacks is still served with placeholder
metadata, so nothing is hidden. Also add it to `client/src/lib/params.js`.

**A new area.** Files provider: add the city to `data/climate.json`,
`data/boundaries.json`, `data/mapmeta.json` and `data/rasters.json`, plus
`data/pixels/<id>.json`, and put its images under `client/public/map/`. It
then appears in `/areas`, `/timeseries`, layers and basemap. For its
forecast, add it to `data/gee/areas.json` (centre and `halfWidthKm`) and run
`npm run gee:extract -- --area <id>`, then `npm run forecasts:build`. Custom
(user-drawn) areas will come through `POST /areas` (see Planned) as another
area `type`, possibly kept in a separate area store: providers receive the
area record (with `center`, and `bbox`/`boundary` when the store has them),
not just an id, so they can answer for areas they did not create.

**A new layer.** Add its meaning to `LAYER_DEFS` in `src/catalog/layers.js`
(title, parameter, resolution, source, description, `values` scale/unit or
`null`). The catalog holds no per-area data. Then have the provider report it
for the areas that have it. Files provider, either:

- a layer every city has in `rasters.json`: add a row to `RASTER_LAYERS` in
  `src/providers/files.js` mapping it to fields of `rasters.json` and
  `pixels/<id>.json` (and `interval` for a timed layer), or
- a one-off layer: add a record to the area's list in `data/layers.extra.json`:

  ```json
  { "jaisalmer": [
      { "id": "s2-ndvi", "bounds": [[26.902729, 70.919915], [26.920817, 70.940063]],
        "interval": null, "times": null, "image": { "url": "/map/s2_ndvi.jpg" }, "values": null } ] }
  ```

  A timed one sets `interval` (e.g. `"yearly"`), `times` and
  `image.urlTemplate`; `values` is `null` (image only), a grid, or
  `{ time: grid }`.

**A new data provider (e.g. NASA POWER live).** Write
`src/providers/nasa.js` exporting a factory that returns an object
implementing the contract in `src/providers/types.js` (every method async;
`getTimeseries`, `getBoundary`, `listLayers` and `getLayerValues` receive
`AreaRecord`s, so a live source can query by `center`/`bbox`/`boundary`, and
return empty results for an area it has no data for), and
register it in `FACTORIES` in `src/providers/index.js`; select it with
`DATA_PROVIDER=nasa`. A practical first step is to wrap the files provider and
override only `getTimeseries()` (NASA POWER maps one-to-one onto the weather
keys, see the README's "Later: live data"), keeping areas, layers and basemap
from the files. Cache upstream responses inside the provider; routes and
services do not change.

**A forecastable parameter or a new forecast model.** The models live in the
forecasting module (`server/ml`), which the server treats as a black box with
a JSON contract (`server/ml/README.md`). Teach the module the new target or
model first, then declare it in `src/catalog/forecasts.js`: a `TARGETS` entry
(the parameter key, its `column` in the Earth Engine feature table, its
`intervals` and the minimum history) or a `MODELS` entry. Then run `npm run forecasts:build` to
save snapshots. Routes and services do not change. To run the models somewhere
other than a local Python process (an HTTP model service, a JS port), write a
runner with the same `run(request) -> Promise<response>` interface as
`src/forecast/runner.js` and pass it to `createApp({ forecastRunner })`.

**A new interval.** Add an entry to `INTERVALS` in
`src/catalog/intervals.js` (id, format, pattern, example, `steps` for the size
limit; time strings must sort chronologically). For a time-series interval
set `timeseries: true`, list it in the parameters' `intervals` (catalog) and
in each area's `coverage.intervals` (provider), and make the provider's
`getTimeseries()` produce it. For layer times only, leave `timeseries: false`
and set the layer's `interval`. Query validation and error messages pick up
the new format automatically.

**A new hazard (e.g. heatwave, drought).** Three parts, no route or service
change:

1. Data: an importer in `server/ml/forecaster/hazards/` (like
   `import_flood.py`, registered in `HAZARDS` in its `__main__.py`) that
   writes `server/data/hazards/<hazard>/`: `events.json` (events with `id`,
   `name`, `country`, `admin`, `place`, `period` {`start`, `end`, ...},
   `bbox` [W, S, E, N], `center`, `cause`, `coverage`, `files`, `sources`;
   `tables` naming each per-event CSV with its `kind` `series` or
   `observation` (the same words as the parameter kinds) and a `file` pattern
   with `{eventId}`; `datasets` with
   citations) and the CSVs (a `date` column, `YYYY-MM-DD` UTC). The layout is
   documented in `forecaster/hazards/dataset.py`.
2. Meaning: `src/catalog/hazards/<hazard>.js` (id, label, description,
   `interval`, `parameters` mapping keys to `table`/`column` or `derived`,
   `observationContext`, `forecast: { snapshot }` or `null`), added to
   `HAZARDS` in `src/catalog/hazards/index.js`.
3. Optional model: a module with `run(base) -> snapshot` and
   `check_environment()` (like `flood.py`) writing
   `model/<snapshot>.json` in the same shape: `models` (label, threshold,
   features, scores), `classes`, `target` (with `labelParameter`),
   `horizonDays`, `features`, and per event `role` plus `dates`, `label`,
   `target`, `inputs` and per model `probability`, `class`, `metrics`.

It then appears in `GET /hazards` with its events, parameters, series and
forecast. Map layers are optional (next paragraph). A new interval for its series (e.g. hourly) also needs an entry in
`src/catalog/intervals.js`.

**A new hazard layer (any hazard, any kind, any number per event).** Have
the hazard's importer write, next to `events.json`:

- `events/<eventId>/layers/<layerId>.png` (or `.jpg` / `.webp`): the overlay,
  in EPSG:4326, at most ~2048 px on the long side;
- a record in `layers.json` under `layers.<eventId>`: `id` (URL-safe, unique
  within the event), `label`, `kind` (`mask` or `raster`), `description`,
  `time` (or `null`), `crs`, `bounds` `[[south, west], [north, east]]` of the
  image, `extent`, `file` (the image path relative to the hazard folder; a
  path outside it is never served), `image` (`format`, `width`, `height`,
  `bytes`, `sha256`, ...), `legend`, `stats`, `source`, `notes`.

`forecaster/hazards/layers.py` does both for a classified GeoTIFF
(`mask_layer(tif, base, eventId, spec)` with a spec of `id`, `label`,
`description`, `legend`, `priority`, `source`, `notes`, then
`write_layers(base, hazard, {eventId: [record]})`, which keeps the other
layers already there). The flood's `--layers` option is an example
(`WATER_REFERENCE` in `import_flood.py`). The API then lists the layer in
`coverage.layers`, `provides.layers` and `/layers`, and serves the image; no
route, service or catalog change. To rebuild the flood's:

```sh
cd server/ml
./hazards-python -m forecaster.hazards import flood --layers /folder/with/<event>_water_reference.tif
```

(`./hazards-python` runs an x86-64 venv under Rosetta on Apple Silicon by
itself.) The source GeoTIFFs are not
committed; only the PNGs and `layers.json` are.

**New events for a hazard.** Add them to the sources and re-run the import
(`./hazards-python -m forecaster.hazards import flood --rainfall ... --soil ...`),
then `build` (see `server/ml/README.md`, "Hazards"). Curated facts the files do
not carry (country, admin area, cause) go in
`forecaster/hazards/flood_events.json`. The server re-reads changed files on
the next request; no restart.

What a rebuild does with them:

- `build` always retrains from scratch on every event in the dataset. A new
  event with target rows (it has `in_flood_period` labels and at least 4 days)
  joins the training events, so the cross-validation folds, the thresholds and
  the final model all change, and the model no longer equals the notebook's
  (the build's `notebookCheck` says so). Only the 3 test events are fixed by name.
- `role: "unseen"` applies only to an event with **no** target rows: it
  cannot train, so the final model scores it.
- No fitted model is saved. `build` writes only the scores
  (`model/forecast.json`); scoring an event later means rebuilding.

**Notebook quirks kept on purpose.** Both reproduce the notebook (cell 34)
and change its numbers if "fixed":

- Pass times are floored to the UTC date, so a soil moisture pass late on a
  UTC day already feeds that same day's forecast (`flood.py`, `load_frames`:
  `.dt.floor('D')`), even if it came after the day's rain.
- When two passes fall on one day, only the last one in the file is used
  (`merge_soil`: `drop_duplicates('date_utc', keep='last')`).

**Live hazard data.** Write a hazard provider with the methods of
`HazardProvider` (`src/providers/types.js`: `getDataset`, `listEvents`,
`getEvent`, `getTable`, `getModel`), e.g. one that fetches today's IMERG rain
for an event box, and pass it to `createApp({ hazardProvider })` (or make it
the default in `src/services/hazards.js`). Responses keep their shape.
