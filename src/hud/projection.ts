/**
 * Projects view directions onto the screen. HUD symbols that refer to the
 * world (flight-path marker, pitch ladder, target box) are directions at
 * infinity, so only the camera's orientation and field of view matter, not
 * its position. Pure: no Cesium, no DOM.
 */
import { type Vec3, dot } from '../sim/math3d';

/** Camera orientation as unit vectors in the aircraft's ENU frame. */
export interface CameraPose {
  forward: Vec3;
  right: Vec3;
  up: Vec3;
}

export interface Viewport {
  width: number;
  height: number;
  /** Cesium frustum fov (radians): the horizontal angle when wider than tall, else vertical. */
  fov: number;
}

export interface ScreenPoint {
  x: number;
  y: number;
}

export interface Projected extends ScreenPoint {
  /** False when the direction is behind the camera; x/y then only give its bearing. */
  visible: boolean;
}

/** Pixels per unit of tan(angle) from the optical axis. */
export function focalLength(vp: Viewport): number {
  const half = Math.max(vp.width, vp.height) / 2;
  return half / Math.tan(vp.fov / 2);
}

const BEHIND = 1e-6;

/** Screen position of a direction (unit or not). Behind the camera the point is pushed far out along its bearing. */
export function projectDirection(dir: Vec3, pose: CameraPose, vp: Viewport): Projected {
  const x = dot(dir, pose.right);
  const y = dot(dir, pose.up);
  const z = dot(dir, pose.forward);
  const cx = vp.width / 2;
  const cy = vp.height / 2;
  if (z <= BEHIND) {
    const len = Math.hypot(x, y) || 1;
    const far = (vp.width + vp.height) * 10;
    return { x: cx + (x / len) * far, y: cy - (y / len) * far, visible: false };
  }
  const f = focalLength(vp);
  return { x: cx + (x / z) * f, y: cy - (y / z) * f, visible: true };
}

export interface EdgePoint extends ScreenPoint {
  /** True when the point was moved onto the edge of the viewport. */
  clamped: boolean;
  /** Bearing from the centre toward the original point, radians, 0 = right, counter-clockwise on screen. */
  angle: number;
}

/** Keeps a point inside the viewport (minus `margin`) along the line from the centre, for off-screen cues. */
export function clampToEdge(p: ScreenPoint, vp: Viewport, margin: number): EdgePoint {
  const cx = vp.width / 2;
  const cy = vp.height / 2;
  const dx = p.x - cx;
  const dy = p.y - cy;
  const angle = Math.atan2(-dy, dx);
  const halfW = cx - margin;
  const halfH = cy - margin;
  if (Math.abs(dx) <= halfW && Math.abs(dy) <= halfH) {
    return { x: p.x, y: p.y, clamped: false, angle };
  }
  const scale = Math.min(
    Math.abs(dx) > 0 ? halfW / Math.abs(dx) : Infinity,
    Math.abs(dy) > 0 ? halfH / Math.abs(dy) : Infinity,
  );
  return { x: cx + dx * scale, y: cy + dy * scale, clamped: true, angle };
}
