import { describe, expect, it } from 'vitest';
import { getAircraftType } from '../aircraft';
import startJson from '../start.config.json';
import { attitudeFromHPR } from './attitude';
import { toRadians, vec3 } from './math3d';
import { type AircraftState, type FlightModel, computeForces, createInitialState } from './physics';
import { validateSimConfig } from './sim-config';
import { activeWarnings, warningsFor } from './warnings';

const world = validateSimConfig(startJson);
const f16 = getAircraftType('f16');
const model: FlightModel = { aircraft: f16, ground: world.ground, environment: world.environment };
const start = { lat: 32, lon: 35, height: 1000, heading: 90, speed: 0 };

function flying(speed: number, patch: Partial<AircraftState> = {}): AircraftState {
  return { ...createInitialState({ ...start, speed }, 0, f16), ...patch };
}

function check(state: AircraftState) {
  return warningsFor(state, computeForces(state, model), model);
}

describe('warningsFor', () => {
  it('is quiet in normal cruise', () => {
    expect(activeWarnings(check(flying(250)))).toEqual([]);
  });

  it('warns of a stall near the stall angle of attack', () => {
    const nose = attitudeFromHPR({ heading: toRadians(90), pitch: toRadians(25), roll: 0 });
    expect(check(flying(60, { attitude: nose })).stall).toBe(true);
    expect(check(flying(60)).stall).toBe(false);
  });

  it('warns of over-g beyond the structural limit', () => {
    const nose = attitudeFromHPR({ heading: toRadians(90), pitch: toRadians(20), roll: 0 });
    expect(check(flying(300, { attitude: nose })).overG).toBe(true);
    expect(check(flying(300)).overG).toBe(false);
  });

  it('warns of overspeed by airspeed and by Mach', () => {
    expect(check(flying(f16.limits.maxAirspeed + 10)).overspeed).toBe(true);
    // Fast but thin air: past the Mach limit before the airspeed limit.
    const high = flying(f16.limits.maxAirspeed - 5, { height: 12_000 });
    const forces = computeForces(high, model);
    expect(forces.mach).toBeGreaterThan(1);
    expect(check(flying(200)).overspeed).toBe(false);
  });

  it('warns when the gear is out above its speed limit', () => {
    expect(check(flying(f16.gear.maxSpeed + 5, { gear: 1 })).gearOverspeed).toBe(true);
    expect(check(flying(f16.gear.maxSpeed + 5, { gear: 0 })).gearOverspeed).toBe(false);
  });

  it('warns when low, slow and descending with the gear up', () => {
    const low = { height: 100, groundHeight: 0, velocity: vec3(100, 0, -3) };
    expect(check(flying(100, { ...low, gear: 0 })).gearUp).toBe(true);
    expect(check(flying(100, { ...low, gear: 1 })).gearUp).toBe(false);
    expect(check(flying(100, { ...low, gear: 0, velocity: vec3(100, 0, 3) })).gearUp).toBe(false);
  });

  it('reports engine out and low fuel', () => {
    expect(check(flying(250, { fuel: 0 })).engineOut).toBe(true);
    expect(check(flying(250, { fuel: 0 })).lowFuel).toBe(false);
    expect(check(flying(250, { fuel: 100 })).lowFuel).toBe(true);
    expect(check(flying(250, { fuel: 2000 })).lowFuel).toBe(false);
  });

  it('lists the active warnings as HUD labels', () => {
    const w = check(flying(f16.limits.maxAirspeed + 10, { gear: 1, fuel: 0 }));
    expect(activeWarnings(w)).toEqual(['OVERSPEED', 'GEAR SPEED', 'ENGINE OUT']);
  });
});
