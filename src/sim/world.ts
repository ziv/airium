/**
 * The world: every entity, stepped in a deterministic order by one fixed
 * time step. Aircraft fly the flight model (the player with the pilot's
 * controls, the rest with the autopilot), surface units follow routes on the
 * terrain, projectiles fly ballistically, then collisions are resolved and
 * wrecks expire. Pure TypeScript, no Cesium.
 */
import { autopilot } from './autopilot';
import { aircraftTarget, surfaceMotion } from './behaviour';
import { findCollisions } from './collision';
import {
  type AircraftEntity,
  type Entity,
  type EntityKind,
  KIND_ORDER,
  type ProjectileEntity,
  type ProjectileSpec,
  type WaypointEntity,
  initProjectile,
  isAircraft,
  isProjectile,
  syncAircraft,
  type SurfaceEntity,
} from './entities';
import { offsetLatLon } from './geo';
import { attitudeFromHPR } from './attitude';
import { vec3 } from './math3d';
import { type Controls, NEUTRAL_CONTROLS, step as stepAircraftPhysics } from './physics';
import type { EnvironmentConfig, GroundConfig, WorldConfig } from './sim-config';
import { CombatSystem } from '../weapons/system';
import { WEAPONS, type WeaponsConfig } from '../weapons/config';
import { ballisticStep, movePosition, type Position } from '../weapons/ballistics';

/** Terrain height under a point from the renderer's loaded tiles, or undefined when unknown. */
export type TerrainQuery = (lat: number, lon: number) => number | undefined;

export interface WorldEvents {
  collisions: { a: string; b: string }[];
  /** Ids that died this step. */
  deaths: string[];
  /** Ids removed from the world this step (expired wrecks). */
  removed: string[];
}

export interface WorldEnvironment {
  ground: GroundConfig;
  environment: EnvironmentConfig;
}

export class World {
  /** Simulated seconds since the world was created. */
  time = 0;
  private list: Entity[] = [];
  private readonly byId = new Map<string, Entity>();
  private sequence = 0;
  private readonly order = new Map<string, number>();
  private projectileCounter = 0;
  readonly combat: CombatSystem;

  constructor(
    readonly env: WorldEnvironment,
    readonly cfg: WorldConfig,
    weapons: WeaponsConfig = WEAPONS,
  ) {
    this.combat = new CombatSystem(this, weapons);
  }

  get entities(): readonly Entity[] {
    return this.list;
  }

  get(id: string): Entity | undefined {
    return this.byId.get(id);
  }

  player(): AircraftEntity | undefined {
    return this.list.find((e): e is AircraftEntity => isAircraft(e) && e.controlledByPlayer);
  }

  aircraft(): AircraftEntity[] {
    return this.list.filter(isAircraft);
  }

  waypoints(): WaypointEntity[] {
    return this.list.filter((e): e is WaypointEntity => e.kind === 'waypoint');
  }

  add(entity: Entity): void {
    if (this.byId.has(entity.id)) throw new Error(`duplicate entity id "${entity.id}"`);
    this.byId.set(entity.id, entity);
    this.order.set(entity.id, this.sequence++);
    this.list.push(entity);
    this.sort();
  }

  remove(id: string): boolean {
    const e = this.byId.get(id);
    if (!e) return false;
    this.byId.delete(id);
    this.order.delete(id);
    this.list = this.list.filter((x) => x !== e);
    return true;
  }

  clear(): void {
    this.list = [];
    this.byId.clear();
    this.order.clear();
    this.time = 0;
    this.sequence = 0;
    this.projectileCounter = 0;
    this.combat.reset();
  }

  /** Update order: by kind, then by insertion. */
  private sort(): void {
    this.list.sort(
      (a, b) =>
        KIND_ORDER[a.kind] - KIND_ORDER[b.kind] ||
        (this.order.get(a.id) ?? 0) - (this.order.get(b.id) ?? 0),
    );
  }

  /**
   * Launches a projectile, reusing a dead one of the same kind when the pool
   * is full. Returns null when the pool is full of live projectiles.
   */
  spawnProjectile(spec: Omit<ProjectileSpec, 'id'>): ProjectileEntity | null {
    const max = spec.kind === 'bullet' ? this.cfg.maxBullets : this.cfg.maxMissiles;
    const pool = this.list.filter(
      (e): e is ProjectileEntity =>
        isProjectile(e) && (spec.kind === 'bullet' ? e.kind === 'bullet' : e.kind !== 'bullet'),
    );
    const dead = pool.find((e) => !e.alive && e.kind === spec.kind);
    if (dead) {
      return initProjectile(dead, { ...spec, id: dead.id });
    }
    if (pool.length >= max) {
      const reusable = pool.find((e) => !e.alive);
      if (!reusable) return null;
      initProjectile(reusable, { ...spec, id: reusable.id });
      this.sort();
      return reusable;
    }
    const id = `${spec.kind}-${this.projectileCounter++}`;
    const e = initProjectile(null, { ...spec, id });
    this.add(e);
    return e;
  }

  /** Death is idempotent; credit/effects happen once. Non-player aircraft become falling wrecks. */
  kill(e: Entity, reason: string, ownerId?: string): void {
    if (!e.alive) return;
    e.alive = false;
    e.health = 0;
    e.diedAt = this.time;
    e.deathReason = reason;
    this.combat.destroyed(e, ownerId);
    if (isAircraft(e) && e.state.status !== 'crashed') {
      e.state = { ...e.state, status: 'crashed', crashReason: reason };
      syncAircraft(e);
    }
  }

