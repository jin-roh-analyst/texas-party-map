# Texas Party Map Web App

```bash
npm install
npm run data
cp .env.example .env.local
npm run dev
```

The app requires `NEXT_PUBLIC_MAPBOX_TOKEN` for the interactive basemap.

## Vercel

Use `web` as the Vercel root directory and add:

```text
NEXT_PUBLIC_MAPBOX_TOKEN=<your restricted Mapbox public token>
```

Restrict the token in Mapbox to the Vercel deployment domain and any custom domain. Keep `.env.local` private and uncommitted.
