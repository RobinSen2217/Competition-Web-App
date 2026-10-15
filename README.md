# Competition Web App

A physics-informed Earth observation and AI platform to assess the environmental
effects on local population health. The web app has two modules:

- **Vegetation** (`/`): how green each city is, how that has changed since 2010,
  which weather drives it, and where it is heading.
- **Disaster** (`/disaster`): to be built.

## Structure

- `client/`: React 19 + Vite 8 front end (see [client/README.md](client/README.md))
- `server/`: Express API (not set up yet)

## Quick start

Requires Node 22 (pinned in `.nvmrc` and `client/package.json`).

```sh
nvm use
cd client && npm install && npm run dev     # http://localhost:5173
cd server && npm install && npm run dev     # http://localhost:5000
```

The client's dev server proxies `/api` to the Express server on port 5000.

## Deployment

The client deploys to Vercel from this repo (project Root Directory: `client`,
preset: Vite; `client/vercel.json` only adds caching headers). Every push to
`main` redeploys. The Express
server is not deployed yet; it will need a Node host such as Render or Railway.
