import 'cesium/Build/Cesium/Widgets/widgets.css';
import './style.css';
import { getAircraftType } from './aircraft';
import { DebugPanel } from './hud/debug-panel';
import { HudCanvas } from './hud/hud-canvas';
import { buildHudData } from './hud/hud-data';
import { InputManager } from './input/controls';
import { formatLegend, legendEntries } from './input/legend';
import { getMission } from './missions';
import { OwnAircraft } from './render/aircraft-model';
import { CameraRig, setCameraFov } from './render/cameras';
import { EntityRenderer } from './render/entities';
import { Buildings, applyGraphicsPreset, setTimeOfDay, tuneForFlight } from './render/graphics';
import { loadedGroundHeight, sampleGroundHeight, sampleGroundHeights } from './render/terrain';
import { type AircraftEntity, type Entity, createAircraftEntity } from './sim/entities';
import { bearing } from './sim/geo';
import { toDegrees } from './sim/math3d';
import {
  type AircraftState,
  type FlightModel,
  computeForces,
  createInitialState,
  interpolateState,
} from './sim/physics';
import { SimClock } from './sim/sim-clock';
import { resolveSimConfig } from './sim/sim-config';
import { createEntities } from './sim/spawn';
import { warningsFor } from './sim/warnings';
import { World } from './sim/world';
import startJson from './start.config.json';
import { getUnitType } from './units';
import { createViewer } from './viewer';

/** Longest we wait for terrain tiles under the start point before flying anyway. */
const SETTLE_TIMEOUT_MS = 10_000;
const PLAYER_ID = 'player';

