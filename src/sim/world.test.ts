import { describe, expect, it } from 'vitest';
import { getAircraftType } from '../aircraft';
import startJson from '../start.config.json';
import { getUnitType } from '../units';
import { attitudeFromHPR } from './attitude';
import { canCollide, findCollisions } from './collision';
import {
  type AircraftEntity,
  createAircraftEntity,
  createSurfaceEntity,
  createWaypointEntity,
} from './entities';
import { offsetLatLon } from './geo';
import { length, vec3 } from './math3d';
import { type FlightModel, NEUTRAL_CONTROLS, createInitialState } from './physics';
import { validateSimConfig } from './sim-config';
import { World } from './world';

const cfg = validateSimConfig(startJson);
const f16 = getAircraftType('f16');
const model: FlightModel = { aircraft: f16, ground: cfg.ground, environment: cfg.environment };
const R = cfg.environment.earthRadius;
const DT = 1 / 120;
const flat = () => 0;

function jet(
  id: string,
  lat: number,
  lon: number,
  height: number,
  heading = 90,
  speed = 200,
  player = false,
): AircraftEntity {
  return createAircraftEntity({
    id,
    name: id,
    faction: player ? 'player' : 'hostile',
    type: f16,
    model,
    state: createInitialState({ lat, lon, height, heading, speed }, 0, f16),
    controlledByPlayer: player,
    behaviour: { mode: 'straight' },
  });
}

function makeWorld() {
  return new World({ ground: cfg.ground, environment: cfg.environment }, cfg.world);
}

