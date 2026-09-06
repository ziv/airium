/**
 * Everything that lives in the world besides terrain. Entities are plain
 * mutable records updated in place by `World.step`; the aircraft kind wraps
 * the immutable `AircraftState` of the flight model.
 */
import type { AircraftType } from '../aircraft/aircraft-type';
import type { UnitType } from '../units/unit-type';
import type { WeaponId } from '../weapons/config';
import { createWeaponState, type WeaponState } from '../weapons/state';
import type { Position } from '../weapons/ballistics';
import { type Attitude, attitudeFromHPR } from './attitude';
import { type Vec3, ZERO, toRadians } from './math3d';
import { type AircraftState, type Controls, type FlightModel, NEUTRAL_CONTROLS } from './physics';

export type EntityKind =
  'aircraft' | 'missile' | 'bullet' | 'bomb' | 'rocket' | 'ground-unit' | 'ship' | 'waypoint';
export type Faction = 'player' | 'friendly' | 'hostile' | 'neutral';

/** Update order within a step; lower first. */
export const KIND_ORDER: Record<EntityKind, number> = {
  aircraft: 0,
  'ground-unit': 1,
  ship: 2,
  missile: 3,
  bullet: 4,
  bomb: 5,
  rocket: 6,
  waypoint: 7,
};

export interface Waypoint {
  lat: number;
  lon: number;
  /** Metres above the ellipsoid (aircraft); ignored by surface units. */
  height: number;
  /** m/s; default = the entity's cruise speed. */
  speed?: number;
}

export interface Route {
  waypoints: Waypoint[];
  loop: boolean;
  index: number;
}

export type Behaviour =
  | { mode: 'straight' }
  | {
      mode: 'orbit';
      lat: number;
      lon: number;
      /** Metres. */
      radius: number;
      /** Metres above the ellipsoid. */
      altitude: number;
      speed: number;
      clockwise: boolean;
    }
  | { mode: 'waypoints'; route: Route };

export interface EntityBase {
  id: string;
  name: string;
  kind: EntityKind;
  faction: Faction;
  lat: number;
  lon: number;
  /** Metres above the ellipsoid. */
  height: number;
  attitude: Attitude;
  /** ENU m/s. */
  velocity: Vec3;
  /** Last known terrain height under the entity. */
  groundHeight: number;
  /** Collision sphere, metres. */
  radius: number;
  health: number;
  maxHealth: number;
  /** Damage dealt to whatever this collides with. */
  impactDamage: number;
  alive: boolean;
  /** World time of death, or null. */
  diedAt: number | null;
  /** Why it died, for the HUD and debrief. */
  deathReason: string | null;
  killedBy?: string;
}

export interface AircraftEntity extends EntityBase {
  kind: 'aircraft';
  typeId: string;
  type: AircraftType;
  model: FlightModel;
  state: AircraftState;
  controls: Controls;
  controlledByPlayer: boolean;
  behaviour: Behaviour;
  weapons: WeaponState;
  systems: { engine: number; controls: number; fuelLeak: number };
  /** Defaults the behaviours fall back to: the spawn heading, altitude and speed. */
  cruise: { heading: number; altitude: number; speed: number };
}

export interface SurfaceEntity extends EntityBase {
  kind: 'ground-unit' | 'ship';
  typeId: string;
  type: UnitType;
  /** Radians. */
  heading: number;
  route: Route | null;
}

export interface WaypointEntity extends EntityBase {
  kind: 'waypoint';
}

export interface ProjectileEntity extends EntityBase {
  kind: 'bullet' | 'missile' | 'bomb' | 'rocket';
  ownerId: string;
  /** Seconds left to live. */
  ttl: number;
  /** Drag: acceleration = -dragFactor * |v| * v. */
  dragFactor: number;
  weaponId: WeaponId | null;
  targetId: string | null;
  guidance: 'none' | 'tracking' | 'active' | 'lost';
  age: number;
  generation: number;
  trail: Position[];
  trailAt: number;
  distanceTravelled: number;
  groundHeight: number;
}

export type Entity = AircraftEntity | SurfaceEntity | WaypointEntity | ProjectileEntity;

export function isProjectile(e: Entity): e is ProjectileEntity {
  return e.kind === 'bullet' || e.kind === 'missile' || e.kind === 'bomb' || e.kind === 'rocket';
}

export function isAircraft(e: Entity): e is AircraftEntity {
  return e.kind === 'aircraft';
}

export function isSurface(e: Entity): e is SurfaceEntity {
  return e.kind === 'ground-unit' || e.kind === 'ship';
}

/** Copies the flight model's state into the shared entity fields. */
export function syncAircraft(e: AircraftEntity): void {
  const s = e.state;
  e.lat = s.lat;
  e.lon = s.lon;
  e.height = s.height;
  e.attitude = s.attitude;
  e.velocity = s.velocity;
  e.groundHeight = s.groundHeight;
}

export interface AircraftSpec {
  id: string;
  name: string;
  faction: Faction;
  type: AircraftType;
  model: FlightModel;
  state: AircraftState;
  controlledByPlayer: boolean;
  behaviour: Behaviour;
  /** Collision radius; defaults to half the model length. */
  radius?: number;
}