async function main(): Promise<void> {
  const container = document.getElementById('cesiumContainer');
  if (!container) {
    throw new Error('Missing #cesiumContainer element in index.html');
  }

  const sim = resolveSimConfig(startJson, window.location.search);
  const { start } = sim;
  const aircraft = getAircraftType(start.aircraft);
  const model: FlightModel = { aircraft, ground: sim.ground, environment: sim.environment };
  const preset = sim.graphics.presets[sim.graphics.preset];
  if (preset === undefined) throw new Error(`unknown graphics preset "${sim.graphics.preset}"`);
  const mission = start.mission.trim() === '' ? null : getMission(start.mission);
  const earthRadius = sim.environment.earthRadius;

  const { viewer, terrainReady } = createViewer(container, sim.ion.token);
  tuneForFlight(viewer);
  applyGraphicsPreset(viewer, preset);
  setTimeOfDay(viewer, start.time);
  setCameraFov(viewer, start.fov);

  const startsOnGround = start.height <= 0;
  const input = new InputManager(window, viewer.canvas, sim.input, {
    throttleStep: aircraft.controls.throttleStep,
    hasAfterburner: aircraft.engine.afterburnerThrust > 0,
  });
  input.reset(startsOnGround);
  const clock = new SimClock(sim.simulation);
  const rig = new CameraRig(viewer, sim.camera, {
    forward: aircraft.model.cockpitForward,
    up: aircraft.model.cockpitUp,
  });
  const own = new OwnAircraft(viewer, aircraft.model);
  own.visible = rig.showsOwnAircraft;
  const buildings = new Buildings(viewer, sim.graphics.osmBuildings, sim.ion.token !== null);
  const hud = new HudCanvas(document.body, sim.hud, window);
  const debugPanel = new DebugPanel(document.body, formatLegend(legendEntries(sim.input.keys)));
  let units = sim.hud.units;
  let fps = 0;
  let tilesQueued = 0;
  viewer.scene.globe.tileLoadProgressEvent.addEventListener((queued: number) => {
    tilesQueued = queued;
  });

  // The world: the player plus whatever the mission spawns.
  const world = new World({ ground: sim.ground, environment: sim.environment }, sim.world);
  const entities = new EntityRenderer(viewer, sim.world.lodDistance, (e: Entity) => {
    if (e.kind === 'aircraft') return e.type.model;
    if (e.kind === 'ground-unit' || e.kind === 'ship') return e.type.model;
    return null;
  });
  const missionHeights = new Map<string, number>();

  /** Rebuilds the world from the start configuration and the mission. */
  const populate = (groundHeight: number): AircraftEntity => {
    world.clear();
    const player = createAircraftEntity({
      id: PLAYER_ID,
      name: 'Player',
      faction: 'player',
      type: aircraft,
      model,
      state: createInitialState(start, groundHeight, aircraft),
      controlledByPlayer: true,
      behaviour: { mode: 'straight' },
    });
    world.add(player);
    if (mission) {
      for (const e of createEntities(mission, missionHeights, {
        aircraftType: getAircraftType,
        unitType: getUnitType,
        ground: sim.ground,
        environment: sim.environment,
      })) {
        world.add(e);
      }
    }
    return player;
  };

  // Terrain height lookups are cached per frame on an ~10 m grid: many
  // entities ask every physics step and `globe.getHeight` is not free.
  const terrainCache = new Map<string, number | undefined>();
  const terrain = (lat: number, lon: number): number | undefined => {
    const key = `${lat.toFixed(4)},${lon.toFixed(4)}`;
    if (terrainCache.has(key)) return terrainCache.get(key);
    const h = loadedGroundHeight(viewer, lat, lon);
    terrainCache.set(key, h);
    return h;
  };

  const hudInfo = () => ({
    aircraftName: aircraft.name,
    cameraMode: rig.mode,
    paused: clock.paused,
    timeScale: clock.timeScale,
    devices: input.devices(),
    buildings: buildings.enabled,
    fps,
    tilesLoaded: viewer.scene.globe.tilesLoaded,
    tilesQueued,
    units,
    entities: world.entities.length - 1,
  });

  /** Draws both overlays from the state shown on screen. */
  const drawHud = (shown: AircraftState, controls: { brakes: boolean }) => {
    const forces = computeForces(shown, model);
    const warnings = warningsFor(shown, forces, model);
    const firstWaypoint = world.waypoints()[0];
    hud.draw(
      buildHudData(shown, forces, warnings, model, sim.hud, {
        pose: rig.pose(),
        cameraMode: rig.mode,
        paused: clock.paused,
        timeScale: clock.timeScale,
        units,
        brakes: controls.brakes,
        time: performance.now() / 1000,
        ...(firstWaypoint
          ? { waypointHeading: toDegrees(bearing(shown, firstWaypoint, earthRadius)) }
          : {}),
      }),
      rig.fov,
    );
    debugPanel.update(shown, forces, warnings, hudInfo());
  };

  // Provisional placement on the ellipsoid while terrain loads.
  let player = populate(0);
  let state = player.state;
  /** State one physics step behind, for render interpolation. */
  let previous = state;
  own.update(state);
  rig.update(state, 0, input.mouse.look(), input.mouse.takeOrbit());
  hud.visible = true;

  const provider = await terrainReady;
  let startGroundHeight = await sampleGroundHeight(provider, start.lat, start.lon);
  if (mission) {
    const heights = await sampleGroundHeights(provider, mission.entities);
    mission.entities.forEach((e, i) => missionHeights.set(e.id, heights[i] ?? 0));
  }
  player = populate(startGroundHeight);
  state = player.state;
  previous = state;
  console.info('[airium] config', {
    ...sim,
    ion: { token: sim.ion.token ? '(set)' : null },
    aircraft: aircraft.id,
    mission: mission?.name ?? null,
    entities: world.entities.length,
    startGroundHeight,
  });

  // Hold the aircraft at the start until the globe reports its tiles loaded
  // (or a timeout passes), so the ground under it is known from detailed
  // tiles before the simulation starts.
  const settleDeadline = performance.now() + SETTLE_TIMEOUT_MS;
  let settled = false;

  const reset = () => {
    input.reset(startsOnGround);
    player = populate(startGroundHeight);
    state = player.state;
    previous = state;
    clock.reset();
    rig.setMode(rig.mode);
  };

  let last = performance.now();

  if (import.meta.env.DEV) {
    // Console hook for debugging in the dev server: `airium.viewer`, `airium.state()`.
    Object.assign(window, { airium: { viewer, state: () => state, clock, world } });
  }

  viewer.clock.onTick.addEventListener(() => {
    const now = performance.now();
    const dt = Math.min(1, (now - last) / 1000);
    last = now;
    if (dt > 0) fps += (1 / dt - fps) * 0.1;
    terrainCache.clear();

    input.update(dt);
    for (const press of input.takePresses()) {
      switch (press) {
        case 'reset':
          reset();
          break;
        case 'pause':
          clock.togglePause();
          break;
        case 'timeFaster':
          clock.faster();
          break;
        case 'timeSlower':
          clock.slower();
          break;
        case 'camera':
          rig.next();
          break;
        case 'cameraCockpit':
          rig.setMode('cockpit');
          break;
        case 'cameraChase':
          rig.setMode('chase');
          break;
        case 'cameraOrbit':
          rig.setMode('orbit');
          break;
        case 'cameraFlyby':
          rig.setMode('flyby');
          break;
        case 'buildings':
          buildings.toggle();
          break;
        case 'units':
          units = units === 'metric' ? 'imperial' : 'metric';
          break;
        case 'debug':
          debugPanel.toggle();
          break;
      }
    }
    own.visible = rig.showsOwnAircraft;

    if (!settled) {
      const loaded = loadedGroundHeight(viewer, start.lat, start.lon);
      if (loaded !== undefined) {
        startGroundHeight = loaded;
        player = populate(startGroundHeight);
        state = player.state;
        previous = state;
      }
      settled = loaded !== undefined || now >= settleDeadline;
      if (!settled) {
        clock.reset();
        own.update(state);
        rig.update(state, dt, input.mouse.look(), input.mouse.takeOrbit());
        entities.update(world, PLAYER_ID, earthRadius);
        drawHud(state, { brakes: false });
        return;
      }
      console.info('[airium] terrain settled, ground at start:', startGroundHeight);
    }

    const controls = input.controls();
    const steps = clock.advance(dt);
    for (let i = 0; i < steps; i++) {
      previous = state;
      world.step(clock.fixedDt, controls, terrain);
      state = player.state;
    }

    // Draw a fraction of a step behind so motion is smooth regardless of how
    // many physics steps this frame happened to contain.
    const shown = interpolateState(previous, state, clock.alpha);
    own.update(shown);
    entities.update(world, PLAYER_ID, earthRadius);
    rig.update(shown, dt, input.mouse.look(), input.mouse.takeOrbit());
    drawHud(shown, controls);
  });
}

main().catch((error) => {
  console.error('[airium] failed to start', error);
  const el = document.createElement('pre');
  el.id = 'hud';
  el.className = 'crashed';
  el.textContent = `AIRIUM failed to start:\n${error instanceof Error ? error.message : String(error)}`;
  document.body.appendChild(el);
});
