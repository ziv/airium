import { describe, expect, it } from 'vitest';
import {
  parseStartOverrides,
  resolveStartConfig,
  StartConfigError,
  validateStartConfig,
} from './start-config';
import startJson from '../start.config.json';

const valid = { lat: 47.2, lon: 11.3, height: 2500, heading: 90, speed: 0, fov: 60 };

describe('validateStartConfig', () => {
  it('accepts a complete valid config', () => {
    expect(validateStartConfig(valid)).toEqual(valid);
  });

  it('accepts the shipped start.config.json', () => {
    expect(() => validateStartConfig(startJson)).not.toThrow();
  });

  it('rejects non-objects', () => {
    expect(() => validateStartConfig(null)).toThrow(StartConfigError);
    expect(() => validateStartConfig([])).toThrow(StartConfigError);
    expect(() => validateStartConfig('x')).toThrow(StartConfigError);
  });

  it('rejects missing or non-numeric keys', () => {
    const missingFov: Record<string, number> = { ...valid };
    delete missingFov['fov'];
    expect(() => validateStartConfig(missingFov)).toThrow(/"fov" must be a finite number/);
    expect(() => validateStartConfig({ ...valid, lat: '47' })).toThrow(/"lat"/);
    expect(() => validateStartConfig({ ...valid, lat: NaN })).toThrow(/"lat"/);
  });

  it('rejects out-of-range values', () => {
    expect(() => validateStartConfig({ ...valid, lat: 91 })).toThrow(/between -90 and 90/);
    expect(() => validateStartConfig({ ...valid, lon: -181 })).toThrow(/"lon"/);
    expect(() => validateStartConfig({ ...valid, height: -1 })).toThrow(/"height"/);
    expect(() => validateStartConfig({ ...valid, speed: -1 })).toThrow(/"speed"/);
    expect(() => validateStartConfig({ ...valid, fov: 0 })).toThrow(/"fov"/);
    expect(() => validateStartConfig({ ...valid, heading: 361 })).toThrow(/"heading"/);
  });

  it('normalises a heading of 360 to 0', () => {
    expect(validateStartConfig({ ...valid, heading: 360 }).heading).toBe(0);
  });

  it('does not mutate its input', () => {
    const input = { ...valid, heading: 360 };
    validateStartConfig(input);
    expect(input.heading).toBe(360);
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
    expect(() => parseStartOverrides('?height=high')).toThrow(StartConfigError);
    expect(() => parseStartOverrides('?height=')).toThrow(StartConfigError);
  });
});

describe('resolveStartConfig', () => {
  it('returns the base config when there are no overrides', () => {
    expect(resolveStartConfig(valid)).toEqual(valid);
  });

  it('applies overrides on top of the base config', () => {
    expect(resolveStartConfig(valid, '?height=900&fov=45')).toEqual({
      ...valid,
      height: 900,
      fov: 45,
    });
  });

  it('validates the merged result', () => {
    expect(() => resolveStartConfig(valid, '?lat=100')).toThrow(/"lat"/);
  });
});
