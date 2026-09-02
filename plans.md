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

Decisions (2026-09-02):

- Physics: point-mass model with angle of attack (`src/sim/physics.ts`). Lift = ½ρv²·S·CL(α),
  drag = ½ρv²·S·(CD0 + 0.05·CL²), thrust = throttle·maxThrust along the nose, gravity = weight·g.
  CL(α) = liftCoefficient + 5·α up to a 15° stall, then decays to zero at 30°. Air density falls off
  with altitude. With neutral controls the nose seeks the angle of attack that gives `trimLoadFactor` g of lift
  (clamped to the stall), turning toward it at a rate that grows with airspeed, so the aircraft
  flies level at any speed and mushes when too slow.
- Config gains an `aircraft` section: `weight` (kg), `wingArea` (m², added because the forces need
  it), `liftCoefficient` (CL at zero AoA), `dragCoefficient` (CD0), `maxThrust` (N). The start
  parameters moved under `start`. Defaults are a Cessna-172-like light aircraft.
- Controls are rates while held: roll 60°/s, pitch 30°/s, yaw 20°/s; release stops the rotation.
  `+`/`-` step throttle by 5 % and it stays put. Flight-sim convention: arrow down = nose up.
  `R` resets to the start configuration.
- Ground: below 4 m/s sink, under 20° bank and not nose-down, touchdown puts the aircraft on its
  wheels (roll forced level, rolling friction, steering with yaw), so takeoff and landing work.
  Harder impacts freeze the sim with CRASHED in red; `R` resets. Ground height under the aircraft
  comes from the loaded terrain tiles each frame, falling back to the last known value.
- All flight-model numbers live in `start.config.json` (sections `aerodynamics`, `controls`,
  `ground`, `environment`), validated with ranges like the rest; the physics reads them and has no
  built-in constants. Angles in the file are degrees.
- Fixed-rate physics steps (`simulation.physicsHz`, 120 by default, with `maxFrameSeconds` capping
  catch-up after a stall) driven from Cesium's clock tick; cockpit camera follows the aircraft.
- HUD (`src/hud.ts`): status, throttle, roll/pitch/heading, AoA, airspeed (m/s and kt), vertical
  speed, AGL, altitude, lat/lon, CL/CD, and a key legend.

Note: the shipped start config (200 m AGL, speed 0) falls and crashes within seconds because the
aircraft has no airspeed. Use `?speed=55` for an in-flight start or `?height=0` for a takeoff.

Acceptance:

- Unit tests cover attitude math, lift curve, forces, takeoff roll, landing, crash, and key mapping
  (50 tests). Verified 2026-09-02 in the browser: roll/pitch/yaw/throttle respond with the right
  sign and rate, the horizon banks correctly, reset works, the HUD updates every frame.
