# Vegetation of the City: client

React 19 + Vite 8 front end for the satellite vegetation and climate explorer.
It was ported from the single-file prototype (`vegetation-of-the-city/index.html`)
and keeps that page's markup, styles and behaviour.

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
  main.jsx                  entry; imports Tailwind + tokens, Leaflet CSS, then Leaflet overrides
  App.jsx                   page assembly, one component per section
  data/                     bundled datasets (see "Data" below)
  lib/
    data.js                 the single access point for all data (swap to API calls here later)
    months.js params.js     month helpers, parameter definitions and number formatting
    stats.js                climatology, anomalies, OLS, correlation, baseline forecast
    chart.js                small SVG line-chart engine (used through components/common/Chart)
    download.js storage.js theme.js
    map/                    Leaflet helpers: basemap mosaics, layer defs, geometry, popup HTML
  index.css                 Tailwind setup: design tokens (light/dark), @theme mapping, base element styles
  hooks/                    useThemeVersion (redraw on dark/light change), useElementWidth
  state/                    AppProvider + useApp(): selected city and toasts
  components/
    ui/                     shared Tailwind building blocks: Card, CardHead, Kicker, Lede, Chip, Pill,
                            Seg, Btn, Select, Toggle, Readout, Note ...
    common/                 Chart, Sparkline
    layout/                 Nav, Footer
    sections/               Hero, Glance, PlotBuilder, Why, Outlook, Compare, Intro, Science,
                            Methods, Sources, Faq
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
