# Airium

A browser-based flight and combat simulator built with TypeScript and CesiumJS. Fly an
F-16-class jet or light trainer over the Earth, configure flight conditions on an interactive
map, and explore patrol, weapons training, and combat scenarios.

## Features

- Interactive flight setup with map-based starting locations, aircraft selection, and date/time controls.
- Configurable flight physics, fuel consumption, landing gear, afterburner, and aircraft damage.
- Fighter-style HUD, radar, targeting, threat warnings, and five camera views.
- Guns, infrared and radar-guided missiles, bombs, rockets, and countermeasures.
- Combat aircraft, wingmen, surface-to-air missiles, and anti-aircraft artillery.
- Keyboard, mouse, and gamepad support.

## Getting started

Install the dependencies and start the development server:

```sh
npm install
npm run dev
```

Open the local URL printed by Vite, usually `http://localhost:5173/`.

### Imagery and terrain

Cesium Ion access is configured through `ion.token` in
[`src/start.config.json`](src/start.config.json). With a valid token, the simulator loads
world terrain and Ion imagery. Without one, or if Ion rejects access, it falls back to
OpenStreetMap imagery on a smooth ellipsoid.

For an origin-restricted token, allow the exact development and deployment origins you use.
`localhost` and `127.0.0.1` are different origins.

## Flight setup

1. Choose a mission or **Free flight**, then select an aircraft.
2. Click the map to set your starting location. Drag to pan, scroll to zoom, or use **World**
   and **Center on start**. You can also enter latitude and longitude directly.
3. Set the starting height, heading, airspeed, field of view, and UTC date/time. Leave the
   date/time blank to use the current time.
4. Expand the settings sections to customize aircraft properties, loadouts, difficulty,
   graphics, controls, and simulation behavior.
5. Select **Start flight**. The default flight begins at idle throttle; increase power to
   maintain airspeed.

Settings are validated before launch and apply to the current session. **R** resets the
flight using those settings; reload the page to return to setup. **Restore defaults** resets
all form values, including values supplied through URL parameters.

The map changes the player's starting location. Mission entities retain their configured
coordinates. Aircraft property changes apply to every instance of that aircraft type.
Lists, including mission entities, routes, and key bindings, use JSON editors.

## Missions

| Mission              | Description                                               |
| -------------------- | --------------------------------------------------------- |
| Free flight          | An empty world for flight practice and exploration        |
| Coastal patrol       | A patrol scenario with passive aircraft and surface units |
| Weapons range        | Unarmed drones and ground targets for weapons practice    |
| Two-bandit intercept | A one-versus-two fighter engagement                       |
| Wingman patrol       | A friendly wingman with engage and rejoin commands        |
| Air defence range    | Armed SAM and anti-aircraft artillery threats             |

Combat difficulty can be set to **easy**, **medium**, or **hard**. It adjusts AI reaction,
aim, maneuvering, launch timing, and missile guidance probability.

## Controls

These are the default bindings. Customize them in the setup page or in `input.keys` within
[`src/start.config.json`](src/start.config.json). The debug panel displays the active key legend.

### Flight and camera

| Input             | Action                                           |
| ----------------- | ------------------------------------------------ |
| `←` / `→`         | Roll left / right                                |
| `↓` / `↑`         | Pitch up / down                                  |
| `[` / `]`         | Yaw left / right; steer on the ground            |
| `+` / `-`         | Increase / decrease throttle                     |
| `A`               | Toggle afterburner                               |
| `G`               | Toggle landing gear                              |
| `S`               | Toggle airbrake                                  |
| Hold `B`          | Apply wheel brakes                               |
| `C`               | Cycle camera views                               |
| `F1`–`F5`         | Cockpit, chase, orbit, fly-by, and padlock views |
| Right drag        | Look around the cockpit                          |
| Left drag / wheel | Rotate / zoom the orbit camera                   |
| `M`               | Toggle mouse flight control                      |

### Weapons and navigation

| Input                     | Action                                                        |
| ------------------------- | ------------------------------------------------------------- |
| `Space` / gamepad trigger | Fire; hold for cannon or rockets, press for a missile or bomb |
| `Enter`                   | Cycle weapons                                                 |
| `1` / `2` / `3`           | Select gun / infrared missile / radar missile                 |
| `4`                       | Select bombs; press again for rockets                         |
| `T` / `Tab`               | Cycle detected hostile tracks                                 |
| `L`                       | Lock / unlock the selected target                             |
| `X`                       | Release a chaff/flare packet                                  |
| `E` / `Q`                 | Order wingmen to engage / rejoin                              |
| `W`                       | Cycle navigation steerpoints                                  |

### Simulation and display

| Input     | Action                                    |
| --------- | ----------------------------------------- |
| `P`       | Pause / resume                            |
| `,` / `.` | Decrease / increase time scale            |
| `R`       | Reset the flight                          |
| `O`       | Toggle OSM buildings; requires Ion access |
| Backtick  | Toggle the debug panel and key legend     |

Gamepad axes, buttons, dead zones, and response curves are configurable under **Input**.
Keyboard stick input ramps gradually: a short press produces a smaller input than a held key.

