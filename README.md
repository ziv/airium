# Airium

A flight simulator using [Cesium.js](https://cesium.com/platform/cesiumjs/) as the world engine.

## Getting started

```sh
npm install
npm run dev
```

The Cesium Ion token is read from `ion.token` in `src/start.config.json`. Ion tokens can be
restricted to specific origins (e.g. GitHub Pages and localhost), which is what makes committing
one acceptable. Without a token the globe renders with OpenStreetMap imagery and no terrain.

## Flying

| Key       | Action                           |
| --------- | -------------------------------- |
| `←` / `→` | Roll left / right                |
| `↓` / `↑` | Nose up / nose down              |
| `[` / `]` | Yaw left / right                 |
| `+` / `-` | Throttle up / down in 5 % steps  |
| `R`       | Reset to the start configuration |

The HUD in the top-left shows throttle, attitude, heading, angle of attack, airspeed, vertical
speed, height above ground, altitude and position. A hard impact freezes the sim with **CRASHED**;
press `R`.

## Configuration

`src/start.config.json` holds all settings. `ion.token` is the Cesium Ion access token (optional).
The `start` section defines where you begin:

| Key       | Unit                            | Notes       |
| --------- | ------------------------------- | ----------- |
| `lat`     | degrees                         | -90 to 90   |
| `lon`     | degrees                         | -180 to 180 |
| `height`  | metres above ground (terrain)   | 0 or more   |
| `heading` | degrees, 0 = north, clockwise   | 0 to 360    |
| `speed`   | metres per second               |             |
| `fov`     | vertical field of view, degrees | 1 to 179    |

The `aircraft` section defines the flight model:

| Key               | Unit | Notes                                              |
| ----------------- | ---- | -------------------------------------------------- |
| `weight`          | kg   | Aircraft mass                                      |
| `wingArea`        | m²   | Reference wing area                                |
| `liftCoefficient` | –    | Lift coefficient at zero angle of attack           |
| `dragCoefficient` | –    | Zero-lift drag coefficient (induced drag is added) |
| `maxThrust`       | N    | Thrust at 100 % throttle                           |

The remaining sections tune the flight model; nothing in the physics is hard-coded.
Angles are degrees, rates are degrees per second.

| Section        | Keys                                                                                                                                                        |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `aerodynamics` | `liftSlope` (per rad), `stallAngle`, `zeroLiftAngle`, `inducedDragFactor`, `trimLoadFactor`, `minAeroSpeed`, `stabilityRatePerSpeed`, `stabilityMaxRate`    |
| `controls`     | `rollRate`, `pitchRate`, `yawRate` (max deg/s), `responseTime`, `releaseTime` (s, how rates build up and die away), `throttleStep` (fraction per key press) |
| `ground`       | `maxLandingSinkRate`, `maxLandingRoll`, `minLandingPitch`, `rollingFriction`, `maxGroundPitch`, `liftoffHeight`                                             |
| `environment`  | `gravity`, `seaLevelAirDensity`, `densityScaleHeight`, `earthRadius`                                                                                        |
| `simulation`   | `physicsHz` (fixed physics steps per second), `maxFrameSeconds` (longest frame gap simulated)                                                               |

Any `start` key can be overridden from the URL for quick experiments:

```
http://localhost:5173/?lat=32.0&lon=34.8&height=900&heading=180&fov=75
```

## Deploying to GitHub Pages

The site is published from the `docs/` folder on `main` (repository settings → Pages → Deploy from
a branch → `/docs`). Rebuild it and commit the result whenever you want to publish:

```sh
npm run build:pages
git add docs && git commit -m "Publish"
```

Production builds are rooted at `/airium/`, the path of a GitHub Pages project site, so every URL
in the built `index.html` (app bundle and Cesium assets) is prefixed accordingly. The dev server
stays at `/`. Set `BASE_PATH` to change it, e.g. `BASE_PATH=/ npm run build` for a custom domain or
`BASE_PATH=/my-fork/ npm run build` for a renamed repository. `npm run preview` serves the build at
`http://localhost:4173/airium/`; if the Ion token is restricted to specific origins, either allow
`http://localhost:4173` in the Ion dashboard or run `npm run preview -- --port 5173`. When Ion
rejects the token the app logs a warning and falls back to OpenStreetMap imagery without terrain.

Cesium is bundled from npm; its runtime files (Workers, Assets, Widgets, ThirdParty) are copied to
`cesium/` at build time by `vite-plugin-static-copy`, and `CESIUM_BASE_URL` follows the base path.

## Scripts

| Command                | Purpose                             |
| ---------------------- | ----------------------------------- |
| `npm run dev`          | Start the Vite dev server           |
| `npm run build`        | Type-check and build for production |
| `npm run build:pages`  | Same, into `docs/` for GitHub Pages |
| `npm run preview`      | Serve the production build locally  |
| `npm test`             | Run unit tests with Vitest          |
| `npm run lint`         | Lint with ESLint                    |
| `npm run format`       | Format with Prettier                |
| `npm run format:check` | Verify formatting                   |

See [plans.md](plans.md) for the roadmap.
