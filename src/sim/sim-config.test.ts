import { describe, expect, it } from 'vitest';
import startJson from '../start.config.json';
import {
  parseOverrides,
  resolveSimConfig,
  SimConfigError,
  validateKeyBindings,
  validateSimConfig,
} from './sim-config';

const valid = validateSimConfig(startJson);
const { start, simulation, graphics, input, camera, hud } = valid;

function without(obj: object, key: string): Record<string, unknown> {
  const copy: Record<string, unknown> = { ...obj };
  delete copy[key];
  return copy;
}

describe('validateSimConfig', () => {
  it('accepts the shipped start.config.json and round-trips it', () => {
    expect(validateSimConfig(valid)).toEqual(valid);
  });

  it('reads and trims the ion token, treating blank or missing as token-free', () => {
    expect(validateSimConfig({ ...valid, ion: { token: '  abc.def ' } }).ion).toEqual({
      token: 'abc.def',
    });
    expect(validateSimConfig({ ...valid, ion: { token: '   ' } }).ion).toEqual({ token: null });
    expect(validateSimConfig({ ...valid, ion: {} }).ion).toEqual({ token: null });
    expect(validateSimConfig(without(valid, 'ion')).ion).toEqual({ token: null });
  });

  it('rejects a malformed ion section', () => {
    expect(() => validateSimConfig({ ...valid, ion: 'tok' })).toThrow(/"ion" must be an object/);
    expect(() => validateSimConfig({ ...valid, ion: { token: 42 } })).toThrow(
      /"ion.token" must be a string/,
    );
  });

  it('rejects non-objects and missing sections', () => {
    expect(() => validateSimConfig(null)).toThrow(SimConfigError);
    expect(() => validateSimConfig([])).toThrow(SimConfigError);
    for (const section of [
      'start',
      'ground',
      'environment',
      'simulation',
      'graphics',
      'input',
      'camera',
    ]) {
      expect(() => validateSimConfig(without(valid, section))).toThrow(
        new RegExp(`"${section}" must be an object`),
      );
    }
  });

  it('rejects missing, mistyped, unknown and out-of-range keys', () => {
    expect(() => validateSimConfig({ ...valid, start: without(start, 'fov') })).toThrow(
      /"start.fov" must be a finite number/,
    );
    expect(() => validateSimConfig({ ...valid, start: { ...start, lat: '47' } })).toThrow(
      /"start.lat"/,
    );
    expect(() => validateSimConfig({ ...valid, start: { ...start, lat: 91 } })).toThrow(
      /"start.lat" must be between -90 and 90/,
    );
    expect(() => validateSimConfig({ ...valid, start: { ...start, weight: 1 } })).toThrow(
      /"start.weight" is not a known setting/,
    );
    expect(() => validateSimConfig({ ...valid, start: { ...start, aircraft: 7 } })).toThrow(
      /"start.aircraft" must be a string/,
    );
    expect(() => validateSimConfig({ ...valid, start: { ...start, aircraft: ' ' } })).toThrow(
      /"start.aircraft" must name an aircraft type/,
    );
  });

  it('normalises heading 360 to 0', () => {
    expect(validateSimConfig({ ...valid, start: { ...start, heading: 360 } }).start.heading).toBe(
      0,
    );
  });

  it('validates graphics presets and the selected one', () => {
    expect(() =>
      validateSimConfig({ ...valid, graphics: { ...graphics, preset: 'ultra' } }),
    ).toThrow(/"graphics.preset" must be one of low, medium, high/);
    expect(() => validateSimConfig({ ...valid, graphics: { ...graphics, presets: {} } })).toThrow(
      /at least one preset/,
    );
    const badPreset = { ...graphics.presets['low'], fog: 'yes' };
    expect(() =>
      validateSimConfig({
        ...valid,
        graphics: { ...graphics, presets: { ...graphics.presets, low: badPreset } },
      }),
    ).toThrow(/"graphics.presets.low.fog" must be true or false/);
  });

  it('requires the time scale range to include 1 and sane orbit distances', () => {
    expect(() =>
      validateSimConfig({
        ...valid,
        simulation: { ...simulation, minTimeScale: 1, maxTimeScale: 1 },
      }),
    ).not.toThrow();
    expect(() =>
      validateSimConfig({ ...valid, simulation: { ...simulation, maxTimeScale: 0.5 } }),
    ).toThrow(/"simulation.maxTimeScale"/);
    expect(() =>
      validateSimConfig({
        ...valid,
        camera: { ...camera, orbitMinDistance: 500, orbitMaxDistance: 100 },
      }),
    ).toThrow(/orbitMinDistance/);
  });

  it('validates the hud section', () => {
    expect(() => validateSimConfig({ ...valid, hud: { ...hud, units: 'nautical' } })).toThrow(
      /"hud.units" must be one of metric, imperial/,
    );
    expect(() => validateSimConfig({ ...valid, hud: { ...hud, color: 'green' } })).toThrow(
      /"hud.color" must be a hex colour/,
    );
    expect(() => validateSimConfig({ ...valid, hud: { ...hud, brightness: 2 } })).toThrow(
      /"hud.brightness"/,
    );
  });

  it('validates gamepad and mouse sections', () => {
    const gamepad = { ...input.gamepad, axes: { ...input.gamepad.axes, roll: 40 } };
    expect(() => validateSimConfig({ ...valid, input: { ...input, gamepad } })).toThrow(
      /"input.gamepad.axes.roll"/,
    );
    expect(() =>
      validateSimConfig({
        ...valid,
        input: { ...input, mouse: { ...input.mouse, mouseFlight: 1 } },
      }),
    ).toThrow(/"input.mouse.mouseFlight" must be true or false/);
  });
});