  step(dt: number, playerControls: Controls, terrain: TerrainQuery): WorldEvents {
    const events: WorldEvents = { collisions: [], deaths: [], removed: [] };
    if (dt <= 0) return events;
    const R = this.env.environment.earthRadius;
    const previous = new Map<string, Position>();
    const living = new Set(this.list.filter((e) => e.alive).map((e) => e.id));
    for (const e of this.list)
      if (e.alive && !isProjectile(e))
        previous.set(e.id, { lat: e.lat, lon: e.lon, height: e.height });
    this.time += dt;
    this.combat.step(dt);

    for (const e of this.list) {
      if (!e.alive) {
        this.stepWreck(e, terrain, dt);
        continue;
      }
      if (isAircraft(e)) this.stepAircraft(e, playerControls, terrain, dt);
      else if (e.kind === 'ground-unit' || e.kind === 'ship') this.stepSurface(e, terrain, dt, R);
    }
    // Spawning can sort the list, so finish solid updates before weapons.
    for (const e of this.aircraft()) if (e.alive) this.combat.fire(e, e.controls.fire ?? false, dt);
    for (const e of this.list)
      if (isProjectile(e) && e.alive) this.combat.stepProjectile(e, terrain, dt, previous);

    if (this.cfg.collisions) {
      for (const { a, b } of findCollisions(
        this.list.filter((e) => !isProjectile(e)),
        R,
      )) {
        if (!a.alive || !b.alive) continue;
        events.collisions.push({ a: a.id, b: b.id });
        this.applyCollision(a, b, events);
      }
    }
    events.deaths = this.list.filter((e) => living.has(e.id) && !e.alive).map((e) => e.id);

    // Expire wrecks; projectiles stay in the list as pool entries.
    for (const e of this.list) {
      if (e.alive || e.diedAt === null || isProjectile(e)) continue;
      if (isAircraft(e) && e.controlledByPlayer) continue;
      if (this.time - e.diedAt > this.cfg.wreckRemoveSeconds) events.removed.push(e.id);
    }
    for (const id of events.removed) this.remove(id);
    return events;
  }

  private stepAircraft(
    e: AircraftEntity,
    playerControls: Controls,
    terrain: TerrainQuery,
    dt: number,
  ): void {
    const controls = e.controlledByPlayer
      ? playerControls
      : autopilot(
          e.state,
          aircraftTarget(e, this.env.environment.earthRadius),
          e.type,
          this.env.environment.gravity,
        );
    e.controls = controls;
    e.state = stepAircraftPhysics(e.state, controls, e.model, terrain(e.lat, e.lon), dt);
    if (e.systems.fuelLeak > 0)
      e.state = { ...e.state, fuel: Math.max(0, e.state.fuel - e.systems.fuelLeak * dt) };
    syncAircraft(e);
    if (e.state.status === 'crashed') this.kill(e, e.state.crashReason ?? 'crashed');
  }

  private stepSurface(e: SurfaceEntity, terrain: TerrainQuery, dt: number, R: number): void {
    const motion = surfaceMotion(e, R);
    if (motion) {
      e.heading = motion.heading;
      e.attitude = attitudeFromHPR({ heading: e.heading, pitch: 0, roll: 0 });
      const east = Math.sin(e.heading) * motion.speed;
      const north = Math.cos(e.heading) * motion.speed;
      e.velocity = vec3(east, north, 0);
      const next = offsetLatLon(e, east * dt, north * dt, R);
      e.lat = next.lat;
      e.lon = next.lon;
    } else {
      e.velocity = vec3(0, 0, 0);
    }
    if (e.kind === 'ship') {
      e.height = 0;
    } else {
      const g = terrain(e.lat, e.lon);
      if (g !== undefined) e.groundHeight = g;
      e.height = e.groundHeight;
    }
  }

  private stepWreck(e: Entity, terrain: TerrainQuery, dt: number): void {
    if (!isAircraft(e) || e.controlledByPlayer) return;
    const ground = terrain(e.lat, e.lon) ?? e.groundHeight;
    if (e.height <= ground) {
      e.height = ground;
      e.velocity = vec3(0, 0, 0);
    } else {
      const step = ballisticStep(e.velocity, dt, this.env.environment.gravity, 0.001);
      Object.assign(e, movePosition(e, step.displacement, this.env.environment.earthRadius));
      e.velocity = step.velocity;
      e.height = Math.max(e.height, terrain(e.lat, e.lon) ?? ground);
    }
    e.groundHeight = terrain(e.lat, e.lon) ?? ground;
    e.state = {
      ...e.state,
      lat: e.lat,
      lon: e.lon,
      height: e.height,
      velocity: e.velocity,
      groundHeight: e.groundHeight,
    };
  }

  private applyCollision(a: Entity, b: Entity, events: WorldEvents): void {
    a.health -= b.impactDamage;
    b.health -= a.impactDamage;
    const reasonFor = (other: Entity) =>
      isProjectile(other) ? `hit by ${other.name}` : `collision with ${other.name}`;
    for (const [e, other] of [
      [a, b],
      [b, a],
    ] as const) {
      if (isProjectile(e)) {
        this.kill(e, 'impact');
      } else if (e.health <= 0 && e.alive) {
        this.kill(e, reasonFor(other));
        events.deaths.push(e.id);
      }
    }
  }
}

/** Kinds that are drawn as something more than a point. */
export const MODELLED_KINDS: readonly EntityKind[] = ['aircraft', 'ground-unit', 'ship'];

/** Convenience for tests and tools: an idle controls record. */
export const NO_CONTROLS: Controls = NEUTRAL_CONTROLS;
