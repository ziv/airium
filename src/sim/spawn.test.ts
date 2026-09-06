import { describe, expect, it } from 'vitest';
import { AIRCRAFT_IDS, getAircraftType } from '../aircraft';
import { MISSION_IDS, getMission } from '../missions';
import startJson from '../start.config.json';
import { UNIT_IDS, getUnitType } from '../units';
import { validateSimConfig } from './sim-config';
import { createEntities, validateMission } from './spawn';

const cfg = validateSimConfig(startJson);
const known = { aircraft: AIRCRAFT_IDS, units: UNIT_IDS };
const deps = {
  aircraftType: getAircraftType,
  unitType: getUnitType,
  ground: cfg.ground,
  environment: cfg.environment,
};

const jet = {
  id: 'b1',
  kind: 'aircraft',
  type: 'f16',
  faction: 'hostile',
  lat: 32,
  lon: 35,
  height: 1000,
  heading: 90,
  speed: 200,
};
const sam = {
  id: 's1',
  kind: 'ground-unit',
  type: 'sam-site',
  faction: 'hostile',
  lat: 32,
  lon: 35,
  heading: 0,
  route: null,
};
const mission = (entities: unknown[]) => ({ name: 'm', description: '', entities });

describe('validateMission', () => {
  it('accepts every shipped mission', () => {
    expect(MISSION_IDS).toContain('coastal-patrol');
    for (const id of MISSION_IDS) expect(getMission(id).entities.length).toBeGreaterThan(0);
    expect(() => getMission('nope')).toThrow(/unknown mission "nope"/);
  });

  it('defaults the behaviour to straight and the name to the id', () => {
    const m = validateMission(mission([jet]), known);
    expect(m.entities[0]).toMatchObject({ name: 'b1', behaviour: { mode: 'straight' } });
  });

  it('rejects unknown kinds, types, factions, ids and behaviours', () => {
    expect(() => validateMission(mission([{ ...jet, kind: 'blimp' }]), known)).toThrow(
      /kind" must be one of/,
    );
    expect(() => validateMission(mission([{ ...jet, type: 'mig' }]), known)).toThrow(
      /entities\[0\].type" must be one of f16, trainer/,
    );
    expect(() => validateMission(mission([{ ...jet, faction: 'pirate' }]), known)).toThrow(
      /faction/,
    );
    expect(() => validateMission(mission([jet, jet]), known)).toThrow(/duplicate id "b1"/);
    expect(() => validateMission(mission([{ ...jet, id: 'player' }]), known)).toThrow(
      /other than "player"/,
    );
    expect(() =>
      validateMission(mission([{ ...jet, behaviour: { mode: 'dance' } }]), known),
    ).toThrow(/behaviour.mode/);
    expect(() =>
      validateMission(mission([{ ...jet, behaviour: { mode: 'orbit', lat: 32, lon: 35 } }]), known),
    ).toThrow(/behaviour.radius/);
    expect(() =>
      validateMission(
        mission([{ ...jet, behaviour: { mode: 'waypoints', loop: true, waypoints: [] } }]),
        known,
      ),
    ).toThrow(/non-empty list of waypoints/);
    expect(() => validateMission(mission([{ ...sam, type: 'f16' }]), known)).toThrow(
      /type" must be one of sam-site, truck, patrol-boat/,
    );
    expect(() =>
      validateMission(mission([{ ...sam, route: { loop: true, waypoints: [{ lat: 1 }] } }]), known),
    ).toThrow(/waypoints\[0\].lon/);
    expect(() => validateMission({ name: 'm', description: '', entities: 'none' }, known)).toThrow(
      /entities" must be a list/,
    );
  });
});

describe('createEntities', () => {
  it('builds aircraft, units and waypoints with the sampled ground heights', () => {
    const m = validateMission(
      mission([
        {
          ...jet,
          behaviour: {
            mode: 'orbit',
            lat: 32,
            lon: 35,
            radius: 3000,
            altitude: 2000,
            speed: 200,
            clockwise: true,
          },
        },
        sam,
        {
          id: 'boat',
          kind: 'ship',
          type: 'patrol-boat',
          faction: 'hostile',
          lat: 32.2,
          lon: 34.7,
          heading: 0,
          route: { loop: false, waypoints: [{ lat: 32.3, lon: 34.7, height: 0, speed: 8 }] },
        },
        { id: 'wp', kind: 'waypoint', lat: 32, lon: 35, height: 1500 },
      ]),
      known,
    );
    const heights = new Map([
      ['b1', 300],
      ['s1', 420],
      ['boat', 0],
    ]);
    const [b1, s1, boat, wp] = createEntities(m, heights, deps);
    expect(b1).toMatchObject({
      kind: 'aircraft',
      typeId: 'f16',
      height: 1300,
      controlledByPlayer: false,
    });
    expect(b1?.kind === 'aircraft' ? b1.behaviour.mode : null).toBe('orbit');
    expect(s1).toMatchObject({
      kind: 'ground-unit',
      height: 420,
      groundHeight: 420,
      radius: getUnitType('sam-site').radius,
    });
    expect(boat).toMatchObject({ kind: 'ship', height: 0 });
    expect(boat?.kind === 'ship' ? boat.route?.waypoints[0]?.speed : null).toBe(8);
    expect(wp).toMatchObject({ kind: 'waypoint', height: 1500, name: 'wp' });
  });
});
