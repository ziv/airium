import { describe, expect, it } from 'vitest';
import { getAircraftType } from '../aircraft';
import { getUnitType } from '../units';
import { attitudeFromHPR } from '../sim/attitude';
import {
  createAircraftEntity,
  createSurfaceEntity,
  isProjectile,
  syncAircraft,
  type AircraftEntity,
} from '../sim/entities';
import { enuOffset } from '../sim/geo';
import { type Vec3, ZERO, add, sub, scale, length, normalize, vec3 } from '../sim/math3d';
import { createInitialState, NEUTRAL_CONTROLS, computeForces } from '../sim/physics';
import { validateSimConfig } from '../sim/sim-config';
import { World } from '../sim/world';
import startJson from '../start.config.json';
import source from './weapons.json';
import { WEAPONS, validateWeapons, validateLoadout } from './config';
import {
  ballisticStep,
  blastDamage,
  gunLead,
  movePosition,
  predictImpact,
  proportionalNavigation,
  segmentSphere,
  terrainImpact,
} from './ballistics';
import { decoyProbability, launchEnvelope, targetList } from './targeting';
import { buildCombatHud } from '../hud/combat-data';

const sim = validateSimConfig(startJson),
  R = sim.environment.earthRadius,
  G = sim.environment.gravity;
const DT = 1 / 120,
  flat = () => 0,
  controls = { ...NEUTRAL_CONTROLS, throttle: 0.7 };
const origin = { lat: 32, lon: 35, height: 3000 };
const f16 = getAircraftType('f16');

function aircraft(id: string, offset = ZERO, player = false, speed = 200): AircraftEntity {
  const position = movePosition(origin, offset, R);
  const e = createAircraftEntity({
    id,
    name: id,
    faction: player ? 'player' : 'hostile',
    type: f16,
    model: { aircraft: f16, environment: sim.environment, ground: sim.ground },
    state: createInitialState({ ...position, heading: 90, speed }, 0, f16),
    controlledByPlayer: player,
    behaviour: { mode: 'straight' },
  });
  return e;
}
function setup(offset = vec3(1500, 0, 0), config = WEAPONS) {
  const world = new World(sim, sim.world, structuredClone(config));
  const player = aircraft('player', ZERO, true),
    target = aircraft('drone', offset);
  world.add(player);
  world.add(target);
  return { world, player, target };
}
function aim(owner: AircraftEntity, direction: Vec3): void {
  const n = normalize(direction);
  owner.state = {
    ...owner.state,
    attitude: attitudeFromHPR({ heading: Math.atan2(n.x, n.y), pitch: Math.asin(n.z), roll: 0 }),
    bodyRates: { roll: 0, pitch: 0, yaw: 0 },
  };
  syncAircraft(owner);
}

describe('weapon configuration', () => {
  it('validates all five weapons and the F-16 inventory', () => {
    expect(WEAPONS.types.gun.muzzleVelocity).toBe(1050);
    expect(f16.combat.gun).toBe(510);
    expect(WEAPONS.types.ir.maxG).toBe(25);
    expect(WEAPONS.types.radar.maxRange).toBeGreaterThanOrEqual(60000);
  });
  it('rejects malformed ranges, seeker cones, burn times, probability and fractional ammunition', () => {
    for (const fields of [
      { minRange: 20000 },
      { seekerCone: 100 },
      { burnTime: 200 },
      { fuzeRadius: 200 },
      { maxG: NaN },
      { seeker: 'radar' },
      { typo: 1 },
    ]) {
      expect(() =>
        validateWeapons({
          ...source,
          types: { ...source.types, ir: { ...source.types.ir, ...fields } },
        }),
      ).toThrow();
    }
    expect(() =>
      validateWeapons({
        ...source,
        countermeasures: { ...source.countermeasures, flareChance: 1.1 },
      }),
    ).toThrow();
    expect(() => validateLoadout({ ...f16.combat, gun: 1.5 })).toThrow();
  });
});

