import { describe, expect, it } from 'vitest';
import { attitudeFromHPR, hprFromAttitude } from './attitude';
import { length, toRadians, vec3 } from './math3d';
import {
  type AircraftState,
  type Controls,
  type FlightModel,
  computeForces,
  createInitialState,
  easeRate,
  liftCoefficient,
  NEUTRAL_CONTROLS,
  step,
  trimAngleOfAttack,
} from './physics';
import { type StartConfig, validateSimConfig } from './sim-config';
import startJson from '../start.config.json';

/**
 * The shipped configuration is the reference flight model for these tests,
 * with instant control response so rate tests are exact.
 */
const shipped = validateSimConfig(startJson);
const model: FlightModel = {
  ...shipped,
  controls: { ...shipped.controls, responseTime: 0, releaseTime: 0 },
};
const { aircraft, aerodynamics: aero, environment: env } = model;
const G = env.gravity;

const start: StartConfig = { lat: 47, lon: 11, height: 1000, heading: 90, speed: 0, fov: 60 };
const GROUND_HEIGHT = 500;
const DT = 1 / 120;

function run(
  state: AircraftState,
  controls: Controls,
  seconds: number,
  ground: number | undefined = GROUND_HEIGHT,
): AircraftState {
  const steps = Math.round(seconds / DT);
  for (let i = 0; i < steps; i++) {
    state = step(state, controls, model, ground, DT);
  }
  return state;
}

describe('createInitialState', () => {
  it('starts airborne above the ground with velocity along the heading', () => {
    const s = createInitialState({ ...start, speed: 50 }, GROUND_HEIGHT);
    expect(s.height).toBe(1500);
    expect(s.status).toBe('airborne');
    expect(s.velocity.x).toBeCloseTo(50);
    expect(s.velocity.y).toBeCloseTo(0);
    expect(s.throttle).toBe(0);
  });

  it('starts on the ground when height is 0', () => {
    const s = createInitialState({ ...start, height: 0 }, GROUND_HEIGHT);
    expect(s.status).toBe('ground');
    expect(s.height).toBe(GROUND_HEIGHT);
  });
});

describe('liftCoefficient', () => {
  it('is the configured value at zero angle of attack', () => {
    expect(liftCoefficient(0.4, 0, aero)).toBe(0.4);
  });

  it('increases up to the stall angle then decays to zero at the configured angles', () => {
    const stall = toRadians(aero.stallAngle);
    const zero = toRadians(aero.zeroLiftAngle);
    const atStall = liftCoefficient(0.4, stall, aero);
    expect(atStall).toBeCloseTo(0.4 + aero.liftSlope * stall);
    expect(atStall).toBeGreaterThan(liftCoefficient(0.4, stall * 0.6, aero));
    expect(liftCoefficient(0.4, (stall + zero) / 2, aero)).toBeCloseTo(atStall / 2);
    expect(liftCoefficient(0.4, zero, aero)).toBe(0);
    expect(liftCoefficient(0.4, toRadians(90), aero)).toBe(0);
  });

  it('honours a different lift slope and stall angle from config', () => {
    const custom = { ...aero, liftSlope: 2, stallAngle: 10, zeroLiftAngle: 20 };
    expect(liftCoefficient(0.1, toRadians(10), custom)).toBeCloseTo(0.1 + 2 * toRadians(10));
    expect(liftCoefficient(0.1, toRadians(20), custom)).toBe(0);
  });
});

describe('computeForces', () => {
  it('has only gravity and thrust when stationary', () => {
    const s = { ...createInitialState(start, GROUND_HEIGHT), throttle: 1 };
    const f = computeForces(s, model);
    expect(f.lift).toEqual({ x: 0, y: 0, z: 0 });
    expect(f.drag).toEqual({ x: 0, y: 0, z: 0 });
    expect(f.gravity.z).toBeCloseTo(-aircraft.weight * G);
    expect(f.thrust.x).toBeCloseTo(aircraft.maxThrust);
  });

  it('produces lift roughly equal to weight at the cruise speed for CL0', () => {
    // v = sqrt(2 W / (rho S CL)) at sea level-ish; use height 0 for exact density.
    const cruise = Math.sqrt(
      (2 * aircraft.weight * G) /
        (env.seaLevelAirDensity * aircraft.wingArea * aircraft.liftCoefficient),
    );
    const s: AircraftState = {
      ...createInitialState({ ...start, speed: cruise }, 0),
      height: 0,
    };
    const f = computeForces(s, model);
    expect(f.angleOfAttack).toBeCloseTo(0);
    expect(f.lift.z).toBeCloseTo(aircraft.weight * G, 0);
    expect(f.drag.x).toBeLessThan(0);
  });

  it('measures a positive angle of attack when the nose is above the velocity', () => {
    const s: AircraftState = {
      ...createInitialState({ ...start, speed: 50 }, GROUND_HEIGHT),
      attitude: attitudeFromHPR({ heading: toRadians(90), pitch: toRadians(5), roll: 0 }),
    };
    expect(computeForces(s, model).angleOfAttack).toBeCloseTo(toRadians(5));
  });
});

