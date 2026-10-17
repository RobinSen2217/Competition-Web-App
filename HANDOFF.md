# Handoff: finish, verify and ship branch `handoff/lazy-flood`

You are finishing and shipping unfinished work on github.com/RobinSen2217/Competition-Web-App ("Competition Web App":
a vegetation explorer for 6 Indian cities, plus a Disaster > Flood section). Work carefully and verify everything yourself.
The owner has limited internet, so the final result must be pushed to `main` in a clean, working state.

## 0. Hard rules

- NO AI/Claude attribution anywhere: no "Co-Authored-By: Claude" and no "Generated with Claude Code" in commits, PRs or code.
  Before your first commit, create `.claude/settings.local.json` in the repo with
  `{ "includeCoAuthoredBy": false, "attribution": { "commit": "", "pr": "" } }`.
  Don't commit it (add it to `.git/info/exclude`).
- Never commit secrets: `.env` files, `server/secrets/`, or any Earth Engine credentials. You don't need any of them.
- Code style:
  - add helpful "why" comments in the existing style and match the surrounding code;
  - client styling is Tailwind v4 with pixel font sizes like `text-[14px]`, never `text-sm`/`text-lg` etc.
- APIs stay generic and scalable: no hazard-, event- or city-specific logic in routes or services.
- Reproduce the team's notebooks exactly. Do not invent or change models.
- Don't touch:
  - `.github/workflows/gee-refresh.yml`;
  - `render.yaml`;
  - the Earth Engine code in `server/ml/forecaster/gee/`;
  - the model logic in `server/ml/forecaster/hazards/flood.py` (it reproduces the notebook, and tests prove it);
  - the curated facts in `server/ml/forecaster/hazards/flood_events.json` (only report any doubts).
- Only stop processes you started yourself (by PID). Don't kill by name.
- This file (`HANDOFF.md`) must NOT reach `main`. Delete it in your last commit before merging.

## 1. Setup

- You are on branch `handoff/lazy-flood` (`git fetch && git checkout handoff/lazy-flood`). ALL the unfinished work is here;
  `main` is the last released state.
- Node 22 is required (Vite 8 fails on Node 18). Then run `(cd client && npm ci) && (cd server && npm ci)`.
- Python 3.12 for the flood model:
  `cd server/ml && python3.12 -m venv .venv-hazards && .venv-hazards/bin/pip install -r requirements-hazards.txt`.
  It needs scikit-learn 1.8.0 exactly; that is what reproduces the notebook's numbers. Don't change the pin.
  The vegetation venv (`server/ml/.venv` from `requirements.txt`) is optional; it is only needed for the vegetation Python tests.
- No external files are needed:
  - All processed data is in the repo (`server/data/hazards/flood/`), including the model output and the water layers.
  - The notebook's printed numbers are embedded in the acceptance tests (`server/ml/tests/notebook_flood_partb.py`).
  - Tests that re-import from the raw team files (`FLOOD_SOURCE_DIR`, `FLOOD_LAYERS_DIR`) skip without them. That is
    expected and fine.

## 2. Read first

- `git diff main...handoff/lazy-flood --stat`, then the changed files.
- The READMEs: `client/README.md`, `server/README.md` and `server/ml/README.md` (the "Hazards" section).
- `server/docs/API.md`: its conventions, plus the "Hazards" section incl. layers.
- Layout:
  - `client/`: React 19 + Vite 8 + Tailwind v4 + framer-motion + React Router + Leaflet.
    Routes: `/` (Vegetation) and `/disaster/flood` (Flood, blue theme).
  - `server/`: Express 5 API, `/api/v1`, `{data, meta}` envelopes, coded errors.
    Layers: routes -> services -> catalog + providers. Default port 5050.
- Data loading: `client/src/lib/store.js` (bootstrap, `load`/`useResource` cache, `useTimeseries`, `useAreaDetail`,
  `useBasemap`). The API base comes from `VITE_API_URL`. Without it, or when the API is down, the client uses the static
  fallback:
  - `client/public/data/fallback/` (vegetation);
  - `client/public/data/hazards/` (flood).
- Deployment is automatic from `main`:
  - Vercel builds `client/` -> https://competition-web-app-black.vercel.app (`VITE_API_URL` is set there);
  - Render runs `server/` -> https://competition-web-app-api.onrender.com (free tier, sleeps; `FORECAST_MODE=snapshot`).

## 3. State of the branch

DONE and tested:

