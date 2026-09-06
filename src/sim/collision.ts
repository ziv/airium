/**
 * Sphere-sphere collision detection between entities. Pure.
 */
import { type Entity, isProjectile } from './entities';
import { enuOffset } from './geo';
import { DEG } from './math3d';

export interface Collision {
  a: Entity;
  b: Entity;
  /** Centre distance, metres. */
  distance: number;
}

/** Whether two entities can hit each other at all. */
export function canCollide(a: Entity, b: Entity): boolean {
  if (a === b || !a.alive || !b.alive) return false;
  if (a.kind === 'waypoint' || b.kind === 'waypoint') return false;
  const pa = isProjectile(a);
  const pb = isProjectile(b);
  if (pa && pb) return false;
  if (pa && a.ownerId === b.id) return false;
  if (pb && b.ownerId === a.id) return false;
  return true;
}

/**
 * All overlapping pairs. Each pair is reported once. Projectile pairs are
 * skipped, so the cost is (solid × everything), not (everything)².
 */
export function findCollisions(entities: readonly Entity[], earthRadius: number): Collision[] {
  const out: Collision[] = [];
  const degPerMetre = 1 / (earthRadius * DEG);
  for (let i = 0; i < entities.length; i++) {
    const a = entities[i] as Entity;
    if (!a.alive || isProjectile(a) || a.kind === 'waypoint') continue;
    for (let j = 0; j < entities.length; j++) {
      const b = entities[j] as Entity;
      // Solid-solid pairs once (j > i); solid-projectile pairs from the solid side.
      if (!isProjectile(b) && j <= i) continue;
      if (!canCollide(a, b)) continue;
      const reach = a.radius + b.radius;
      if (Math.abs(a.height - b.height) > reach) continue;
      if (Math.abs(a.lat - b.lat) > reach * degPerMetre * 1.01) continue;
      const o = enuOffset(a, b, earthRadius);
      const distance = Math.hypot(o.x, o.y, o.z);
      if (distance <= reach) out.push({ a, b, distance });
    }
  }
  return out;
}