describe('validateKeyBindings', () => {
  it('requires every action and rejects a key bound twice', () => {
    expect(validateKeyBindings(input.keys)).toEqual(input.keys);
    expect(() => validateKeyBindings(without(input.keys, 'gear'))).toThrow(
      /"input.keys.gear" must be a list of strings/,
    );
    expect(() => validateKeyBindings({ ...input.keys, gear: 'g' })).toThrow(
      /"input.keys.gear" must be a list of strings/,
    );
    expect(() => validateKeyBindings({ ...input.keys, gear: ['p'] })).toThrow(
      /key "p" is bound to both gear and pause/,
    );
    expect(() => validateKeyBindings({ ...input.keys, fire: [' '] })).toThrow(
      /"input.keys.fire" is not a known setting/,
    );
  });

  it('allows an action with no key', () => {
    expect(validateKeyBindings({ ...input.keys, buildings: [] }).buildings).toEqual([]);
  });
});

describe('parseOverrides', () => {
  it('reads numeric start keys, the aircraft and time strings, and graphics switches', () => {
    expect(
      parseOverrides(
        '?lat=1.5&height=200&aircraft=trainer&time=2026-06-21T12:00:00Z&graphics=low&buildings=1',
      ),
    ).toEqual({
      start: { lat: 1.5, height: 200, aircraft: 'trainer', time: '2026-06-21T12:00:00Z' },
      graphics: { preset: 'low', osmBuildings: true },
      hud: {},
    });
    expect(parseOverrides('?buildings=0').graphics).toEqual({ osmBuildings: false });
    expect(parseOverrides('?units=metric').hud).toEqual({ units: 'metric' });
    expect(parseOverrides('')).toEqual({ start: {}, graphics: {}, hud: {} });
    expect(parseOverrides('?foo=1')).toEqual({ start: {}, graphics: {}, hud: {} });
  });

  it('rejects non-numeric values for numeric keys', () => {
    expect(() => parseOverrides('?lat=abc')).toThrow(/"lat" is not a number/);
    expect(() => parseOverrides('?fov=')).toThrow(/"fov"/);
  });
});

describe('resolveSimConfig', () => {
  it('applies URL overrides on top of the base and validates the result', () => {
    const resolved = resolveSimConfig(startJson, '?lat=10&aircraft=trainer&graphics=high');
    expect(resolved.start.lat).toBe(10);
    expect(resolved.start.lon).toBe(start.lon);
    expect(resolved.start.aircraft).toBe('trainer');
    expect(resolved.graphics.preset).toBe('high');
    expect(resolveSimConfig(startJson, '?units=metric').hud.units).toBe('metric');
    expect(() => resolveSimConfig(startJson, '?units=furlongs')).toThrow(/"hud.units"/);
    expect(() => resolveSimConfig(startJson, '?lat=200')).toThrow(/"start.lat"/);
    expect(() => resolveSimConfig(startJson, '?graphics=ultra')).toThrow(/"graphics.preset"/);
  });
});
