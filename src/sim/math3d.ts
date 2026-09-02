/**
 * Minimal 3D vector helpers. Vectors live in the local East-North-Up frame:
 * x = east, y = north, z = up (metres or metres per second).
 */
export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export const ZERO: Vec3 = { x: 0, y: 0, z: 0 };
export const UP: Vec3 = { x: 0, y: 0, z: 1 };

export function vec3(x: number, y: number, z: number): Vec3 {
  return { x, y, z };
}

export function add(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

export function sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

export function scale(v: Vec3, s: number): Vec3 {
  return { x: v.x * s, y: v.y * s, z: v.z * s };
}

export function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

export function length(v: Vec3): number {
  return Math.hypot(v.x, v.y, v.z);
}

/** Unit vector, or ZERO when the input has no length. */
export function normalize(v: Vec3): Vec3 {
  const len = length(v);
  return len > 0 ? scale(v, 1 / len) : ZERO;
}

/** Rotates `v` about the unit axis `k` by `angle` radians (Rodrigues' formula). */
export function rotateAboutAxis(v: Vec3, k: Vec3, angle: number): Vec3 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return add(add(scale(v, c), scale(cross(k, v), s)), scale(k, dot(k, v) * (1 - c)));
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export const DEG = Math.PI / 180;

export function toRadians(degrees: number): number {
  return degrees * DEG;
}

export function toDegrees(radians: number): number {
  return radians / DEG;
}