describe('ballistics and swept intersections', () => {
  it('matches analytic gravity-only drop and displacement', () => {
    let p = ZERO,
      v = vec3(1050, 0, 100);
    for (let i = 0; i < 360; i++) {
      const s = ballisticStep(v, DT, G, 0);
      p = add(p, s.displacement);
      v = s.velocity;
    }
    expect(p.x).toBeCloseTo(3150, 7);
    expect(p.z).toBeCloseTo(300 - 0.5 * G * 9, 7);
    expect(v.z).toBeCloseTo(100 - G * 3, 7);
    const drag = ballisticStep(vec3(1050, 0, 0), DT, G, 0.00012);
    expect(drag.velocity.x).toBeLessThan(1050);
  });
  it('finds the first segment-sphere entry, tangent, inside and misses', () => {
    expect(segmentSphere(vec3(-100, 0, 0), vec3(100, 0, 0), 8)).toBeCloseTo(0.46);
    expect(segmentSphere(vec3(-10, 8, 0), vec3(10, 8, 0), 8)).toBeCloseTo(0.5);
    expect(segmentSphere(ZERO, ZERO, 8)).toBe(0);
    expect(segmentSphere(vec3(10, 0, 0), vec3(10, 0, 0), 8)).toBeNull();
    expect(segmentSphere(vec3(-100, 9, 0), vec3(100, 9, 0), 8)).toBeNull();
  });
  it('detects a ridge crossed between endpoints, with a last-known-height fallback', () => {
    const end = movePosition(origin, vec3(100, 0, 0), R);
    const hill = (lat: number, lon: number) =>
      Math.abs(enuOffset(origin, { lat, lon }, R).x - 50) < 15 ? 3100 : 0;
    expect(terrainImpact(origin, end, hill, 0, R)?.fraction).toBeLessThan(0.7);
    const ground = terrainImpact(
      { ...origin, height: 101 },
      { ...origin, height: 90 },
      () => undefined,
      100,
      R,
    );
    expect(ground?.point.height).toBe(100);
  });
  it('hits the nearest crossed target once even when the bullet moves 100 metres in one step', () => {
    const { world, player, target } = setup(vec3(50, 0, 0));
    const farther = aircraft('farther', vec3(80, 0, 0));
    world.add(farther);
    const p = world.spawnProjectile({
      kind: 'bullet',
      ownerId: player.id,
      faction: 'player',
      ...origin,
      attitude: player.attitude,
      velocity: vec3(12000, 0, 0),
      ttl: 1,
      dragFactor: 0,
      radius: 0.05,
      damage: 30,
    })!;
    world.step(DT, controls, flat);
    expect(p.alive).toBe(false);
    expect(target.health).toBe(70);
    expect(farther.health).toBe(100);
  });
  it('sweeps target motion as well as bullet motion', () => {
    const { world, player, target } = setup(vec3(0, -30, 0));
    target.state = { ...target.state, velocity: vec3(0, 7200, 0) };
    syncAircraft(target);
    const p = world.spawnProjectile({
      kind: 'bullet',
      ownerId: player.id,
      faction: 'player',
      ...origin,
      attitude: player.attitude,
      velocity: ZERO,
      ttl: 1,
      dragFactor: 0,
      radius: 0.05,
      damage: 30,
    })!;
    world.step(DT, controls, flat);
    expect(p.alive).toBe(false);
    expect(target.health).toBe(70);
  });
});

