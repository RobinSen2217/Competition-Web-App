# Competition Web App: client

React 19 + Vite 8 front end. One nav bar switches between two pages:

| Path | Page |
| --- | --- |
| `/` | **Vegetation**: the satellite vegetation and climate explorer, ported from the single-file prototype (`vegetation-of-the-city/index.html`) |
| `/disaster/flood` | **Disaster → Flood**: past flood events with daily rainfall / soil moisture, the danger-day forecast and its scores (`src/pages/FloodPage.jsx`, sections in `src/components/flood/`, data via `src/lib/hazards.js`); `/disaster` redirects here. More hazards: add a route in `App.jsx` and an entry in `HAZARDS` in `Nav.jsx` |

Routing uses React Router (`src/App.jsx`). `vercel.json` rewrites every path
except `/api/...` to `index.html`, so `/disaster/flood` also works when opened directly.

## Run it

Vite 8 needs Node 20.19+; the project pins **Node 22** (`.nvmrc`, `engines`):

```sh
nvm use            # picks up .nvmrc (Node 22)
npm install
npm run dev        # http://localhost:5173
npm run build      # production build in dist/
npm run preview    # serve the build
npm run lint       # oxlint
```

`vite.config.js` proxies `/api` to `http://localhost:5050` for the Express server in `../server`
(start it with `npm run dev` there). Without the server the site still works on its static
fallback data; see [Data](#data).

## Layout

```
public/
  favicon.svg
  logos/                    partner logos (MNIT Jaipur, St. Stephen's College), set in src/data/contact.js
  map/                      satellite mosaics (<id>.jpg) and place-name overlays (<id>_lab.png)
  map/s2_*.jpg              Sentinel-2 10 m layers (Jaisalmer only)
  data/fallback/            static copies of the data (climate, boundaries, mapmeta, rasters .json), fetched
                            on demand when the API is not used (see "Data"); never bundled into the JS
  data/forecasts/           saved ML forecasts, <city>.<target>.json (e.g. jaipur.ndvi.json), generated
                            by the server's forecasting module; used when the API is not (see "Forecasts")
  map/raster/<city>/        per-city MODIS rasters: ndvi-<year>.png, change.png, lst-day.png,
                            lst-night.png, and values.json (static per-pixel numbers for the pixel
                            inspector, used only when the API is unavailable)
src/
  main.jsx                  entry; starts bootstrap() (city list only) + the App.jsx import, renders Boot
  Boot.jsx                  shows the animated Loader until the app is ready, then crossfades
  App.jsx                   router: nav bar + the page for the current path, with page transitions
  pages/                    VegetationPage (all its sections + footer), DisasterPage (layout), FloodPage
  hooks/useModuleTheme.js   sets <html data-module="disaster"> on /disaster/* (blue theme)
  data/contact.js           partner institutions and team (Contact card, nav, footer)
  lib/
    store.js                the single access point for data: bootstrap, on-demand cached loading,
                            hooks (useTimeseries, useAreaDetail, useBasemap, useResource), static fallback
    api.js                  v1 API client: request helper, requests, v1 -> internal converters
    months.js params.js     month helpers, parameter definitions and number formatting
    stats.js                climatology, anomalies, OLS, correlation
    forecasts.js            ML forecast loader: live API run, or the saved snapshot (see "Forecasts")
    chart.js                small SVG line-chart engine (used through components/common/Chart)
    download.js storage.js theme.js
    map/                    Leaflet helpers: basemap mosaics, layer defs, geometry, popup HTML
  index.css                 Tailwind setup: design tokens (light/dark), @theme mapping, base element styles
  hooks/                    useThemeVersion (redraw on dark/light change), useElementWidth
  state/                    AppProvider + useApp(): selected city and toasts
  components/
    ui/                     shared Tailwind building blocks: Card, CardHead, Kicker, Lede, Chip, Pill,
                            Seg, Btn, Select, Toggle, Readout, Note ...
    common/                 Chart, Sparkline, Loader (boot), SectionLoader (in-card loader + skeletons),
                            LazySection (mounts a section near the viewport), ErrorBoundary
    layout/                 Nav (app name, partner logos, city picker, page tabs), CityPicker, Footer
    sections/               Hero, Glance, PlotBuilder, Why, ModelForecast, Compare, Intro,
                            Science, Methods, Sources, Faq
    map/                    MapExplorer and its rail, planner and hooks
  styles/classes.js         shared class strings (cx, noteCls, selectCls, rangeCls)
  styles/leaflet.css        the only plain CSS: overrides for elements Leaflet creates itself
```

### Styling

Styling is Tailwind CSS v4 utilities, written directly on the elements.

- **Colours and fonts** come from design tokens in `src/index.css`. Use them as
  normal Tailwind classes: `bg-surface`, `bg-surface2`, `text-ink`, `text-muted`,
  `border-line`, `bg-accent`, `text-on-accent`, series colours `s1`–`s4`, status
  colours `good`/`warn`/`bad`, fonts `font-display`/`font-body`/`font-mono`, and
  `shadow-card`. Light and dark mode swap the underlying CSS variables, so no
  `dark:` variants are needed.
- **Font sizes** are pixel values (`text-[14px]`). Tailwind's named sizes
  (`text-sm` etc.) also set a line-height and would shift the layout.
- **Repeated pieces** (cards, chips, pills, buttons, selects, readouts) are React
  components in `src/components/ui/`. Use those before writing long class lists.
- **SVG and Leaflet colours** are read from the CSS variables at runtime
  (`css('--accent')`). Components that do this redraw when `useThemeVersion()`
  changes, so a dark/light switch recolours them live.


### Motion and themes

- Animations use **framer-motion** (`framer-motion` package, the same imports
  hover.dev components use, so their code can be pasted in). The whole app sits
  in `<MotionConfig reducedMotion="user">`, so devices set to reduce motion get
  fades only.
- Building blocks: `components/common/Reveal.jsx` (fade-up on first scroll into
  view; `Card` and `PageSection` use it), `components/common/motionPresets.js`
  (shared easing/variants), `components/common/Loader.jsx` (startup loader).
  Animate only opacity/transform, never size: the map and charts measure their
  containers.
- **Module themes:** on `/disaster/*` the palette is blue. The overrides live in
  `index.css` under `[data-module="disaster"]`; the colour tokens are registered
  with `@property`, so switching fades smoothly (0.6 s). Charts and Leaflet read
  colours from `:root`, which switches instantly, so they never bake half-faded
  colours.

## Data

The site loads its data from the Express API in `../server`, piece by piece as
the reader scrolls, and falls back to static copies when the API cannot be reached.

`src/lib/store.js` is the single access point (its header has the full guide).

**Startup** (`main.jsx` awaits `bootstrap()`, with the boot loader on screen)
makes one small request, `GET /api/v1/areas?type=city` (waits 4 s, see Fallback). It gives
the city list (`CITY_IDS`, `CITIES`: names, states, centres, which parameters
have data) and the monthly time axis `M` (from the areas' coverage), which
`lib/months.js` and the charts read synchronously. Nothing else is loaded yet.

**Sections load their own data** when they come near the viewport:
`components/common/LazySection.jsx` mounts a section about 800px before it
scrolls into view (and at once when a `#anchor` link targets it), and the
section asks the store for what it draws, showing an in-card loader
(`SectionLoader.jsx`) meanwhile:

| Hook / function | Request | Static fallback |
| --- | --- | --- |
| `useTimeseries({ areas, parameters })` | `/api/v1/timeseries?areas=..&parameters=..&interval=monthly` | `public/data/fallback/climate.json` |
| `useAreaDetail(id)` | `/api/v1/areas/<id>?include=boundary,layers` | `boundaries.json`, `rasters.json` |
| `useBasemap()` | `/api/v1/basemap` | `mapmeta.json` |
| `getPixelValues(id)` (map inspector, on click) | the four MODIS layers' `/values` | `public/map/raster/<id>/values.json` |
| `loadForecast(id)` (`lib/forecasts.js`) | `/api/v1/areas/<id>/forecasts` | `public/data/forecasts/<id>.ndvi.json` |

Requests are de-duplicated and cached in memory for the page's lifetime
(series per city and parameter, so overlapping requests only fetch what is
missing); switching city fetches only what the mounted sections need for it.
The city is picked in the hero's shelf or, from anywhere on the page, with
the city picker in the sticky nav (`components/layout/CityPicker.jsx`); both
call `useApp().setCity`. The plot builder fetches only the parameters selected
in it.
The heaviest sections (map with Leaflet, plot builder, forecast) are also
split into their own JS chunks, downloaded on approach.
Until a section mounts, its placeholder has the real card's height for the
current width, from the measured tables in `src/lib/sectionHeights.js`
(re-measure them after changing a card; how is described there).
Error boundaries keep a failure local: a section that fails to render or
whose chunk cannot be downloaded (e.g. after a redeploy) shows an error card
with "Try again" (which re-imports, and reloads the page at that section if
the chunk is still missing); a broken page keeps the nav; the whole app has a
last-resort "Reload" screen.

**Fallback.** When the API is not used (a production build without
`VITE_API_URL`) or does not answer the startup request within 4 s, every call
is answered from the static files in `public/data/fallback/`, fetched only when
needed and converted to the same shapes, so every section works the same. The
browser console logs it (`[data] using API ...` or `[data] using static
fallback files`).
A sleeping API (Render's free tier needs ~10-50 s for its first answer) is not
waited for at startup, but its request keeps running for up to 60 s: if it
answers and lists the same cities, parameters and months, everything loaded
from then on comes from the API (`[data] API answered late ...`), while what
was already loaded stays. A failed API is not retried. Details at the top of
`lib/store.js`.
Map images (`public/map/...`) are always static files served with the site.

How a section asks for its data (hooks, loading and error states) is
described at the top of `lib/store.js`.

The API speaks in generic resources (areas, parameters, layers, time series; see
`../server/docs/API.md`), while the components use small city-based shapes.
`src/lib/api.js` holds everything API-specific: the request helper
(`apiGet`/`apiData`, which unwraps the `{ data, meta }` envelope and turns the
`{ error: { code, ... } }` envelope into an `ApiError`), the requests, and the
converters from v1 resources to the store's shapes. `RASTER_LAYERS` there maps
the explorer's four MODIS layers to API layer ids. When the API changes, only
`api.js` (and the fallback adapter in `store.js`) need to follow.
The Sentinel-2 layers for Jaisalmer are still defined client-side in
`src/lib/map/layers.js`.

Rule: nothing that reads `CITY_IDS`, `CITIES` or `M` may be evaluated before
`bootstrap()` finishes (for example `lib/months.js` computes the year range at
import time). That is why `main.jsx` imports `App.jsx` dynamically.

### API URL (`VITE_API_URL`)

| Where | Setting | Result |
| --- | --- | --- |
| Local dev | unset | requests go to `/api` on the dev server, which Vite proxies to `http://localhost:5050` |
| Production (Vercel) | unset | the API is skipped and the static fallback files are used (no API requests) |
| Production (Vercel) | `https://<server-domain>` | requests go to the hosted Express server |

Set it in Vercel under Project Settings > Environment Variables, or locally in
`.env.local` (see `.env.example`). Give the base URL only, without `/api`. Vite
bakes it in at build time, so redeploy after changing it. The server must allow
the site's origin in its `CORS_ORIGINS`. The `/api/v1` prefix is added in
`src/lib/api.js`.

Without `VITE_API_URL`, production runs on the static fallback files. Once the
API is reliably live, the copies (`public/data/fallback/*.json` and
`public/map/raster/*/values.json`) can be removed together with the fallback
adapter in `lib/store.js`.

To add a city, add it to the server's data (see `../server/README.md`) and, while
they exist, to the fallback copies: its series to `public/data/fallback/climate.json`,
its outline to `boundaries.json`, its three mosaics to `mapmeta.json` and `public/map`, and its
rasters under `public/map/raster/<city>/` with an entry in `rasters.json`. With
the API, a new city appears in the site without client changes as long as it has
a boundary and three mosaics (its map layers show when it has the four MODIS layers).

## Forecasts

The page's "Forecast" part has one card (the prototype's statistical baseline
was removed so the page shows only the team's models):

- **Machine-learning forecast** (`sections/ModelForecast.jsx`, card id
  `mlforecast`): the team notebook's three models (Ridge regression, a small
  neural network and gradient boosting), trained per city on its monthly NDVI,
  weather and land-surface-temperature history, forecasting NDVI 12 months
  ahead. The card shows the last 36 observed months with the forecast of the
  selected model (or all three in "Compare all"), an optional hindcast (the
  last 12 observed months re-predicted by a model that never saw them), the
  test score in plain words (R² and RMSE on the most recent ~20% of months,
  held out from training), the top five inputs by permutation importance, and
  the assumptions the server returns (future weather = each month's historical
  average, constants used in the physics features). It follows the selected city.

The models run on the server, not in the browser: `../server/ml` is a Python
package (`python -m forecaster`, JSON in, JSON out) that the API calls. Data flow:

```
ModelForecast ── loadForecast(city) (lib/forecasts.js, cached per city)
   ├─ API in use:   GET /api/v1/areas/<id>/forecasts?target=ndvi&horizon=12&models=ridge,nn,gbm
   │                (lib/api.js fetchForecast; 20 s timeout, a live run takes a few seconds)
   └─ otherwise, or if that fails:  public/data/forecasts/<id>.ndvi.json  (saved snapshot)
```

Both sources return the forecasting module's response unchanged (shape
documented at the top of `lib/forecasts.js` and in `../server/docs/API.md`),
so the card shows "Source: live model" or "Source: saved snapshot" and is
otherwise identical. The snapshots are generated on the server from the same
module (see `../server/README.md`); regenerate them after the data or the model
changes, or a statically hosted site keeps showing the old forecast. A city
without a snapshot (and no API) shows a short error with a "Try again" button.

## Visitor counter

The footer shows "Visitors: N". The number is kept by
[Abacus](https://abacus.jsn.cam), a free public counter service, so no database
or setup is needed (`src/components/layout/VisitorCounter.jsx`).

- Each browser is counted once: the first visit adds one and stores a flag in
  localStorage (`votc-visited`); later visits only read the total.
- Only the live domain (`LIVE_HOST` in the component) adds visitors. Local dev
  and Vercel preview links just read the number. Update `LIVE_HOST` if the site
  moves to a new domain.
- The counter expires after 6 months without any visit, and the footer line is
  hidden if the service can't be reached.

## Hazard data (Disaster pages)

`src/lib/hazards.js` loads `/api/v1/hazards/...` (see `server/docs/API.md`, "Hazards") through the store's cache, one
whole resource per request, and the flood page reads every label, unit, parameter, model and threshold from it, so new
hazards, events or parameters need no client change. When the site has no API, or the API has no hazard endpoints
(the hosted API before a redeploy), it reads the static copy in `public/data/hazards/` instead (file names in
`src/lib/hazardPaths.js`). Refresh that copy after the server's hazard data changes:

```sh
npm run hazards:snapshot                            # from the API at http://localhost:5050
npm run hazards:snapshot -- http://localhost:5097   # or another server
```
