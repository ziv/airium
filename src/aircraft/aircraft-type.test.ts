import { describe, expect, it } from 'vitest';
import { AIRCRAFT_IDS, getAircraftType } from './index';
import f16 from './f16.json';
import { validateAircraftType } from './aircraft-type';

describe('aircraft registry', () => {
  it('validates every shipped type', () => {
    expect(AIRCRAFT_IDS).toContain('f16');
    expect(AIRCRAFT_IDS).toContain('trainer');
    for (const id of AIRCRAFT_IDS) {
      const type = getAircraftType(id);
      expect(type.id).toBe(id);
      expect(type.name.length).toBeGreaterThan(0);
    }
    expect(getAircraftType('f16')).toBe(getAircraftType('f16'));
  });

  it('rejects unknown ids and lists the known ones', () => {
    expect(() => getAircraftType('mig29')).toThrow(
      /unknown aircraft "mig29" \(known: f16, trainer\)/,
    );
  });
});

describe('validateAircraftType', () => {
  const patch = (section: keyof typeof f16, values: Record<string, unknown>) => ({
    ...f16,
    [section]: { ...(f16[section] as Record<string, unknown>), ...values },
  });

  it('accepts the F-16 file and keeps its numbers', () => {
    const type = validateAircraftType('f16', f16);
    expect(type.engine.afterburnerThrust).toBe(f16.engine.afterburnerThrust);
    expect(type.model.uri).toBe('models/jet.glb');
  });

  it('requires a name and known keys only', () => {
    expect(() => validateAircraftType('x', { ...f16, name: '' })).toThrow(
      /"name" must be a non-empty string/,
    );
    expect(() => validateAircraftType('x', patch('engine', { boost: 1 }))).toThrow(
      /"x.engine.boost" is not a known setting/,
    );
    expect(() => validateAircraftType('x', 'nope')).toThrow(/must be an object/);
  });

  it('checks the cross-field rules', () => {
    expect(() => validateAircraftType('x', patch('aerodynamics', { zeroLiftAngle: 20 }))).toThrow(
      /zeroLiftAngle/,
    );
    expect(() => validateAircraftType('x', patch('aerodynamics', { machDragPeak: 0.5 }))).toThrow(
      /machDragPeak/,
    );
    expect(() => validateAircraftType('x', patch('limits', { maxAngleOfAttack: 30 }))).toThrow(
      /maxAngleOfAttack/,
    );
  });
});
