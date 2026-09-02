# Airium

A flight simulator using [Cesium.js](https://cesium.com/platform/cesiumjs/) as the world engine.

## Getting started

```sh
npm install
cp .env.example .env   # optional: add your Cesium Ion token
npm run dev
```

Without an Ion token the globe renders with OpenStreetMap imagery and no terrain.

## Flying

| Key       | Action                                 |
| --------- | -------------------------------------- |
| `←` / `→` | Roll left / right (60°/s while held)   |
| `↓` / `↑` | Nose up / nose down (30°/s while held) |
| `[` / `]` | Yaw left / right (20°/s while held)    |
| `+` / `-` | Throttle up / down in 5 % steps        |
| `R`       | Reset to the start configuration       |

The HUD in the top-left shows throttle, attitude, heading, angle of attack, airspeed, vertical
speed, height above ground, altitude and position. A hard impact freezes the sim with **CRASHED**;
press `R`.

## Configuration

`src/start.config.json` has two sections. The `start` section defines where you begin:

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

| Section        | Keys                                                                                                                                                     |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `aerodynamics` | `liftSlope` (per rad), `stallAngle`, `zeroLiftAngle`, `inducedDragFactor`, `trimLoadFactor`, `minAeroSpeed`, `stabilityRatePerSpeed`, `stabilityMaxRate` |
| `controls`     | `rollRate`, `pitchRate`, `yawRate`, `throttleStep` (fraction per key press)                                                                              |
| `ground`       | `maxLandingSinkRate`, `maxLandingRoll`, `minLandingPitch`, `rollingFriction`, `maxGroundPitch`, `liftoffHeight`                                          |
| `environment`  | `gravity`, `seaLevelAirDensity`, `densityScaleHeight`, `earthRadius`                                                                                     |
| `simulation`   | `physicsHz` (fixed physics steps per second), `maxFrameSeconds` (longest frame gap simulated)                                                            |

Any `start` key can be overridden from the URL for quick experiments:

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
