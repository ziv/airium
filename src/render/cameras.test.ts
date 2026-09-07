import { expect, it } from 'vitest';
import { Cartesian3, PerspectiveFrustum, type Viewer } from 'cesium';
import { CameraRig } from './cameras';
import { enuFrame, enuPoint, aircraftPosition } from './frames';
import { getAircraftType } from '../aircraft';
import { createInitialState } from '../sim/physics';
import { validateSimConfig } from '../sim/sim-config';
import start from '../start.config.json';
import { vec3 } from '../sim/math3d';

it('padlocks a target ahead, overhead and behind through a merge with a finite orthogonal up vector', () => {
  const sim = validateSimConfig(start),
    type = getAircraftType('f16');
  const state = createInitialState({ ...sim.start, height: 5000, heading: 0, speed: 250 }, 0, type);
  let view:
    { destination: Cartesian3; orientation: { direction: Cartesian3; up: Cartesian3 } } | undefined;
  const viewer = {
    camera: {
      frustum: new PerspectiveFrustum(),
      setView: (v: NonNullable<typeof view>) => {
        view = v;
      },
    },
  } as unknown as Viewer;
  const rig = new CameraRig(viewer, sim.camera, { forward: 0, up: 0 });
  rig.setMode('padlock');
  expect(rig.showsOwnAircraft).toBe(false);
  const frame = enuFrame(aircraftPosition(state));
  for (const target of [vec3(0, 1000, 0), vec3(0, 0, 1000), vec3(0, -1000, 0)]) {
    rig.update(state, 1 / 60, { yaw: 0, pitch: 0 }, { azimuth: 0, elevation: 0, zoom: 1 }, target);
    expect(view).toBeDefined();
    const direction = Cartesian3.normalize(
      Cartesian3.subtract(enuPoint(frame, target), view!.destination, new Cartesian3()),
      new Cartesian3(),
    );
    expect(Cartesian3.dot(direction, view!.orientation.direction)).toBeCloseTo(1, 8);
    expect(Cartesian3.magnitude(view!.orientation.up)).toBeCloseTo(1, 8);
    expect(Cartesian3.dot(direction, view!.orientation.up)).toBeCloseTo(0, 8);
  }
  rig.update(state, 1 / 60, { yaw: 0, pitch: 0 }, { azimuth: 0, elevation: 0, zoom: 1 });
  expect(Number.isFinite(view!.orientation.direction.x)).toBe(true);
});