describe('World', () => {
  it('steps entities in kind order then insertion order, whatever the order they were added', () => {
    const w = makeWorld();
    w.add(createWaypointEntity({ id: 'wp', name: 'wp', lat: 32, lon: 35, height: 1000 }));
    w.add(
      createSurfaceEntity({
        id: 'sam',
        name: 'sam',
        faction: 'hostile',
        type: getUnitType('sam-site'),
        lat: 32,
        lon: 35,
        groundHeight: 100,
        heading: 0,
        route: null,
      }),
    );
    w.add(jet('b', 32, 35.1, 1000));
    w.add(jet('a', 32, 35.2, 1000));
    w.spawnProjectile({
      kind: 'bullet',
      ownerId: 'a',
      faction: 'hostile',
      lat: 32,
      lon: 35,
      height: 500,
      attitude: attitudeFromHPR({ heading: 0, pitch: 0, roll: 0 }),
      velocity: vec3(0, 0, 0),
      ttl: 1,
      dragFactor: 0,
      radius: 0.1,
      damage: 10,
    });
    expect(w.entities.map((e) => e.id)).toEqual(['b', 'a', 'sam', 'bullet-0', 'wp']);
  });

  it('flies AI aircraft with the autopilot and the player with the given controls', () => {
    const w = makeWorld();
    w.add(jet('player', 32, 35, 1000, 90, 200, true));
    w.add(jet('ai', 32.1, 35, 1000));
    for (let i = 0; i < 120; i++) w.step(DT, { ...NEUTRAL_CONTROLS, roll: 1 }, flat);
    const player = w.player() as AircraftEntity;
    const ai = w.get('ai') as AircraftEntity;
    expect(player.controls.roll).toBe(1);
    expect(ai.controls.throttle).toBeGreaterThan(0);
    expect(Math.abs(player.state.attitude.right.z)).toBeGreaterThan(0.3);
    expect(Math.abs(ai.state.attitude.right.z)).toBeLessThan(0.1);
    expect(w.time).toBeCloseTo(1);
    // Shared fields mirror the flight-model state.
    expect(ai.lat).toBe(ai.state.lat);
    expect(ai.height).toBe(ai.state.height);
  });

  it('moves surface units along their route on the terrain and ships at sea level', () => {
    const w = makeWorld();
    const start = { lat: 32, lon: 35 };
    const end = offsetLatLon(start, 500, 0, R);
    w.add(
      createSurfaceEntity({
        id: 'truck',
        name: 'truck',
        faction: 'hostile',
        type: getUnitType('truck'),
        ...start,
        groundHeight: 50,
        heading: 0,
        route: { waypoints: [{ ...end, height: 0 }], loop: false, index: 0 },
      }),
    );
    w.add(
      createSurfaceEntity({
        id: 'boat',
        name: 'boat',
        faction: 'hostile',
        type: getUnitType('patrol-boat'),
        lat: 32.2,
        lon: 34.7,
        groundHeight: 0,
        heading: 0,
        route: null,
      }),
    );
    const hilly = (_lat: number, lon: number) => 50 + (lon - 35) * 1e4;
    for (let i = 0; i < 120 * 10; i++) w.step(DT, NEUTRAL_CONTROLS, hilly);
    const truck = w.get('truck')!;
    expect(truck.lon).toBeGreaterThan(start.lon);
    expect(length(truck.velocity)).toBeCloseTo(getUnitType('truck').speed, 1);
    expect(truck.height).toBeCloseTo(hilly(truck.lat, truck.lon), 0);
    expect(truck.attitude.forward.x).toBeCloseTo(1, 1);
    const boat = w.get('boat')!;
    expect(boat.height).toBe(0);
    expect(length(boat.velocity)).toBe(0);
  });

  it('keeps the last known terrain height when the terrain is not loaded', () => {
    const w = makeWorld();
    w.add(
      createSurfaceEntity({
        id: 'truck',
        name: 'truck',
        faction: 'hostile',
        type: getUnitType('truck'),
        lat: 32,
        lon: 35,
        groundHeight: 320,
        heading: 0,
        route: null,
      }),
    );
    w.add(jet('j', 32, 35, 0));
    w.step(DT, NEUTRAL_CONTROLS, () => undefined);
    expect(w.get('truck')!.height).toBe(320);
    expect(w.get('j')!.groundHeight).toBe(0);
    w.step(DT, NEUTRAL_CONTROLS, (lat, lon) => (lon === 35 && lat === 32 ? 400 : undefined));
    expect(w.get('truck')!.height).toBe(400);
  });

  it('flies bullets ballistically, pools them and kills them on the ground or when expired', () => {
    const w = makeWorld();
    const spec = {
      kind: 'bullet' as const,
      ownerId: 'x',
      faction: 'hostile' as const,
      lat: 32,
      lon: 35,
      height: 100,
      attitude: attitudeFromHPR({ heading: 0, pitch: 0, roll: 0 }),
      velocity: vec3(0, 100, 0),
      ttl: 5,
      dragFactor: 0,
      radius: 0.1,
      damage: 10,
    };
    const b = w.spawnProjectile(spec)!;
    for (let i = 0; i < 120; i++) w.step(DT, NEUTRAL_CONTROLS, flat);
    expect(b.velocity.z).toBeCloseTo(-cfg.environment.gravity, 0);
    expect(b.height).toBeCloseTo(100 - 0.5 * cfg.environment.gravity, 0);
    expect(b.lat).toBeGreaterThan(32);
    for (let i = 0; i < 120 * 5; i++) w.step(DT, NEUTRAL_CONTROLS, flat);
    expect(b.alive).toBe(false);
    expect(b.deathReason).toBe('ground');
    // The dead bullet is reused before a new one is allocated.
    const again = w.spawnProjectile({ ...spec, ttl: 0.01 })!;
    expect(again).toBe(b);
    expect(again.alive).toBe(true);
    w.step(DT, NEUTRAL_CONTROLS, flat);
    w.step(DT, NEUTRAL_CONTROLS, flat);
    expect(again.deathReason).toBe('expired');
    const small = new World(
      { ground: cfg.ground, environment: cfg.environment },
      { ...cfg.world, maxBullets: 2 },
    );
    expect(small.spawnProjectile(spec)).not.toBeNull();
    expect(small.spawnProjectile(spec)).not.toBeNull();
    expect(small.spawnProjectile(spec)).toBeNull();
  });

  it('crashes both aircraft in a mid-air collision and reports it', () => {
    const w = makeWorld();
    w.add(jet('player', 32, 35, 1000, 90, 200, true));
    const ahead = offsetLatLon({ lat: 32, lon: 35 }, 60, 0, R);
    w.add(jet('bandit', ahead.lat, ahead.lon, 1000, 270, 200));
    let events = w.step(DT, NEUTRAL_CONTROLS, flat);
    let hit = events.collisions.length > 0;
    for (let i = 0; i < 120 && !hit; i++) {
      events = w.step(DT, NEUTRAL_CONTROLS, flat);
      hit = events.collisions.length > 0;
    }
    expect(hit).toBe(true);
    expect(events.deaths).toEqual(expect.arrayContaining(['player', 'bandit']));
    const player = w.player()!;
    expect(player.alive).toBe(false);
    expect(player.state.status).toBe('crashed');
    expect(player.state.crashReason).toBe('collision with bandit');
    expect(w.get('bandit')!.deathReason).toBe('collision with player');
  });

  it('a bullet damages an aircraft without destroying it outright and dies on impact', () => {
    const w = makeWorld();
    const target = jet('t', 32, 35, 1000, 90, 0);
    w.add(target);
    const b = w.spawnProjectile({
      kind: 'bullet',
      ownerId: 'x',
      faction: 'hostile',
      lat: 32,
      lon: 35,
      height: 1000,
      attitude: attitudeFromHPR({ heading: 0, pitch: 0, roll: 0 }),
      velocity: vec3(0, 0, 0),
      ttl: 5,
      dragFactor: 0,
      radius: 0.1,
      damage: 30,
    })!;
    w.step(DT, NEUTRAL_CONTROLS, flat);
    expect(target.health).toBe(70);
    expect(target.alive).toBe(true);
    expect(b.alive).toBe(false);
  });

  it('removes wrecks after the configured delay but keeps the player', () => {
    const w = new World(
      { ground: cfg.ground, environment: cfg.environment },
      { ...cfg.world, wreckRemoveSeconds: 1 },
    );
    w.add(jet('player', 32, 35, 1000, 90, 200, true));
    w.add(jet('ai', 32.1, 35, 1000));
    w.kill(w.get('ai')!, 'test');
    w.kill(w.player()!, 'test');
    let removed: string[] = [];
    for (let i = 0; i < 150; i++)
      removed = removed.concat(w.step(DT, NEUTRAL_CONTROLS, flat).removed);
    expect(removed).toEqual(['ai']);
    expect(w.get('ai')).toBeUndefined();
    expect(w.player()).toBeDefined();
  });

  it('enforces unique ids', () => {
    const w = makeWorld();
    w.add(jet('a', 32, 35, 1000));
    expect(() => w.add(jet('a', 32, 35, 1000))).toThrow(/duplicate entity id "a"/);
  });
});

