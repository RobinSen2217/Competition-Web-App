# Vegetation of the City

A physics-informed Earth observation and AI platform to assess the environmental
effects on local population health. The web app shows how green each city is, how
that has changed since 2010, which weather drives it, and where it is heading.

## Structure

- `client/`: React 19 + Vite 8 front end (see [client/README.md](client/README.md))
- `server/`: Express API (not set up yet)

## Quick start

Requires Node 20.19+ (the repo pins Node 22 in `.nvmrc`).

```sh
nvm use
cd client && npm install && npm run dev     # http://localhost:5173
cd server && npm install && npm run dev     # http://localhost:5000
```

The client's dev server proxies `/api` to the Express server on port 5000.

## Deployment

The client deploys to Vercel from this repo (`vercel.json` at the root builds
`client/` and serves `client/dist`). Every push to `main` redeploys. The Express
server is not deployed yet; it will need a Node host such as Render or Railway.
