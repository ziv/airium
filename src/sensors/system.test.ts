import { describe, expect, it } from 'vitest';
import { getAircraftType } from '../aircraft';
import { createAircraftEntity, createWaypointEntity, syncAircraft } from '../sim/entities';
import { attitudeFromHPR } from '../sim/attitude';
import { offsetLatLon } from '../sim/geo';
import { createInitialState, NEUTRAL_CONTROLS } from '../sim/physics';
import { validateSimConfig } from '../sim/sim-config';
import { World } from '../sim/world';
import start from '../start.config.json';
import { SENSORS, validateSensors } from './config';
import { cycleTrack, detect, lineOfSight } from './system';
import { buildCombatHud } from '../hud/combat-data';

const sim = validateSimConfig(start),
  R = sim.environment.earthRadius;
const type = getAircraftType('f16'),
  flat = () => 0;
function aircraft(id: string, east = 0, north = 0, height = 5000, heading = 0) {
  return createAircraftEntity({
    id,
    name: id,
    faction: id === 'player' ? 'player' : 'hostile',
    type,
    model: { aircraft: type, ground: sim.ground, environment: sim.environment },
    state: createInitialState(
      { ...offsetLatLon({ lat: 32, lon: 35 }, east, north, R), height, heading, speed: 250 },
      0,
      type,
    ),
    controlledByPlayer: id === 'player',
    behaviour: { mode: 'straight' },
  });
}
function setup(range = 40000) {
  const world = new World(sim, sim.world),
    player = aircraft('player'),
    bandit = aircraft('bandit', 0, range, 5000, 180);
  world.add(player);
  world.add(bandit);
  world.sensors.step(flat);
  return { world, player, bandit };
}
describe('M8 sensors', () => {
  it('validates the config', () => {
    expect(validateSensors(SENSORS)).toEqual(SENSORS);
    for (const fields of [
      { updateHz: 0 },
      { azimuth: 180 },
      { sampleSpacing: NaN },
      { typo: true },
    ])
      expect(() => validateSensors({ ...SENSORS, ...fields })).toThrow();
  });
  it('uses separate body-frame azimuth and elevation limits, including rolled aircraft', () => {
    const owner = aircraft('player');
    expect(detect(owner, aircraft('a', 17000, 10000), R, SENSORS, flat)).not.toBeNull();
    expect(detect(owner, aircraft('b', 18000, 10000), R, SENSORS, flat)).toBeNull();
    expect(detect(owner, aircraft('c', 0, 10000, 11000), R, SENSORS, flat)).toBeNull();
    expect(detect(owner, aircraft('d', 0, -10000), R, SENSORS, flat)).toBeNull();
    owner.attitude = attitudeFromHPR({ heading: 0, pitch: 0, roll: Math.PI / 2 });
    expect(detect(owner, aircraft('e', 10000, 10000), R, SENSORS, flat)).toBeNull();
  });
  it('scales detection range with target size', () => {
    const owner = aircraft('player'),
      target = aircraft('bandit', 0, 60000);
    expect(detect(owner, target, R, SENSORS, flat)).not.toBeNull();
    target.radius = 2;
    expect(detect(owner, target, R, SENSORS, flat)).toBeNull();
  });
  it('blocks a ray behind a hill and allows unknown terrain', () => {
    const a = aircraft('player'),
      b = aircraft('bandit', 0, 10000);
    const hill = (lat: number) => (lat > 32.04 && lat < 32.05 ? 6000 : 0);
    expect(lineOfSight(a, b, R, hill, 250)).toBe(false);
    expect(detect(a, b, R, SENSORS, hill)).toBeNull();
    expect(lineOfSight(a, b, R, () => undefined, 250)).toBe(true);
    expect(detect(a, b, R, { ...SENSORS, terrainLOS: false }, hill)).not.toBeNull();
  });
  it('cycles nearest-first hostile tracks, with stable ties, and excludes friendlies from weapons', () => {
    const { world, player } = setup();
    const friend = aircraft('friend', 0, 1000);
    friend.faction = 'friendly';
    world.add(friend);
    world.add(aircraft('z', 0, 2000));
    world.add(aircraft('a', 0, 2000));
    world.time = 1;
    world.sensors.step(flat);
    expect(world.sensors.tracks(player)[0]?.id).toBe('friend');
    const tracks = world.sensors.targets(player);
    expect(tracks.map((t) => t.id)).toEqual(['a', 'z', 'bandit']);
    expect(cycleTrack(tracks, null)).toBe('a');
    expect(cycleTrack(tracks, 'a')).toBe('z');
    expect(cycleTrack(tracks, 'bandit')).toBe('a');
    expect(cycleTrack([], null)).toBeNull();
    player.weapons.targetId = friend.id;
    world.combat.command(player.id, 'lock');
    world.combat.step(0.01);
    expect(player.weapons.lockId).toBeNull();
    expect(world.combat.launch(player, 'ir')?.targetId).toBe('a');
  });
  it('refreshes at the configured rate and drops masked locks', () => {
    const { world, player, bandit } = setup();
    player.weapons.lockId = bandit.id;
    world.time = 0.1;
    world.sensors.step(() => 9000);
    expect(player.weapons.lockId).toBe(bandit.id);
    world.time = 0.26;
    world.sensors.step(() => 9000);
    expect(player.weapons.lockId).toBeNull();
    expect(world.sensors.tracks(player)).toEqual([]);
  });
  it('detects at 40 km, locks both ways, and reports RWR bearing and missile direction at Rmax', () => {
    const { world, player, bandit } = setup();
    expect(world.sensors.tracks(player)[0]?.range).toBeCloseTo(40000);
    world.combat.command(player.id, 'target');
    world.combat.command(player.id, 'lock');
    world.combat.command(bandit.id, 'target');
    world.combat.command(bandit.id, 'lock');
    world.combat.step(0.01);
    expect(player.weapons.lockId).toBe(bandit.id);
    expect(world.sensors.threats(player)).toContainEqual({
      id: bandit.id,
      bearing: 0,
      level: 'lock',
    });
    const max = world.combat.cfg.types.radar.maxRange;
    bandit.state = { ...bandit.state, ...offsetLatLon(player, 0, max - 0.001, R) };
    syncAircraft(bandit);
    world.time = 1;
    world.sensors.step(flat);
    expect(world.combat.launch(player, 'radar')).not.toBeNull();
    expect(world.combat.launch(bandit, 'radar')).not.toBeNull();
    expect(
      world.sensors.threats(player).some((t) => t.level === 'launch' && Math.abs(t.bearing) < 0.01),
    ).toBe(true);
    player.weapons.selected = 'radar';
    expect(buildCombatHud(player, world, flat).shoot).toBe(true);
  });
  it('reports relative RWR bearings to the right and behind, and removes dead emitters', () => {
    const { world, player, bandit } = setup();
    bandit.state = {
      ...bandit.state,
      ...offsetLatLon(player, 10000, 0, R),
      attitude: attitudeFromHPR({ heading: -Math.PI / 2, pitch: 0, roll: 0 }),
    };
    syncAircraft(bandit);
    world.time = 1;
    world.sensors.step(flat);
    expect(world.sensors.threats(player)[0]?.bearing).toBeCloseTo(Math.PI / 2);
    bandit.state = {
      ...bandit.state,
      ...offsetLatLon(player, 0, -10000, R),
      attitude: attitudeFromHPR({ heading: 0, pitch: 0, roll: 0 }),
    };
    syncAircraft(bandit);
    world.time = 2;
    world.sensors.step(flat);
    expect(world.sensors.threats(player)[0]?.bearing).toBeCloseTo(Math.PI);
    bandit.alive = false;
    expect(world.sensors.threats(player)).toEqual([]);
  });
  it('acquires IR without radar lock and rejects terrain-masked targets', () => {
    const { world, player, bandit } = setup(3000);
    expect(world.combat.missileTarget(player, 'ir')).toBe(bandit);
    expect(player.weapons.lockId).toBeNull();
    world.time = 1;
    world.sensors.step(() => 9000);
    expect(world.combat.missileTarget(player, 'ir')).toBeUndefined();
  });
  it('cycles steerpoints, exposes distance and bearing, and resets cleanly', () => {
    const { world, player } = setup();
    for (const id of ['one', 'two'])
      world.add(createWaypointEntity({ id, name: id, lat: 32.1, lon: 35, height: 0 }));
    expect(world.sensors.waypoint()?.id).toBe('one');
    world.sensors.cycleWaypoint();
    expect(buildCombatHud(player, world, flat).navigation?.name).toBe('two');
    world.sensors.cycleWaypoint();
    expect(world.sensors.waypoint()?.id).toBe('one');
    world.clear();
    expect(world.sensors.tracks(player)).toEqual([]);
    expect(world.sensors.waypoint()).toBeUndefined();
    world.sensors.cycleWaypoint();
    world.step(0.01, NEUTRAL_CONTROLS, flat);
  });
});
