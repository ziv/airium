import { describe, expect, it } from 'vitest';
import { getAircraftType } from '../aircraft';
import startJson from '../start.config.json';
import { attitudeFromHPR, hprFromAttitude } from './attitude';
import { length, toRadians, vec3 } from './math3d';
import {
  type AircraftState,
  type Controls,
  type FlightModel,
  airDensity,
  commandedAngleOfAttack,
  commandedLoadFactor,
  computeForces,
  controlAuthority,
  createInitialState,
  easeRate,
  fuelFlow,
  interpolateState,
  liftCoefficient,
  machDragFactor,
  NEUTRAL_CONTROLS,
  speedOfSound,
  step,
  thrustAvailable,
} from './physics';
import { validateSimConfig } from './sim-config';

/**
 * The shipped F-16 type over the shipped world is the reference flight model
 * for these tests, with instant control response so rate tests are exact.
 */
const world = validateSimConfig(startJson);
const f16 = getAircraftType('f16');
const trainer = getAircraftType('trainer');
const model: FlightModel = {
  aircraft: { ...f16, controls: { ...f16.controls, responseTime: 0, releaseTime: 0 } },
  ground: world.ground,
  environment: world.environment,
};
const { airframe, engine, aerodynamics: aero, limits, gear } = model.aircraft;
const env = model.environment;
const G = env.gravity;
const FULL_MASS = airframe.emptyMass + airframe.fuelCapacity;

const start = { lat: 47, lon: 11, height: 1000, heading: 90, speed: 0 };
const GROUND_HEIGHT = 500;
const DT = 1 / 120;

/** Airspeed at which CL0 alone carries the full weight at sea level. */
const cruise = Math.sqrt(
  (2 * FULL_MASS * G) / (env.seaLevelAirDensity * airframe.wingArea * airframe.liftCoefficient),
);

function airborne(speed: number, patch: Partial<AircraftState> = {}): AircraftState {
  return { ...createInitialState({ ...start, speed }, GROUND_HEIGHT, f16), ...patch };
}

function run(
  state: AircraftState,
  controls: Controls,
  seconds: number,
  ground: number | undefined = GROUND_HEIGHT,
  m: FlightModel = model,
): AircraftState {
  const steps = Math.round(seconds / DT);
  for (let i = 0; i < steps; i++) {
    state = step(state, controls, m, ground, DT);
  }
  return state;
}

describe('createInitialState', () => {
  it('starts airborne above the ground with velocity along the heading, full fuel, gear up', () => {
    const s = createInitialState({ ...start, speed: 50 }, GROUND_HEIGHT, f16);
    expect(s.height).toBe(1500);
    expect(s.status).toBe('airborne');
    expect(s.velocity.x).toBeCloseTo(50);
    expect(s.velocity.y).toBeCloseTo(0);
    expect(s.throttle).toBe(0);
    expect(s.afterburner).toBe(false);
    expect(s.fuel).toBe(airframe.fuelCapacity);
    expect(s.gear).toBe(0);
    expect(s.crashReason).toBeNull();
  });

  it('starts on the ground with the gear down when height is 0', () => {
    const s = createInitialState({ ...start, height: 0 }, GROUND_HEIGHT, f16);
    expect(s.status).toBe('ground');
    expect(s.height).toBe(GROUND_HEIGHT);
    expect(s.gear).toBe(1);
  });
});

