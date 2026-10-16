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

The client deploys to Vercel from this repo (project Root Directory: `client`,
preset: Vite; `client/vercel.json` only adds caching headers). Every push to
`main` redeploys.

The Express API is not hosted yet (planned: an Oracle Cloud Always Free server).
Until then the website falls back to the copy of the data bundled into the
client. Once the API is hosted, set `VITE_API_URL` in Vercel to its address.
