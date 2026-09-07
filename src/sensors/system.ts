/** Deterministic radar scans and navigation; no browser or renderer dependencies. */
import { isAircraft, isProjectile, type AircraftEntity, type Entity } from '../sim/entities';
import { bearing, enuOffset, headingError, offsetLatLon } from '../sim/geo';
import { dot, length, toRadians } from '../sim/math3d';
import type { World, TerrainQuery } from '../sim/world';
import { enemies, validTarget } from '../weapons/targeting';
import { SENSORS, type SensorConfig } from './config';

export interface Track {
  id: string;
  range: number;
  azimuth: number;
  elevation: number;
  faction: Entity['faction'];
}
export interface Threat {
  id: string;
  bearing: number;
  level: 'search' | 'lock' | 'launch';
}
export function scanAngles(owner: Entity, target: Entity, R: number) {
  const v = enuOffset(owner, target, R),
    a = owner.attitude;
  const forward = dot(v, a.forward),
    right = dot(v, a.right),
    up = dot(v, a.up);
  return {
    range: length(v),
    azimuth: Math.atan2(right, forward),
    elevation: Math.atan2(up, Math.hypot(forward, right)),
  };
}
/** Unknown terrain is permissive; loaded samples block the ray, including Earth curvature. */
export function lineOfSight(
  a: Entity,
  b: Entity,
  R: number,
  terrain: TerrainQuery,
  spacing: number,
): boolean {
  const v = enuOffset(a, b, R),
    distance = Math.hypot(v.x, v.y);
  const steps = Math.ceil(distance / spacing);
  for (let i = 1; i < steps; i++) {
    const t = i / steps,
      p = offsetLatLon(a, v.x * t, v.y * t, R);
    const height = a.height + v.z * t - (distance * distance * t * (1 - t)) / (2 * R);
    const ground = terrain(p.lat, p.lon);
    if (ground !== undefined && ground >= height) return false;
  }
  return true;
}
export function detect(
  owner: Entity,
  target: Entity,
  R: number,
  cfg: SensorConfig,
  terrain: TerrainQuery,
): Track | null {
  if (
    !target.alive ||
    target.id === owner.id ||
    (!isAircraft(target) && target.kind !== 'ground-unit' && target.kind !== 'ship')
  )
    return null;
  const angles = scanAngles(owner, target, R);
  const rangeLimit = cfg.maxRange * Math.min(1, Math.sqrt(target.radius / cfg.referenceRadius));
  if (
    angles.range <= 0 ||
    angles.range > rangeLimit ||
    Math.abs(angles.azimuth) > toRadians(cfg.azimuth) + 1e-10 ||
    Math.abs(angles.elevation) > toRadians(cfg.elevation) + 1e-10
  )
    return null;
  if (cfg.terrainLOS && !lineOfSight(owner, target, R, terrain, cfg.sampleSpacing)) return null;
  return { id: target.id, faction: target.faction, ...angles };
}
export function cycleTrack(tracks: readonly Track[], current: string | null): string | null {
  return tracks[(tracks.findIndex((t) => t.id === current) + 1) % tracks.length]?.id ?? null;
}
export class SensorSystem {
  private scans = new Map<string, Track[]>();
  private nextScan = 0;
  private terrain: TerrainQuery = () => undefined;
  waypointIndex = 0;
  constructor(
    private readonly world: World,
    readonly cfg: SensorConfig = SENSORS,
  ) {}
  reset(): void {
    this.scans.clear();
    this.nextScan = 0;
    this.waypointIndex = 0;
  }
  tracks(owner: AircraftEntity): Track[] {
    return (this.scans.get(owner.id) ?? []).filter((t) => this.world.get(t.id)?.alive);
  }
  targets(owner: AircraftEntity): Track[] {
    return this.tracks(owner).filter((t) => {
      const e = this.world.get(t.id);
      return e && validTarget(owner, e);
    });
  }
  visible(owner: Entity, target: Entity): boolean {
    return (
      !this.cfg.terrainLOS ||
      lineOfSight(
        owner,
        target,
        this.world.env.environment.earthRadius,
        this.terrain,
        this.cfg.sampleSpacing,
      )
    );
  }
  step(terrain: TerrainQuery): void {
    this.terrain = terrain;
    if (this.world.time < this.nextScan) return;
    this.nextScan = this.world.time + 1 / this.cfg.updateHz;
    this.scans.clear();
    for (const owner of this.world.aircraft()) {
      if (!owner.alive) continue;
      const tracks = this.world.entities
        .map((e) => detect(owner, e, this.world.env.environment.earthRadius, this.cfg, terrain))
        .filter((t): t is Track => t !== null)
        .sort((a, b) => a.range - b.range || a.id.localeCompare(b.id));
      this.scans.set(owner.id, tracks);
      if (owner.weapons.lockId && !this.targets(owner).some((t) => t.id === owner.weapons.lockId))
        owner.weapons.lockId = null;
      if (
        owner.weapons.targetId &&
        !this.targets(owner).some((t) => t.id === owner.weapons.targetId)
      )
        owner.weapons.targetId = null;
    }
  }
  threats(owner: AircraftEntity): Threat[] {
    const out: Threat[] = [],
      R = this.world.env.environment.earthRadius;
    const heading = Math.atan2(owner.attitude.forward.x, owner.attitude.forward.y);
    for (const e of this.world.entities) {
      if (!e.alive || !enemies(owner.faction, e.faction)) continue;
      const relative = headingError(heading, bearing(owner, e, R));
      if (isAircraft(e) && this.tracks(e).some((t) => t.id === owner.id))
        out.push({
          id: e.id,
          bearing: relative,
          level: e.weapons.lockId === owner.id ? 'lock' : 'search',
        });
      if (
        isProjectile(e) &&
        e.kind === 'missile' &&
        e.targetId === owner.id &&
        e.guidance !== 'lost' &&
        this.visible(owner, e)
      )
        out.push({ id: e.id, bearing: relative, level: 'launch' });
    }
    return out;
  }
  cycleWaypoint(): void {
    const n = this.world.waypoints().length;
    this.waypointIndex = n ? (this.waypointIndex + 1) % n : 0;
  }
  waypoint() {
    return this.world.waypoints()[this.waypointIndex];
  }
}
