# AIRIUM — next: from flight simulator to combat jet game

Roadmap for everything still needed to turn the current Cesium flight simulator into a
playable fighter-jet combat game. Milestones 1–3 (globe, start configuration, light-aircraft
flight model, keyboard controls, text HUD) are done and documented in `plans.md`; this
document starts at Milestone 4. Each milestone lists tasks as checkboxes, the decisions
that have to be made, and acceptance criteria in the same spirit as `plans.md`.

## Where the code is today (baseline for all tasks below)

- `src/main.ts` — startup, terrain settle, fixed-step loop driven by `viewer.clock.onTick`.
- `src/viewer.ts` — Cesium `Viewer` with widgets and mouse navigation disabled, Ion or
  OpenStreetMap fallback.
- `src/sim/physics.ts` — point-mass model (lift/drag/thrust/gravity, trim, weathervane
  stability, eased body rates, ground contact, crash). Pure TypeScript, unit-tested.
- `src/sim/attitude.ts`, `src/sim/math3d.ts` — body triad in East-North-Up, vector math.
- `src/sim/sim-config.ts` — validated `start.config.json` (Cessna-172-like numbers).
- `src/sim/camera.ts` — cockpit camera = aircraft position/attitude; terrain height sampling.
- `src/input.ts` — keyboard only: roll/pitch/yaw/throttle/reset.
- `src/hud.ts` — monospace text panel.
- No aircraft model, no other entities, no weapons, no sound, no menus, no game state.

Known debt to fix along the way:

- `plans.md` refers to `src/sim/start-config.ts`; the file is `src/sim/sim-config.ts`.
- `docs/` is a committed production build (~ Cesium runtime included). Consider building in
  CI instead (see Milestone 12).
- ~~The HUD key legend is hard-coded and will drift as keys are added; generate it from the
  key map.~~ Done in M4 (`src/input/legend.ts`).
- Position integration is flat-earth (`earthRadius`, `cos(lat)`); fine below ~80° latitude.
  Documented in the README; switching to ECEF remains optional.
- The shipped `start` (0 m AGL, speed 0 at Sde Dov) needs a throttle-up to do anything; the
  game needs proper mission starts (Milestone 10).

## Shortest path to a playable game (vertical slice)

Do these first, in this order, so there is something to play as early as possible; the
remaining milestones then deepen each system.

1. Jet flight model and afterburner (M4, first half).
2. Own-aircraft 3D model + chase camera (M4) so the jet is visible.
3. Entity system with one enemy jet flying the same physics (M6).
4. Gun with tracers and hit detection (M7, gun only).
5. Graphical HUD with pitch ladder, flight-path marker, gun cross and target box (M5).
6. One enemy AI that turns toward you and shoots (M9, pursuit only).
7. Kill/death/win/lose overlay and restart (M10, minimal).

Everything after that is polish and depth.

---

## Milestone 4 — Jet flight model, aircraft model and cameras

Goal: the aircraft behaves like a fighter (F-16-class), is visible from outside, and the
world is tuned for 250+ m/s flight.

### Flight model

- [x] Replace the light-aircraft numbers in `start.config.json` with a fighter:
      mass ≈ 9 000 kg empty + fuel, wing area ≈ 28 m², CD0 ≈ 0.02, CL0 ≈ 0.1,
      military thrust ≈ 76 kN, afterburner ≈ 127 kN. Keep everything in config, no constants
      in code.
- [x] Add an `aircraft` table (`aircraft/*.json` or a section keyed by type) so the player
      and enemies can have different types; `start.aircraft` names the player's type.
- [x] Thrust model: throttle 0–100 % = military power, a separate afterburner stage
      (key or throttle beyond 100 %); thrust scales with air density ratio; optional
      speed (ram) term.
- [x] Fuel: capacity, flow rate per throttle stage, mass decreases, engine flame-out at zero.
- [x] Compressibility: speed of sound from an ISA temperature model, Mach number in the state,
      transonic drag rise (CD multiplier vs Mach), Mach limit warning.
