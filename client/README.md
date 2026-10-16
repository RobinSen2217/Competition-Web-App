# Competition Web App: client

React 19 + Vite 8 front end. One nav bar switches between two pages:

| Path | Page |
| --- | --- |
| `/` | **Vegetation**: the satellite vegetation and climate explorer, ported from the single-file prototype (`vegetation-of-the-city/index.html`) |
| `/disaster` | **Disaster**: empty for now (`src/pages/DisasterPage.jsx`) |

Routing uses React Router (`src/App.jsx`). `vercel.json` rewrites every path
except `/api/...` to `index.html`, so `/disaster` also works when opened directly.

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
(start it with `npm run dev` there). Without the server the site still works on its bundled data;
see [Data](#data).

## Layout

```
public/
  favicon.svg
  map/                      satellite mosaics (<id>.jpg) and place-name overlays (<id>_lab.png)
  map/s2_*.jpg              Sentinel-2 10 m layers (Jaisalmer only)
  map/raster/<city>/        per-city MODIS rasters: ndvi-<year>.png, change.png, lst-day.png,
                            lst-night.png, and values.json (bundled per-pixel numbers for the pixel
                            inspector, used only when the API is unavailable)
src/
  main.jsx                  entry; imports the CSS, awaits initData(), then loads App.jsx
  App.jsx                   router: nav bar + the page for the current path
  pages/                    VegetationPage (all its sections + footer), DisasterPage
  data/                     bundled fallback datasets (see "Data" below)
  lib/
    data.js                 the single access point for all data: loads it from the API (or the bundle)
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
    layout/                 Nav (logo + page tabs), Footer (vegetation page)
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

The site loads its data from the Express API in `../server` at startup and
falls back to bundled copies when the API cannot be reached.

`src/lib/data.js` is the single access point. Before React renders, `main.jsx`
awaits `initData()`, which fetches these four endpoints in parallel (4 s timeout):

| Endpoint | Bundled fallback | Contents |
| --- | --- | --- |
| `/api/climate` | `src/data/climate.json` | `{ months: ["2010-01", ...], cities: { id: { name, state, lat, lon, series: { ndvi, rain, ... } } } }`, monthly values from Jan 2010 |
| `/api/boundaries` | `src/data/boundaries.json` | district outline (GeoJSON geometry) for each city |
| `/api/map/mosaics` | `src/data/mapmeta.json` | bounds and zoom of every basemap mosaic in `public/map` |
| `/api/map/rasters` | `src/data/rasters.json` | raster bounds and image URLs per city, plus where its per-pixel values live |

If all four succeed and look valid, the API data is used; if any one fails, all
four come from the bundle (sources are never mixed). The browser console logs
which one is in use (`[data] using API ...` or `[data] using bundled data`).
The per-pixel values for the map's pixel inspector are fetched on demand from
`/api/cities/<id>/pixels` (API) or `public/map/raster/<id>/values.json` (bundled).
Map images (`public/map/...`) are always static files served with the site.

Rule: nothing that reads the data may be imported before `initData()` finishes
(for example `lib/months.js` computes the year range at import time). That is why
`main.jsx` imports `App.jsx` dynamically. Components import from `lib/data.js` as usual.

### API URL (`VITE_API_URL`)

| Where | Setting | Result |
| --- | --- | --- |
| Local dev | unset | requests go to `/api` on the dev server, which Vite proxies to `http://localhost:5050` |
| Production (Vercel) | unset | the API is skipped and the bundled data is used (no requests are made) |
| Production (Vercel) | `https://<server-domain>` | requests go to the hosted Express server |

Set it in Vercel under Project Settings > Environment Variables, or locally in
`.env.local` (see `.env.example`). Give the base URL only, without `/api`. Vite
bakes it in at build time, so redeploy after changing it. The server must allow
the site's origin in its `CORS_ORIGINS`.

Until the API is hosted, production runs on the bundled data. Once it is live,
the bundled copies (`src/data/climate.json`, `boundaries.json`, `mapmeta.json`,
`rasters.json` and `public/map/raster/*/values.json`) can be removed together
with the fallback in `lib/data.js`.

To add a city, add it to the server's data files (and to the bundled copies while
they exist): its series to `climate.json`, its outline to `boundaries.json`, its
three mosaics to `mapmeta.json` and `public/map`, and its rasters under
`public/map/raster/<city>/` with an entry in `rasters.json`.

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