- **A. Flood/hazards API** (`server/`), all generic. Endpoints:
  - `GET /api/v1/hazards`
  - `/hazards/:hazard`
  - `/hazards/:hazard/parameters[/:key]`
  - `/hazards/:hazard/events` (`?country=`, `?bbox=`)
  - `/events/:eventId`
  - `/events/:eventId/timeseries` (daily "series" + irregular "observations")
  - `/events/:eventId/forecast`
  - `/events/:eventId/layers[/:layerId[/image]]`

  Code: `src/catalog/hazards/*`, `src/providers/hazards.js`, `src/services/hazards.js`, `src/routes/v1/hazards.js`.
  Tests in `test/hazards.test.js`. Docs in `docs/API.md`, `api.http` and the Postman collection.
- **B. Flood model** (`server/ml/forecaster/hazards/`):
  - Code: `import_flood.py`, `flood.py`, `layers.py`. The CLI is `python -m forecaster.hazards import|build flood`.
  - It reproduces notebook Part B exactly (all 54 printed numbers): records 221; thresholds 0.55 (rain) / 0.75 (rain_soil);
    test balanced accuracy 0.542 / 0.583; recall 1.0; test events Guangxi, Bhagalpur and Bangkok; Nepal excluded.
  - Output: `server/data/hazards/flood/model/forecast.json`.
  - Water layers for 3 events: `server/data/hazards/flood/layers.json` + `events/<id>/layers/water-reference.png`.
- **C. Flood page client: BUILT**, but only quickly checked at 390 and 1280 px.
  Files: `client/src/pages/FloodPage.jsx`, `client/src/components/flood/*`, `lib/hazards.js`, `lib/hazardPaths.js`,
  `scripts/snapshot-hazards.mjs` (`npm run hazards:snapshot -- <apiBase>`), `public/data/hazards/`.
- **D. Vegetation page lazy loading + city picker in the sticky nav: BUILT, with the review fixes applied, but only partly
  verified.**
  - Each section loads its data only as it scrolls near; `MapExplorer`, `PlotBuilder` and `ModelForecast` are React.lazy chunks.
  - Error boundaries at section level (`LazySection`), page level (`App.jsx`) and top level (`Boot.jsx`).
  - Measured placeholder heights in `client/src/lib/sectionHeights.js`; the forecast skeleton uses them too.
  - City picker: `client/src/components/layout/CityPicker.jsx`. Below 580 px it gets its own row in the nav.
  - Cold start: the client gives up on the API after 4 s and shows the static fallback. It keeps the `/areas` request open
    for up to 60 s and switches to the API for anything loaded later (see the `store.js` header and `client/README.md`).
  - Verified only at 390 and 1280 px. NOT verified:
    - "Try again" after a chunk 404 at 1280;
    - the late switch to the API after a cold start;
    - the nav picker at other widths since its last change.

## 4. Tasks

### Task 1: verify the vegetation page (`/`)

The fixes are already in. Change code only where a check fails.

- a. **Chunk errors:** block each lazy chunk (`MapExplorer`, `PlotBuilder`, `ModelForecast`) with a 404 at 390 and 1280 px.
  - That section shows its error with "Try again", and the rest of the page keeps working.
  - After unblocking, "Try again" recovers (a reload to `#section` is the intended path).
  - The page never goes blank.
- b. **Placeholder heights** (`lib/sectionHeights.js`): check at 320 / 360 / 480 / 600 / 768 / 900 / 1024 / 1280 / 1440 px,
  for at least 2 cities.
  - Placeholder vs loaded height stays within ~60 px.
  - `/#where`, `/#plot` and `/#mlforecast` (opened directly and from the footer) land ~70 px below the top, with minimal shift
    when scrolling back up.
- c. **ModelForecast:** the skeleton is close to the loaded height, and a city switch keeps the old forecast dimmed (no jump).
- d. **Nav city picker:** sweep every 10 px from 320 to 1440 px, especially around 560–600.
  - No cut or ambiguous names (Jaipur vs Jaisalmer), and no horizontal overflow.
  - The list stays inside the viewport.
  - Keyboard and touch both work.
  - It stays in sync with the page's city buttons.
  - It is hidden on `/disaster/*`.
- e. **Cold start:** simulate an `/areas` response that takes more than 4 s (e.g. 10 s).
  - The page appears on the fallback after ~4 s.
  - Sections loaded after the API answers use the API, and no section mixes both sources.
- f. **Network order:** data loads only per section as it approaches, in both API mode and fallback mode.
- g. **Busy state and themes:** no aria-busy on placeholders not yet reached; light and dark both work; no console errors.

### Task 2: polish the Flood page (`/disaster/flood`)

Don't rebuild it.

- a. **Widths and heights:** check at 320, 768 and 1024 px (only 390 and 1280 were checked), in light and dark, and re-measure
  `components/flood/heights.js`.
- b. **EventMap crash:** `EventMap.jsx` crashed once during a dev hot reload (its error box caught it). Reproduce it with fresh
  loads and fast event switching, and fix it if it's a real bug.
