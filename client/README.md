# Vegetation of the City: client

React 19 + Vite 8 front end for the satellite vegetation and climate explorer.
It was ported from the single-file prototype (`vegetation-of-the-city/index.html`)
and keeps that page's markup, styles and behaviour.

## Run it

Vite 8 needs **Node 20.19+**. The repo pins Node 22 in `.nvmrc`:

```sh
nvm use            # picks up .nvmrc (Node 22)
npm install
npm run dev        # http://localhost:5173
npm run build      # production build in dist/
npm run preview    # serve the build
npm run lint       # oxlint
```

`vite.config.js` proxies `/api` to `http://localhost:5000` for the Express server in `../server`.

## Layout

```
public/
  favicon.svg
  map/                      satellite mosaics (<id>.jpg) and place-name overlays (<id>_lab.png)
  map/s2_*.jpg              Sentinel-2 10 m layers (Jaisalmer only)
  map/raster/<city>/        per-city MODIS rasters: ndvi-<year>.png, change.png, lst-day.png,
                            lst-night.png, and values.json (per-pixel numbers for the pixel inspector,
                            fetched on demand)
src/
  main.jsx                  entry; imports Tailwind, Leaflet CSS, then app styles (in that order)
  App.jsx                   page assembly, one component per section
  data/                     bundled datasets (see "Data" below)
  lib/
    data.js                 the single access point for all data (swap to API calls here later)
    months.js params.js     month helpers, parameter definitions and number formatting
    stats.js                climatology, anomalies, OLS, correlation, baseline forecast
    chart.js                small SVG line-chart engine (used through components/common/Chart)
    download.js storage.js theme.js
    map/                    Leaflet helpers: basemap mosaics, layer defs, geometry, popup HTML
  hooks/                    useThemeVersion (redraw on dark/light change), useElementWidth
  state/                    AppProvider + useApp(): selected city and toasts
  components/
    common/                 Chart, Sparkline
    layout/                 Nav, Footer
    sections/               Hero, Glance, PlotBuilder, Why, Outlook, Compare, Intro, Science,
                            Methods, Sources, Faq
    map/                    MapExplorer and its rail, planner and hooks
  styles/app.css            design tokens (light and dark) and all component styles
```

### Styling

`styles/app.css` is the prototype's stylesheet, unchanged apart from two margin
restores (see the comments in the file). It is unlayered, so it overrides Tailwind's
preflight and `leaflet.css`. Tailwind is still loaded, so utility classes work in new
components.

Colours that end up inside SVG or Leaflet layers are read from CSS variables at
runtime (`css('--accent')`). Components that do this redraw when
`useThemeVersion()` changes, so a dark/light switch recolours them live.

## Data

| File | Contents |
| --- | --- |
| `src/data/climate.json` | `{ months: ["2010-01", ...], cities: { id: { name, state, lat, lon, series: { ndvi, rain, ... } } } }`, monthly values from Jan 2010 |
| `src/data/boundaries.json` | district outline (GeoJSON geometry) for each city |
| `src/data/mapmeta.json` | bounds and zoom of every basemap mosaic in `public/map` |
| `src/data/rasters.json` | raster bounds and image URLs per city, plus the URL of its `values.json` |

Every read goes through `src/lib/data.js`. When the server is ready, change
that one module to load from the API (for example serve the same JSON from
`/api/...`). The components do not need to change.

To add a city, add its series to `climate.json`, its outline to `boundaries.json`,
its three mosaics to `mapmeta.json` and `public/map`, and its rasters under
`public/map/raster/<city>/` with an entry in `rasters.json`.
