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
import { type Vec3, add, scale, vec3 } from './math3d';
import { type Controls, NEUTRAL_CONTROLS, step as stepAircraftPhysics } from './physics';
import type { EnvironmentConfig, GroundConfig, WorldConfig } from './sim-config';

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

  constructor(
    readonly env: WorldEnvironment,
    readonly cfg: WorldConfig,
  ) {}

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
    const pool = this.list.filter((e): e is ProjectileEntity => e.kind === spec.kind);
    const dead = pool.find((e) => !e.alive);
    if (dead) {
      return initProjectile(dead, { ...spec, id: dead.id });
    }
    if (pool.length >= max) return null;
    const id = `${spec.kind}-${this.projectileCounter++}`;
    const e = initProjectile(null, { ...spec, id });
    this.add(e);
    return e;
  }

  /** Kills an entity: aircraft freeze as crashed, everything else just stops. */
  kill(e: Entity, reason: string): void {
    if (!e.alive) return;
    e.alive = false;
    e.health = 0;
    e.diedAt = this.time;
    e.deathReason = reason;
    if (isAircraft(e) && e.state.status !== 'crashed') {
      e.state = { ...e.state, status: 'crashed', crashReason: reason };
      syncAircraft(e);
    }
  }

  step(dt: number, playerControls: Controls, terrain: TerrainQuery): WorldEvents {
    const events: WorldEvents = { collisions: [], deaths: [], removed: [] };
    const R = this.env.environment.earthRadius;
    this.time += dt;

    for (const e of this.list) {
      if (!e.alive) continue;
      switch (e.kind) {
        case 'aircraft':
          this.stepAircraft(e, playerControls, terrain, dt);
          break;
        case 'ground-unit':
        case 'ship':
          this.stepSurface(e, terrain, dt, R);
          break;
        case 'bullet':
        case 'missile':
          this.stepProjectile(e, terrain, dt);
          break;
        default:
          break;
      }
      if (!e.alive) events.deaths.push(e.id);
    }

    if (this.cfg.collisions) {
      for (const { a, b } of findCollisions(this.list, R)) {
        events.collisions.push({ a: a.id, b: b.id });
        this.applyCollision(a, b, events);
      }
    }

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

  private stepProjectile(e: ProjectileEntity, terrain: TerrainQuery, dt: number): void {
    const env = this.env.environment;
    const speed = Math.hypot(e.velocity.x, e.velocity.y, e.velocity.z);
    const drag: Vec3 = scale(e.velocity, -e.dragFactor * speed);
    e.velocity = add(e.velocity, scale(add(drag, vec3(0, 0, -env.gravity)), dt));
    const next = offsetLatLon(e, e.velocity.x * dt, e.velocity.y * dt, env.earthRadius);
    e.lat = next.lat;
    e.lon = next.lon;
    e.height += e.velocity.z * dt;
    const g = terrain(e.lat, e.lon);
    if (g !== undefined) e.groundHeight = g;
    e.ttl -= dt;
    if (e.height <= e.groundHeight) this.kill(e, 'ground');
    else if (e.ttl <= 0) this.kill(e, 'expired');
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
