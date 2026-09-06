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

The player flies an F-16-class jet (`src/aircraft/f16.json`); `?aircraft=trainer` selects the light
trainer. Keys are configured in `input.keys` of `src/start.config.json` (the on-screen legend is
generated from them). A held key ramps the stick up over `input.keyboard.axisRampTime`, so a tap
is a small input and a long press a full one. The defaults are:

| Key               | Action                                                   |
| ----------------- | -------------------------------------------------------- |
| `←` / `→`         | Roll left / right                                        |
| `↓` / `↑`         | Nose up / nose down (fly-by-wire: the stick commands g)  |
| `[` / `]`         | Yaw left / right (nose-wheel steering on the ground)     |
| `+` / `-`         | Throttle in 5 % steps; past 100 % lights the afterburner |
| `A`               | Afterburner on/off                                       |
| `G`               | Landing gear up/down                                     |
| `S`               | Airbrake in/out                                          |
| `B` (hold)        | Wheel brakes                                             |
| `C`, `F1`–`F4`    | Next camera; cockpit / chase / orbit / fly-by            |
| Right drag        | Look around in the cockpit (returns to the boresight)    |
| Left drag / wheel | Rotate / zoom the orbit camera                           |
| `M`               | Mouse flight (pointer position = stick) on/off           |
| `P`               | Pause                                                    |
| `,` / `.`         | Time scale slower / faster                               |
| `O`               | Cesium OSM Buildings on/off (needs an Ion token)         |
| `` ` ``           | Debug block (position, coefficients, fps, tiles) on/off  |
| `R`               | Reset to the start configuration                         |

A gamepad works too: stick axes for roll/pitch/yaw, optional throttle axis, buttons for
throttle up/down, afterburner, gear, brakes, airbrake, camera, reset and pause (`input.gamepad`).

The HUD in the top-left shows throttle and afterburner, fuel, attitude, heading, angle of attack,
load factor (current and peak), airspeed, Mach, vertical speed, height above ground, altitude and
the gear/airbrake state, plus STALL / OVER-G / OVERSPEED / GEAR / ENGINE OUT / BINGO FUEL warnings.
A hard landing, a wing strike, a nose-first impact or a gear-up landing freezes the sim with
**CRASHED** and the reason; press `R`.

## Configuration

`src/start.config.json` holds the world settings; each aircraft type is a file in `src/aircraft/`
registered in `src/aircraft/index.ts`. Angles are degrees, rates degrees per second, lengths
metres, speeds m/s, masses kg, forces N. Nothing in the physics is hard-coded.

| Section       | Keys                                                                                                                                                                                            |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ion`         | `token` — Cesium Ion access token (optional)                                                                                                                                                    |
| `start`       | `lat`, `lon`, `height` (above terrain; 0 = on the wheels), `heading`, `speed`, `fov`, `aircraft` (type id), `time` (ISO 8601 for sun position; blank = now)                                     |
| `ground`      | `maxLandingSinkRate`, `maxLandingRoll`, `minLandingPitch`, `rollingFriction`, `maxGroundPitch`, `liftoffHeight`                                                                                 |
| `environment` | `gravity`, `seaLevelAirDensity`, `densityScaleHeight`, `earthRadius`, `seaLevelTemperature`, `lapseRate`, `tropopauseHeight`, `gasConstant`, `heatCapacityRatio`                                |
| `simulation`  | `physicsHz`, `maxFrameSeconds`, `minTimeScale`, `maxTimeScale`, `timeScaleStep`                                                                                                                 |
| `graphics`    | `preset` (low/medium/high), `osmBuildings`, `presets.*` (`maximumScreenSpaceError`, `tileCacheSize`, `preloadTiles`, `fog`, `msaaSamples`, `fxaa`, `resolutionScale`, `lighting`, `atmosphere`) |
| `input`       | `keys.<action>` (list of key names), `gamepad` (dead zone, curve, axis and button indices), `mouse` (look/orbit sensitivity, mouse flight)                                                      |
| `camera`      | chase distance/height/smoothing, orbit distance limits, fly-by lead and range, `nearPlane`                                                                                                      |

An aircraft type file has these sections:

| Section        | Keys                                                                                                                                   |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `airframe`     | `emptyMass`, `fuelCapacity`, `wingArea`, `liftCoefficient` (CL0), `dragCoefficient` (CD0)                                              |
| `engine`       | `militaryThrust`, `afterburnerThrust` (0 = none), `idleFuelFlow`, `militaryFuelFlow`, `afterburnerFuelFlow`                            |
| `aerodynamics` | `liftSlope`, `stallAngle`, `zeroLiftAngle`, `inducedDragFactor`, `minAeroSpeed`, `machDragOnset`, `machDragPeak`, `machDragPeakFactor` |
| `limits`       | `maxLoadFactor`, `minLoadFactor`, `maxAngleOfAttack`, `maxMach`, `maxAirspeed`                                                         |
| `controls`     | `rollRate`, `pitchRate`, `yawRate`, `responseTime`, `releaseTime`, `throttleStep`, `referenceDynamicPressure`                          |
| `gear`         | `transitTime`, `dragCoefficient`, `maxSpeed`, `brakeDeceleration`                                                                      |
| `airbrake`     | `dragCoefficient`                                                                                                                      |
| `model`        | `uri` (glTF under `public/`), `scale`, `cockpitForward`, `cockpitUp`                                                                   |

Thrust scales with air density; the speed of sound comes from an ISA temperature model and the
zero-lift drag rises between `machDragOnset` and `machDragPeak`. Pitch input commands a load
factor between `minLoadFactor` and `maxLoadFactor`, limited by `maxAngleOfAttack`; control rates
scale with dynamic pressure up to `referenceDynamicPressure`. Position is integrated flat-earth
in a local East-North-Up frame (fine below about 80° latitude).

Any `start` key can be overridden from the URL for quick experiments, along with the graphics
preset and buildings:

```
http://localhost:5173/?lat=32.0&lon=34.8&height=900&heading=180&speed=250&aircraft=trainer&graphics=low&buildings=1
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
| `npm run model`        | Regenerate `public/models/jet.glb`  |

See [plans.md](plans.md) for the milestones done so far and [next.md](next.md) for the roadmap;
assets are listed in [CREDITS.md](CREDITS.md).
