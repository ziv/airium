/** Basic visual target designation for M7. Full radar/LOS belongs to M8. */
import { isAircraft, type AircraftEntity, type Entity, type Faction } from '../sim/entities';
import { enuOffset } from '../sim/geo';
import { clamp, dot, length, normalize, toRadians, type Vec3 } from '../sim/math3d';
import type { WeaponConfig, WeaponsConfig, Seeker } from './config';

export function enemies(a: Faction, b: Faction): boolean {
  return a === 'hostile'
    ? b === 'player' || b === 'friendly'
    : (a === 'player' || a === 'friendly') && b === 'hostile';
}

export function validTarget(owner: Entity, target: Entity): boolean {
  return (
    target.alive &&
    enemies(owner.faction, target.faction) &&
    (isAircraft(target) || target.kind === 'ground-unit' || target.kind === 'ship')
  );
}

export function inCone(forward: Vec3, direction: Vec3, halfAngle: number): boolean {
  return (
    length(direction) > 0 &&
    dot(normalize(forward), normalize(direction)) >= Math.cos(toRadians(halfAngle)) - 1e-10
  );
}

export function launchEnvelope(
  owner: Entity,
  target: Entity | undefined,
  weapon: WeaponConfig,
  locked: boolean,
  earthRadius: number,
): { allowed: boolean; reason: string; range: number } {
  if (!target || !validTarget(owner, target) || !isAircraft(target))
    return { allowed: false, reason: 'NO TARGET', range: 0 };
  const relative = enuOffset(owner, target, earthRadius);
  const range = length(relative);
  const reason = !locked
    ? 'NO LOCK'
    : range < weapon.minRange
      ? 'TOO CLOSE'
      : range > weapon.maxRange
        ? 'OUT OF RANGE'
        : !inCone(owner.attitude.forward, relative, weapon.seekerCone)
          ? 'OUT OF CONE'
          : '';
  return { allowed: reason === '', reason, range };
}

export function targetList(
  owner: AircraftEntity,
  entities: readonly Entity[],
  earthRadius: number,
  maxRange: number,
): Entity[] {
  return entities
    .filter((e) => validTarget(owner, e) && length(enuOffset(owner, e, earthRadius)) <= maxRange)
    .sort(
      (a, b) =>
        length(enuOffset(owner, a, earthRadius)) - length(enuOffset(owner, b, earthRadius)) ||
        a.id.localeCompare(b.id),
    );
}

/** One independent decoy trial per released packet, not per simulation step. Aspect: 1 = tail view. */
export function decoyProbability(
  seeker: Seeker,
  decoy: 'flare' | 'chaff',
  aspect: number,
  range: number,
  cfg: WeaponsConfig['countermeasures'],
): number {
  if (
    (seeker === 'ir' && decoy !== 'flare') ||
    (seeker === 'radar' && decoy !== 'chaff') ||
    seeker === 'none' ||
    range > cfg.effectiveRange
  )
    return 0;
  const base = seeker === 'ir' ? cfg.flareChance : cfg.chaffChance;
  const aspectFactor =
    seeker === 'ir'
      ? 1 - 0.4 * clamp(aspect, 0, 1)
      : 0.6 + 0.4 * (1 - Math.abs(clamp(aspect, -1, 1)));
  return clamp(base * aspectFactor * (1 - 0.5 * clamp(range / cfg.effectiveRange, 0, 1)), 0, 1);
}
