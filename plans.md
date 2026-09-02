# AIRIUM

A flight simulator based on cesium.js as world engine.

## Milestone 1

Development environment:

- Web application
- Vanila/Typescript
- Vite
- Vitest

Decisions (clarified 2026-09-02):

- Scope: Cesium.js is wired in from the start and renders a full-screen globe in the browser.
- Package manager: npm (node v22, lockfile is `package-lock.json`).
- Code quality: ESLint (typescript-eslint) and Prettier, exposed as `npm run lint` and `npm run format`.
- Cesium Ion token: read from `VITE_CESIUM_ION_TOKEN` in a gitignored `.env` or `.env.local` file; a `.env.example`
  is committed. If the token is missing the app falls back to token-free OpenStreetMap imagery and
  ellipsoid terrain so the globe still renders.
- Cesium static assets are served via `vite-plugin-cesium`.

Acceptance:

- `npm run dev` opens a page with an interactive globe (verified 2026-09-02 with and without an Ion token).
- `npm run build` produces a production bundle without type errors.
- `npm test` runs Vitest and passes.
- `npm run lint` and `npm run format:check` pass on a clean tree.

## Milestone 2

Start from configuration:

- lat
- lon
- height
- heading
- speed = 0
- fov

The camera should be located as the configuration.

Decisions (2026-09-02):

- Configuration lives in `src/start.config.json` and is validated at load time
  (`src/sim/start-config.ts`); an invalid value throws with a clear message.
- Units: lat/lon in degrees, height in metres above ground (terrain surface), heading in degrees
  (0 = north, clockwise), speed in m/s, fov = vertical field of view in degrees.
- Any key can be overridden for quick experiments via URL query parameters,
  e.g. `/?lat=32.0&lon=34.8&height=900&heading=180&fov=75`.
- The camera is placed at (lat, lon) and `height` metres above the terrain, looking along `heading`
  with pitch 0 and roll 0 (`src/sim/camera.ts`). Ground height is sampled from the terrain provider
  once it is ready; without Ion terrain the ground is the ellipsoid, so height is effectively above
  sea level.
- Cesium's map widgets (geocoder, home, base-layer picker) and mouse/touch camera navigation are
  disabled so only the simulation moves the camera.
- Default start: over the Inn valley near Innsbruck, 2500 m, heading east, fov 60, speed 0.

Acceptance:

- `npm run dev` opens with the camera at the configured position, heading and fov
  (verified 2026-09-02 in the browser, including query-string overrides).
- Dragging the mouse does not move the camera.
- Config validation is unit-tested (`src/sim/start-config.test.ts`).

## Milestone 3

Add to configuration:

- airplane weight
- drag coefficient
- lift coefficient
- max thrust

Flight controls:

- roll (arrows left/right)
- pitch (arrow up/down)
- yaw (for debugging "[" and "]")
- throttle (+/-)

Minimal textual HUD (flight control details, height, speed, etc.)