## HUD and combat

The HUD displays heading, airspeed, altitude, vertical speed, Mach, load factor, angle of
attack, fuel, and aircraft status. Warnings identify stalls, excessive loads or speed,
terrain proximity, engine failure, and low fuel. A crash stops the simulation and displays
its cause; press **R** to restart.

The radar display identifies hostile contacts in red, friendlies in blue, and neutrals in
white. Use **T** to select a hostile track and **L** to lock it. Radar coverage and terrain
can affect detection and lock continuity. The radar warning receiver identifies search
emissions (**S**), locks (**L**), and incoming missiles (**M**).

- **Gun:** align the target with the lead cue and hold fire.
- **Infrared missile:** acquire a target within the seeker cone and fire when **SHOOT** appears.
- **Radar missile:** lock the target and maintain the lock during **MIDCOURSE** guidance.
  The missile guides independently once **ACTIVE**.
- **Bombs:** place the impact predictor over a ground target and release.
- **Rockets:** aim and hold fire to launch successive rounds.
- **Countermeasures:** release chaff and flares while maneuvering. They do not guarantee a miss.

Damage can reduce thrust and control authority or cause fuel leaks. Resetting restores
health, ammunition, mission entities, and AI state. Rearming and refueling at airbases are
not currently implemented.

## Configuration

The setup page exposes the existing configuration properties. To change the project defaults,
edit the corresponding source files:

| Source                                                 | Settings                                                                                               |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| [`src/start.config.json`](src/start.config.json)       | Flight start, environment, ground rules, simulation, graphics, controls, camera, HUD, and world limits |
| [`src/aircraft/`](src/aircraft/)                       | Airframe, engine, aerodynamics, limits, controls, model, health, and loadout                           |
| [`src/missions/`](src/missions/)                       | Entity spawns, factions, routes, waypoints, and AI roles                                               |
| [`src/units/`](src/units/)                             | Surface-unit models, speed, size, and health                                                           |
| [`src/weapons/weapons.json`](src/weapons/weapons.json) | Weapons, countermeasures, damage, and random seed                                                      |
| [`src/sensors/sensors.json`](src/sensors/sensors.json) | Radar coverage, range, update rate, and terrain visibility                                             |
| [`src/ai/ai.json`](src/ai/ai.json)                     | Difficulty presets, AI behavior, and random seed                                                       |

Configuration uses metres, metres per second, kilograms, newtons, and degrees unless noted
otherwise. Starting aircraft heights are above terrain; behavior and waypoint altitudes are
above the ellipsoid. A starting height of zero places the aircraft on its wheels.

New aircraft, missions, and surface units must be registered in their directory's `index.ts`.
Aircraft support straight flight, orbits, and waypoint routes. Optional AI roles include
`combat` and `wingman` for aircraft, and `sam` and `aaa` for surface units.

### URL parameters

URL parameters prefill the setup page. All `start` fields are supported, along with
`graphics`, `buildings`, `units`, and `difficulty`:

```text
http://localhost:5173/?mission=dogfight&aircraft=f16&speed=260&difficulty=medium
```

For example, add `&time=2026-09-12T12:00:00Z` to set a specific UTC time, or
`&graphics=low&units=metric` to change display defaults.

### Simulation scope

Airium uses a configurable game flight model. Position is integrated in a local
East-North-Up frame; accuracy is limited near the poles. Radar, missile guidance, damage,
and AI are simplified models. Terrain-dependent behavior also depends on loaded map data.

## Development

| Command                | Purpose                             |
| ---------------------- | ----------------------------------- |
| `npm run dev`          | Start the development server        |
| `npm run build`        | Type-check and build into `dist/`   |
| `npm run preview`      | Serve the production build locally  |
| `npm test`             | Run the test suite                  |
| `npm run test:watch`   | Run tests in watch mode             |
| `npm run lint`         | Run ESLint                          |
| `npm run format`       | Format the project with Prettier    |
| `npm run format:check` | Check formatting                    |
| `npm run model`        | Regenerate aircraft and unit models |
| `npm run build:pages`  | Build into `docs/` for GitHub Pages |

Simulation code lives in `src/sim/`; rendering, input, HUD, and setup UI are separated into
`src/render/`, `src/input/`, `src/hud/`, and `src/setup/`. Tests are colocated with the source.

## Deployment

The GitHub Pages build targets the `docs/` directory:

```sh
npm run build:pages
```

Commit the generated files and configure GitHub Pages to deploy from the `main` branch's
`/docs` directory.

Production builds use `/airium/` as the base path. To build for a custom domain or another
repository path, set `BASE_PATH`:

```sh
BASE_PATH=/ npm run build
BASE_PATH=/my-fork/ npm run build
```

The default preview URL is `http://localhost:4173/airium/`. Include the preview origin in any
Ion token restrictions, or run `npm run preview -- --port 5173` to reuse the development port.
Cesium runtime assets are copied into the build automatically.

## Project resources

- [Development plans](plans.md)
- [Roadmap](next.md)
- [Asset credits](CREDITS.md)
