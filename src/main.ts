import 'cesium/Build/Cesium/Widgets/widgets.css';
import './style.css';
import { Hud } from './hud';
import { KeyboardInput } from './input';
import { loadedGroundHeight, placeCamera, sampleGroundHeight, setCameraFov } from './sim/camera';
import { computeForces, createInitialState, step } from './sim/physics';
import { resolveSimConfig } from './sim/sim-config';
import startJson from './start.config.json';
import { createViewer } from './viewer';

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
  const startGroundHeight = await sampleGroundHeight(provider, start.lat, start.lon);
  state = createInitialState(start, startGroundHeight);
  placeCamera(viewer, state);
  console.info('[airium] config', {
    ...sim,
    ion: { token: sim.ion.token ? '(set)' : null },
    startGroundHeight,
  });

  let last = performance.now();
  let accumulator = 0;

  viewer.clock.onTick.addEventListener(() => {
    const now = performance.now();
    accumulator += Math.min(maxFrameDt, (now - last) / 1000);
    last = now;

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
