# Texas Party Support Map

Interactive portfolio app mapping Texas city-level political support using 2024 presidential precinct returns as a proxy.

## Important Caveat

Texas does not register voters by party. This project does not show official party registration or true current party affiliation. The v1 map uses 2024 presidential election returns and aggregates precincts to city boundaries as an election-results proxy for local party support.

## Data Sources

- 2024 presidential precinct results and boundaries: New York Times public precinct dataset.
- Texas city boundaries: Texas Geographic Information Office ArcGIS city boundary service.
- Preferred official refresh source when available: Texas Capitol Data Portal 2024 General Election VTD data and VTD shapefile.

## Local Setup

```bash
cd web
npm install
npm run data
cp .env.example .env.local
npm run dev
```

Set `NEXT_PUBLIC_MAPBOX_TOKEN` in `web/.env.local`.

## Vercel Deployment

Deploy this repository through Vercel with:

- Root Directory: `web`
- Build Command: `npm run build`
- Install Command: `npm install`
- Output Directory: default Next.js setting

Add this Vercel environment variable:

```text
NEXT_PUBLIC_MAPBOX_TOKEN=<your restricted Mapbox public token>
```

The Mapbox token is a browser token, so it will be visible to visitors. Create a token specifically for this project and restrict it in Mapbox to the deployed domains, for example:

- `https://texas-party-map.vercel.app/*`
- any custom production domain you add later
- `http://localhost:3000/*` for local development, if needed

Do not commit `web/.env.local`. It is intentionally ignored by git.

## Scripts

- `npm run data`: downloads raw data and builds `web/public/data/cities.geojson`, `sources.json`, and `methodology.json`.
- `npm run dev`: starts the app.
- `npm run build`: production build.
- `npm run lint`: Next.js lint.

## Methodology

The current city aggregation uses a precinct-centroid assignment: each Texas precinct is assigned to the city polygon containing its centroid, and the full precinct vote total is added to that city. This is fast and transparent, but approximate near city boundaries. Cities without matched precinct centroids are marked `Needs Review`.

ZIP/ZCTA support is not included in v1 because election returns are not natively ZIP-based. It can be added later with a documented crosswalk or block-level allocation source.