- [x] Load factor: compute g from lift/mass, expose in state; configurable structural limit
      (e.g. 9 g) with over-g damage/warning; negative-g limit.
- [x] Fly-by-wire pitch: pitch input commands a target load factor (blended with AoA limiter
      near the stall) instead of a raw pitch rate; rates scale with dynamic pressure so controls
      go soft at low speed. Roll rate ≈ 250°/s max.
- [x] Departure/stall behaviour: beyond the AoA limiter the nose drops and the aircraft loses
      energy (no spin model needed).
- [x] Landing gear: `G` toggles gear (transit time), drag when down, max gear speed, crash if
      touching down gear-up. Wheel brakes (`B`), nose-wheel steering (existing yaw on ground),
      airbrake/speed brake (`S`) adding drag.
- [x] Pause (`P`) and optional time scale (sim speed ×0.5/×1/×2) in `simulation` config.
- [ ] Optional (not done): integrate position in ECEF (`Cartesian3`) and convert to cartographic for
      terrain queries, removing the flat-earth approximation.
- [x] Unit tests: afterburner thrust, fuel burn, Mach/drag rise, g-limit, FBW g-command
      converges, gear drag, brakes stop the aircraft.

### Own-aircraft model and cameras

- [x] Source a fighter glTF model (CC0/CC-BY, record attribution in `CREDITS.md`) or build a
      simple low-poly jet (done: generated by `scripts/make-jet-model.mjs`, see `CREDITS.md`); place it as a Cesium `Entity`/`Model` with orientation from the body
      triad (`Transforms.headingPitchRollQuaternion` or a `Matrix4` from the ENU triad).
- [x] Camera modes cycled with `C` (and `F1`–`F4`): cockpit (existing), chase (behind and
      above, smoothed), orbit/external (mouse drag rotates, wheel zooms), fly-by, target
      padlock (added in M8). Hide the own model in cockpit view.
- [x] Mouse-look in cockpit (hold right button) that snaps back to boresight.
- [x] Camera near/far planes and `depthTestAgainstTerrain` tuned so terrain and models don't
      z-fight at speed.

### Cesium world tuning for jets

- [x] Continuous rendering with a target of 60 fps: `maximumScreenSpaceError`,
      `tileCacheSize`, `preloadSiblings`/`preloadAncestors`, `scene.fog`, `msaaSamples`/FXAA,
      lighting and `skyAtmosphere` settings collected in a `graphics` config section with
      low/medium/high presets.
- [x] Time of day: `start.time` (ISO string) sets `viewer.clock.currentTime` and
      `globe.enableLighting`; sun position affects lighting.
- [x] Optional Cesium OSM Buildings 3D Tiles layer (Ion asset) for cities, with a toggle.
- [x] Confirm tile streaming keeps up at Mach 1 low-level flight; measure and set
      `maxFrameSeconds`/physics substeps accordingly (60 fps, tiles loaded at 220 m/s over
      Tel Aviv on the medium preset; 120 Hz physics, 0.1 s frame clamp).

### Input

- [x] Gamepad API: stick axes for roll/pitch, rudder axis or buttons, throttle axis, buttons
      for fire/weapon select/gear/flares; dead-zone and curve in config.
- [x] Optional mouse flight (mouse position = stick) toggled in settings.
- [x] Key bindings move into config (`controls.keys`) and the HUD legend/help screen is
      generated from them.
- [x] `input.ts` split into keyboard/gamepad/mouse sources merged into one `Controls` struct
      with extra actions (fire, select weapon, lock, countermeasures, gear, brakes, camera).

Acceptance: take off from the runway, climb to 10 km, exceed Mach 1, pull 9 g in a turn,
land with gear down; visible from a chase camera; a gamepad flies it; 60 fps on a mid-range
laptop with the medium preset.

---

## Milestone 5 — Combat HUD

Goal: replace the text panel with a fighter-style HUD drawn on a canvas/SVG overlay, with
the world-referenced symbols projected from Cesium.

