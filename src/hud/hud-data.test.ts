import { describe, expect, it } from 'vitest';
import { getAircraftType } from '../aircraft';
import startJson from '../start.config.json';
import { attitudeFromHPR } from '../sim/attitude';
import { toRadians, vec3 } from '../sim/math3d';
import {
  type AircraftState,
  type FlightModel,
  computeForces,
  createInitialState,
} from '../sim/physics';
import { validateSimConfig } from '../sim/sim-config';
import { warningsFor } from '../sim/warnings';
import { type HudExtras, buildHudData } from './hud-data';
import { projectDirection } from './projection';

const world = validateSimConfig(startJson);
const f16 = getAircraftType('f16');
const model: FlightModel = { aircraft: f16, ground: world.ground, environment: world.environment };
const start = { lat: 32, lon: 35, height: 1000, heading: 90, speed: 200 };

function data(state: AircraftState, extras: Partial<HudExtras> = {}) {
  const forces = computeForces(state, model);
  return buildHudData(state, forces, warningsFor(state, forces, model), model, world.hud, {
    pose: state.attitude,
    cameraMode: 'cockpit',
    paused: false,
    timeScale: 1,
    units: 'imperial',
    brakes: false,
    time: 0,
    ...extras,
  });
}

describe('buildHudData', () => {
  it('reads the same numbers the debug panel shows', () => {
    const s = createInitialState(start, 0, f16);
    const d = data(s);
    expect(d.airspeed).toBeCloseTo(200);
    expect(d.altitude).toBe(1000);
    expect(d.agl).toBe(1000);
    expect(d.heading).toBeCloseTo(toRadians(90));
    expect(d.fuel).toBe(f16.airframe.fuelCapacity);
    expect(d.warnings).toEqual([]);
    expect(d.target).toBeUndefined();
  });

  it('puts the flight-path marker below the boresight at high angle of attack', () => {
    const s: AircraftState = {
      ...createInitialState(start, 0, f16),
      attitude: attitudeFromHPR({ heading: toRadians(90), pitch: toRadians(12), roll: 0 }),
    };
    const d = data(s);
    const vp = { width: 1600, height: 900, fov: toRadians(60) };
    const nose = projectDirection(d.boresight, d.pose, vp);
    const fpm = projectDirection(d.flightPath, d.pose, vp);
    expect(nose.y).toBeCloseTo(450);
    expect(fpm.y).toBeGreaterThan(nose.y + 50);
    expect(fpm.x).toBeCloseTo(nose.x);
  });

  it('uses the nose as the flight path when too slow to fly', () => {
    const s = createInitialState({ ...start, height: 0, speed: 0 }, 0, f16);
    expect(data(s).flightPath).toEqual(s.attitude.forward);
  });

  it('adds PULL UP first when the ground is close', () => {
    const s: AircraftState = {
      ...createInitialState(start, 0, f16),
      height: 60,
      velocity: vec3(200, 0, -30),
      gear: 1,
    };
    const d = data(s);
    expect(d.warnings[0]).toBe('PULL UP');
    expect(d.warnings).toContain('GEAR SPEED');
  });

  it('passes through extras and optional symbology', () => {
    const s = createInitialState(start, 0, f16);
    const d = data(s, {
      paused: true,
      units: 'metric',
      target: { direction: vec3(1, 0, 0), range: 5000, closure: 100, locked: true },
      weapon: 'GUN 510',
      waypointHeading: 45,
    });
    expect(d.paused).toBe(true);
    expect(d.units).toBe('metric');
    expect(d.target?.range).toBe(5000);
    expect(d.weapon).toBe('GUN 510');
    expect(d.waypointHeading).toBe(45);
  });
});