- c. **Pass coverage:** an API data note says chart labels show each soil-moisture pass's box coverage, but the chart doesn't.
  Show the coverage (in the hover readout and/or as point opacity).
- d. **Danger zones:** the model flags most days as danger (by design, faithful to the notebook).
  - Keep showing each day's probability against the threshold, and keep the honest caveat.
  - Don't change the thresholds.

### Task 3: show the water layers on the Flood page map

The API serves `GET /api/v1/hazards/flood/events/:id/layers` for Guangxi, Bhagalpur and Bangkok. The layer is
`water-reference`, kind `mask`; `bounds` is in Leaflet order `[[south, west], [north, east]]`, and each layer has a legend and
stats.

- In `components/flood/EventMap.jsx`, when the selected event has layers:
  - add a Leaflet imageOverlay of `layer.url`. It is an API **path**, so prefix the API origin; in fallback mode use the
    snapshot copy;
  - add a toggle, the legend and the stats: water km² and % of the known area, both for the whole image and inside the
    event box;
  - show the API's `provenanceNote`: the notebook doesn't say where the labels come from or which day they show.
- Events without layers show nothing extra.
- Extend `lib/hazardPaths.js` + `scripts/snapshot-hazards.mjs` so the fallback snapshot includes the layer JSON and the PNGs
  (`client/public/data/hazards/...`).

### Task 4: small server fixes

- a. **Launcher:** `server/ml/hazards-python` starts `.venv-hazards` and handles an x86_64 venv on Apple Silicon.
  - Make it executable: `chmod +x`, plus `git update-index --chmod=+x server/ml/hazards-python`.
  - Test it.
  - In `server/README.md`, `server/docs/API.md` and `server/ml/README.md`, replace `.venv-hazards/bin/python -m` with
    `./hazards-python -m`.
- b. **One spelling:** the dataset table kind `"observations"` becomes `"observation"`, the same as the parameter kind.
  - Change it in `forecaster/hazards/dataset.py`, `import_flood.py`, `server/data/hazards/flood/events.json`, the docs and
    the tests.
  - Keep everything consistent; all tests must still pass.
- c. **Doc correction:** in `server/docs/API.md`, "New events for a hazard", say that:
  - rebuilding retrains on the new events and changes the thresholds;
  - role `unseen` applies only to events with no target rows;
  - no fitted model is saved.
- d. **Notebook quirks:** add a short note to `server/ml/README.md` and `server/docs/API.md` on two quirks that are kept on
  purpose:
  - a soil-moisture pass late on a UTC day already feeds that same day's forecast, because the times are floored to the date;
  - when two passes fall on one day, only the last one in the file is used (`drop_duplicates(keep='last')`).
- e. **Refresh the snapshot:** after these fixes, re-run `npm run hazards:snapshot -- http://localhost:<port>` (in `client/`)
  against a local server, so the client's flood snapshot matches the server data.

### Task 5: verify everything

All of these must pass, and you must look at the results yourself.

- `cd server && npm test`
- In `server/ml`: `./hazards-python -m unittest discover -t . -s tests -p 'test_hazards*.py'`.
  The notebook acceptance tests must pass. Re-import tests may skip.
- `cd client && npx oxlint && npx vite build`
- In a browser (headless or real):
  - at 320 / 390 / 768 / 1024 / 1280 px, in light and dark, on both `/` and `/disaster/flood`;
  - in both modes:
    - API mode: local server (`cd server && PORT=<port> npm start`) and client
      `VITE_API_URL=http://localhost:<port> npx vite`;
    - fallback mode: no `VITE_API_URL`.

  Check:
  - no console errors and no horizontal scroll;
  - the lazy request order is as described;
  - error states and "Try again" work (simulate 500s, slow responses and a chunk 404).
- The vegetation page still looks like the live site https://competition-web-app-black.vercel.app, apart from the new nav
  picker and the loaders.

### Task 6: ship

1. Delete `HANDOFF.md`.
2. Make clean, logical commits with no AI attribution, for example:
   - "Vegetation: lazy per-section loading and nav city picker"
   - "Hazards API and flood model"
   - "Flood page"
   - "Flood water layers"
3. Merge `handoff/lazy-flood` into `main` and push `main`.
4. Wait for the deploys, then check:
   - https://competition-web-app-api.onrender.com/api/v1/hazards (the first call may take ~30–60 s while Render wakes);
   - https://competition-web-app-black.vercel.app/
   - https://competition-web-app-black.vercel.app/disaster/flood

   The live flood page must use the live API: the network tab shows `onrender.com/api/v1/hazards...`.
5. Delete the remote branch `handoff/lazy-flood` once `main` has it.

## 5. Report back

Write a short report covering:

- what you changed for each task;
- how you verified it (commands and results);
- the results of the live check;
- anything left open or doubtful, including any doubts about the facts in `flood_events.json`.