describe('step', () => {
  it('falls under gravity from rest', () => {
    const s = run(createInitialState(start, GROUND_HEIGHT), NEUTRAL_CONTROLS, 1);
    expect(s.velocity.z).toBeCloseTo(-G, 0);
    expect(s.height).toBeLessThan(1500);
  });

  it('rolls right at the configured control rate while the key is held', () => {
    const s = run(
      createInitialState({ ...start, speed: 50 }, GROUND_HEIGHT),
      { ...NEUTRAL_CONTROLS, roll: 1 },
      0.5,
    );
    expect(hprFromAttitude(s.attitude).roll).toBeCloseTo(toRadians(model.controls.rollRate / 2), 1);
  });

  it('uses the roll rate from the config, not a built-in constant', () => {
    const fast: FlightModel = { ...model, controls: { ...model.controls, rollRate: 120 } };
    let s = createInitialState({ ...start, speed: 50 }, GROUND_HEIGHT);
    for (let i = 0; i < Math.round(0.5 / DT); i++) {
      s = step(s, { ...NEUTRAL_CONTROLS, roll: 1 }, fast, GROUND_HEIGHT, DT);
    }
    expect(hprFromAttitude(s.attitude).roll).toBeCloseTo(toRadians(60), 1);
  });

  it('builds the roll rate up gradually with a response time, per config', () => {
    const smooth: FlightModel = {
      ...model,
      controls: { ...model.controls, responseTime: 0.5, releaseTime: 0.5 },
    };
    let s = createInitialState({ ...start, speed: 50 }, GROUND_HEIGHT);
    const max = toRadians(smooth.controls.rollRate);
    const rateAt: number[] = [];
    for (let i = 0; i < Math.round(1.5 / DT); i++) {
      s = step(s, { ...NEUTRAL_CONTROLS, roll: 1 }, smooth, GROUND_HEIGHT, DT);
      rateAt.push(s.bodyRates.roll);
    }
    const at = (t: number) => rateAt[Math.round(t / DT) - 1] ?? 0;
    expect(at(0.1)).toBeGreaterThan(0);
    expect(at(0.1)).toBeLessThan(0.25 * max);
    expect(at(0.5)).toBeCloseTo(max * (1 - Math.exp(-1)), 1);
    expect(at(1.5)).toBeCloseTo(max * (1 - Math.exp(-3)), 1);
    // Rate only ever increases while the key is held.
    for (let i = 1; i < rateAt.length; i++)
      expect(rateAt[i]).toBeGreaterThanOrEqual(rateAt[i - 1]!);
  });

  it('keeps rolling after the key is released and decays with the release time', () => {
    const smooth: FlightModel = {
      ...model,
      controls: { ...model.controls, responseTime: 0.2, releaseTime: 1 },
    };
    let s = createInitialState({ ...start, speed: 50 }, GROUND_HEIGHT);
    for (let i = 0; i < Math.round(2 / DT); i++) {
      s = step(s, { ...NEUTRAL_CONTROLS, roll: 1 }, smooth, GROUND_HEIGHT, DT);
    }
    const rollAtRelease = hprFromAttitude(s.attitude).roll;
    const rateAtRelease = s.bodyRates.roll;
    for (let i = 0; i < Math.round(1 / DT); i++) {
      s = step(s, NEUTRAL_CONTROLS, smooth, GROUND_HEIGHT, DT);
    }
    expect(hprFromAttitude(s.attitude).roll).toBeGreaterThan(rollAtRelease + toRadians(10));
    expect(s.bodyRates.roll).toBeGreaterThan(0);
    expect(s.bodyRates.roll).toBeCloseTo(rateAtRelease * Math.exp(-1), 1);
  });

  it('easeRate is instant when the time constants are zero', () => {
    expect(easeRate(0, 1, 0, 0, DT)).toBe(1);
    expect(easeRate(1, 0, 0, 0, DT)).toBe(0);
  });

  it('uses gravity from the config', () => {
    const moon: FlightModel = { ...model, environment: { ...env, gravity: 1.62 } };
    let s = createInitialState(start, GROUND_HEIGHT);
    for (let i = 0; i < Math.round(1 / DT); i++) {
      s = step(s, NEUTRAL_CONTROLS, moon, GROUND_HEIGHT, DT);
    }
    expect(s.velocity.z).toBeCloseTo(-1.62, 1);
  });

  it('accelerates along the runway under full throttle and lifts off', () => {
    let s = createInitialState({ ...start, height: 0 }, GROUND_HEIGHT);
    s = run(s, { ...NEUTRAL_CONTROLS, throttle: 1 }, 5);
    expect(s.status).toBe('ground');
    expect(s.velocity.x).toBeGreaterThan(5);
    expect(s.velocity.y).toBeCloseTo(0, 3);
    expect(s.height).toBe(GROUND_HEIGHT);
    expect(s.lon).toBeGreaterThan(start.lon);

    s = run(s, { ...NEUTRAL_CONTROLS, throttle: 1 }, 40);
    expect(s.status).toBe('airborne');
    expect(s.height).toBeGreaterThan(GROUND_HEIGHT + 1);
  });

  it('slows to a stop on the ground with no throttle', () => {
    let s = createInitialState({ ...start, height: 0, speed: 3 }, GROUND_HEIGHT);
    s = run(s, NEUTRAL_CONTROLS, 30);
    expect(length(s.velocity)).toBe(0);
  });

  it('lands softly and switches to ground status', () => {
    let s: AircraftState = {
      ...createInitialState({ ...start, speed: 30 }, GROUND_HEIGHT),
      height: GROUND_HEIGHT + 0.5,
      velocity: vec3(30, 0, -1),
    };
    s = run(s, NEUTRAL_CONTROLS, 1);
    expect(s.status).toBe('ground');
    expect(s.height).toBe(GROUND_HEIGHT);
    expect(hprFromAttitude(s.attitude).roll).toBeCloseTo(0);
  });

  it('crashes on a hard impact', () => {
    let s: AircraftState = {
      ...createInitialState(start, GROUND_HEIGHT),
      height: GROUND_HEIGHT + 0.5,
      velocity: vec3(0, 0, -20),
    };
    s = run(s, NEUTRAL_CONTROLS, 0.5);
    expect(s.status).toBe('crashed');
    expect(s.height).toBe(GROUND_HEIGHT);
  });

  it('freezes once crashed', () => {
    const crashed: AircraftState = {
      ...createInitialState(start, GROUND_HEIGHT),
      status: 'crashed',
    };
    expect(step(crashed, { ...NEUTRAL_CONTROLS, throttle: 1 }, model, GROUND_HEIGHT, DT)).toBe(
      crashed,
    );
  });

  it('uses the last known ground height when the terrain is not loaded', () => {
    let s: AircraftState = {
      ...createInitialState(start, GROUND_HEIGHT),
      height: GROUND_HEIGHT + 0.01,
      velocity: vec3(0, 0, -0.5),
    };
    s = run(s, NEUTRAL_CONTROLS, 0.5, undefined);
    expect(s.status).toBe('ground');
    expect(s.groundHeight).toBe(GROUND_HEIGHT);
  });

  it('trims to level flight with neutral controls at high speed instead of looping', () => {
    let s = createInitialState({ ...start, speed: 200 }, GROUND_HEIGHT);
    let maxAbsVz = 0;
    for (let i = 0; i < Math.round(10 / DT); i++) {
      s = step(s, NEUTRAL_CONTROLS, model, GROUND_HEIGHT, DT);
      maxAbsVz = Math.max(maxAbsVz, Math.abs(s.velocity.z));
    }
    expect(s.status).toBe('airborne');
    // Brief transient while the nose rotates to the trim angle, then level.
    expect(maxAbsVz).toBeLessThan(15);
    expect(Math.abs(s.velocity.z)).toBeLessThan(6);
    expect(Math.abs(hprFromAttitude(s.attitude).roll)).toBeLessThan(toRadians(5));
    expect(Math.abs(hprFromAttitude(s.attitude).pitch)).toBeLessThan(toRadians(10));
    expect(computeForces(s, model).angleOfAttack).toBeLessThan(0);
  });

  it('trim angle of attack is ~0 at the CL0 cruise speed and negative when faster', () => {
    const cruise = Math.sqrt(
      (2 * aircraft.weight * G) /
        (env.seaLevelAirDensity * aircraft.wingArea * aircraft.liftCoefficient),
    );
    const s = { ...createInitialState({ ...start, speed: cruise }, 0), height: 0 };
    expect(trimAngleOfAttack(s, cruise, model)).toBeCloseTo(0, 3);
    expect(trimAngleOfAttack(s, cruise * 2, model)).toBeLessThan(0);
    expect(trimAngleOfAttack(s, cruise / 3, model)).toBeCloseTo(toRadians(aero.stallAngle));
    const noTrim = { ...model, aerodynamics: { ...aero, trimLoadFactor: 0 } };
    expect(trimAngleOfAttack(s, cruise * 2, noTrim)).toBe(0);
  });

  it('the nose follows the velocity vector in flight (stability)', () => {
    let s: AircraftState = {
      ...createInitialState({ ...start, speed: 60 }, GROUND_HEIGHT),
      attitude: attitudeFromHPR({ heading: toRadians(90), pitch: toRadians(20), roll: 0 }),
    };
    const before = hprFromAttitude(s.attitude).pitch;
    s = run(s, NEUTRAL_CONTROLS, 0.5);
    const after = hprFromAttitude(s.attitude).pitch;
    expect(after).toBeLessThan(before);
  });
});