describe('cannon and inventory', () => {
  it('fires 100 rounds per second, consumes exactly 510 rounds, and clicks once on an empty press', () => {
    const { world, player, target } = setup(vec3(0, 10000, 0));
    world.remove(target.id);
    for (let i = 0; i < 120; i++) world.step(DT, { ...controls, fire: true }, flat);
    expect(player.weapons.ammo.gun).toBe(410);
    for (let i = 0; i < 600; i++) world.step(DT, { ...controls, fire: true }, flat);
    expect(player.weapons.ammo.gun).toBe(0);
    expect(world.entities.filter(isProjectile).length).toBeLessThanOrEqual(sim.world.maxBullets);
    world.combat.takeEvents();
    world.step(DT, controls, flat);
    for (let i = 0; i < 10; i++) world.step(DT, { ...controls, fire: true }, flat);
    expect(world.combat.takeEvents().filter((e) => e.kind === 'empty')).toHaveLength(1);
  });
  it('starts at the body-frame muzzle with inherited aircraft velocity and repeatable dispersion', () => {
    const a = setup(),
      b = setup();
    const p = a.world.combat.launch(a.player, 'gun')!,
      q = b.world.combat.launch(b.player, 'gun')!;
    expect(p.velocity).toEqual(q.velocity);
    const muzzle = enuOffset(a.player, p, R);
    expect(muzzle.x).toBeCloseTo(7, 5);
    expect(muzzle.y).toBeCloseTo(0.7, 5);
    expect(muzzle.z).toBeCloseTo(-0.2);
    expect(length(sub(p.velocity, a.player.velocity))).toBeCloseTo(1050);
    expect(a.player.weapons.ammo.gun).toBe(509);
  });
  it('computes positive lead and gravity compensation, and destroys a drone with the cannon', () => {
    const lead = gunLead(vec3(500, 0, 0), vec3(0, 100, 0), 1050, 0, G, 3)!;
    expect(lead.direction.y).toBeGreaterThan(0);
    expect(lead.direction.z).toBeGreaterThan(0);
    const { world, player, target } = setup(vec3(500, 0, 0));
    for (let i = 0; i < 600 && target.alive; i++) {
      const sight = gunLead(
        enuOffset(world.combat.muzzle(player, 'gun'), target, R),
        sub(target.velocity, player.velocity),
        1050,
        WEAPONS.types.gun.dragFactor,
        G,
        3,
      )!;
      aim(player, sight.direction);
      world.step(DT, { ...controls, fire: true }, flat);
    }
    expect(target.alive).toBe(false);
    expect(target.killedBy).toBe(player.id);
    expect(player.weapons.kills).toBe(1);
  });
  it('does not consume ammunition when the pool is full and clears the complete combat state on restart', () => {
    const { world, player } = setup();
    for (let i = 0; i < sim.world.maxBullets; i++)
      expect(world.combat.launch(player, 'gun')).not.toBeNull();
    const ammo = player.weapons.ammo.gun;
    expect(world.combat.launch(player, 'gun')).toBeNull();
    expect(player.weapons.ammo.gun).toBe(ammo);
    world.combat.command(player.id, 'countermeasures');
    world.clear();
    expect(world.time).toBe(0);
    expect(world.entities).toEqual([]);
    expect(world.combat.effects).toEqual([]);
    expect(world.combat.takeEvents()).toEqual([]);
    const fresh = aircraft('player', ZERO, true);
    world.add(fresh);
    world.step(DT, controls, flat);
    expect(fresh.weapons.ammo.gun).toBe(510);
    expect(fresh.weapons.flare).toBe(30);
  });
});

