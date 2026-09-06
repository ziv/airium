import { describe, expect, it } from 'vitest';
import { getAircraftType } from '../aircraft';
import startJson from '../start.config.json';
import { hprFromAttitude } from './attitude';
import { headingError } from './geo';
import { length, toRadians } from './math3d';
import { autopilot } from './autopilot';
import { type FlightModel, createInitialState, step } from './physics';
import { validateSimConfig } from './sim-config';

const world = validateSimConfig(startJson);
const f16 = getAircraftType('f16');
const model: FlightModel = { aircraft: f16, ground: world.ground, environment: world.environment };
const DT = 1 / 60;

describe('autopilot', () => {
  it('turns to a heading, climbs to an altitude and settles on a speed', () => {
    let s = createInitialState({ lat: 32, lon: 35, height: 2000, heading: 90, speed: 200 }, 0, f16);
    const target = { heading: toRadians(200), altitude: 2600, speed: 230 };
    for (let i = 0; i < Math.round(90 / DT); i++) {
      s = step(s, autopilot(s, target, f16, world.environment.gravity), model, 0, DT);
    }
    const hpr = hprFromAttitude(s.attitude);
    expect(s.status).toBe('airborne');
    expect(Math.abs(headingError(hpr.heading, target.heading))).toBeLessThan(toRadians(3));
    expect(Math.abs(s.height - target.altitude)).toBeLessThan(60);
    expect(Math.abs(length(s.velocity) - target.speed)).toBeLessThan(15);
    expect(Math.abs(hpr.roll)).toBeLessThan(toRadians(8));
  });

  it('holds altitude through a turn', () => {
    let s = createInitialState({ lat: 32, lon: 35, height: 3000, heading: 0, speed: 220 }, 0, f16);
    let minH = Infinity;
    let maxH = -Infinity;
    for (let i = 0; i < Math.round(40 / DT); i++) {
      const heading = toRadians((i * DT * 6) % 360); // 6°/s demanded turn
      s = step(
        s,
        autopilot(s, { heading, altitude: 3000, speed: 220 }, f16, world.environment.gravity),
        model,
        0,
        DT,
      );
      minH = Math.min(minH, s.height);
      maxH = Math.max(maxH, s.height);
    }
    expect(minH).toBeGreaterThan(2850);
    expect(maxH).toBeLessThan(3150);
  });

  it('takes off from the ground with full power', () => {
    let s = createInitialState({ lat: 32, lon: 35, height: 0, heading: 90, speed: 0 }, 0, f16);
    for (let i = 0; i < Math.round(40 / DT); i++) {
      s = step(
        s,
        autopilot(
          s,
          { heading: toRadians(90), altitude: 1000, speed: 200 },
          f16,
          world.environment.gravity,
        ),
        model,
        0,
        DT,
      );
    }
    expect(s.status).toBe('airborne');
    expect(s.height).toBeGreaterThan(100);
  });
});