- [x] `src/hud/` module rendering to a full-screen `<canvas>` above the Cesium canvas,
      scaled for device pixel ratio, redrawn every frame from the aircraft state.
- [x] Symbols: boresight cross, flight-path marker (velocity vector projected to screen
      through the camera), pitch ladder with horizon line (rolls with the aircraft in cockpit
      view), heading tape with current heading and waypoint caret (`HudData.waypointHeading`,
      fed by M8), airspeed tape (knots) with
      Mach below, altitude tape (feet) with radar altitude below a threshold, vertical speed,
      g readout with max g, AoA bracket, throttle/afterburner and fuel state, gear/brake
      indicators.
- [x] Warnings block: STALL, OVER-G, OVERSPEED, PULL UP (terrain closure predicted from
      velocity and ground height), BINGO fuel, GEAR (low and slow with gear up), with
      flashing text and (M11) audio.
- [x] Combat symbology (populated by M7/M8): target designator box, target range/closure/
      aspect, missile seeker circle and Rmin/Rmax cue, shoot cue, gun cross with lead
      computing sight (LCOS) pipper, selected weapon and rounds/missiles remaining, radar
      lock state, RWR strip. (Done so far: `HudData.target` draws the TD box with range,
      closure, LOCK and an off-screen arrow, `HudData.weapon` the selection; seeker circle,
      Rmin/Rmax, shoot cue, LCOS pipper and RWR come with the weapons and sensors.)
- [x] Units setting (metric/imperial) and HUD colour/brightness setting.
- [x] Keep the old text panel as a debug overlay behind a toggle key (backtick); add fps and
      tile-load counters to it.
- [x] Screen projection helper (`SceneTransforms.worldToWindowCoordinates` or manual
      projection from the camera matrices) with off-screen handling (clamp to edge with arrow).
- [x] Unit-test the pure layout math (ladder angles, tape scrolling, projection of a point
      known to be on boresight).

Acceptance: in a level turn the horizon line and ladder roll correctly, the FPM sits below the
boresight at high AoA, tapes read the same values as the debug panel, warnings appear in the
right conditions.

---

## Milestone 6 — Entity system: other aircraft and ground targets

Goal: the world contains many simulated objects besides the player, updated by the same
fixed-step loop and rendered by Cesium.

- [ ] `src/sim/world.ts`: `World` holding a list of entities, each with `id`, `kind`
      (`aircraft`, `missile`, `bullet`, `ground-unit`, `ship`, `waypoint`), `faction`
      (player, friendly, hostile, neutral), position (lat/lon/height), attitude, velocity,
      `health`, `alive`, and a per-kind update function. Deterministic step order.
- [ ] Aircraft entities reuse `physics.step` with their own `FlightModel`; the player is just
      the entity with `controlledByPlayer`.
- [ ] Ground units placed by lat/lon and clamped to terrain (`sampleTerrainMostDetailed` at
      spawn, `loadedGroundHeight` later); ships at sea level; both may follow waypoints.
- [ ] Renderer `src/render/entities.ts`: sim ↔ Cesium sync each frame using
      `Entity` models (near) and billboards/points (far) with distance-based LOD; hostile /
      friendly colouring; remove wrecks after a delay. Object pools for bullets and missiles.
- [ ] Collision: sphere-sphere between aircraft/missiles, terrain contact for every entity
      (reuse ground logic), optional building contact via `scene.sampleHeight`/`clampToHeight`
      when OSM Buildings is on.
- [ ] Spawn descriptions in a JSON format (position, heading, speed, type, faction, waypoints,
      behaviour) validated like `sim-config.ts`; used by missions (M10).
- [ ] Performance: profile with 30 aircraft + 200 bullets; sim step under 2 ms.
- [ ] Unit tests: entity update ordering, spawn parsing/validation, collision detection,
      terrain clamping fallback.

Acceptance: a mission file spawns a flight of enemy jets in a holding pattern and a SAM site on
a hill; they render at the right place and scale, and flying into one crashes both.