describe('missile guidance and launch envelope', () => {
  it('PN intercepts a constant-velocity crossing target under the g clamp', () => {
    let missile = ZERO,
      target = vec3(2000, 400, 0),
      velocity = vec3(650, 0, 0);
    const targetVelocity = vec3(150, 150, 0);
    let miss = Infinity;
    for (let i = 0; i < 1200; i++) {
      const demand = proportionalNavigation(
        sub(target, missile),
        sub(targetVelocity, velocity),
        velocity,
        4,
        25 * G,
      );
      expect(length(demand)).toBeLessThanOrEqual(25 * G + 1e-8);
      velocity = scale(normalize(add(velocity, scale(demand, DT))), 650);
      missile = add(missile, scale(velocity, DT));
      target = add(target, scale(targetVelocity, DT));
      miss = Math.min(miss, length(sub(target, missile)));
    }
    expect(miss).toBeLessThan(7);
  });
  it('gates Rmin/Rmax, cone, lock and IFF, including boresight IR acquisition', () => {
    const { world, player, target } = setup();
    const cfg = WEAPONS.types.ir;
    expect(launchEnvelope(player, target, cfg, true, R).allowed).toBe(true);
    expect(launchEnvelope(player, target, cfg, false, R).reason).toBe('NO LOCK');
    expect(
      launchEnvelope(
        player,
        { ...target, ...movePosition(player, vec3(100, 0, 0), R) },
        cfg,
        true,
        R,
      ).reason,
    ).toBe('TOO CLOSE');
    expect(
      launchEnvelope(
        player,
        { ...target, ...movePosition(player, vec3(19000, 0, 0), R) },
        cfg,
        true,
        R,
      ).reason,
    ).toBe('OUT OF RANGE');
    expect(
      launchEnvelope(
        player,
        { ...target, ...movePosition(player, vec3(100, 1000, 0), R) },
        cfg,
        true,
        R,
      ).reason,
    ).toBe('OUT OF CONE');
    expect(launchEnvelope(player, { ...target, faction: 'friendly' }, cfg, true, R).allowed).toBe(
      false,
    );
    expect(world.combat.launch(player, 'radar')).toBeNull();
    expect(world.combat.launch(player, 'ir')).not.toBeNull();
    expect(player.weapons.ammo.ir).toBe(1);
  });
  it('destroys a drone with an IR missile through the full world simulation', () => {
    const { world, player, target } = setup();
    const missile = world.combat.launch(player, 'ir')!;
    expect(missile.guidance).toBe('tracking');
    for (let i = 0; i < 2400 && missile.alive; i++) world.step(DT, controls, flat);
    expect(missile.deathReason).toBe('impact');
    expect(target.alive).toBe(false);
    expect(target.killedBy).toBe(player.id);
    expect(player.weapons.kills).toBe(1);
  });
  it('loses IR tracking outside the gimbal and does not reacquire', () => {
    const { world, player, target } = setup();
    const missile = world.combat.launch(player, 'ir')!;
    target.state = { ...target.state, ...movePosition(player, vec3(-1000, 0, 0), R) };
    syncAircraft(target);
    for (let i = 0; i < 30; i++) world.step(DT, controls, flat);
    expect(missile.guidance).toBe('lost');
    target.state = { ...target.state, ...movePosition(missile, vec3(1000, 0, 0), R) };
    syncAircraft(target);
    world.step(DT, controls, flat);
    expect(missile.guidance).toBe('lost');
  });
  it('uses radar datalink until active, then survives launcher unlock', () => {
    const { world, player, target } = setup(vec3(18000, 0, 0));
    player.weapons.targetId = target.id;
    player.weapons.lockId = target.id;
    const missile = world.combat.launch(player, 'radar')!;
    expect(missile.guidance).toBe('tracking');
    for (let i = 0; i < 3600 && missile.guidance !== 'active'; i++) world.step(DT, controls, flat);
    expect(missile.guidance).toBe('active');
    player.weapons.lockId = null;
    for (let i = 0; i < 120; i++) world.step(DT, controls, flat);
    expect(missile.guidance).toBe('active');
    const other = setup(vec3(25000, 0, 0));
    other.player.weapons.lockId = other.target.id;
    const lost = other.world.combat.launch(other.player, 'radar')!;
    other.player.weapons.lockId = null;
    for (let i = 0; i < 40; i++) other.world.step(DT, controls, flat);
    expect(lost.guidance).toBe('lost');
  });
  it('launches one missile per trigger press and cycles targets nearest first', () => {
    const { world, player, target } = setup();
    const friend = aircraft('friend', vec3(800, 0, 0));
    friend.faction = 'friendly';
    world.add(friend);
    const far = aircraft('far', vec3(3000, 0, 0));
    world.add(far);
    expect(targetList(player, world.entities, R, 18000).map((e) => e.id)).toEqual([
      target.id,
      far.id,
    ]);
    world.combat.command(player.id, 'target');
    world.combat.command(player.id, 'selectIR');
    for (let i = 0; i < 240; i++) world.step(DT, { ...controls, fire: true }, flat);
    expect(player.weapons.ammo.ir).toBe(1);
    expect(player.weapons.targetId).toBe(target.id);
  });
});

