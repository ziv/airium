/**
 * Conversions between the simulation's local East-North-Up frame at the
 * aircraft and Cesium's Earth-fixed frame.
 */
import { Cartesian3, Matrix3, Matrix4, Quaternion, Transforms } from 'cesium';
import type { Attitude } from '../sim/attitude';
import type { Vec3 } from '../sim/math3d';
import type { AircraftState } from '../sim/physics';

/** Earth-fixed position of the aircraft. */
export function aircraftPosition(state: AircraftState, result?: Cartesian3): Cartesian3 {
  return Cartesian3.fromDegrees(state.lon, state.lat, state.height, undefined, result);
}

/** ENU-at-position to Earth-fixed transform (rotation + translation). */
export function enuFrame(position: Cartesian3, result?: Matrix4): Matrix4 {
  return Transforms.eastNorthUpToFixedFrame(position, undefined, result);
}

/** Rotates an ENU vector into the Earth-fixed frame (no translation). */
export function enuVector(frame: Matrix4, v: Vec3, result = new Cartesian3()): Cartesian3 {
  result.x = v.x;
  result.y = v.y;
  result.z = v.z;
  return Matrix4.multiplyByPointAsVector(frame, result, result);
}

/** Earth-fixed point at an ENU offset from the frame origin. */
export function enuPoint(frame: Matrix4, v: Vec3, result = new Cartesian3()): Cartesian3 {
  result.x = v.x;
  result.y = v.y;
  result.z = v.z;
  return Matrix4.multiplyByPoint(frame, result, result);
}

const scratchBody = new Matrix3();
const scratchRot = new Matrix3();

/** Body-to-ENU rotation for a model with +X forward, +Y left, +Z up. */
function bodyRotation(att: Attitude, result: Matrix3): Matrix3 {
  const { forward: f, right: r, up: u } = att;
  // Columns: forward, left (= -right), up.
  return Matrix3.fromArray([f.x, f.y, f.z, -r.x, -r.y, -r.z, u.x, u.y, u.z], 0, result);
}

/** Model matrix (body → Earth-fixed) for the given ENU frame and body triad. */
export function modelMatrix(frame: Matrix4, att: Attitude, result = new Matrix4()): Matrix4 {
  return Matrix4.multiplyByMatrix3(frame, bodyRotation(att, scratchBody), result);
}

/**
 * Orientation quaternion for a Cesium model whose local axes are +X forward,
 * +Y left, +Z up (what Cesium makes of a glTF's +Z forward / +Y up), given
 * the body triad in ENU.
 */
export function orientationQuaternion(
  frame: Matrix4,
  att: Attitude,
  result = new Quaternion(),
): Quaternion {
  const { forward: f, right: r, up: u } = att;
  // Columns: forward, left (= -right), up. Matrix3's constructor is row-major.
  const body = Matrix3.fromArray([f.x, f.y, f.z, -r.x, -r.y, -r.z, u.x, u.y, u.z], 0, scratchBody);
  const rotation = Matrix4.getMatrix3(frame, scratchRot);
  Matrix3.multiply(rotation, body, scratchRot);
  return Quaternion.fromRotationMatrix(scratchRot, result);
}