---

## Milestone 7 — Weapons and damage

Goal: shoot things down.

### Gun

- [ ] Fixed cannon (M61-like: 100 rounds/s, 1 050 m/s muzzle velocity, 510 rounds), fire
      with `Space`/trigger, muzzle offset in body frame, small dispersion.
- [ ] Bullet entities: ballistic integration (gravity, quadratic drag), lifetime ~3 s,
      rendered as tracers (short polylines or point primitives); pooled.
- [ ] Hit detection: swept segment vs target bounding sphere per step; damage per hit.
- [ ] Lead-computing gun sight on the HUD using the target's relative velocity and bullet time
      of flight.
- [ ] Ammo counter, empty-gun click, rearm at base (M10).

### Missiles

- [ ] Missile types in config: short-range IR (AIM-9-like: 18 km, 25 g, seeker cone 30°,
      boresight or radar-slaved), medium-range radar (AIM-120-like: 60+ km, datalink until
      active); each with motor thrust and burn time, mass, drag, max g, seeker field of view
      and gimbal limit, proximity fuze radius, warhead damage/radius, minimum range.
- [ ] Guidance: proportional navigation toward the tracked target with g clamp; seeker loses
      lock if the target leaves the gimbal or countermeasures succeed; go ballistic when lost.
- [ ] Launch logic: needs a lock (M8) inside Rmin/Rmax and seeker cone; launch transient,
      smoke trail (polyline), time-to-impact on the HUD.
- [ ] Countermeasures: `X` releases chaff/flare (counts in config); probability of decoying
      depends on seeker type, aspect and range; decoys rendered briefly.
- [ ] Weapon selection: `Enter`/`1`–`3` cycles gun/IR/radar/A-G; HUD shows selection and count.

### Air-to-ground

- [ ] Unguided bombs with CCIP pipper (integrate the bomb trajectory to terrain impact each
      frame) and rockets; release with the same trigger.
- [ ] Optional: TV/laser-guided bomb with a designated ground point (later).

### Damage and destruction

- [ ] Health per entity type; hit damage; warhead damage falls off with distance; system
      damage for the player (engine, controls, fuel leak) as simple modifiers.
- [ ] Destroyed state: explosion effect, falling wreck for aircraft, smoke plume for ground
      units, removal after a timeout; kill credited to the shooter.
- [ ] Player death: crash/kill freezes the sim with a cause message and a restart prompt.
- [ ] Unit tests: bullet ballistics vs analytic drop, segment-sphere hit, PN guidance hits a
      constant-velocity target, Rmin/Rmax gating, flare decoy probability, damage falloff,
      CCIP impact point on flat terrain.

Acceptance: destroy a drone with the gun and another with an IR missile; a bomb hits within
the pipper's error on a ground target; a missile fired at you can be decoyed with flares.

---

## Milestone 8 — Sensors, targeting and warnings

Goal: find, lock and track targets; know when you are being targeted.

- [ ] Radar model: scan volume (±60° azimuth, ±30° elevation), max range by target size,
      update rate, optional terrain line-of-sight check (sample terrain along the ray);
      produces a track list.
- [ ] Target lock: `T`/`Tab` cycles tracks (nearest first), `L` locks/unlocks (single target
      track); locked target drives the HUD TD box, range/closure/aspect, missile seeker
      slaving and the padlock camera.
- [ ] IR seeker for IR missiles: boresight acquisition when no radar lock, tone when locked.
- [ ] Radar display: small B-scope/PPI panel on the HUD (range rings, tracks, lock).
- [ ] Radar warning receiver: shows bearing of enemy radars that see you, lock warning,
      missile-launch warning with direction; drives audio cues (M11).
- [ ] IFF: friendlies never appear as valid weapon targets; colouring on HUD and radar.
- [ ] Waypoint/steerpoint navigation: HUD caret, distance and bearing, cycle with `W`.
- [ ] Unit tests: scan-volume membership, track cycling order, LOS blocked by a hill, RWR
      bearing.

