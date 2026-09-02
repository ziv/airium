import {
  type Vec3,
  clamp,
  cross,
  dot,
  normalize,
  rotateAboutAxis,
  scale,
  sub,
  vec3,
} from './math3d';

/**
 * Aircraft orientation as an orthonormal body triad expressed in the local
 * East-North-Up frame. `forward` is the nose, `right` the right wing, `up`
 * the canopy. Invariant: up = right x forward.
 */
export interface Attitude {
  readonly forward: Vec3;
  readonly right: Vec3;
  readonly up: Vec3;
}

/** Heading / pitch / roll in radians using the aviation convention. */
export interface HPR {
  /** 0 = north, increasing clockwise. Range [0, 2pi). */
  heading: number;
  /** Positive = nose above the horizon. Range [-pi/2, pi/2]. */
  pitch: number;
  /** Positive = right wing down. Range (-pi, pi]. */
  roll: number;
}

export type BodyAxis = 'roll' | 'pitch' | 'yaw';

export function attitudeFromHPR({ heading, pitch, roll }: HPR): Attitude {
  const ch = Math.cos(heading);
  const sh = Math.sin(heading);
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  const cr = Math.cos(roll);
  const sr = Math.sin(roll);

  const forward = vec3(sh * cp, ch * cp, sp);
  const rightLevel = vec3(ch, -sh, 0);
  const upLevel = cross(rightLevel, forward);

  return {
    forward,
    right: vec3(
      rightLevel.x * cr - upLevel.x * sr,
      rightLevel.y * cr - upLevel.y * sr,
      rightLevel.z * cr - upLevel.z * sr,
    ),
    up: vec3(
      upLevel.x * cr + rightLevel.x * sr,
      upLevel.y * cr + rightLevel.y * sr,
      upLevel.z * cr + rightLevel.z * sr,
    ),
  };
}

export function hprFromAttitude({ forward, right }: Attitude): HPR {
  let heading = Math.atan2(forward.x, forward.y);
  if (heading < 0) heading += 2 * Math.PI;
  const pitch = Math.asin(clamp(forward.z, -1, 1));

  const rightLevel = vec3(Math.cos(heading), -Math.sin(heading), 0);
  const upLevel = cross(rightLevel, forward);
  const roll = Math.atan2(-dot(right, upLevel), dot(right, rightLevel));

  return { heading, pitch, roll };
}

/** Rebuilds an exact orthonormal triad after accumulated floating-point drift. */
export function orthonormalize(att: Attitude): Attitude {
  const forward = normalize(att.forward);
  const right = normalize(sub(att.right, scale(forward, dot(att.right, forward))));
  const up = cross(right, forward);
  return { forward, right, up };
}

/** Rotates the whole triad about an arbitrary unit axis. */
export function rotateAttitude(att: Attitude, axis: Vec3, angle: number): Attitude {
  if (angle === 0) return att;
  return orthonormalize({
    forward: rotateAboutAxis(att.forward, axis, angle),
    right: rotateAboutAxis(att.right, axis, angle),
    up: rotateAboutAxis(att.up, axis, angle),
  });
}

/**
 * Rotates about one of the body axes. Positive angles follow the aviation
 * convention: roll right, pitch nose up, yaw nose right.
 */
export function rotateBody(att: Attitude, axis: BodyAxis, angle: number): Attitude {
  switch (axis) {
    case 'roll':
      return rotateAttitude(att, att.forward, angle);
    case 'pitch':
      return rotateAttitude(att, att.right, angle);
    case 'yaw':
      return rotateAttitude(att, att.up, -angle);
  }
}