describe('atmosphere', () => {
  it('follows the ISA speed of sound', () => {
    expect(speedOfSound(0, env)).toBeCloseTo(340.3, 0);
    expect(speedOfSound(11_000, env)).toBeCloseTo(295.1, 0);
    expect(speedOfSound(20_000, env)).toBeCloseTo(speedOfSound(11_000, env));
  });

  it('thins the air with height', () => {
    expect(airDensity(0, env)).toBe(env.seaLevelAirDensity);
    expect(airDensity(10_000, env)).toBeLessThan(0.4 * env.seaLevelAirDensity);
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

describe('machDragFactor', () => {
  it('is 1 below the onset, rises linearly and holds the peak factor', () => {
    expect(machDragFactor(0.5, aero)).toBe(1);
    expect(machDragFactor(aero.machDragOnset, aero)).toBe(1);
    const mid = (aero.machDragOnset + aero.machDragPeak) / 2;
    expect(machDragFactor(mid, aero)).toBeCloseTo((1 + aero.machDragPeakFactor) / 2);
    expect(machDragFactor(aero.machDragPeak, aero)).toBe(aero.machDragPeakFactor);
    expect(machDragFactor(2, aero)).toBe(aero.machDragPeakFactor);
  });
});

describe('thrustAvailable', () => {
  it('scales military thrust with the throttle and jumps to afterburner thrust', () => {
    expect(thrustAvailable(1, false, 1000, 0, model)).toBeCloseTo(engine.militaryThrust);
    expect(thrustAvailable(0.5, false, 1000, 0, model)).toBeCloseTo(engine.militaryThrust / 2);
    expect(thrustAvailable(0.3, true, 1000, 0, model)).toBeCloseTo(engine.afterburnerThrust);
  });

  it('falls with air density and is zero without fuel', () => {
    const ratio = airDensity(8000, env) / env.seaLevelAirDensity;
    expect(thrustAvailable(1, true, 1000, 8000, model)).toBeCloseTo(
      engine.afterburnerThrust * ratio,
    );
    expect(thrustAvailable(1, true, 0, 0, model)).toBe(0);
  });

  it('ignores the afterburner switch on an aircraft without one', () => {
    const m = { ...model, aircraft: trainer };
    expect(thrustAvailable(1, true, 100, 0, m)).toBe(trainer.engine.militaryThrust);
  });
});

describe('fuelFlow', () => {
  it('interpolates between idle and military and uses the afterburner rate when lit', () => {
    expect(fuelFlow(0, false, engine)).toBe(engine.idleFuelFlow);
    expect(fuelFlow(1, false, engine)).toBe(engine.militaryFuelFlow);
    expect(fuelFlow(0.5, false, engine)).toBeCloseTo(
      (engine.idleFuelFlow + engine.militaryFuelFlow) / 2,
    );
    expect(fuelFlow(1, true, engine)).toBe(engine.afterburnerFuelFlow);
    expect(fuelFlow(1, true, trainer.engine)).toBe(trainer.engine.militaryFuelFlow);
  });
});

describe('fly-by-wire commands', () => {
  it('maps the stick to a load factor between the configured limits', () => {
    expect(commandedLoadFactor(0, limits)).toBe(1);
    expect(commandedLoadFactor(1, limits)).toBe(limits.maxLoadFactor);
    expect(commandedLoadFactor(-1, limits)).toBe(limits.minLoadFactor);
    expect(commandedLoadFactor(0.5, limits)).toBeCloseTo((1 + limits.maxLoadFactor) / 2);
    expect(commandedLoadFactor(2, limits)).toBe(limits.maxLoadFactor);
  });

  it('asks for the angle of attack that carries the commanded g, within the limiter', () => {
    const q = 0.5 * env.seaLevelAirDensity * 250 * 250;
    const alpha = commandedAngleOfAttack(1, q, FULL_MASS, model);
    const s: AircraftState = {
      ...airborne(250),
      height: 0,
      attitude: attitudeFromHPR({ heading: toRadians(90), pitch: alpha, roll: 0 }),
    };
    expect(computeForces(s, model).loadFactor).toBeCloseTo(1, 2);
    expect(commandedAngleOfAttack(9, q, FULL_MASS, model)).toBeGreaterThan(alpha);
    // Slow: the limiter caps the demand.
    const slow = 0.5 * env.seaLevelAirDensity * 40 * 40;
    expect(commandedAngleOfAttack(9, slow, FULL_MASS, model)).toBeCloseTo(
      toRadians(limits.maxAngleOfAttack),
    );
    expect(commandedAngleOfAttack(1, 0, FULL_MASS, model)).toBe(0);
  });

  it('control authority scales with dynamic pressure up to the reference', () => {
    const ref = model.aircraft.controls.referenceDynamicPressure;
    expect(controlAuthority(0, model.aircraft.controls)).toBe(0);
    expect(controlAuthority(ref / 2, model.aircraft.controls)).toBeCloseTo(0.5);
    expect(controlAuthority(ref * 3, model.aircraft.controls)).toBe(1);
  });
});

describe('computeForces', () => {
  it('has only gravity and thrust when stationary, with the full mass', () => {
    const s = { ...createInitialState(start, GROUND_HEIGHT, f16), throttle: 1 };
    const f = computeForces(s, model);
    expect(f.lift).toEqual({ x: 0, y: 0, z: 0 });
    expect(f.drag).toEqual({ x: 0, y: 0, z: 0 });
    expect(f.mass).toBe(FULL_MASS);
    expect(f.gravity.z).toBeCloseTo(-FULL_MASS * G);
    const ratio = airDensity(s.height, env) / env.seaLevelAirDensity;
    expect(f.thrust.x).toBeCloseTo(engine.militaryThrust * ratio);
    expect(f.mach).toBe(0);
  });

  it('produces lift equal to weight at the CL0 cruise speed at sea level', () => {
    const s = airborne(cruise, { height: 0 });
    const f = computeForces(s, model);
    expect(f.angleOfAttack).toBeCloseTo(0);
    expect(f.lift.z).toBeCloseTo(FULL_MASS * G, 0);
    expect(f.loadFactor).toBeCloseTo(1, 3);
    expect(f.drag.x).toBeLessThan(0);
    expect(f.mach).toBeCloseTo(cruise / speedOfSound(0, env));
  });

  it('measures a positive angle of attack when the nose is above the velocity', () => {
    const s = airborne(50, {
      attitude: attitudeFromHPR({ heading: toRadians(90), pitch: toRadians(5), roll: 0 }),
    });
    expect(computeForces(s, model).angleOfAttack).toBeCloseTo(toRadians(5));
  });

  it('raises the drag coefficient through the transonic range', () => {
    const a = speedOfSound(0, env);
    const subsonic = computeForces(airborne(0.7 * a, { height: 0 }), model);
    const transonic = computeForces(airborne(1.05 * a, { height: 0 }), model);
    expect(transonic.mach).toBeGreaterThan(1);
    // CL0 is the same, so only the compressibility multiplier separates them.
    const clPart = aero.inducedDragFactor * airframe.liftCoefficient ** 2;
    expect(transonic.dragCoefficient - clPart).toBeCloseTo(
      (subsonic.dragCoefficient - clPart) * aero.machDragPeakFactor,
    );
  });

  it('adds gear and airbrake drag', () => {
    const clean = computeForces(airborne(150), model);
    const dirty = computeForces(airborne(150, { gear: 1, airbrake: true }), model);
    expect(dirty.dragCoefficient - clean.dragCoefficient).toBeCloseTo(
      gear.dragCoefficient + model.aircraft.airbrake.dragCoefficient,
    );
    expect(length(dirty.drag)).toBeGreaterThan(length(clean.drag));
  });
});

describe('step', () => {
  const FULL_AB: Controls = { ...NEUTRAL_CONTROLS, throttle: 1, afterburner: true };

  it('falls under gravity from rest', () => {
    const s = run(createInitialState(start, GROUND_HEIGHT, f16), NEUTRAL_CONTROLS, 1);
    expect(s.velocity.z).toBeCloseTo(-G, 0);
    expect(s.height).toBeLessThan(1500);
  });

  it('rolls at the configured rate with full authority', () => {
    const s = run(airborne(200), { ...NEUTRAL_CONTROLS, roll: 1 }, 0.25);
    expect(hprFromAttitude(s.attitude).roll).toBeCloseTo(
      toRadians(model.aircraft.controls.rollRate / 4),
      1,
    );
  });

  it('uses the roll rate from the config, not a built-in constant', () => {
    const slow: FlightModel = {
      ...model,
      aircraft: { ...model.aircraft, controls: { ...model.aircraft.controls, rollRate: 120 } },
    };
    const s = run(airborne(200), { ...NEUTRAL_CONTROLS, roll: 1 }, 0.25, GROUND_HEIGHT, slow);
    expect(hprFromAttitude(s.attitude).roll).toBeCloseTo(toRadians(30), 1);
  });

  it('goes soft at low speed: the roll rate scales with dynamic pressure', () => {
    const q = 0.5 * airDensity(1500, env) * 40 * 40;
    const expected =
      toRadians(model.aircraft.controls.rollRate) *
      (q / model.aircraft.controls.referenceDynamicPressure);
    const s = run(airborne(40), { ...NEUTRAL_CONTROLS, roll: 1 }, 0.25);
    expect(hprFromAttitude(s.attitude).roll).toBeCloseTo(expected * 0.25, 1);
    expect(hprFromAttitude(s.attitude).roll).toBeLessThan(toRadians(20));
  });

  it('builds the roll rate up gradually with a response time, per config', () => {
    const smooth: FlightModel = {
      ...model,
      aircraft: {
        ...model.aircraft,
        controls: { ...model.aircraft.controls, responseTime: 0.5, releaseTime: 0.5 },
      },
    };
    let s = airborne(200);
    const max = toRadians(smooth.aircraft.controls.rollRate);
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
    for (let i = 1; i < rateAt.length; i++)
      expect(rateAt[i]).toBeGreaterThanOrEqual(rateAt[i - 1]!);
  });

  it('easeRate is instant when the time constants are zero', () => {
    expect(easeRate(0, 1, 0, 0, DT)).toBe(1);
    expect(easeRate(1, 0, 0, 0, DT)).toBe(0);
  });

  it('uses gravity from the config', () => {
    const moon: FlightModel = { ...model, environment: { ...env, gravity: 1.62 } };
    const s = run(
      createInitialState(start, GROUND_HEIGHT, f16),
      NEUTRAL_CONTROLS,
      1,
      GROUND_HEIGHT,
      moon,
    );
    expect(s.velocity.z).toBeCloseTo(-1.62, 1);
  });

  it('holds 1 g and level flight with the stick neutral', () => {
    let s = airborne(250);
    let maxAbsVz = 0;
    for (let i = 0; i < Math.round(10 / DT); i++) {
      s = step(s, { ...NEUTRAL_CONTROLS, throttle: 0.8 }, model, GROUND_HEIGHT, DT);
      maxAbsVz = Math.max(maxAbsVz, Math.abs(s.velocity.z));
    }
    expect(s.status).toBe('airborne');
    expect(maxAbsVz).toBeLessThan(10);
    expect(Math.abs(s.velocity.z)).toBeLessThan(3);
    expect(s.loadFactor).toBeCloseTo(1, 1);
    expect(Math.abs(hprFromAttitude(s.attitude).roll)).toBeLessThan(toRadians(2));
  });

  it('pulls the commanded load factor with full back stick and remembers the peak', () => {
    let s = airborne(300);
    let seen = 0;
    for (let i = 0; i < Math.round(3 / DT); i++) {
      s = step(s, { ...FULL_AB, pitch: 1 }, model, GROUND_HEIGHT, DT);
      seen = Math.max(seen, s.loadFactor);
    }
    expect(s.loadFactor).toBeCloseTo(limits.maxLoadFactor, 0);
    expect(seen).toBeLessThan(limits.maxLoadFactor + 0.5);
    expect(s.peakLoadFactor).toBeCloseTo(seen);
  });

  it('pushes to the negative limit with full forward stick', () => {
    const s = run(airborne(300), { ...FULL_AB, pitch: -1 }, 2);
    expect(s.loadFactor).toBeCloseTo(limits.minLoadFactor, 0);
  });

  it('respects the angle-of-attack limiter when too slow for the commanded g', () => {
    let s = airborne(60);
    let maxAoa = 0;
    let maxG = 0;
    for (let i = 0; i < Math.round(3 / DT); i++) {
      s = step(s, { ...NEUTRAL_CONTROLS, pitch: 1 }, model, GROUND_HEIGHT, DT);
      const f = computeForces(s, model);
      maxAoa = Math.max(maxAoa, f.angleOfAttack);
      maxG = Math.max(maxG, f.loadFactor);
    }
    expect(maxAoa).toBeLessThanOrEqual(toRadians(limits.maxAngleOfAttack) + toRadians(1));
    expect(maxG).toBeLessThan(limits.maxLoadFactor / 2);
    // Held at the limiter without the lift to match: the aircraft sinks and the nose comes down with it.
    expect(s.velocity.z).toBeLessThan(0);
    expect(hprFromAttitude(s.attitude).pitch).toBeLessThan(toRadians(limits.maxAngleOfAttack));
  });

  it('burns fuel by throttle stage and the afterburner state is reported', () => {
    const mil = run(airborne(250), { ...NEUTRAL_CONTROLS, throttle: 1 }, 10);
    expect(airframe.fuelCapacity - mil.fuel).toBeCloseTo(engine.militaryFuelFlow * 10, 1);
    expect(mil.afterburner).toBe(false);
    const ab = run(airborne(250), FULL_AB, 10);
    expect(airframe.fuelCapacity - ab.fuel).toBeCloseTo(engine.afterburnerFuelFlow * 10, 1);
    expect(ab.afterburner).toBe(true);
  });

  it('flames out at zero fuel: no thrust, afterburner off', () => {
    let s = run(airborne(250, { fuel: 1 }), FULL_AB, 1);
    expect(s.fuel).toBe(0);
    expect(s.afterburner).toBe(false);
    expect(computeForces(s, model).thrustMagnitude).toBe(0);
    const before = length(s.velocity);
    s = run(s, FULL_AB, 5);
    expect(length(s.velocity)).toBeLessThan(before);
  });

  it('takes off: accelerates on the wheels, rotates and climbs', () => {
    let s = createInitialState({ ...start, height: 0 }, GROUND_HEIGHT, f16);
    s = run(s, FULL_AB, 8);
    expect(s.status).toBe('ground');
    expect(s.velocity.x).toBeGreaterThan(60);
    expect(s.velocity.y).toBeCloseTo(0, 3);
    expect(s.height).toBe(GROUND_HEIGHT);
    expect(s.lon).toBeGreaterThan(start.lon);
    s = run(s, { ...FULL_AB, pitch: 1 }, 12);
    expect(s.status).toBe('airborne');
    expect(s.height).toBeGreaterThan(GROUND_HEIGHT + 50);
  });

  it('gear-up on the runway is a crash; gear-down is a landing', () => {
    const sink = { height: GROUND_HEIGHT + 0.5, velocity: vec3(70, 0, -1) };
    const wheelsUp = run(airborne(70, { ...sink, gear: 0 }), NEUTRAL_CONTROLS, 1);
    expect(wheelsUp.status).toBe('crashed');
    expect(wheelsUp.crashReason).toBe('gear-up landing');
    const wheelsDown = run(
      airborne(70, { ...sink, gear: 1 }),
      { ...NEUTRAL_CONTROLS, gearDown: true },
      1,
    );
    expect(wheelsDown.status).toBe('ground');
    expect(wheelsDown.height).toBe(GROUND_HEIGHT);
    expect(hprFromAttitude(wheelsDown.attitude).roll).toBeCloseTo(0);
  });

  it('moves the gear over the transit time', () => {
    let s = airborne(150);
    s = run(s, { ...NEUTRAL_CONTROLS, gearDown: true }, gear.transitTime / 2);
    expect(s.gear).toBeCloseTo(0.5, 1);
    s = run(s, { ...NEUTRAL_CONTROLS, gearDown: true }, gear.transitTime);
    expect(s.gear).toBe(1);
    s = run(s, { ...NEUTRAL_CONTROLS, gearDown: false }, gear.transitTime * 1.5);
    expect(s.gear).toBe(0);
  });

  it('wheel brakes stop the aircraft; rolling friction alone barely slows it', () => {
    const rolling = createInitialState({ ...start, height: 0, speed: 30 }, GROUND_HEIGHT, f16);
    const braked = run(rolling, { ...NEUTRAL_CONTROLS, gearDown: true, brakes: true }, 12);
    expect(length(braked.velocity)).toBe(0);
    const coasting = run(rolling, { ...NEUTRAL_CONTROLS, gearDown: true }, 5);
    expect(length(coasting.velocity)).toBeGreaterThan(25);
  });

  it('slows to a stop on the ground with no throttle', () => {
    const s = run(
      createInitialState({ ...start, height: 0, speed: 3 }, GROUND_HEIGHT, f16),
      NEUTRAL_CONTROLS,
      30,
    );
    expect(length(s.velocity)).toBe(0);
  });

  it('crashes on a hard impact with a reason', () => {
    const s = run(
      airborne(0, { height: GROUND_HEIGHT + 0.5, velocity: vec3(0, 0, -20) }),
      NEUTRAL_CONTROLS,
      0.5,
    );
    expect(s.status).toBe('crashed');
    expect(s.crashReason).toBe('hard landing');
    expect(s.height).toBe(GROUND_HEIGHT);
  });

  it('freezes once crashed', () => {
    const crashed: AircraftState = { ...airborne(0), status: 'crashed' };
    expect(step(crashed, FULL_AB, model, GROUND_HEIGHT, DT)).toBe(crashed);
  });

  it('uses the last known ground height when the terrain is not loaded', () => {
    const s = run(
      airborne(0, { height: GROUND_HEIGHT + 0.01, velocity: vec3(0, 0, -0.5), gear: 1 }),
      { ...NEUTRAL_CONTROLS, gearDown: true },
      0.5,
      undefined,
    );
    expect(s.status).toBe('ground');
    expect(s.groundHeight).toBe(GROUND_HEIGHT);
  });

  it('the nose follows the velocity vector in flight (stability)', () => {
    let s = airborne(100, {
      attitude: attitudeFromHPR({ heading: toRadians(90), pitch: toRadians(20), roll: 0 }),
    });
    const before = hprFromAttitude(s.attitude).pitch;
    s = run(s, NEUTRAL_CONTROLS, 0.5);
    expect(hprFromAttitude(s.attitude).pitch).toBeLessThan(before);
  });

  it('exceeds Mach 1 in a full-afterburner dive from altitude', () => {
    let s = airborne(250, { height: 8000 });
    let maxMach = 0;
    for (let i = 0; i < Math.round(40 / DT); i++) {
      s = step(s, { ...FULL_AB, pitch: -0.3 }, model, 0, DT);
      maxMach = Math.max(maxMach, computeForces(s, model).mach);
      if (s.status !== 'airborne') break;
    }
    expect(maxMach).toBeGreaterThan(1);
  });
});

describe('interpolateState', () => {
  it('blends position, velocity and attitude and takes discrete fields from the newer state', () => {
    const a = airborne(100, { lat: 10, lon: 20, height: 1000, gear: 0 });
    const b: AircraftState = {
      ...a,
      lat: 11,
      lon: 21,
      height: 1200,
      velocity: vec3(120, 0, 0),
      attitude: attitudeFromHPR({ heading: toRadians(90), pitch: toRadians(20), roll: 0 }),
      gear: 0.5,
      fuel: 100,
    };
    const mid = interpolateState(a, b, 0.5);
    expect(mid.lat).toBe(10.5);
    expect(mid.lon).toBe(20.5);
    expect(mid.height).toBe(1100);
    expect(mid.velocity.x).toBe(110);
    expect(hprFromAttitude(mid.attitude).pitch).toBeCloseTo(toRadians(10), 2);
    expect(mid.gear).toBe(0.5);
    expect(mid.fuel).toBe(100);
    expect(interpolateState(a, b, 0)).toBe(a);
    expect(interpolateState(a, b, 1)).toBe(b);
  });

  it('crosses the antimeridian the short way', () => {
    const a = airborne(100, { lon: 179.9 });
    const b = { ...a, lon: -179.9 };
    expect(interpolateState(a, b, 0.5).lon).toBeCloseTo(180);
  });
});