describe('countermeasures', () => {
  it('depends on seeker type, aspect and range, with zero mismatched-decoy probability', () => {
    const cfg = WEAPONS.countermeasures;
    expect(decoyProbability('ir', 'chaff', 0, 1000, cfg)).toBe(0);
    expect(decoyProbability('radar', 'flare', 0, 1000, cfg)).toBe(0);
    expect(decoyProbability('ir', 'flare', 0, 7000, cfg)).toBe(0);
    expect(decoyProbability('ir', 'flare', 0, 1000, cfg)).toBeGreaterThan(
      decoyProbability('ir', 'flare', 1, 1000, cfg),
    );
    expect(decoyProbability('ir', 'flare', 0, 1000, cfg)).toBeGreaterThan(
      decoyProbability('ir', 'flare', 0, 5000, cfg),
    );
  });
  it('decoys an incoming missile, consumes a packet once and renders expiring decoys', () => {
    // A fixed seed exercises a successful packet; failure probabilities are tested separately.
    const { world, player, target: enemy } = setup(vec3(-1500, 0, 0), { ...WEAPONS, seed: 2 });
    enemy.weapons.lockId = player.id;
    const missile = world.combat.launch(enemy, 'ir')!;
    expect(missile).not.toBeNull();
    world.combat.command(player.id, 'countermeasures');
    world.combat.command(player.id, 'countermeasures');
    world.step(DT, controls, flat);
    expect(player.weapons.flare).toBe(29);
    expect(player.weapons.chaff).toBe(29);
    expect(missile.guidance).toBe('lost');
    expect(
      world.combat.effects.filter((e) => e.kind === 'flare' || e.kind === 'chaff'),
    ).toHaveLength(2);
    for (let i = 0; i < 600; i++) world.step(DT, controls, flat);
    expect(
      world.combat.effects.filter((e) => e.kind === 'flare' || e.kind === 'chaff'),
    ).toHaveLength(0);
    expect(player.alive).toBe(true);
  });
});

