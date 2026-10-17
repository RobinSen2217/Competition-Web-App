# Competition Web App

A physics-informed Earth observation and AI platform to assess the environmental
effects on local population health. The web app has two modules:

- **Vegetation** (`/`): how green each city is, how that has changed since 2010,
  which weather drives it, and where it is heading.
- **Disaster** (`/disaster`): to be built.

## Structure

- `client/`: React 19 + Vite 8 front end (see [client/README.md](client/README.md))
- `server/`: Express API serving the site data (see [server/README.md](server/README.md)); not hosted yet

## Quick start

Requires Node 22 (pinned in `.nvmrc` and `client/package.json`).

```sh
nvm use
cd client && npm install && npm run dev     # http://localhost:5173
cd server && npm install && npm run dev     # http://localhost:5050
```

The client's dev server proxies `/api` to the Express server on port 5050.

## Deployment

| Part | Where | How it updates |
| --- | --- | --- |
| Website (`client/`) | **Vercel** (Root Directory `client`, preset Vite) | every push to `main` |
| API (`server/`) | **Render**, free plan, from `render.yaml` (New > Blueprint) | every push that changes `server/` |
| Monthly data + forecasts | **GitHub Actions**, `.github/workflows/gee-refresh.yml` | 5th of each month, or Actions > Run workflow |

- The API runs in `FORECAST_MODE=snapshot`: it serves the data files and the
  forecasts that the monthly job computed and committed, so it needs no Python
  or Earth Engine login. Render's free plan sleeps after 15 minutes idle; the
  website then uses its bundled copy of the same data until the API wakes.
- The monthly job runs the team's GEE notebook pipeline for every area (Earth
  Engine extraction, physics features, models, 12-month forecast) and commits
  the results, which redeploys both the website and the API. It needs an Earth
  Engine login as a repository secret: `GEE_CREDENTIALS` (personal login) or
  `GEE_SERVICE_ACCOUNT_KEY` (service-account key JSON), plus optionally the
  repository variable `GEE_PROJECT`. Without one it does nothing.
- The website uses the API when `VITE_API_URL` is set in Vercel to the Render
  URL (then redeploy); otherwise it uses the bundled data.