Acceptance: pick up a bandit at 40 km, lock it, fire a radar missile at Rmax, see the RWR
light up when it locks back, and padlock it through a merge.

---

## Milestone 9 — Enemy and friendly AI

Goal: opponents that fly, fight and defend themselves credibly, with adjustable difficulty.

- [ ] Aircraft AI as a state machine: `patrol` (waypoints/orbit) → `detect` (own sensor
      model with reaction delay) → `engage` → `defend` → `disengage`/`RTB`
      (low fuel/health/ammo); crashes avoided by a terrain-avoidance override (pull up when
      predicted AGL falls under a floor).
- [ ] Engage: pure/lead/lag pursuit selection, energy management (target speed, don't stall),
      gun employment inside range/angle limits with lead, missile employment inside the
      envelope with launch spacing, re-attack after overshoot.
- [ ] Defend: break turn into the missile, notch, dive/climb, dispense countermeasures on
      launch warning, evade guns.
- [ ] Wingman/formation: friendlies hold position relative to a leader and engage on command.
- [ ] Ground defences: SAM site (search radar → track → launch, reload time, engagement
      zone), AAA (lead-aimed bursts with dispersion), both with an enable range and ammo.
- [ ] Difficulty presets: reaction time, aim error, max g used, missile Pk, in config.
- [ ] Seeded RNG so replays and tests are deterministic.
- [ ] Unit tests (headless, fast-forwarded): AI intercepts a straight target in under N s,
      does not fly into a 2 000 m ridge, launches only inside the envelope, wingman keeps
      station.

Acceptance: a 1-v-2 against medium AI is winnable but not trivial; AI never flies into terrain
in a 10-minute unattended run over the Alps.

---

## Milestone 10 — Missions, game loop and UI

Goal: it is a game: menus, missions with objectives, win/lose, scores and progress.

- [ ] Screens (plain DOM/CSS over the canvas): main menu, mission select, briefing (map
      thumbnail, objectives, loadout), in-game pause menu (resume, restart, settings, quit),
      debrief (result, kills, hits/shots, time, score), settings (controls, units, graphics,
      audio, difficulty), help/controls reference generated from the key map.
- [ ] Mission format (`missions/*.json`, validated): metadata, time of day/weather, player
      start (position, aircraft, loadout, fuel), entity spawns (M6), waypoints, objectives
      (destroy, protect, reach, survive for T, land at base), triggers (on time / on area /
      on kill → spawn, message, objective change), win and lose conditions.
- [ ] Runtime: objective tracker overlay, mission clock, radio-style message log, kill feed,
      score, end-of-mission detection → debrief.
- [ ] Missions: free flight; gunnery training vs drones; intercept a bomber raid; SEAD strike
      on a SAM site; 1-v-2 dogfight; defend the base; instant action (random dogfight).
      Default theatre around the shipped start (Israel) plus one Alpine mission.
- [ ] Airbase: runway definition (threshold, heading, length) for spawn on runway, landing
      detection, rearm/refuel when stopped, mission "land to complete" objective.
- [ ] Persistence in `localStorage`: settings, unlocked missions, best scores; reset option.
- [ ] URL start overrides keep working for debugging (`?mission=…`, existing `start` keys).
- [ ] Unit tests: mission validation, objective evaluation (each type), trigger firing, score
      computation, runway landing detection.

Acceptance: a new player can open the site, read the briefing, fly the gunnery mission, see the
debrief, and their score is there after a reload.

---

## Milestone 11 — Audio and visual effects

Goal: feedback that makes speed, hits and danger felt.

- [ ] Web Audio engine: master/SFX/UI gains, one `AudioContext` unlocked on first input.
- [ ] Sounds: engine loop pitched by throttle with afterburner layer, wind noise by speed
      and AoA, gun burst, missile launch and fly-by, explosions (near/far), hits on own
      aircraft, gear/airbrake, RWR and lock tones, missile-launch warning, voice-style
      warnings (pull up, altitude, bingo) or beeps, UI clicks. CC0 assets with credits.
- [ ] Visuals: afterburner glow, wingtip vortices/contrails at high g and altitude, missile
      smoke, explosions and debris (`ParticleSystem`), muzzle flash, hit sparks, damage smoke
      trail, screen shake on hits, g-effects (tunnel vision grey-out above ~7 g, red-out on
      negative g), landing dust.
- [ ] Weather: `CloudCollection` cumulus layer, fog/visibility, wind vector affecting the air
      velocity used in `computeForces`.
- [ ] Settings for all of the above; effects scale with the graphics preset.

Acceptance: eyes closed you can tell throttle, speed, a gun burst and an incoming missile from
the sound alone; a missile hit visibly and audibly rocks the aircraft.

---

## Milestone 12 — Performance, robustness, tooling and release

- [ ] Frame budget: profile sim vs render; move bullets/missiles to a lighter integrator;
      cull far entities; verify no per-frame allocations in hot paths; keep 60 fps with a
      full mission on the medium preset.
- [ ] Robustness: `visibilitychange` pauses the sim, WebGL context loss shows a reload
      prompt, window resize rescales the HUD canvas, Ion token failure keeps the game
      playable (already falls back) and is shown in the menu.
- [ ] Browser support statement (desktop Chrome/Edge/Firefox/Safari); touch devices show
      a "keyboard or gamepad required" notice.
- [ ] Tests: keep unit coverage for every pure module (physics, weapons, AI, missions, HUD
      math); add a Playwright smoke test that loads the page token-free and sees the menu.
- [ ] CI with GitHub Actions: lint, format check, test, build on every push; deploy to
      GitHub Pages from the action (`actions/deploy-pages`) so `docs/` can be removed from
      the repository.
- [ ] Docs: README (controls table from the key map, missions, mission authoring guide,
      configuration reference), `CREDITS.md` for models/sounds/imagery, `CLAUDE.md` with the
      project conventions (config-driven physics, pure sim modules, tests per module).
- [ ] Fix the debt listed at the top (plans.md file name, generated legend, flat-earth note).
- [ ] Versioning: `package.json` version bump per milestone, changelog, `v1.0.0` tag when
      Milestones 4–11 acceptance criteria all pass.

---

## Decisions to make before starting (with suggested defaults)

- **Realism level**: arcade-leaning "simplified realistic" (real numbers, FBW g-command, no
  spin/engine-management depth). Default: yes.
- **Aircraft roster**: one player type (F-16-class) at first, two or three enemy types
  (fighter, bomber/transport, drone) sharing the same physics with different configs.
- **Theatre**: keep the Israel start plus the existing Innsbruck valley; Ion terrain is
  required for the mountain missions, token-free mode gets flat-earth missions only.
- **Assets**: CC0/CC-BY glTF models and sounds with a `CREDITS.md`; fall back to simple
  procedural shapes so the game works before assets are found.
- **Multiplayer**: out of scope for 1.0.
- **Mobile/touch**: out of scope for 1.0.
- **Deploy**: move from committed `docs/` to GitHub Actions Pages deployment (M12), keep
  `npm run build:pages` until then.

## Suggested order and rough effort

| Order | Milestone                                | Effort (focused days) |
| ----- | ---------------------------------------- | --------------------- |
| 1     | M4 Jet model, own model, cameras, tuning | 5–7                   |
| 2     | M6 Entity system                         | 3–4                   |
| 3     | M7 Gun + IR missile + damage             | 5–7                   |
| 4     | M5 Combat HUD                            | 4–5                   |
| 5     | M9 Aircraft AI (pursuit + defend)        | 5–7                   |
| 6     | M10 Missions, menus, debrief             | 5–7                   |
| 7     | M8 Radar, lock, RWR, radar missile       | 3–4                   |
| 8     | M7/M9 Ground attack, SAM/AAA             | 3–4                   |
| 9     | M11 Audio and effects                    | 3–4                   |
| 10    | M12 Performance, CI, docs, release       | 3–4                   |
