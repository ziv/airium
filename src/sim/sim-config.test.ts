import { describe, expect, it } from 'vitest';
import {
  parseStartOverrides,
  resolveSimConfig,
  SimConfigError,
  validateSimConfig,
} from './sim-config';
import startJson from '../start.config.json';

const start = { lat: 47.2, lon: 11.3, height: 2500, heading: 90, speed: 0, fov: 60 };
const aircraft = {
  weight: 1100,
  wingArea: 16,
  liftCoefficient: 0.4,
  dragCoefficient: 0.03,
  maxThrust: 3000,
};
const { aerodynamics, controls, ground, environment, simulation } = startJson;
const rest = { aerodynamics, controls, ground, environment, simulation };
const valid = { start, aircraft, ...rest };

describe('validateSimConfig', () => {
  it('accepts a complete valid config', () => {
    expect(validateSimConfig(valid)).toEqual(valid);
  });

  it('accepts the shipped start.config.json', () => {
    expect(() => validateSimConfig(startJson)).not.toThrow();
  });

  it('rejects non-objects and missing sections', () => {
    expect(() => validateSimConfig(null)).toThrow(SimConfigError);
    expect(() => validateSimConfig([])).toThrow(SimConfigError);
    expect(() => validateSimConfig({ start, ...rest })).toThrow(/"aircraft" must be an object/);
    expect(() => validateSimConfig({ aircraft, ...rest })).toThrow(/"start" must be an object/);
    const noEnv: Record<string, unknown> = { ...valid };
    delete noEnv['environment'];
    expect(() => validateSimConfig(noEnv)).toThrow(/"environment" must be an object/);
  });

  it('rejects missing or non-numeric keys', () => {
    const missingFov: Record<string, number> = { ...start };
    delete missingFov['fov'];
    expect(() => validateSimConfig({ ...valid, start: missingFov })).toThrow(
      /"start.fov" must be a finite number/,
    );
    expect(() => validateSimConfig({ ...valid, start: { ...start, lat: '47' } })).toThrow(
      /"start.lat"/,
    );
    expect(() => validateSimConfig({ ...valid, aircraft: { ...aircraft, weight: NaN } })).toThrow(
      /"aircraft.weight"/,
    );
    expect(() =>
      validateSimConfig({ ...valid, controls: { ...controls, rollRate: '60' } }),
    ).toThrow(/"controls.rollRate"/);
  });

  it('rejects out-of-range values', () => {
    const withStart = (patch: Partial<typeof start>) => ({
      start: { ...start, ...patch },
      aircraft,
    });
    const withAircraft = (patch: Partial<typeof aircraft>) => ({
      start,
      aircraft: { ...aircraft, ...patch },
    });
    expect(() => validateSimConfig(withStart({ lat: 91 }))).toThrow(/between -90 and 90/);
    expect(() => validateSimConfig(withStart({ lon: -181 }))).toThrow(/"start.lon"/);
    expect(() => validateSimConfig(withStart({ height: -1 }))).toThrow(/"start.height"/);
    expect(() => validateSimConfig(withStart({ speed: -1 }))).toThrow(/"start.speed"/);
    expect(() => validateSimConfig(withStart({ fov: 0 }))).toThrow(/"start.fov"/);
    expect(() => validateSimConfig(withStart({ heading: 361 }))).toThrow(/"start.heading"/);
    expect(() => validateSimConfig(withAircraft({ weight: 0 }))).toThrow(/"aircraft.weight"/);
    expect(() => validateSimConfig(withAircraft({ wingArea: 0 }))).toThrow(/"aircraft.wingArea"/);
    expect(() => validateSimConfig(withAircraft({ maxThrust: -1 }))).toThrow(
      /"aircraft.maxThrust"/,
    );
    expect(() =>
      validateSimConfig({ ...valid, ground: { ...ground, rollingFriction: 2 } }),
    ).toThrow(/"ground.rollingFriction"/);
    expect(() =>
      validateSimConfig({ ...valid, environment: { ...environment, gravity: -1 } }),
    ).toThrow(/"environment.gravity"/);
    expect(() =>
      validateSimConfig({ ...valid, simulation: { ...simulation, physicsHz: 0 } }),
    ).toThrow(/"simulation.physicsHz"/);
  });

  it('requires the zero-lift angle to be beyond the stall angle', () => {
    expect(() =>
      validateSimConfig({
        ...valid,
        aerodynamics: { ...aerodynamics, stallAngle: 20, zeroLiftAngle: 20 },
      }),
    ).toThrow(/zeroLiftAngle/);
  });

  it('normalises a heading of 360 to 0', () => {
    expect(validateSimConfig({ ...valid, start: { ...start, heading: 360 } }).start.heading).toBe(
      0,
    );
  });

  it('does not mutate its input', () => {
    const input = { ...valid, start: { ...start, heading: 360 } };
    validateSimConfig(input);
    expect(input.start.heading).toBe(360);
  });
});

describe('parseStartOverrides', () => {
  it('returns nothing for an empty query', () => {
    expect(parseStartOverrides('')).toEqual({});
    expect(parseStartOverrides('?')).toEqual({});
  });

  it('parses known numeric keys and ignores unknown ones', () => {
    expect(parseStartOverrides('?lat=32.1&lon=-34.8&foo=bar')).toEqual({ lat: 32.1, lon: -34.8 });
  });

  it('rejects non-numeric values for known keys', () => {
    expect(() => parseStartOverrides('?height=high')).toThrow(SimConfigError);
    expect(() => parseStartOverrides('?height=')).toThrow(SimConfigError);
  });
});

describe('resolveSimConfig', () => {
  it('returns the base config when there are no overrides', () => {
    expect(resolveSimConfig(valid)).toEqual(valid);
  });

  it('applies start overrides on top of the base config', () => {
    expect(resolveSimConfig(valid, '?height=900&fov=45')).toEqual({
      ...valid,
      start: { ...start, height: 900, fov: 45 },
    });
  });

  it('validates the merged result', () => {
    expect(() => resolveSimConfig(valid, '?lat=100')).toThrow(/"start.lat"/);
  });
});