describe('collision', () => {
  it('detects overlapping spheres once per pair and skips the excluded pairs', () => {
    const a = jet('a', 32, 35, 1000);
    const near = offsetLatLon({ lat: 32, lon: 35 }, 10, 0, R);
    const b = jet('b', near.lat, near.lon, 1000);
    const far = offsetLatLon({ lat: 32, lon: 35 }, 100, 0, R);
    const c = jet('c', far.lat, far.lon, 1000);
    const above = jet('d', 32, 35, 1030);
    const hits = findCollisions([a, b, c, above], R);
    expect(hits.map((h) => [h.a.id, h.b.id])).toEqual([['a', 'b']]);
    expect(hits[0]!.distance).toBeCloseTo(10, 0);
    const wp = createWaypointEntity({ id: 'wp', name: 'wp', lat: 32, lon: 35, height: 1000 });
    expect(canCollide(a, wp)).toBe(false);
    b.alive = false;
    expect(canCollide(a, b)).toBe(false);
  });

  it('never collides a projectile with its owner or another projectile', () => {
    const w = makeWorld();
    const shooter = jet('s', 32, 35, 1000);
    w.add(shooter);
    const spec = {
      kind: 'bullet' as const,
      ownerId: 's',
      faction: 'hostile' as const,
      lat: 32,
      lon: 35,
      height: 1000,
      attitude: shooter.attitude,
      velocity: vec3(0, 0, 0),
      ttl: 5,
      dragFactor: 0,
      radius: 0.1,
      damage: 10,
    };
    const b1 = w.spawnProjectile(spec)!;
    const b2 = w.spawnProjectile(spec)!;
    expect(canCollide(b1, shooter)).toBe(false);
    expect(canCollide(b1, b2)).toBe(false);
    expect(findCollisions(w.entities, R)).toEqual([]);
  });
});

describe('performance', () => {
  it('steps 30 aircraft and 200 bullets in under 2 ms on average', () => {
    const w = makeWorld();
    for (let i = 0; i < 30; i++) {
      const p = offsetLatLon({ lat: 32, lon: 35 }, (i % 6) * 800, Math.floor(i / 6) * 800, R);
      const e = jet(`j${i}`, p.lat, p.lon, 2000 + i * 20, (i * 37) % 360, 200, i === 0);
      e.behaviour = {
        mode: 'orbit',
        lat: 32.05,
        lon: 35.05,
        radius: 5000,
        altitude: 2500,
        speed: 220,
        clockwise: i % 2 === 0,
      };
      w.add(e);
    }
    for (let i = 0; i < 200; i++) {
      const p = offsetLatLon({ lat: 32, lon: 35 }, Math.random() * 4000, Math.random() * 4000, R);
      w.spawnProjectile({
        kind: 'bullet',
        ownerId: 'j0',
        faction: 'player',
        lat: p.lat,
        lon: p.lon,
        height: 2000,
        attitude: attitudeFromHPR({ heading: 0, pitch: 0, roll: 0 }),
        velocity: vec3(500, 500, 100),
        ttl: 30,
        dragFactor: 1e-4,
        radius: 0.2,
        damage: 5,
      });
    }
    for (let i = 0; i < 60; i++) w.step(DT, NEUTRAL_CONTROLS, flat); // warm up
    const steps = 240;
    const t0 = performance.now();
    for (let i = 0; i < steps; i++) w.step(DT, NEUTRAL_CONTROLS, flat);
    const perStep = (performance.now() - t0) / steps;
    expect(w.entities.length).toBe(230);
    expect(perStep).toBeLessThan(2);
  });
});
