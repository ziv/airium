# Airium

A flight simulator using [Cesium.js](https://cesium.com/platform/cesiumjs/) as the world engine.

## Getting started

```sh
npm install
cp .env.example .env   # optional: add your Cesium Ion token
npm run dev
```

Without an Ion token the globe renders with OpenStreetMap imagery and no terrain.

## Start configuration

The starting position is defined in `src/start.config.json`:

| Key       | Unit                            | Notes       |
| --------- | ------------------------------- | ----------- |
| `lat`     | degrees                         | -90 to 90   |
| `lon`     | degrees                         | -180 to 180 |
| `height`  | metres above ground (terrain)   | 0 or more   |
| `heading` | degrees, 0 = north, clockwise   | 0 to 360    |
| `speed`   | metres per second               |             |
| `fov`     | vertical field of view, degrees | 1 to 179    |

Any key can be overridden from the URL for quick experiments:

```
http://localhost:5173/?lat=32.0&lon=34.8&height=900&heading=180&fov=75
```

## Scripts

| Command                | Purpose                             |
| ---------------------- | ----------------------------------- |
| `npm run dev`          | Start the Vite dev server           |
| `npm run build`        | Type-check and build for production |
| `npm run preview`      | Serve the production build locally  |
| `npm test`             | Run unit tests with Vitest          |
| `npm run lint`         | Lint with ESLint                    |
| `npm run format`       | Format with Prettier                |
| `npm run format:check` | Verify formatting                   |

See [plans.md](plans.md) for the roadmap.