describe('ground attack and damage', () => {
  it('predicts CCIP on flat terrain against analytic vacuum impact', () => {
    const start = { ...origin, height: 1000 },
      v = vec3(200, 0, 0);
    const result = predictImpact(start, v, G, 0, R, flat, 0, 90)!;
    const time = Math.sqrt(2000 / G);
    expect(result.time).toBeCloseTo(time, 3);
    expect(enuOffset(start, result.point, R).x).toBeCloseTo(200 * time, 2);
    expect(predictImpact(start, v, 0, 0, R, flat, 0, 1)).toBeNull();
  });
  it('a released bomb hits within two metres of CCIP and destroys a ground target', () => {
    const { world, player, target } = setup();
    world.remove(target.id);
    player.weapons.selected = 'bomb';
    const cfg = WEAPONS.types.bomb;
    const prediction = predictImpact(
      world.combat.muzzle(player, 'bomb'),
      player.velocity,
      G,
      cfg.dragFactor,
      R,
      flat,
      0,
      cfg.lifetime,
    )!;
    const site = createSurfaceEntity({
      id: 'site',
      name: 'site',
      faction: 'hostile',
      type: getUnitType('sam-site'),
      ...prediction.point,
      groundHeight: 0,
      heading: 0,
      route: null,
    });
    world.add(site);
    const bomb = world.combat.launch(player, 'bomb')!;
    for (let i = 0; i < 6000 && bomb.alive; i++) world.step(DT, controls, flat);
    // Sphere contact occurs slightly above ground; compare a terrain-only release separately.
    expect(site.alive).toBe(false);
    expect(player.weapons.kills).toBe(1);
    const empty = setup();
    empty.world.remove(empty.target.id);
    const freeBomb = empty.world.combat.launch(empty.player, 'bomb')!;
    for (let i = 0; i < 6000 && freeBomb.alive; i++) empty.world.step(DT, controls, flat);
    expect(length(enuOffset(prediction.point, freeBomb, R))).toBeLessThan(2);
  });
  it('rockets burn their motor, fly unguided and release repeatedly while held', () => {
    const { world, player } = setup(vec3(0, 10000, 0));
    player.weapons.selected = 'rocket';
    for (let i = 0; i < 120; i++) world.step(DT, { ...controls, fire: true }, flat);
    expect(player.weapons.ammo.rocket).toBe(9);
    const rocket = world.entities.find((e) => e.kind === 'rocket')!;
    expect(length(rocket.velocity)).toBeGreaterThan(400);
  });
  it('warhead falloff and system damage reduce thrust, control rates and fuel', () => {
    expect(blastDamage(200, 0, 40)).toBe(200);
    expect(blastDamage(200, 20, 40)).toBe(100);
    expect(blastDamage(200, 40, 40)).toBe(0);
    expect(blastDamage(200, 80, 40)).toBe(0);
    const { world, player, target } = setup();
    player.state = { ...player.state, throttle: 1 };
    const thrust = computeForces(player.state, player.model).thrustMagnitude;
    world.combat.damage(player, 50, target.id, 'gun hit');
    expect(player.health).toBe(50);
    expect(player.systems.fuelLeak).toBe(4);
    expect(computeForces(player.state, player.model).thrustMagnitude).toBeLessThan(thrust);
    expect(player.model.aircraft.controls.pitchRate).toBeLessThan(f16.controls.pitchRate);
    const fuel = player.state.fuel;
    world.step(0.1, controls, flat);
    expect(player.state.fuel).toBeLessThan(fuel - 0.4);
    world.combat.damage(player, 1000, target.id, 'destroyed by AIM-9');
    expect(player.state.status).toBe('crashed');
    expect(player.state.crashReason).toBe('destroyed by AIM-9');
    expect(player.killedBy).toBe(target.id);
  });
  it('creates one explosion/kill credit, falls as a wreck and removes it after the timeout', () => {
    const { world, player, target } = setup();
    world.combat.damage(target, 200, player.id, 'gun hit');
    world.combat.damage(target, 200, player.id, 'gun hit');
    expect(player.weapons.kills).toBe(1);
    expect(world.combat.effects.filter((e) => e.kind === 'explosion')).toHaveLength(1);
    const height = target.height;
    for (let i = 0; i < 240; i++) world.step(DT, controls, flat);
    expect(target.height).toBeLessThan(height);
    for (let i = 0; i < 3600; i++) world.step(DT, controls, flat);
    expect(world.get(target.id)).toBeUndefined();
  });
  it('exposes real weapon counts, locks, shoot cues, LCOS, CCIP and system warnings to the HUD', () => {
    const { world, player, target } = setup();
    player.weapons.targetId = target.id;
    expect(buildCombatHud(player, world, flat).pipper?.label).toBe('LCOS');
    player.weapons.selected = 'ir';
    const ir = buildCombatHud(player, world, flat);
    expect(ir.shoot).toBe(true);
    expect(ir.target?.locked).toBe(true);
    expect(ir.label).toContain('2');
    expect(ir.envelope?.max).toBe(18000);
    player.weapons.selected = 'bomb';
    expect(buildCombatHud(player, world, flat).pipper?.label).toBe('CCIP');
    world.combat.damage(player, 30, target.id, 'gun hit');
    expect(buildCombatHud(player, world, flat).systems).toContain('FUEL LEAK');
  });
});
