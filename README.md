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

| Key               | Action                                                           |
| ----------------- | ---------------------------------------------------------------- |
| `←` / `→`         | Roll left / right                                                |
| `↓` / `↑`         | Nose up / nose down (fly-by-wire: the stick commands g)          |
| `[` / `]`         | Yaw left / right (nose-wheel steering on the ground)             |
| `+` / `-`         | Throttle in 5 % steps; past 100 % lights the afterburner         |
| `A`               | Afterburner on/off                                               |
| `G`               | Landing gear up/down                                             |
| `S`               | Airbrake in/out                                                  |
| `B` (hold)        | Wheel brakes                                                     |
| `C`, `F1`–`F5`    | Next camera; cockpit / chase / orbit / fly-by / padlock          |
| Right drag        | Look around in the cockpit (returns to the boresight)            |
| Left drag / wheel | Rotate / zoom the orbit camera                                   |
| `M`               | Mouse flight (pointer position = stick) on/off                   |
| `P`               | Pause                                                            |
| `,` / `.`         | Time scale slower / faster                                       |
| `O`               | Cesium OSM Buildings on/off (needs an Ion token)                 |
| `` ` ``           | Debug block (position, coefficients, fps, tiles) on/off          |
| `R`               | Reset to the start configuration                                 |
| `Space` / trigger | Fire cannon/rockets while held; release a missile/bomb per press |
| `Enter`           | Cycle gun → IR → radar → bomb → rocket                           |
| `1` / `2` / `3`   | Select gun / IR missile / radar missile                          |
| `4`               | Select bombs; press again for rockets                            |
| `E` / `Q`         | Wingmen engage / rejoin                                          |
| `W`               | Next navigation steerpoint                                       |
| `T` / `Tab`       | Cycle detected hostile radar tracks, nearest first               |
| `L`               | Lock/unlock the selected target                                  |
| `X`               | Release one chaff/flare packet                                   |

A gamepad works too: stick axes for roll/pitch/yaw, optional throttle axis, buttons for
throttle up/down, afterburner, gear, brakes, airbrake, camera, reset and pause (`input.gamepad`).

The HUD is a fighter-style overlay: heading tape at the top, airspeed tape (knots or m/s) on
the left with Mach, g, peak g and angle of attack below it, altitude tape (feet or metres) on the
right with radar altitude and vertical speed, a pitch ladder that rolls with the aircraft, the
boresight cross, the flight-path marker (with an AoA bracket beside it, clamped to the edge with
an arrow when off screen), throttle/afterburner and fuel at the bottom left, GEAR / AIRBRAKE /
BRAKES indicators at the bottom, and flashing STALL / OVER-G / OVERSPEED / GEAR / PULL UP /
ENGINE OUT / BINGO FUEL warnings. World-referenced symbols are projected through the current
camera, so they stay correct in the chase and orbit views too. A hard landing, a wing strike,
a nose-first impact or a gear-up landing freezes the sim with **CRASHED** and the reason;
press `R`. The backtick key opens the debug panel with every raw number, fps and the key legend.

## Missions and the world

`start.mission` (or `?mission=coastal-patrol`) names a mission file in `src/missions/`. A mission
is a list of entity spawns validated at load time:

| Kind                  | Fields                                                                                                                                                                        |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `aircraft`            | `id`, `name`, `type` (`src/aircraft`), `faction` (`friendly`/`hostile`/`neutral`), `lat`, `lon`, `height` (above terrain; 0 = on the wheels), `heading`, `speed`, `behaviour` |
| `ground-unit`, `ship` | `id`, `name`, `type` (`src/units`), `faction`, `lat`, `lon`, `heading`, `route` (`{ loop, waypoints }` or `null`)                                                             |
| `waypoint`            | `id`, `name`, `lat`, `lon`, `height` (above the ellipsoid); the HUD heading caret points at the selected one (`W` cycles)                                                     |

Aircraft behaviours: `{ "mode": "straight" }` holds the spawn heading, altitude and speed;
`{ "mode": "orbit", "lat", "lon", "radius", "altitude", "speed", "clockwise" }` flies a circle;
`{ "mode": "waypoints", "loop", "waypoints": [{ "lat", "lon", "height", "speed"? }] }` follows a
route. Altitudes in behaviours and waypoints are metres above the ellipsoid. AI aircraft fly the
same flight model as the player through a simple autopilot (`src/sim/autopilot.ts`); ground units
are clamped to the terrain and ships to sea level, and both drive their routes at the unit type's
speed. Entities collide as spheres (`radius` in the unit type; aircraft 8 m): flying into one
crashes both. Near the player entities draw as glTF models, beyond `world.lodDistance` as
faction-coloured points (red hostile, blue friendly). Wrecks disappear after
`world.wreckRemoveSeconds`. Bullets and missiles are pooled (`world.maxBullets`, `maxMissiles`).

Unit types live in `src/units/*.json` (`name`, `kind`, `radius`, `health`, `speed`, `model`) and
are registered in `src/units/index.ts`.

## Weapons and damage (Milestone 7)

Open `?mission=weapons-range&time=2026-09-06T12:00:00Z` for two unarmed drones ahead of the
default airborne start and a ground range farther east. The existing coastal patrol also
supports all weapons. Set throttle before practising; the default flight starts at idle.

- **Gun:** select `1`, designate a drone with `T`, and bring the boresight onto the LCOS
  lead cue. Hold Space for the 100-round/s cannon. It carries 510 rounds, adds aircraft
  velocity to its 1,050 m/s muzzle velocity, and applies dispersion, gravity and drag.
  Fast rounds use swept hits against moving targets. An empty press clicks after the first
  keyboard/pointer interaction has unlocked browser audio.
- **IR:** select `2`. The seeker acquires a hostile aircraft in the nose's 30° half-cone,
  or follows the target selected and locked with `T`, `L`. Fire when **SHOOT** appears
  (300 m–18 km). A single trigger press launches one missile. The HUD shows a seeker ring,
  range limits and estimated time to impact.
- **Radar:** select `3`, designate and lock an aircraft, then fire within 600 m–65 km and
  the launch cone. Maintain the lock during **MIDCOURSE**; inside 15 km the missile goes
  **ACTIVE** and no longer needs the launching aircraft. Losing the datalink before active,
  exceeding the seeker gimbal, target destruction or a successful decoy makes the missile
  ballistic. Range limits are nominal game envelopes, not guaranteed intercepts.
- **Bombs/rockets:** `4` selects bombs and toggles to rockets on the next press; Enter also
  cycles through both. The bomb **CCIP** pipper predicts terrain impact using the actual
  release offset, gravity and drag. Place it over a ground target and tap Space. A dashed
  pipper at the screen edge means the predicted impact is outside the view. Rockets fire
  repeatedly while the trigger is held and follow their motor-driven ballistic trajectory.
- **Defence:** `X` releases one flare and one chaff cartridge when available, at most one
  packet every 0.5 seconds. Their chance of breaking seeker tracking depends on seeker type,
  aspect and distance. They do not guarantee a miss. The RWR shows incoming missile direction when terrain visibility permits.
  Armed M9 missions add autonomous incoming fire. The HUD confirms which cartridges were
  released; combine repeated packets with a sharp turn. A missile can still coast into you
  after losing guidance.

The HUD shows remaining weapons, flares/chaff, hull health, kills and damaged systems.
Damage reduces engine thrust and control rates and causes a fuel leak. Explosive damage
falls off with distance from the target's collision sphere; unguided fire and blast can also
hit friendlies or the shooter. Only hostile kills count. Aircraft wrecks fall, destroyed
surface units smoke, and wrecks expire after the configured timeout. Player death freezes
the entire simulation with the cause; `R` rebuilds the world with fresh ammunition and health.

`src/weapons/weapons.json` contains validated tuning for every weapon, the random seed,
countermeasure probabilities and damage modifiers. Weapon angles are **half-cones in degrees**;
other values use SI units. Each aircraft's `combat` section sets health and the starting gun,
IR, radar, bomb, rocket, flare and chaff counts. Missiles, bombs and rockets share the bounded
`world.maxMissiles` pool; bullets use `world.maxBullets`. Simulation and visual pools are reused.
Base rearming/refuelling is deferred to the airbase system in M10; TV/laser guidance is optional
future work. Reset currently restores the loadout.

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
preset, buildings, HUD units and mission:

```
http://localhost:5173/?lat=32.0&lon=34.8&height=900&heading=180&speed=250&aircraft=trainer&graphics=low&buildings=1&units=metric&mission=coastal-patrol
```

## Sensors and targeting (Milestone 8)

Radar scans at 4 Hz inside ±60° azimuth and ±30° elevation in the aircraft body frame.
`src/sensors/sensors.json` configures scan limits, rate, range (80 km for an 8 m radius
reference target), size scaling and optional terrain LOS. Terrain is sampled every 500 m
with Earth curvature included; unloaded terrain is permissive, so a newly loaded ridge
can remove a track at the next scan. This is a simplified size-based radar model.

The lower-left B-scope shows range lines and coloured contacts: red hostile, blue friendly,
white neutral. `T`/`Tab` cycles detected hostiles nearest first; `L` locks or unlocks.
Only hostile tracks can become weapon targets. Radar locks drop outside the scan volume
or behind terrain. IR missiles can acquire visible hostiles in their seeker cone without
radar; a radar lock slaves the seeker within its launch envelope. Acquisition produces a
pulsed tone after keyboard/pointer input unlocks audio.

`F5` selects padlock (also included in `C` cycling). It follows the last designated target
through a merge, even after radar loses it, and returns to boresight when the target dies.
This visual camera memory does not preserve a missile radar lock. `W` cycles mission
steerpoints; the heading caret and readout show bearing and distance.

The RWR uses nose-relative bearings: **S** search, **L** radar lock, **M** incoming missile.
Lock and missile warnings have distinct pulsed tones; full audio styling remains M11.
Every aircraft emits search radar. Opponent lock commands use the same track checks as
the player; autonomous enemy locking/firing is enabled by the M9 mission AI settings. Headless tests exercise reciprocal
locks, 40 km detection, launches at Rmax, terrain masking, IFF and padlock geometry.
Chrome verification confirmed radar selection/lock and launch cues, a radar-missile kill,
padlock target centering, RWR search bearings, and waypoint cycling. A radar/fuel-readout
overlap found during that check was fixed. Reciprocal lock and incoming-missile warnings
remain covered headlessly; audio was not verified by listening.

## Combat AI (Milestone 9)

Try these scenarios after `npm run dev` (the start is at idle power, so throttle up):

- `http://localhost:5173/?mission=dogfight&difficulty=medium&speed=260` — 1-v-2 against fighters.
- `http://localhost:5173/?mission=wingman-patrol&difficulty=medium&speed=260` — a friendly wingman
  holds formation until `E` orders engagement; `Q` orders rejoin. Commands require a live,
  unpaused simulation. A defending wingman finishes its threat response before rejoining.
- `http://localhost:5173/?mission=air-defence&speed=260` — an armed SAM and AAA battery.

Append `&time=2026-09-08T12:00:00Z` for daylight. Use `difficulty=easy`, `medium`, or `hard`;
the HUD shows the current level. `R` restores the mission, ammunition, AI state and random seeds.
The original coastal patrol and weapons range stay passive unless their spawns explicitly
opt into AI. Use `localhost`, not `127.0.0.1`, for the origin-restricted Ion token.

Add optional `ai` objects to mission spawns:

```json
{"role":"combat"}
{"role":"wingman","leaderId":"player"}
{"role":"sam"}
{"role":"aaa"}
```

Aircraft support `combat` and `wingman`; surface units support `sam` and `aaa`. Wingmen must
be friendly and reference the player or another friendly aircraft; missing or cyclic leaders
are rejected. AI does not change the spawn's patrol behaviour or give it different physics.
The AAA scenario currently reuses the SAM model as a visual placeholder.

`src/ai/ai.json` contains validated presets and tuning. Decisions run at 10 Hz, with flight
controls updated every physics step. Aircraft patrol, detect through their own M8 radar,
wait for the reaction delay, then engage. A further lock dwell precedes the first missile.
They use lead/pure/lag pursuit, extend briefly after overshooting and turn back using bounded
last-seen contact memory. Cannon bursts use ballistic lead and nose-pitch guidance; missile
launches use the existing IFF, seeker, range and inventory checks with launch spacing.

Terrain avoidance sweeps a forward corridor and overrides attacks to level the wings and
climb. Low-speed recovery reduces bank and adds power. Missile defence turns toward IR
threats or perpendicular to radar threats, changes altitude, and dispenses countermeasures
inside their useful range. Gun threats also trigger evasive turns. Low fuel, damage or no
air-to-air ammunition causes disengagement, then return to the spawn area and loiter;
landing, refuelling and rearming remain M10.

SAMs use omnidirectional search, LOS, track delay, lock, finite missiles and reloads. AAA
uses lead-aimed dispersed bursts, finite rounds and a shorter engagement zone. Both are
subject to the weapon's own range as well as AI engagement limits. SAM radar and missiles
feed the player's RWR; missiles retain the existing radar datalink/active-seeker behaviour.

Difficulty adjusts reaction delay, aim error, permitted commanded g, launch spacing and
`missilePk`. The last setting is a simplified seeded chance of successful guidance at launch;
it is **not** the final probability of a kill. Seeker geometry, terrain, target manoeuvres,
remaining energy and countermeasures still determine the outcome. Aircraft and ground
emitters have separate deterministic random streams; weapon effects use the existing weapon seed.

Acceptance tests cover intercept within 120 seconds, cannon damage, defence, re-attack,
formation, RTB, SAM/AAA, IFF/LOS/range gates, reloads and deterministic replay. A fixed set of
eight combat seeds includes a scripted medium 1-v-2 win with early shots, lead aiming and
defence; an idle pilot loses in all eight. A 600-second endurance test survives a synthetic
2,000 m alpine ridge and surrounding terrain. This is a reproducible terrain fixture, not
a guarantee for unloaded Cesium tiles or a live ten-minute Alps test.

Live checks confirmed hostile engagement and RWR warnings, a SAM kill, and wingman command
messages. The user confirmed `X` reduces FLR/CHF counts; countermeasures do not guarantee survival.

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
| `npm run model`        | Regenerate `public/models/*.glb`    |

See [plans.md](plans.md) for the milestones done so far and [next.md](next.md) for the roadmap;
assets are listed in [CREDITS.md](CREDITS.md).
