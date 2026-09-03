import 'cesium/Build/Cesium/Widgets/widgets.css';
import './style.css';
import { Hud } from './hud';
import { KeyboardInput } from './input';
import { loadedGroundHeight, placeCamera, sampleGroundHeight, setCameraFov } from './sim/camera';
import { computeForces, createInitialState, step } from './sim/physics';
import { resolveSimConfig } from './sim/sim-config';
import startJson from './start.config.json';
import { createViewer } from './viewer';

/** Longest we wait for terrain tiles under the start point before flying anyway. */
const SETTLE_TIMEOUT_MS = 10_000;

async function main(): Promise<void> {
  const container = document.getElementById('cesiumContainer');
  if (!container) {
    throw new Error('Missing #cesiumContainer element in index.html');
  }

  const sim = resolveSimConfig(startJson, window.location.search);
  const { start } = sim;
  const fixedDt = 1 / sim.simulation.physicsHz;
  const maxFrameDt = sim.simulation.maxFrameSeconds;

  const { viewer, terrainReady } = createViewer(container, sim.ion.token);
  setCameraFov(viewer, start.fov);

  const input = new KeyboardInput(window, sim.controls.throttleStep);
  const hud = new Hud(document.body);

  // Provisional placement on the ellipsoid while terrain loads.
  let state = createInitialState(start, 0);
  placeCamera(viewer, state);

  const provider = await terrainReady;
  let startGroundHeight = await sampleGroundHeight(provider, start.lat, start.lon);
  state = createInitialState(start, startGroundHeight);
  placeCamera(viewer, state);
  console.info('[airium] config', {
    ...sim,
    ion: { token: sim.ion.token ? '(set)' : null },
    startGroundHeight,
  });

  // Hold the aircraft at the start until the globe reports its tiles loaded
  // (or a timeout passes), so the ground under it is known from detailed
  // tiles before the simulation starts.
  const settleDeadline = performance.now() + SETTLE_TIMEOUT_MS;
  let settled = false;

  let last = performance.now();
  let accumulator = 0;

  viewer.clock.onTick.addEventListener(() => {
    const now = performance.now();
    accumulator += Math.min(maxFrameDt, (now - last) / 1000);
    last = now;

    if (!settled) {
      const loaded = loadedGroundHeight(viewer, start.lat, start.lon);
      if (loaded !== undefined) {
        startGroundHeight = loaded;
        state = createInitialState(start, startGroundHeight);
        placeCamera(viewer, state);
      }
      settled = loaded !== undefined || now >= settleDeadline;
      if (!settled) {
        accumulator = 0;
        hud.update(state, computeForces(state, sim));
        return;
      }
      console.info('[airium] terrain settled, ground at start:', startGroundHeight);
    }

    if (input.consumeReset()) {
      input.throttle = 0;
      state = createInitialState(start, startGroundHeight);
      accumulator = 0;
    }

    const controls = input.controls();
    const terrainHeight = loadedGroundHeight(viewer, state.lat, state.lon);
    while (accumulator >= fixedDt) {
      state = step(state, controls, sim, terrainHeight, fixedDt);
      accumulator -= fixedDt;
    }

    placeCamera(viewer, state);
    hud.update(state, computeForces(state, sim));
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
