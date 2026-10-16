# Competition Web App API v1

Reference for the HTTP API in `server/`. Base path: **`/api/v1`**. All
endpoints are `GET` (and `HEAD`) and return JSON. The data comes from a
pluggable *provider*; today that is the JSON files in `server/data` (see
[How to add](#how-to-add) for live sources).

- [Conventions](#conventions)
- [Endpoints](#endpoints): [health](#get-health), [parameters](#get-parameters),
  [areas](#get-areas), [boundary](#get-areasareaidboundary),
  [timeseries](#get-timeseries), [layers](#get-areasareaidlayers),
  [layer values](#get-areasareaidlayerslayeridvalues), [basemap](#get-basemap)
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
| 400 | `invalid_parameter` | a `parameters` list names an unknown parameter key |
| 400 | `invalid_query` | a query value is malformed or unsupported: missing required `areas`, empty list, bad month, `from` after `to`, unknown `include`, a single-value key repeated with different values, `time` on a static layer or not in the layer's time format, a `/timeseries` response over the size limit, a malformed URL |
| 400 | `unsupported_interval` | `interval` is not offered (by `/timeseries`, by a parameter named in `parameters`, or by a requested area); `details.supported` lists what is |
| 404 | `not_found` | unknown route, area, parameter (in the path), layer, layer time, or a layer without values |
| 405 | `method_not_allowed` | a known path with a method other than GET/HEAD; the `Allow` header and `details.allowed` list the allowed ones |
| 500 | `internal_error` | a bug; the message is generic and the details go to the server log |

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
| `GET /api/v1/areas/:areaId/forecasts?parameters=&horizon=` | forecasts per parameter; a statistical baseline first, an ML model later (same response shape, `meta.model` names the method) |
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
then appears in `/areas`, `/timeseries`, layers and basemap. Custom
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

**A new interval.** Add an entry to `INTERVALS` in
`src/catalog/intervals.js` (id, format, pattern, example, `steps` for the size
limit; time strings must sort chronologically). For a time-series interval
set `timeseries: true`, list it in the parameters' `intervals` (catalog) and
in each area's `coverage.intervals` (provider), and make the provider's
`getTimeseries()` produce it. For layer times only, leave `timeseries: false`
and set the layer's `interval`. Query validation and error messages pick up
the new format automatically.
