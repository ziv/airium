import {
  type Vec3,
  ZERO,
  add,
  sub,
  scale,
  dot,
  cross,
  length,
  normalize,
  clamp,
} from '../sim/math3d';
import { enuOffset, offsetLatLon } from '../sim/geo';
import type { TerrainQuery } from '../sim/world';

export interface Position {
  lat: number;
  lon: number;
  height: number;
}

/** Midpoint integration: exact constant-gravity drop and stable quadratic drag. */
export function ballisticStep(
  velocity: Vec3,
  dt: number,
  gravity: number,
  drag: number,
  powered = ZERO,
): { displacement: Vec3; velocity: Vec3 } {
  const acceleration = (v: Vec3) =>
    add(add(scale(v, -drag * length(v)), { x: 0, y: 0, z: -gravity }), powered);
  const mid = add(velocity, scale(acceleration(velocity), dt / 2));
  return { displacement: scale(mid, dt), velocity: add(velocity, scale(acceleration(mid), dt)) };
}

export function movePosition(p: Position, offset: Vec3, earthRadius: number): Position {
  return { ...offsetLatLon(p, offset.x, offset.y, earthRadius), height: p.height + offset.z };
}

/** Earliest intersection fraction, including starts inside, tangency and zero-length segments. */
export function segmentSphere(start: Vec3, end: Vec3, radius: number): number | null {
  const c = dot(start, start) - radius * radius;
  if (c <= 0) return 0;
  const d = sub(end, start);
  const a = dot(d, d);
  if (a < 1e-12) return null;
  const b = dot(start, d);
  const discriminant = b * b - a * c;
  if (discriminant < 0) return null;
  const t = (-b - Math.sqrt(discriminant)) / a;
  return t >= 0 && t <= 1 ? t : null;
}

/** Proportional navigation, perpendicular to missile velocity, capped in m/s². */
export function proportionalNavigation(
  relativePosition: Vec3,
  relativeVelocity: Vec3,
  missileVelocity: Vec3,
  navigationConstant: number,
  maxAcceleration: number,
): Vec3 {
  const range = length(relativePosition);
  if (range < 1e-6) return ZERO;
  const closing = Math.max(0, -dot(relativePosition, relativeVelocity) / range);
  const losRate = scale(cross(relativePosition, relativeVelocity), 1 / (range * range));
  const demand = scale(cross(losRate, normalize(missileVelocity)), navigationConstant * closing);
  return scale(demand, Math.min(1, maxAcceleration / Math.max(length(demand), 1e-9)));
}

export function blastDamage(damage: number, distance: number, radius: number): number {
  return radius > 0 ? damage * clamp(1 - distance / radius, 0, 1) : 0;
}

/** LCOS aim direction: relative motion plus gravity compensation, with drag-adjusted time of flight. */
export function gunLead(
  relativePosition: Vec3,
  relativeVelocity: Vec3,
  muzzleVelocity: number,
  drag: number,
  gravity: number,
  lifetime: number,
): { direction: Vec3; time: number } | null {
  let time = length(relativePosition) / muzzleVelocity;
  let aim = relativePosition;
  for (let i = 0; i < 12; i++) {
    aim = add(add(relativePosition, scale(relativeVelocity, time)), {
      x: 0,
      y: 0,
      z: 0.5 * gravity * time * time,
    });
    const distance = length(aim);
    time =
      drag > 0
        ? Math.expm1(Math.min(20, distance * drag)) / (drag * muzzleVelocity)
        : distance / muzzleVelocity;
    if (!Number.isFinite(time) || time > lifetime) return null;
  }
  return { direction: normalize(aim), time };
}

/** Intersect a short flight segment with terrain, retaining the last loaded height. */
export function terrainImpact(
  start: Position,
  end: Position,
  terrain: TerrainQuery,
  fallback: number,
  earthRadius: number,
): { point: Position; fraction: number; ground: number } | null {
  const delta = enuOffset(start, end, earthRadius);
  const samples = Math.max(1, Math.ceil(length(delta) / 25));
  let last = 0;
  let ground = fallback;
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const p = movePosition(start, scale(delta, t), earthRadius);
    ground = terrain(p.lat, p.lon) ?? ground;
    if (p.height <= ground) {
      let lo = last,
        hi = t;
      for (let j = 0; j < 12; j++) {
        const mid = (lo + hi) / 2;
        const q = movePosition(start, scale(delta, mid), earthRadius);
        const h = terrain(q.lat, q.lon) ?? ground;
        if (q.height > h) lo = mid;
        else {
          hi = mid;
          ground = h;
        }
      }
      return {
        point: { ...movePosition(start, scale(delta, hi), earthRadius), height: ground },
        fraction: hi,
        ground,
      };
    }
    last = t;
  }
  return null;
}

/** CCIP uses the same integrator and terrain intersection as a released bomb. */
export function predictImpact(
  start: Position,
  velocity: Vec3,
  gravity: number,
  drag: number,
  earthRadius: number,
  terrain: TerrainQuery,
  fallback: number,
  lifetime: number,
): { point: Position; time: number } | null {
  let p = start,
    v = velocity,
    ground = fallback;
  const dt = 1 / 30;
  for (let time = 0; time < lifetime; time += dt) {
    const h = Math.min(dt, lifetime - time);
    const step = ballisticStep(v, h, gravity, drag);
    const next = movePosition(p, step.displacement, earthRadius);
    const hit = terrainImpact(p, next, terrain, ground, earthRadius);
    if (hit) return { point: hit.point, time: time + h * hit.fraction };
    ground = terrain(next.lat, next.lon) ?? ground;
    p = next;
    v = step.velocity;
  }
  return null;
}