export function createAircraftEntity(spec: AircraftSpec): AircraftEntity {
  const e: AircraftEntity = {
    id: spec.id,
    name: spec.name,
    kind: 'aircraft',
    faction: spec.faction,
    lat: 0,
    lon: 0,
    height: 0,
    attitude: spec.state.attitude,
    velocity: ZERO,
    groundHeight: 0,
    radius: spec.radius ?? 8,
    health: spec.type.combat.health,
    maxHealth: spec.type.combat.health,
    impactDamage: Infinity,
    alive: true,
    diedAt: null,
    deathReason: null,
    typeId: spec.type.id,
    type: spec.type,
    model: spec.model,
    state: spec.state,
    controls: NEUTRAL_CONTROLS,
    controlledByPlayer: spec.controlledByPlayer,
    behaviour: spec.behaviour,
    weapons: createWeaponState(spec.type.combat),
    systems: { engine: 1, controls: 1, fuelLeak: 0 },
    cruise: {
      heading: Math.atan2(spec.state.attitude.forward.x, spec.state.attitude.forward.y),
      altitude: spec.state.height,
      speed: Math.hypot(spec.state.velocity.x, spec.state.velocity.y, spec.state.velocity.z),
    },
  };
  if (e.cruise.heading < 0) e.cruise.heading += 2 * Math.PI;
  syncAircraft(e);
  return e;
}

export interface SurfaceSpec {
  id: string;
  name: string;
  faction: Faction;
  type: UnitType;
  lat: number;
  lon: number;
  /** Terrain height at the position (ships sit at 0). */
  groundHeight: number;
  /** Degrees. */
  heading: number;
  route: Route | null;
}

export function createSurfaceEntity(spec: SurfaceSpec): SurfaceEntity {
  const heading = toRadians(spec.heading);
  const height = spec.type.kind === 'ship' ? 0 : spec.groundHeight;
  return {
    id: spec.id,
    name: spec.name,
    kind: spec.type.kind,
    faction: spec.faction,
    lat: spec.lat,
    lon: spec.lon,
    height,
    attitude: attitudeFromHPR({ heading, pitch: 0, roll: 0 }),
    velocity: ZERO,
    groundHeight: height,
    radius: spec.type.radius,
    health: spec.type.health,
    maxHealth: spec.type.health,
    impactDamage: Infinity,
    alive: true,
    diedAt: null,
    deathReason: null,
    typeId: spec.type.id,
    type: spec.type,
    heading,
    route: spec.route,
  };
}

export function createWaypointEntity(spec: {
  id: string;
  name: string;
  lat: number;
  lon: number;
  height: number;
}): WaypointEntity {
  return {
    id: spec.id,
    name: spec.name,
    kind: 'waypoint',
    faction: 'neutral',
    lat: spec.lat,
    lon: spec.lon,
    height: spec.height,
    attitude: attitudeFromHPR({ heading: 0, pitch: 0, roll: 0 }),
    velocity: ZERO,
    groundHeight: 0,
    radius: 0,
    health: Infinity,
    maxHealth: Infinity,
    impactDamage: 0,
    alive: true,
    diedAt: null,
    deathReason: null,
  };
}

export interface ProjectileSpec {
  id: string;
  kind: ProjectileEntity['kind'];
  ownerId: string;
  faction: Faction;
  lat: number;
  lon: number;
  height: number;
  attitude: Attitude;
  velocity: Vec3;
  ttl: number;
  dragFactor: number;
  radius: number;
  damage: number;
  weaponId?: WeaponId;
  targetId?: string;
  groundHeight?: number;
}

/** Fills (or refills, when pooled) a projectile record. */
export function initProjectile(
  target: ProjectileEntity | null,
  spec: ProjectileSpec,
): ProjectileEntity {
  const e: ProjectileEntity = target ?? {
    id: spec.id,
    name: spec.kind,
    kind: spec.kind,
    faction: spec.faction,
    lat: 0,
    lon: 0,
    height: 0,
    attitude: spec.attitude,
    velocity: ZERO,
    groundHeight: 0,
    radius: 0,
    health: 1,
    maxHealth: 1,
    impactDamage: 0,
    alive: false,
    diedAt: null,
    deathReason: null,
    ownerId: spec.ownerId,
    ttl: 0,
    dragFactor: 0,
    weaponId: null,
    targetId: null,
    guidance: 'none',
    age: 0,
    generation: 0,
    trail: [],
    trailAt: 0,
    distanceTravelled: 0,
  };
  e.name = spec.kind;
  e.kind = spec.kind;
  e.faction = spec.faction;
  e.lat = spec.lat;
  e.lon = spec.lon;
  e.height = spec.height;
  e.attitude = spec.attitude;
  e.velocity = spec.velocity;
  e.radius = spec.radius;
  e.health = 1;
  e.maxHealth = 1;
  e.impactDamage = spec.damage;
  e.alive = true;
  e.diedAt = null;
  e.deathReason = null;
  e.ownerId = spec.ownerId;
  e.ttl = spec.ttl;
  e.dragFactor = spec.dragFactor;
  e.groundHeight = spec.groundHeight ?? 0;
  e.weaponId = spec.weaponId ?? null;
  e.targetId = spec.targetId ?? null;
  e.guidance = e.targetId ? 'tracking' : 'none';
  e.age = 0;
  e.generation++;
  e.trail = [{ lat: e.lat, lon: e.lon, height: e.height }];
  e.trailAt = 0;
  e.distanceTravelled = 0;
  delete e.killedBy;
  return e;
}
