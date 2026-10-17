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

The hazard part (`python -m forecaster.hazards`: the flood events and the
flood notebook's 3-day forecast) has its own section, [Hazards](#hazards),
and its own environment.

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

## Hazards

`forecaster.hazards` turns the team's flood data and the flood notebook
(`flood_disaster.ipynb`, Part B) into the files the API serves under
`/api/v1/hazards` (server `docs/API.md`, "Hazards"). It is separate from the
NDVI black box above: nothing runs per web request.

```sh
cd server/ml
./hazards-python -m forecaster.hazards import flood --rainfall <rainfall dir> --soil <soil_moisture dir>
./hazards-python -m forecaster.hazards import flood --layers <dir with <event>_water_reference.tif>   # map layers only
./hazards-python -m forecaster.hazards build flood            # -> server/data/hazards/flood/model/forecast.json
./hazards-python -m forecaster.hazards build flood --stdout   # the same JSON on stdout, nothing written
```

Like the other CLIs: stdout carries one JSON object (or `{"error": ...}`),
progress goes to stderr; exit 0 success, 2 invalid input (unknown hazard,
missing dataset, wrong scikit-learn), 1 failure.

### Setup: its own environment

```sh
cd server/ml
python3 -m venv .venv-hazards                 # Apple Silicon: arch -x86_64 python3 -m venv .venv-hazards
.venv-hazards/bin/pip install -r requirements-hazards.txt
```

`requirements-hazards.txt` pins scikit-learn **1.8.0**, pandas, numpy and
rasterio (for the GeoTIFF bboxes). It is separate from `requirements.txt`
because the notebook's forest cannot be reproduced with scikit-learn 1.9,
while the NDVI models stay on their 1.9.1 pin (1.8 would change their GBM
hindcast in the 5th decimal). `build` refuses scikit-learn >= 1.9 unless
`--any-sklearn` is given. On an Apple Silicon Mac, create the venv as x86-64
(Rosetta) for bit-exact results (see "Reproducing the notebook").

Run it through `./hazards-python`, not `.venv-hazards/bin/python`: the venv's
python binary may be universal, so a plain call on Apple Silicon starts as
arm64 and then cannot load an x86-64 scikit-learn. The launcher looks at the
installed scikit-learn and re-runs under `arch -x86_64` only when it is x86-64
on an arm64 Mac; elsewhere it calls the venv's python directly.

### Import: the normalized dataset

`import flood` reads the folders inside the team's `rainfall.zip` and
`soil_moisture.zip` (`<event>/rainfall_daily.csv`, `rainfall_daily_grid.tif`,
`README.md`; `<event>/soil_moisture_passes.csv`; the summary CSVs and
READMEs) and writes `server/data/hazards/flood/`:

| File | Contents |
| --- | --- |
| `events.json` | per event: `id`, `name` (README title), `country` {code, name}, `admin`, `place`, `period` {`reported`, `start`, `end`, `windowStart`, `windowEnd`, `soilWindowStart`}, `bbox` [W, S, E, N] (extent of the rainfall GeoTIFF, EPSG:4326, float32 edges rounded to 4 decimals), `center`, `cause`, `rainDriven`, `notes` (the README's event-specific "Things to know"), `summary` (the summary CSVs), `coverage`, `files`, `sources`; plus `tables` (column documentation), `datasets` (citations, DOIs) and general `notes` |
| `events/<event>/daily.csv` | `date, rain_box_mm, rain_wettest_cell_mm, cells_with_data, in_flood_period` (from `date_utc, box_mean_mm, wettest_cell_mm, ...`) |
| `events/<event>/soil_passes.csv` | the pass table, every column, `date_utc` renamed `date`, rows in the source's order |
| `layers.json` | with `--layers`: map layers per event (`{layers: {eventId: [record]}}`), see below |
| `events/<event>/layers/<layer>.png` | with `--layers`: each layer's overlay image |
| `README.md` | generated description of all of it |

Numbers are copied as the sources wrote them (no float round trip), booleans
become `true`/`false`, so the model reads exactly what the notebook read.
Every event is kept, Nepal included. Facts the files do not carry (country,
admin area, cause, `rainDriven`) come from `forecaster/hazards/flood_events.json`;
events missing there are imported with those fields `null`. The layout is the
same for every hazard (`forecaster/hazards/dataset.py`).

**Map layers (`--layers <dir>`).** Every `<event>_water_reference.tif` in the
folder (the reference water labels of the flood notebook's Part A, used there
to train and score the NISAR HH/HV water segmentation: EPSG:4326, uint8 band
`water_label`, ~30 m, 0 = not water, 1 = water, 255 = unknown) becomes the
layer `water-reference` of the event whose id the file name starts with
(longest match; a file matching no event is skipped with a warning). For each,
`forecaster/hazards/layers.py`:

- counts the classes at the **native** resolution, each pixel row with its own
  area (R² · Δφ · Δλ · cos φ, R = 6371.0088 km), over the whole raster and
  inside the event bbox (`stats.eventBox`), giving km², % of the known
  pixels and the unknown share;
- writes an 8-bit palette PNG (encoded with `zlib`, no imaging package) at
  most 2048 px on the long side: blocks of `ceil(longSide / 2048)` source
  pixels become one image pixel by the "any water" rule (water if any source
  pixel is water, else not water if any is, else unknown), water drawn
  `#1a5cff` at 80% opacity, everything else transparent; `bounds`
  (`[[south, west], [north, east]]`) include the few padded pixels;
- records label, legend, stats, source and the image's size and SHA-256 in
  `layers.json`, replacing only layers with the same id on the same event.

The notebook does not say where the labels come from or which day they show,
so the records say so (`source.origin`, `time`: `null`). With `--layers` alone
`events.json` is left as it is (the events must already be imported); the
source GeoTIFFs are not copied, so keep them to rebuild. Other hazards and
layer kinds reuse `mask_layer` / `write_layers` with their own spec (server
`docs/API.md`, "How to add").

### Build: the flood model (`forecaster/hazards/flood.py`)

The notebook's Part B was run out of order in Colab, and the cell that built
`train_df`/`test_df` ("CELL 2") was deleted from the file. The pipeline that
produced the printed results, reconstructed from the execution counts:

1. **Data, cell 34 ("CELL 1")**: daily rainfall per event, Nepal skipped
   (glacier collapse, not rain). Features per event, past days only:
   `box_1d/3d/7d/max3d` and `wet_1d/3d/7d/max3d` (rolling sums and 3-day max,
   `min_periods=1`). Soil: `mean_sm_recommended_only`, `coverage_pct`,
   `mean_uncertainty` of the latest pass on or before the day
   (`merge_asof(direction="backward", tolerance=24 days)`, last pass of a day
   wins) and its age in days.
2. **Target, cell 28**: `actual_flood_within_next_3_days` = flood period on
   any of the next 3 days; the last 3 days of each event have none. 221
   rows, 83.7% positive.
3. **Split, "CELL 2"**: test = 02_china_guangxi, 07_india_bihar_bhagalpur,
   09_thailand_bangkok (cell 32's `FORECAST_TEST_EVENTS`; 45 rows), train =
   the other 6 events (176 rows). Cell 35 shows both frames with the target.
4. **Models, cell 36 ("CELL 3")**: "Rainfall only" (8 features) and
   "Rainfall + soil moisture" (12), each `SimpleImputer(median)` +
   `RandomForestClassifier(300 trees, max_depth 6, min_samples_leaf 3,
   balanced_subsample, random_state 42)`. Threshold: GroupKFold (5 folds over
   whole training events) out-of-fold probabilities, thresholds
   0.100..0.900 step 0.025, the first with the best balanced accuracy. Final
   model on all training rows, scored on the test events.

`tests/notebook_flood_partb.py` is a near-verbatim copy of those cells; a
test checks the module against it row by row.

Two notebook quirks are kept on purpose, because "fixing" them would change
the printed numbers:

- pass times are floored to the UTC date (`load_frames`, `.dt.floor('D')`),
  so a soil moisture pass late on a UTC day already feeds that same day's
  forecast;
- when two passes fall on one day, only the last one in the file is used
  (`merge_soil`, `drop_duplicates('date_utc', keep='last')`).

What the build adds: **every day of every event** gets a probability per
model and a danger class (`probability >= threshold`). Test events are scored
by the final model; training events by their **out-of-fold** model (the fold
that held the event out, i.e. the notebook's `oof` array), so no event is
scored by a model that saw it. The last 3 days are scored the same way and
have `target: null`. Nepal gets `role: "excluded"` and the reason. Per model
the snapshot also holds the held-out test metrics (the notebook's table), the
per-event metrics (test events: the notebook's event table; training events:
from their out-of-fold probabilities), the out-of-fold balanced accuracy, all
33 thresholds of the sweep, the feature importance, and the model inputs per
day. `provenance.notebookCheck` compares 54 printed numbers with the run.

One deliberate difference: the notebook predicts with `n_jobs=-1`, where
scikit-learn adds the 300 trees' votes up in whatever order its threads
finish, so the last bits of a probability change from run to run. The module
fits with all cores (identical trees) but predicts with one core, so the
same data always gives the same file (differences vs the notebook's way are
below 1e-12; no printed number depends on them).

### Reproducing the notebook

On x86-64 with scikit-learn 1.8.0 (the committed snapshot: Python 3.12,
numpy 2.5.3, pandas 3.0.6, under Rosetta) every printed number matches
(`notebookCheck.matches: true`): 221 records, positive rate 0.837, the cell-34
per-event table, thresholds 0.550 / 0.750, out-of-fold balanced accuracy
0.777 / 0.800, and the test table (accuracy 0.756 / 0.778, balanced accuracy
0.542 / 0.583, precision 0.750 / 0.767, recall 1.0, F1 0.857 / 0.868,
ROC AUC 0.692 / 0.692, AP 0.877 / 0.874, 45 rows, actual positive rate 0.733,
predicted 0.978 / 0.956) and the per-event test table. Also tried: x86-64
with scikit-learn 1.6.1 matches the same way; on arm64, 1.5.2, 1.6.1, 1.7.2 and
1.8.0 all give the same numbers (the arm64 row below). The notebook ran Python
3.13 on Colab; Python 3.12 here reproduces it, so the Python version does not
matter for these results.

Where it differs, and why:

| Environment | Differs from the notebook | Why |
| --- | --- | --- |
| scikit-learn 1.9.x (any machine) | out-of-fold balanced accuracy 0.781 / 0.804, soil model ROC AUC 0.689 and AP 0.869; thresholds and every threshold-based test metric unchanged | 1.9 changed how forests draw bootstrap samples with class weights (`balanced_subsample` and sample weights now go into the sampling), so the trees differ |
| scikit-learn <= 1.8 on arm64 (Apple Silicon) | soil model out-of-fold balanced accuracy 0.804 instead of 0.800; everything else matches | floating-point differences in tree building between the arm64 and x86-64 builds flip a near-tied split in one fold |

### Tests

```sh
cd server/ml
./hazards-python -m unittest discover -t . -s tests -p 'test_hazards*.py'
# with the source folders: also re-imports and compares file by file
FLOOD_SOURCE_DIR=/path/with/rainfall+soil_moisture ./hazards-python -m unittest -v tests.test_hazards_import
# with the layer GeoTIFFs: also rebuilds the layers and compares them byte for byte
FLOOD_LAYERS_DIR=/path/with/water_reference_tifs ./hazards-python -m unittest -v tests.test_hazards_layers
```

(the launcher picks the architecture; on an arm64 venv the two bit-exact
acceptance tests skip with the reason). `test_hazards_import.py`: the
import on a synthetic source tree (values kept as written, booleans, source
order, notes split, curated facts, bbox from a float32 GeoTIFF, errors) and
the committed dataset's consistency. `test_hazards_flood.py`: the building
blocks (target, rolling features, the 24-day backward soil join, exclusion),
the module against the notebook copy row by row, the scoring rules (no event
scored by a model that saw it) and the CLI. `test_hazards_flood_acceptance.py`:
the notebook's printed numbers, and that the committed snapshot equals a
fresh build. `test_hazards_layers.py`: the layer helpers (any-water
downsampling, the PNG encoder, per-row pixel areas, class stats, the event-box
window, merging layers.json), the `--layers` import on synthetic GeoTIFFs
(bounds, padding, colours, refusals, CLI) and the committed layers. With the main `.venv` (scikit-learn 1.9.1, no rasterio) the
acceptance and GeoTIFF tests skip with the reason and the rest runs, so
`.venv/bin/python -m unittest` stays green.

### Adding a hazard

Write `forecaster/hazards/import_<hazard>.py` (writing the layout of
`dataset.py`) and, if it has a model, a module with `run(base) -> snapshot`,
`check_environment()` and `MODEL_VERSION`; register both in `HAZARDS` in
`forecaster/hazards/__main__.py`. Per-event map layers are optional: build
them with `layers.mask_layer` and `layers.write_layers` (as the flood's
`--layers` does). The server side is a catalog file (server
`docs/API.md`, "How to add").
