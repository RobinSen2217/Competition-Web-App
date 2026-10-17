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
| 400 | `invalid_parameter` | a `parameters` list names an unknown parameter key (or, for forecasts, one that cannot be forecast) |
| 400 | `invalid_query` | a query value is malformed or unsupported: missing required `areas`, empty list, bad month, `from` after `to`, unknown `include`, a single-value key repeated with different values, `time` on a static layer or not in the layer's time format, a `/timeseries` response over the size limit, a forecast `horizon` out of range, an unknown forecast model, more than one forecast parameter, a malformed URL |
| 400 | `unsupported_interval` | `interval` is not offered (by `/timeseries`, by a parameter named in `parameters`, or by a requested area); `details.supported` lists what is |
| 404 | `not_found` | unknown route, area, parameter (in the path), layer, layer time, or a layer without values |
| 405 | `method_not_allowed` | a known path with a method other than GET/HEAD; the `Allow` header and `details.allowed` list the allowed ones |
| 422 | `insufficient_data` | the request is valid but the area has too little data for it (a forecast needs enough months in the area's feature table) |
| 500 | `internal_error` | a bug; the message is generic and the details go to the server log |
| 502 | `model_failure` | the forecasting model failed for this request (details in the server log) |
| 503 | `forecast_unavailable` | no forecast can be given now: the area's Earth Engine data has not been extracted yet (`details.reason: "no_gee_data"`), or the forecasting model cannot run (not installed, timed out, or turned off) and no saved forecast covers the request |

### Query parameters

- **Lists** are comma-separated: `?parameters=ndvi,rain`. Repeated keys are
  merged (`?parameters=ndvi&parameters=rain` is the same). Duplicates and
  spaces are dropped. An empty list (`?parameters=`) is `invalid_query`.
- **`*` means all**: `?areas=*`, `?parameters=*`, `?include=*`, `?type=*`.
  A list containing `*` also means all.
- **Single values** (`from`, `to`, `interval`, `time`) may be repeated only if
  every copy is identical; otherwise `invalid_query`. An empty value counts as absent.
- **Unknown query parameters are ignored**, so clients can send extras safely.
- **Time values** are strings whose format depends on the interval
  (`src/catalog/intervals.js`): monthly `YYYY-MM`, yearly `YYYY`. Time series
  are monthly; a layer names the interval of its `times` in `interval` (today
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

Ids (`areaId`, `layerId`, parameter keys) are stable, lowercase and URL-safe.
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

## Planned

Not implemented yet; reserved so the API can grow without breaking v1 clients.

| Endpoint | Purpose |
| --- | --- |
| `POST /api/v1/areas` | create a custom area of interest from a bbox or GeoJSON polygon; returns an Area (`type: "custom"`) usable everywhere an `areaId` is accepted |
| more forecasts | more forecastable parameters (e.g. `lst_day`) and intervals on `GET /api/v1/areas/:areaId/forecasts`, same response shape |
| `GET /api/v1/hazards`, `GET /api/v1/areas/:areaId/hazards` | the Disaster module: hazard events / risk per area |
| `interval=daily`, `interval=16-day` | other intervals for `/timeseries` |
| auth | required for write endpoints (`POST /areas`) only; reads stay public |

Extension points already in the code: `src/routes/v1/index.js` (new resource
files), `src/http/route.js` (add `.post()` to a route), `AREA_INCLUDES` in
`src/services/areas.js` (e.g. `include=hazards`), `src/catalog/intervals.js`
(commented daily/16-day entries), `src/providers/index.js` (new providers),
and the provider contract, whose methods take area records rather than ids
so custom areas can live in their own area store.
A breaking change would go to a new `/api/v2` router alongside v1.

## How to add

The code is layered so each kind of change touches one place:

```
routes/v1/*      HTTP only: parse the query, call a service, send the envelope
services/*       validation against the catalogs, "*", includes, intervals
catalog/*        what things mean: parameters, layers, intervals
providers/*      where the numbers come from (files today)
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
