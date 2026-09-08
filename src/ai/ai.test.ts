import { describe, expect, it } from 'vitest';
import { getAircraftType } from '../aircraft';
import { getUnitType } from '../units';
import {
  createAircraftEntity,
  createSurfaceEntity,
  isProjectile,
  syncAircraft,
  type AircraftEntity,
} from '../sim/entities';
import { WEAPONS } from '../weapons/config';
import { gunLead } from '../weapons/ballistics';
import { attitudeFromHPR, hprFromAttitude } from '../sim/attitude';
import { enuOffset, offsetLatLon } from '../sim/geo';
import { clamp, dot, length, sub, vec3 } from '../sim/math3d';
import { createInitialState, NEUTRAL_CONTROLS } from '../sim/physics';
import { validateSimConfig } from '../sim/sim-config';
import { World, type TerrainQuery } from '../sim/world';
import { autopilot } from '../sim/autopilot';
import { getMission } from '../missions';
import { getUnitType as unitType } from '../units';
import { createEntities, validateMission } from '../sim/spawn';
import start from '../start.config.json';
import { AI, difficultyFromSearch, validateAI } from './config';
import { fly, formationTarget, pursuit } from './flight';

const sim = validateSimConfig(start),
  R = sim.environment.earthRadius,
  type = getAircraftType('f16'),
  DT = 1 / 60,
  flat = () => 0;
