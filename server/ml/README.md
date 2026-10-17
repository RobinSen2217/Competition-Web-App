# Forecaster: the team notebook as a program

This package runs the team's Colab notebook
`GEE_Data_Pipeline_Lat_Long_08_10_26.ipynb` for the site's areas, in two
separate steps:

1. **Extraction** (`python -m forecaster.gee`): notebook cells 9-46. It pulls
   monthly satellite and weather data from Google Earth Engine for a 2 x 2 km
   box around each area's centre, adds the physics features and writes
   `server/data/gee/<id>.features.csv`, the notebook's final
   "v4_physics_big_Final" CSV (33 columns, same names and order). This step
   needs Earth Engine credentials and takes minutes per area, so it runs ahead
   of time, not per web request.
2. **Forecast black box** (`python -m forecaster`): notebook cell 54. It
   reads one JSON request on stdin (an area's features table) and writes one
   JSON response on stdout: three models' scores, feature importance,
   hindcast and a 12-month NDVI forecast. It never touches the network or disk,
   so the Node server decides what data goes in.

The site's bundled NASA data (`server/data/climate.json`) is **not** used for
forecasts.

## Setup

Python 3.12. The virtual environment lives in `server/ml/.venv` (git-ignored):

```sh
cd server/ml
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
```

`requirements.txt` pins scikit-learn, pandas, numpy and `earthengine-api`.
`geemap`, `rasterio`, `matplotlib` and `seaborn` from the notebook are not
needed (see "Not part of the server pipeline").

## Credentials

Earth Engine needs a login even for public datasets. Every dataset used is
public; the Google Cloud project (`miicproject2`, notebook cell 5) is only the
account the requests run under. The code reads credentials in one place,
`forecaster/gee/auth.py`, from environment variables:

| Variable | Meaning |
| --- | --- |
| `GEE_SERVICE_ACCOUNT_KEY` | Path to a service-account JSON key. If set, it is used (`ee.ServiceAccountCredentials` + `ee.Initialize(credentials, project=...)`). Relative paths are tried against the current directory, then `server/`. |
| `GEE_CREDENTIALS` | A personal login as an environment variable: the **contents** of `~/.config/earthengine/credentials` written by `earthengine authenticate` (needs at least `refresh_token`). Used when no service-account key is set. It acts as that Google account, so keep it secret (server env or `server/.env`, never in git). |
| `GEE_PROJECT` | Cloud project, default `miicproject2`. |

If `GEE_SERVICE_ACCOUNT_KEY` is not set, the login stored on this machine by
`earthengine authenticate` is used (`ee.Initialize(project=...)`).

### Server: a service account for miicproject2

Whoever administers `miicproject2` does this once in the
[Google Cloud Console](https://console.cloud.google.com/), with the project
selected:

1. **APIs & Services > Library**: make sure the **Google Earth Engine API**
   is enabled.
2. **IAM & Admin > Service Accounts > Create service account**, e.g. name
   `web-app-gee`.
3. Grant it the roles **Earth Engine Resource Viewer** (or Earth Engine
   Resource Writer) and **Service Usage Consumer** (lets it use the project's
   enabled APIs).
4. Open the account > **Keys > Add key > Create new key > JSON**. A file
   like `miicproject2-1234abcd.json` downloads. Send it over a private channel
   (never by email to a list, never via GitHub).
5. Only if Earth Engine later answers "not registered": register the project
   (or the service account) for Earth Engine at
   <https://code.earthengine.google.com/register>.

Then on the server:

```sh
mkdir -p server/secrets
mv ~/Downloads/miicproject2-1234abcd.json server/secrets/gee-key.json
chmod 600 server/secrets/gee-key.json
export GEE_SERVICE_ACCOUNT_KEY="$PWD/server/secrets/gee-key.json"   # or put it in server/.env
cd server/ml && .venv/bin/python -m forecaster.gee check
```

`server/secrets/` is in the root `.gitignore`, so keys there are never
committed.

### Your own machine: your Google login

```sh
cd server/ml
.venv/bin/earthengine authenticate          # opens a browser once
.venv/bin/python -m forecaster.gee check
```

Your Google account needs access to `miicproject2` (or set `GEE_PROJECT` to a
project of your own that is registered for Earth Engine).

`check` logs in and makes one tiny request (counts one MODIS image). It prints
`{"ok":true,"project":...,"credentials":...}` and exits 0, or prints an error
saying what to fix and exits 1.

## Extraction

```sh
cd server/ml
.venv/bin/python -m forecaster.gee extract --area jaisalmer
.venv/bin/python -m forecaster.gee extract --all
.venv/bin/python -m forecaster.gee extract --area jaisalmer --end 2026-09-01
```

- Areas come from `server/data/gee/areas.json` (`id`, `name`, `lat`, `lon`,
  `halfWidthKm`, `state`). The six cities use the site's city centres and the
  notebook's `HALF_WIDTH_KM = 1`; Jaisalmer's centre is the notebook's.
- `START_DATE` is `2010-01-01` (cell 11). `--end` is `END_DATE`, exclusive;
  default is the first day of the current month, so the table ends with the
  last whole month. The notebook used `2026-09-01`.
- Output: `server/data/gee/<id>.features.csv`, written atomically.
  `--out-dir` writes elsewhere.
- Progress goes to stderr. stdout gets one JSON object: for `--area`,
  `{"area","path","rows","columns","from","to","seconds"}`; for `--all`,
  `{"results":[...]}` with one entry per area (an area that fails has an
  `"error"` entry and the others still run).
- Exit codes: 0 success, 2 invalid input (unknown area, bad arguments),
  1 failure (credentials, Earth Engine error). Errors are
  `{"error":{"code":"invalid_input"|"credentials"|"earth_engine","message":...}}`.

Earth Engine allows only a few concurrent aggregations per project, so run
one extraction at a time (`--all` already does them one after another).

### Notebook cells and where they live

| Cell | Notebook | Here |
| --- | --- | --- |
| 1, 3, 5 | install, `ee.Authenticate()`, `ee.Initialize(project="miicproject2")` | `requirements.txt`, `gee/auth.py` |
| 7 | mount Google Drive | not needed: files go to `server/data/gee/` |
| 9 | AOI rectangle from centre and `HALF_WIDTH_KM` (110.574 km/deg lat, 111.320 cos(lat) km/deg lon) | `gee/areas.py` `aoi_bounds`, `gee/extract.py` `aoi_rectangle` |
| 11 | `START_DATE`, `END_DATE` | `gee/__init__.py` `START_DATE`, `--end` |
| 19 | `aggregate_monthly` (server-side map, one `getInfo`) | `gee/aggregate.py` |
| 21 | MODIS LST + emissivity, `MODIS/061/MOD11A2`, mean, 1000 m | `gee/scaling.py` `scale_modis`, `gee/extract.py` |
| 23 | MODIS albedo, `MODIS/061/MCD43A3`, 500 m | `scale_albedo` |
| 24 | Sentinel-5P aerosol index, `COPERNICUS/S5P/OFFL/L3_AER_AI`, 1000 m | `scale_aerosol` |
| 26 | Landsat 5/7/8/9 C2 L2, QA mask, OLI harmonisation, NDVI/NDWI, 30 m | `mask_landsat`, `prep_tm_etm`, `prep_oli`, `add_indices` |
| 28 | ERA5-Land monthly, 9000 m | `scale_era5` |
| 30 | ESA WorldCover mode (10 m), OpenLandMap soil texture mode (250 m) | `gee/extract.py` |
| 31 | WorldPop sum and mean, 100 m | `gee/extract.py` |
| 33 | outer merge on date + static columns | `gee/tables.py` `merge_satellite` |
| 35 | save v2 CSV to Drive | not needed (intermediate file) |
| 37 | SMAP soil moisture, 10000 m | `scale_smap` |
| 39 | `aggregate_monthly_chunked` (6-month chunks, retries on "Too many concurrent aggregations", 2 s pause) + Dynamic World, 100 m | `gee/aggregate.py`, `scale_dw` |
| 41 | TerraClimate PDSI, 4000 m | `scale_terraclimate` |
| 42 | v5 merge (dates as YYYY-MM-DD, outer, sorted) | `gee/tables.py` `merge_v5` |
| 45 | physics features | `features.py` `add_physics` |
| 46 | final CSV | `gee/tables.py` `final_table`, `gee/extract.py` `write_csv` |
| 54 | models, scores, importance, recursive forecast, hindcast | `pipeline.py`, `models.py` |

The final CSV's columns are fixed in `features.FINAL_COLUMNS` (the order the
notebook's merges produced, as cell 48 printed it). Earth Engine leaves a band
out of a month when it has no pixels, so a dataset with no data at all for an
area would otherwise lose its column; it is kept as an empty column instead,
and the extraction logs a warning.

### Not part of the server pipeline

These cells draw pictures; none of them feeds the table or the models:

- **Cell 13**: interactive `geemap` map of the box.
- **Cells 15-17**: Sentinel-2 (`COPERNICUS/S2_SR_HARMONIZED`) RGB thumbnail
  and NDVI/NDWI/NDBI/EVI GeoTIFF heatmaps. They need `geemap`, `rasterio` and
  Google Drive, and produce images, not table columns.
- **Cells 47-52**: matplotlib/seaborn plots (correlations, time series,
  scatter plots).
- **Cell 54's plots** (fitting curves, 1:1 plots, importance bars, forecast
  panels): the response carries the same numbers for the site to plot.

## The forecast black box

```sh
cd server/ml
.venv/bin/python tools/build_request.py jaisalmer | .venv/bin/python -m forecaster
```

`tools/build_request.py <area-id> [--csv path] [--horizon n]` builds a request
from `server/data/gee/<id>.features.csv` and `areas.json`. Any request file
works too: `.venv/bin/python -m forecaster < request.json`.

| Exit code | Meaning | stdout |
| --- | --- | --- |
| 0 | Success | The response |
| 2 | Invalid input (bad request, or not enough data) | `{"error":{"code":"invalid_input","message":...}}` |
| 1 | Internal failure | `{"error":{"code":"model_failure","message":...}}` |

All models use the request's `seed`, so the same input gives the same output
(apart from `provenance.generated`, the time of the run). A run over 16 years
of monthly data with all three models takes a few seconds.

### Request (contract version 2)

```jsonc
{
  "version": 2,
  "area": { "id": "jaisalmer", "name": "Jaisalmer",
            "center": { "lat": 26.911773, "lon": 70.929989 }, "halfWidthKm": 1 },
  "interval": "monthly",                       // only "monthly"
  "columns": ["Emissivity_31", "Emissivity_32", "LST_Day_C", "LST_Night_C", "date", ...],
  "rows": [[0.971193, 0.975896, 25.886646, 10.088511, "2010-01-01", ...], ...],
  "target": "NDVI",                            // only "NDVI" (Landsat)
  "horizon": 12,                               // 1..24, default 12 (the notebook's N_FORECAST)
  "models": ["ridge", "nn", "gbm"],            // any subset, any order (= response order)
  "options": { "testFraction": 0.2, "seed": 42, "lags": 2 }   // optional; the notebook's values
}
```

- `columns` / `rows` are the features CSV: one row per month, `date` as
  `"YYYY-MM-DD"`, consecutive months in order, numbers or `null` (an empty
  CSV field). Required columns: `date`, `NDVI` and the 13 model drivers
  (`features.DRIVERS`); the other notebook columns may come along and are
  ignored.
- `area.name`, `area.center` and `area.halfWidthKm` are optional
  (`halfWidthKm` feeds `provenance.areaKm` and the assumptions text).

### Response

```jsonc
{
  "version": 2, "area": "jaisalmer", "target": "NDVI", "interval": "monthly",
  "issued": "2026-08",                     // last complete month (every input + NDVI present)
  "forecastTimes": ["2026-09", ...],       // `horizon` months after `issued`
  "models": {
    "ridge": {
      "label": "Ridge regression",
      "forecast": [0.2528, ...],           // one per forecastTimes entry
      "hindcast": {                        // forecast re-run from 12 complete months earlier
        "times": [...], "observed": [...], "predicted": [...], "r2": 0.31, "rmse": 0.03
      },
      "metrics": {
        "train": { "r2": 0.8279, "rmse": 0.02, "from": "2010-03", "to": "2023-07", "n": 152 },
        "test":  { "r2": 0.8125, "rmse": 0.0184, "from": "2023-08", "to": "2026-08", "n": 37 }
      },
      "importance": [ { "feature": "NDVI_lag1", "label": "Last month's NDVI", "value": 0.38 }, ... ]
    },
    "nn": { ... }, "gbm": { ... }
  },
  "features": [ { "key": "AirTemp_C", "label": "Air temperature", "unit": "°C" }, ... ],
  "assumptions": [ "NDVI (what is forecast) is the monthly mean of cloud-free Landsat ...", ... ],
  "modelVersion": "gee-notebook-2026-10-08",
  "dataUntil": { "NDVI": "2026-08", "AirTemp_C": "2026-08", ... },   // last month with a value
  "history": { "times": ["2010-01", ...], "observed": [0.126, ..., null, ...] },  // all NDVI, for plotting
  "provenance": {
    "pipeline": "GEE notebook GEE_Data_Pipeline_Lat_Long_08_10_26",
    "datasets": ["MODIS/061/MOD11A2", ...],  // every Earth Engine dataset the extraction reads
    "areaKm": "2 × 2 km",
    "generated": "2026-10-17T12:00:00Z"      // when this response was computed
  }
}
```

- `importance`: permutation importance on the test months (drop in test R²
  when that input is shuffled, 30 repeats). Sorted high to low, every input
  listed; values can be slightly negative (noise).
- Values are rounded (forecasts to 5 decimals, R² to 4).

### What happens inside (cell 54)

Code map: `contract.py` (validation), `features.py` (columns, physics,
labels), `models.py` (registry), `pipeline.py` (training and forecasting),
`__main__.py` (stdin/stdout).

1. **Complete rows.** `NDVI_lag1`, `NDVI_lag2` = NDVI shifted by 1 and 2
   months; month as sine/cosine; every row missing a model input or NDVI is
   dropped (`dropna(subset=COLS + ["NDVI"])`). Model inputs are the 13
   drivers (`AirTemp_C`, `Dewpoint_C`, `Precip_mm`, `WindSpeed_ms`,
   `VPD_kPa`, `Rs_down_Wm2`, `evopration_demand`, `Vapor_Slope_kPa_C`,
   `Precip_2mo_sum`, `Precip_3mo_sum`, `R_n`, `delta_T`, `LST_DTR`), season
   and lags (`USE_TREND = False`).
2. **Split and score.** The last `int(n * 0.2)` complete rows are the test
   set (chronological). Ridge (alpha 10), NN (MLP 8-8 tanh, lbfgs) and GBM
   (200 trees, depth 2), each behind a StandardScaler, exactly as
   `make_models()`. R² and RMSE on train and test.
3. **Importance.** `permutation_importance(n_repeats=30, scoring="r2",
   random_state=seed)` on the test rows.
4. **Hindcast.** `recursive_forecast(df.iloc[:-12], 12)`, compared with the
   last 12 complete rows.
5. **Forecast.** `recursive_forecast(df, horizon)`: refit on all complete
   rows; future drivers are each calendar month's mean over them
   (climatology); the forecast starts the month after the last complete row;
   each predicted NDVI becomes the next month's lag.

The physics features (`features.add_physics`, formulas in its docstring)
follow cell 45, including sunlight as `Rs_down_Jm2 / (days in that month x
86400)` and net radiation with the measured MODIS `Emissivity_31`.

`tests/notebook_cell54.py` is a near-verbatim copy of cell 54 (without the
plots); `tests/test_pipeline.py` checks that the pipeline gives the same
split, scores, importance, hindcast and forecast on a synthetic table.

### Assumptions (also in every response)

- NDVI is the mean of cloud-free Landsat 5/7/8/9 pixels (30 m) over the
  2 x 2 km box; months without a clear view have no NDVI and drop out.
- Weather is ERA5-Land (~9 km grid), so it describes the wider area, not the
  box itself.
- Future weather is climatology, as in the notebook, not a weather forecast.
- Test scores use the actual weather and last month's actual NDVI, so they
  are better than a real forecast can be; the hindcast (typical weather, 12
  months blind) is the more honest picture.

## Tests

```sh
cd server/ml
.venv/bin/python -m unittest -v
```

Everything runs offline in about 15 seconds: AOI maths against cell 9's
printed box, the band maths on a fake image (`tests/fake_ee.py`), chunking
and retries, merges and the final column layout, the extraction wiring with
Earth Engine replaced, credentials handling, the CLIs, physics against hand
calculations, the contract, and the pipeline against the notebook's own code.

**Acceptance test** (needs working credentials, several minutes):

```sh
GEE_ACCEPTANCE=1 .venv/bin/python -m unittest -v tests.test_notebook_acceptance
```

It extracts Jaisalmer with `END_DATE = 2026-09-01` and checks the numbers
the notebook printed: first-row MODIS, albedo, Landsat, ERA5 and PDSI values,
land cover, soil and population, the (200, 33) table, the 152/37 split, R²
per model and all 36 forecast values. Without `GEE_ACCEPTANCE=1` or without
credentials it is skipped with the reason. If Google reprocesses a dataset,
some values may drift; the failing test names the dataset.

## Adding or replacing a model

Add one entry to `MODELS` in `forecaster/models.py`:

```python
'pinn': ModelSpec(label='Physics-informed network', factory=lambda seed: PhysicsNet(seed=seed)),
```

The factory gets the seed and returns an unfitted object with `fit(X, y)` and
`predict(X)` (scikit-learn style; X columns are listed in the response's
`features`). Metrics, importance, hindcast and forecast then work unchanged,
and callers can ask for it by name. If it needs other inputs, add them to
`features.py` (`DRIVERS` and a `FEATURE_INFO` label; a new column also needs
to come from the extraction). Bump `MODEL_VERSION` in `pipeline.py` whenever
the response would change (results, or text such as `assumptions`), so cached
forecasts are recomputed and saved snapshots can be told apart.
