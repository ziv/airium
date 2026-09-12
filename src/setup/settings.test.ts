import { describe, expect, it } from 'vitest';
import { defaultSettings, validateSettings } from './settings';
import { World } from '../sim/world';
import { createInitialState } from '../sim/physics';

describe('flight setup', () => {
  it('validates defaults and seeds the form from shared flight URLs', () => {
    const settings = validateSettings(
      defaultSettings('?aircraft=trainer&mission=dogfight&speed=123&difficulty=hard'),
    );
    expect(settings.sim.start.aircraft).toBe('trainer');
    expect(settings.sim.start.mission).toBe('dogfight');
    expect(settings.sim.start.speed).toBe(123);
    expect(settings.ai.difficulty).toBe('hard');
  });
  it('applies edited aircraft, world, weapons, AI and sensor settings without mutating defaults', () => {
    const draft = defaultSettings();
    draft.aircraft.f16!.airframe.fuelCapacity = 1234;
    draft.sim.start.height = 2000;
    draft.sim.start.mission = '';
    draft.sensors.maxRange = 42000;
    draft.weapons.types.gun.damage = 42;
    draft.ai.difficulty = 'easy';
    const selected = validateSettings(draft);
    const world = new World(
      { ground: selected.sim.ground, environment: selected.sim.environment },
      selected.sim.world,
      selected.weapons,
      selected.ai,
      selected.sensors,
    );
    expect(world.sensors.cfg.maxRange).toBe(42000);
    expect(world.ai.difficulty).toBe('easy');
    expect(createInitialState(selected.sim.start, 100, selected.aircraft.f16!).fuel).toBe(1234);
    expect(createInitialState(selected.sim.start, 100, selected.aircraft.f16!).height).toBe(2100);
    expect(defaultSettings().aircraft.f16!.airframe.fuelCapacity).not.toBe(1234);
  });
  it('rejects invalid values before starting', () => {
    const draft = defaultSettings();
    draft.sim.start.time = 'invalid';
    expect(() => validateSettings(draft)).toThrow('date and time');
    draft.sim.start.time = '';
    draft.aircraft.f16!.airframe.emptyMass = -1;
    expect(() => validateSettings(draft)).toThrow();
  });
});
