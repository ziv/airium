/**
 * Flat-earth geodesy in the local East-North-Up frame, consistent with how
 * the physics integrates position (`earthRadius`, `cos(lat)`). Good to a few
 * per cent within ~100 km, which is all a mission needs.
 */
import { type Vec3, DEG, vec3 } from './math3d';

export interface LatLon {
  lat: number;
  lon: number;
}

/** ENU offset (metres) from `from` to `to`, ignoring height unless both have it. */
export function enuOffset(
  from: LatLon & { height?: number },
  to: LatLon & { height?: number },
  earthRadius: number,
): Vec3 {
  let dLon = to.lon - from.lon;
  if (dLon > 180) dLon -= 360;
  if (dLon < -180) dLon += 360;
  return vec3(
    dLon * DEG * earthRadius * Math.cos(from.lat * DEG),
    (to.lat - from.lat) * DEG * earthRadius,
    (to.height ?? 0) - (from.height ?? 0),
  );
}

/** Horizontal distance in metres. */
export function groundDistance(a: LatLon, b: LatLon, earthRadius: number): number {
  const o = enuOffset(a, b, earthRadius);
  return Math.hypot(o.x, o.y);
}

/** Bearing from `a` to `b`, radians, 0 = north, clockwise, in [0, 2π). */
export function bearing(a: LatLon, b: LatLon, earthRadius: number): number {
  const o = enuOffset(a, b, earthRadius);
  const θ = Math.atan2(o.x, o.y);
  return θ < 0 ? θ + 2 * Math.PI : θ;
}

/** Point displaced by an ENU offset (metres). */
export function offsetLatLon(
  origin: LatLon,
  east: number,
  north: number,
  earthRadius: number,
): LatLon {
  const lat = origin.lat + north / earthRadius / DEG;
  let lon = origin.lon + east / (earthRadius * Math.cos(origin.lat * DEG)) / DEG;
  if (lon > 180) lon -= 360;
  if (lon < -180) lon += 360;
  return { lat: Math.max(-90, Math.min(90, lat)), lon };
}

/** Smallest signed difference `target - current` in radians, in (-π, π]. */
export function headingError(current: number, target: number): number {
  let d = (target - current) % (2 * Math.PI);
  if (d > Math.PI) d -= 2 * Math.PI;
  if (d <= -Math.PI) d += 2 * Math.PI;
  return d;
}