function jet(
  id: string,
  east = 0,
  north = 0,
  heading = 90,
  speed = 240,
  height = 3000,
): AircraftEntity {
  return createAircraftEntity({
    id,
    name: id,
    faction: id === 'player' ? 'player' : 'hostile',
    type,
    model: { aircraft: type, ...sim },
    state: createInitialState(
      { ...offsetLatLon({ lat: 32, lon: 35 }, east, north, R), height, heading, speed },
      0,
      type,
    ),
    controlledByPlayer: id === 'player',
    behaviour: { mode: 'straight' },
    ...(id === 'player' ? {} : { ai: { role: 'combat' as const, leaderId: '' } }),
  });
}
function setup(range = 7000) {
  const world = new World(sim, { ...sim.world, collisions: false }),
    enemy = jet('enemy'),
    player = jet('player', range, 1000, 90, 200);
  world.add(enemy);
  world.add(player);
  return { world, enemy, player };
}
function run(world: World, seconds: number, terrain: TerrainQuery = flat) {
  for (let i = 0; i < seconds / DT; i++) {
    const p = world.player();
    const controls = p
      ? autopilot(p.state, p.cruise, p.type, sim.environment.gravity)
      : NEUTRAL_CONTROLS;
    world.step(DT, controls, terrain);
  }
}
describe('M9 AI', () => {
  it('validates difficulty, tuning and deterministic seeds', () => {
    expect(validateAI(AI)).toEqual(AI);
    expect(difficultyFromSearch('?difficulty=hard')).toBe('hard');
    expect(() => difficultyFromSearch('?difficulty=oops')).toThrow();
    for (const changed of [
      { seed: 1.5 },
      { difficulty: 'bad' },
      { tuning: { ...AI.tuning, terrainSamples: 2.5 } },
      { presets: { ...AI.presets, medium: { ...AI.presets.medium, missilePk: 2 } } },
    ])
      expect(() => validateAI({ ...AI, ...changed })).toThrow();
  });
  it('reacts after a delay, locks only a detected hostile, and spaces launches', () => {
    const { world, enemy, player } = setup(12000);
    run(world, 1);
    expect(world.ai.state(enemy.id)?.mode).toBe('detect');
    expect(enemy.weapons.lockId).toBeNull();
    run(world, 1);
    expect(world.ai.state(enemy.id)?.mode).toBe('engage');
    expect(enemy.weapons.lockId).toBe(player.id);
    const missiles = () =>
      world.entities.filter(
        (e) => isProjectile(e) && e.kind === 'missile' && e.ownerId === enemy.id,
      );
    run(world, 2);
    expect(missiles()).toHaveLength(1);
    run(world, 5);
    expect(missiles()).toHaveLength(1);
    expect(
      world.sensors.threats(player).some((t) => t.level === 'lock' || t.level === 'launch'),
    ).toBe(true);
  });
  it('uses lead, pure, lag pursuit and extension after an overshoot', () => {
    const e = jet('enemy'),
      t = jet('player', 10000);
    expect(pursuit(e, t, R, AI.tuning).mode).toBe('lead');
    t.lon = offsetLatLon(e, 1000, 0, R).lon;
    expect(pursuit(e, t, R, AI.tuning).mode).toBe('pure');
    t.lon = offsetLatLon(e, 500, 0, R).lon;
    expect(pursuit(e, t, R, AI.tuning).mode).toBe('lag');
    t.lon = offsetLatLon(e, -500, 0, R).lon;
    expect(pursuit(e, t, R, AI.tuning).mode).toBe('extend');
  });
  it('intercepts a straight target within 120 seconds using the flight model', () => {
    const { world, enemy, player } = setup(6000);
    enemy.weapons.ammo.ir = enemy.weapons.ammo.radar = 0;
    let closest = Infinity;
    for (let i = 0; i < 120 / DT; i++) {
      run(world, DT);
      closest = Math.min(closest, length(enuOffset(enemy, player, R)));
      if (closest < 1500) break;
    }
    expect(enemy.alive).toBe(true);
    expect(closest).toBeLessThan(1500);
  });
  it('fires its cannon with lead and damages a crossing target', () => {
    const { world, enemy, player } = setup(1100);
    player.state = { ...player.state, ...offsetLatLon(enemy, 1100, 100, R) };
    syncAircraft(player);
    enemy.weapons.ammo.ir = enemy.weapons.ammo.radar = 0;
    world.cfg.collisions = true;
    run(world, 45);
    expect(enemy.weapons.ammo.gun).toBeLessThan(type.combat.gun);
    expect(player.health).toBeLessThan(player.maxHealth);
  });
  it('medium 1-v-2 can be won with early shots and defence, while an idle pilot loses', () => {
    const duel = (active: boolean, seed: number) => {
      const world = new World(sim, sim.world, { ...WEAPONS, seed });
      const player = jet('player', 0, 0, 90, 260, 2400);
      const one = jet('one', 12000, 0, 270, 260, 2400),
        two = jet('two', 15000, 1300, 270, 260, 2400);
      world.add(player);
      world.add(one);
      world.add(two);
      let fired = 0;
      for (let i = 0; i < 180 / DT && player.alive && (one.alive || two.alive); i++) {
        const tracks = world.sensors.targets(player);
        const target =
          tracks
            .map((t) => world.get(t.id)!)
            .find((e) => e.alive && e.id === (fired % 2 === 0 ? one.id : two.id)) ??
          (one.alive ? one : two);
        const range = length(enuOffset(player, target, R));
        if (active && i > 10 && i % 60 === 0) {
          player.weapons.targetId = target.id;
          player.weapons.lockId = tracks.some((t) => t.id === target.id) ? target.id : null;
          const id = range < 4500 && player.weapons.ammo.ir > 0 ? 'ir' : 'radar';
          if (world.combat.launch(player, id)) fired++;
        }
        const threats = world.sensors.threats(player).filter((t) => t.level === 'launch');
        if (
          active &&
          i % 30 === 0 &&
          threats.some((t) => length(enuOffset(player, world.get(t.id)!, R)) < 3000)
        )
          world.combat.command(player.id, 'countermeasures');
        const contact = { ...target, velocity: target.velocity, attitude: target.attitude };
        const aim = active
          ? pursuit(player, contact, R, AI.tuning).aim
          : { heading: Math.PI / 2, altitude: 2400, speed: 280 };
        if (active && threats.length) {
          const incoming = world.get(threats[0]!.id)!;
          const offset = enuOffset(player, incoming, R);
          aim.heading = Math.atan2(offset.x, offset.y) + Math.PI / 2;
          aim.altitude = 1500;
          aim.speed = 320;
        }
        if (active && !threats.length && range < 2000) {
          const gun = world.combat.cfg.types.gun;
          const lead = gunLead(
            enuOffset(world.combat.muzzle(player, 'gun'), target, R),
            sub(target.velocity, player.velocity),
            gun.muzzleVelocity,
            gun.dragFactor,
            sim.environment.gravity,
            gun.lifetime,
          );
          if (lead) {
            aim.heading = Math.atan2(lead.direction.x, lead.direction.y);
            aim.speed = clamp(length(target.velocity) + (range - 600) * 0.1, 150, 320);
          }
        }
        const controls = active
          ? fly(
              player,
              aim,
              600,
              { ...AI.presets.hard!, maxG: 9 },
              AI.tuning,
              sim.environment.gravity,
            )
          : autopilot(player.state, aim, type, sim.environment.gravity);
        if (active && !threats.length && range < 2000) {
          const gun = world.combat.cfg.types.gun,
            lead = gunLead(
              enuOffset(world.combat.muzzle(player, 'gun'), target, R),
              sub(target.velocity, player.velocity),
              gun.muzzleVelocity,
              gun.dragFactor,
              sim.environment.gravity,
              gun.lifetime,
            );
          if (lead) {
            const hpr = hprFromAttitude(player.attitude),
              pitch = Math.atan2(lead.direction.z, Math.hypot(lead.direction.x, lead.direction.y));
            const load = clamp(
              1 / Math.max(0.2, Math.cos(hpr.roll)) +
                20 * (pitch - hpr.pitch) -
                2 * player.state.bodyRates.pitch,
              0.2,
              9,
            );
            controls.pitch =
              load >= 1 ? (load - 1) / 8 : (load - 1) / (1 - type.limits.minLoadFactor);
            player.weapons.selected = 'gun';
            controls.fire = dot(lead.direction, player.attitude.forward) > 0.999;
          }
        }
        world.step(DT, controls, flat);
      }
      return {
        time: world.time,
        fired,
        reason: player.deathReason,

        alive: player.alive,
        kills: player.weapons.kills,
        enemyAlive: [one, two].filter((e) => e.alive).length,
      };
    };
    const results = Array.from({ length: 8 }, (_, i) => ({
      seed: WEAPONS.seed + i,
      active: duel(true, WEAPONS.seed + i),
      idle: duel(false, WEAPONS.seed + i),
    }));
    expect(results.some((r) => r.active.kills === 2 && r.active.alive)).toBe(true);
    expect(results.every((r) => !r.idle.alive)).toBe(true);
  });
  it('loads the combat scenarios without arming the original training drones', () => {
    for (const id of ['dogfight', 'wingman-patrol', 'air-defence']) {
      const mission = getMission(id);
      const entities = createEntities(mission, new Map(), {
        aircraftType: getAircraftType,
        unitType,
        ground: sim.ground,
        environment: sim.environment,
      });
      expect(entities.some((e) => e.ai)).toBe(true);
    }
    expect(getMission('weapons-range').entities.every((e) => !e.ai)).toBe(true);
  });
  it('does not acquire friendlies, shoot behind itself, or launch below minimum range', () => {
    const { world, enemy, player } = setup(100);
    player.faction = 'hostile';
    run(world, 3);
    expect(world.ai.state(enemy.id)?.targetId).toBeNull();
    expect(world.entities.filter(isProjectile)).toHaveLength(0);
    player.faction = 'player';
    player.state = { ...player.state, ...offsetLatLon(enemy, -1000, 0, R) };
    syncAircraft(player);
    run(world, 2);
    expect(world.entities.filter(isProjectile)).toHaveLength(0);
  });
  it('defends against missile warnings and dispenses finite countermeasures', () => {
    const { world, enemy, player } = setup();
    world.spawnProjectile({
      kind: 'missile',
      ownerId: player.id,
      faction: 'player',
      lat: enemy.lat,
      lon: offsetLatLon(enemy, 4000, 0, R).lon,
      height: enemy.height,
      attitude: attitudeFromHPR({ heading: -Math.PI / 2, pitch: 0, roll: 0 }),
      velocity: vec3(-300, 0, 0),
      ttl: 30,
      dragFactor: 0,
      radius: 0.2,
      damage: 100,
      weaponId: 'radar',
      targetId: enemy.id,
    });
    // Keep the threat active independent of launcher datalink, as an active seeker would be.
    const missile = world.entities.find(isProjectile)!;
    missile.guidance = 'active';
    const before = enemy.weapons.flare;
    run(world, 1.3);
    expect(world.ai.state(enemy.id)?.mode).toBe('defend');
    expect(enemy.weapons.flare).toBeLessThan(before);
    expect(enemy.weapons.flare).toBeGreaterThanOrEqual(0);
    expect(enemy.controls.throttle).toBeGreaterThan(0.5);
  });
  it('turns back after extending past a target and forgets a masked contact after the memory timeout', () => {
    const { world, enemy, player } = setup(3000);
    run(world, 2);
    // Move the pursuer past the last observed contact, leaving that contact's motion unchanged.
    enemy.state = { ...enemy.state, ...offsetLatLon(player, 150, 0, R) };
    syncAircraft(enemy);
    world.time += 0.3;
    world.sensors.step(flat);
    world.ai.step(flat);
    expect(world.ai.state(enemy.id)?.pursuing).toBe('extend');
    const extension = AI.tuning.extendSeconds + 0.2;
    enemy.state = {
      ...enemy.state,
      ...offsetLatLon(enemy, enemy.velocity.x * extension, enemy.velocity.y * extension, R),
    };
    syncAircraft(enemy);
    world.time += extension;
    world.ai.step(flat);
    expect(world.ai.state(enemy.id)?.pursuing).toBe('lead');
    world.time += AI.tuning.memorySeconds + 1;
    world.sensors.step(() => 10000);
    world.ai.step(() => 10000);
    expect(world.ai.state(enemy.id)?.targetId).toBeNull();
    expect(world.ai.state(enemy.id)?.mode).toBe('patrol');
  });
  it('returns home when damaged, fuel is low, or air-to-air ammunition is exhausted', () => {
    for (const reason of ['fuel', 'health', 'ammo']) {
      const { world, enemy } = setup();
      if (reason === 'fuel') enemy.state = { ...enemy.state, fuel: 1 };
      if (reason === 'health') enemy.health = enemy.maxHealth * 0.2;
      if (reason === 'ammo')
        enemy.weapons.ammo.gun = enemy.weapons.ammo.ir = enemy.weapons.ammo.radar = 0;
      run(world, 0.2);
      expect(world.ai.state(enemy.id)?.mode).toBe('disengage');
      run(world, 14);
      expect(world.ai.state(enemy.id)?.mode).toBe('rtb');
      expect(enemy.weapons.lockId).toBeNull();
    }
  });
  it('keeps a wingman near its station, engages on command and rejoins', () => {
    const { world, enemy: wing, player } = setup(0);
    wing.faction = 'friendly';
    wing.ai = { role: 'wingman', leaderId: player.id };
    wing.state = { ...wing.state, ...offsetLatLon(player, -400, -400, R) };
    syncAircraft(wing);
    run(world, 90);
    const station = formationTarget(wing, player, 0, R, AI.tuning);
    expect(wing.alive).toBe(true);
    expect(length(enuOffset(wing, player, R))).toBeLessThan(900);
    expect(Math.abs(station.speed - length(player.velocity))).toBeLessThan(35);
    world.add(jet('bandit', 5000));
    world.ai.commandWingmen(true);
    expect(world.ai.state(wing.id)?.engageOrdered).toBe(true);
    world.ai.commandWingmen(false);
    expect(world.ai.state(wing.id)?.mode).toBe('patrol');
    expect(wing.weapons.lockId).toBeNull();
  });
  it('clears AI state on reset and repeats an identical engagement from the seed', () => {
    const a = setup(),
      b = setup();
    run(a.world, 8);
    run(b.world, 8);
    expect(a.enemy.state).toEqual(b.enemy.state);
    expect(a.world.ai.state('enemy')).toEqual(b.world.ai.state('enemy'));
    expect(a.world.entities.filter(isProjectile)).toEqual(b.world.entities.filter(isProjectile));
    a.world.clear();
    expect(a.world.ai.state('enemy')).toBeUndefined();
  });
  it('climbs over a 2000 m ridge and survives 10 minutes of alpine-style terrain', () => {
    const world = new World(sim, { ...sim.world, collisions: false });
    const e = jet('patrol', 0, 0, 90, 240, 1300);
    e.faction = 'friendly';
    e.behaviour = {
      mode: 'orbit',
      lat: 32,
      lon: 35.07,
      radius: 7000,
      altitude: 1600,
      speed: 240,
      clockwise: true,
    };
    world.add(e);
    const terrain = (lat: number, lon: number) =>
      2000 * Math.exp(-(((lon - 35.055) / 0.015) ** 2)) + 400 * Math.sin((lat - 32) * 70) ** 2;
    let minAGL = Infinity;
    for (let i = 0; i < 600 / DT; i++) {
      world.step(DT, NEUTRAL_CONTROLS, terrain);
      minAGL = Math.min(minAGL, e.height - terrain(e.lat, e.lon));
      if (!e.alive) break;
    }
    expect(e.alive).toBe(true);
    expect(minAGL).toBeGreaterThan(100);
    expect(world.time).toBeGreaterThan(599);
  }, 20000);
  it('validates AI roles and wingman references in mission files', () => {
    const spawn = {
      id: 'wing',
      kind: 'aircraft',
      type: 'f16',
      faction: 'friendly',
      lat: 32,
      lon: 35,
      height: 3000,
      heading: 90,
      speed: 200,
      ai: { role: 'wingman', leaderId: 'player' },
    };
    const mission = { name: 'test', description: 'test', entities: [spawn] },
      known = { aircraft: ['f16'], units: ['sam-site'] };
    expect(validateMission(mission, known).entities[0]?.ai?.role).toBe('wingman');
    for (const ai of [
      { role: 'sam' },
      { role: 'wingman', leaderId: 'missing' },
      { role: 'wingman', leaderId: 'wing' },
    ])
      expect(() => validateMission({ ...mission, entities: [{ ...spawn, ai }] }, known)).toThrow();
  });
});
describe('ground defences', () => {
  function range(role: 'sam' | 'aaa', distance: number) {
    const world = new World(sim, sim.world);
    const site = createSurfaceEntity({
      id: 'site',
      name: 'site',
      faction: 'hostile',
      type: getUnitType('sam-site'),
      lat: 32,
      lon: 35,
      groundHeight: 0,
      heading: 0,
      route: null,
      ai: { role, leaderId: '' },
    });
    const player = jet('player', distance, 0, 270, 200, 1000);
    world.add(site);
    world.add(player);
    return { world, site, player };
  }
  it('SAM searches, locks, launches and reloads; RWR receives the ground emitter', () => {
    const { world, site, player } = range('sam', 12000);
    run(world, 1);
    expect(world.ai.state(site.id)?.mode).toBe('detect');
    run(world, 1);
    expect(world.ai.state(site.id)?.lockId).toBe(player.id);
    expect(world.ai.state(site.id)?.ammo).toBe(AI.tuning.samAmmo - 1);
    expect(world.sensors.threats(player).some((t) => t.id === site.id && t.level === 'lock')).toBe(
      true,
    );
    run(world, 3);
    expect(world.ai.state(site.id)?.ammo).toBe(AI.tuning.samAmmo - 1);
  });
  it('ground radar loses masked targets and cannot fire without ammunition', () => {
    const { world, site, player } = range('sam', 12000);
    run(world, 2);
    const state = world.ai.state(site.id)!;
    state.ammo = 0;
    expect(world.combat.launchSurface(site, player, 'radar', vec3(1, 0, 0))).toBeNull();
    world.time += 1;
    world.sensors.step(() => 9000);
    world.ai.step(() => 9000);
    expect(state.lockId).toBeNull();
    expect(world.sensors.threats(player).some((t) => t.id === site.id)).toBe(false);
  });
  it('AAA fires a dispersed, lead-aimed burst with bounded ammo; inactive outside the zone', () => {
    const { world, site } = range('aaa', 2000);
    run(world, 2);
    expect(world.ai.state(site.id)?.ammo).toBe(AI.tuning.aaaAmmo - 12);
    const bullets = world.entities.filter(isProjectile);
    expect(bullets.length).toBe(12);
    expect(bullets[0]?.velocity).not.toEqual(bullets[1]?.velocity);
    const far = range('sam', 40000);
    run(far.world, 4);
    expect(far.world.entities.filter(isProjectile)).toHaveLength(0);
  });
});
