import {
  type Attitude,
  attitudeFromHPR,
  hprFromAttitude,
  rotateAttitude,
  rotateBody,
} from './attitude';
import {
  type Vec3,
  ZERO,
  add,
  clamp,
  cross,
  dot,
  length,
  normalize,
  rotateAboutAxis,
  scale,
  sub,
  toDegrees,
  toRadians,
  vec3,
} from './math3d';
import type { SimConfig, StartConfig } from './sim-config';

/** Pilot input: -1..1 for the three axes, 0..1 for throttle. */
export interface Controls {
  roll: number;
  pitch: number;
  yaw: number;
  throttle: number;
}

export const NEUTRAL_CONTROLS: Controls = { roll: 0, pitch: 0, yaw: 0, throttle: 0 };

export type FlightStatus = 'ground' | 'airborne' | 'crashed';

/** Current rotation rates about the body axes, rad/s (positive = roll right, nose up, nose right). */
export interface BodyRates {
  roll: number;
  pitch: number;
  yaw: number;
}

export const ZERO_RATES: BodyRates = { roll: 0, pitch: 0, yaw: 0 };

export interface AircraftState {
  lat: number;
  lon: number;
  /** Metres above the WGS84 ellipsoid. */
  height: number;
  attitude: Attitude;
  /** Control-driven rotation rates, which build up and decay smoothly. */
  bodyRates: BodyRates;
  /** Velocity over ground in the local East-North-Up frame, m/s. */
  velocity: Vec3;
  throttle: number;
  status: FlightStatus;
  /** Ellipsoid height of the terrain under the aircraft, from the last successful sample. */
  groundHeight: number;
}

export interface Forces {
  thrust: Vec3;
  lift: Vec3;
  drag: Vec3;
  gravity: Vec3;
  total: Vec3;
  airspeed: number;
  angleOfAttack: number;
  liftCoefficient: number;
  dragCoefficient: number;
}

/** Everything the physics needs from the configuration, minus the start section. */
export type FlightModel = Pick<
  SimConfig,
  'aircraft' | 'aerodynamics' | 'controls' | 'ground' | 'environment'
>;

export function createInitialState(start: StartConfig, groundHeight: number): AircraftState {
  const onGround = start.height <= 0;
  const attitude = attitudeFromHPR({ heading: toRadians(start.heading), pitch: 0, roll: 0 });
  return {
    lat: start.lat,
    lon: start.lon,
    height: groundHeight + start.height,
    attitude,
    bodyRates: ZERO_RATES,
    velocity: scale(attitude.forward, start.speed),
    throttle: 0,
    status: onGround ? 'ground' : 'airborne',
    groundHeight,
  };
}

export function airDensity(height: number, env: SimConfig['environment']): number {
  return env.seaLevelAirDensity * Math.exp(-Math.max(height, 0) / env.densityScaleHeight);
}

/**
 * Lift coefficient as a function of angle of attack (radians): linear up to
 * the stall angle, then decaying linearly to zero at the zero-lift angle.
 * `cl0` is the value at zero AoA.
 */
export function liftCoefficient(cl0: number, aoa: number, aero: SimConfig['aerodynamics']): number {
  const stall = toRadians(aero.stallAngle);
  const zeroLift = toRadians(aero.zeroLiftAngle);
  const a = Math.abs(aoa);
  if (a <= stall) {
    return cl0 + aero.liftSlope * aoa;
  }
  if (a >= zeroLift) {
    return 0;
  }
  const clAtStall = cl0 + aero.liftSlope * stall * Math.sign(aoa);
  const t = (a - stall) / (zeroLift - stall);
  return clAtStall * (1 - t);
}

export function computeForces(state: AircraftState, model: FlightModel): Forces {
  const { aircraft, aerodynamics: aero, environment: env } = model;
  const { forward, up } = state.attitude;
  const mass = aircraft.weight;
  const gravity = vec3(0, 0, -mass * env.gravity);
  const thrust = scale(forward, state.throttle * aircraft.maxThrust);

  const v = state.velocity;
  const airspeed = length(v);
  let lift: Vec3 = ZERO;
  let drag: Vec3 = ZERO;
  let angleOfAttack = 0;
  let cl = liftCoefficient(aircraft.liftCoefficient, 0, aero);
  let cd = aircraft.dragCoefficient + aero.inducedDragFactor * cl * cl;

  if (airspeed >= aero.minAeroSpeed) {
    const vhat = scale(v, 1 / airspeed);
    angleOfAttack = Math.atan2(-dot(v, up), dot(v, forward));
    cl = liftCoefficient(aircraft.liftCoefficient, angleOfAttack, aero);
    cd = aircraft.dragCoefficient + aero.inducedDragFactor * cl * cl;
    const q = 0.5 * airDensity(state.height, env) * airspeed * airspeed * aircraft.wingArea;
    const liftDir = normalize(sub(up, scale(vhat, dot(up, vhat))));
    lift = scale(liftDir, q * cl);
    drag = scale(vhat, -q * cd);
  }

  const total = add(add(add(thrust, lift), drag), gravity);
  return {
    thrust,
    lift,
    drag,
    gravity,
    total,
    airspeed,
    angleOfAttack,
    liftCoefficient: cl,
    dragCoefficient: cd,
  };
}

/**
 * Angle of attack (radians) at which lift equals `trimLoadFactor` times the
 * weight at the current airspeed and altitude, clamped to the stall angle.
 * With neutral controls the nose seeks this angle, like a trimmed aircraft.
 */
export function trimAngleOfAttack(state: AircraftState, airspeed: number, model: FlightModel) {
  const { aircraft, aerodynamics: aero, environment: env } = model;
  if (aero.trimLoadFactor <= 0 || aero.liftSlope <= 0) return 0;
  const q = 0.5 * airDensity(state.height, env) * airspeed * airspeed * aircraft.wingArea;
  if (q <= 0) return 0;
  const clRequired = (aircraft.weight * env.gravity * aero.trimLoadFactor) / q;
  const stall = toRadians(aero.stallAngle);
  return clamp((clRequired - aircraft.liftCoefficient) / aero.liftSlope, -stall, stall);
}

/**
 * Pitch/yaw stability: turns the nose toward the velocity vector (offset by
 * the trim angle of attack), like a weathervane.
 */
function applyStability(
  state: AircraftState,
  att: Attitude,
  velocity: Vec3,
  airspeed: number,
  model: FlightModel,
  dt: number,
): Attitude {
  const aero = model.aerodynamics;
  const vhat = scale(velocity, 1 / airspeed);
  const target = normalize(
    rotateAboutAxis(vhat, att.right, trimAngleOfAttack(state, airspeed, model)),
  );
  const cosAngle = clamp(dot(att.forward, target), -1, 1);
  const angle = Math.acos(cosAngle);
  if (angle < 1e-5) return att;
  const axis = normalize(cross(att.forward, target));
  if (axis === ZERO) return att;
  const rate = Math.min(
    toRadians(aero.stabilityMaxRate),
    toRadians(aero.stabilityRatePerSpeed) * airspeed,
  );
  return rotateAttitude(att, axis, Math.min(angle, rate * dt));
}

/**
 * Eases a rotation rate toward the commanded rate. The rate builds up with the
 * response time constant while a key is held and decays with the release time
 * constant when it is let go, so control feels like it has momentum.
 */
export function easeRate(
  current: number,
  target: number,
  responseTime: number,
  releaseTime: number,
  dt: number,
): number {
  const tau = target !== 0 ? responseTime : releaseTime;
  if (tau <= 0) return target;
  return current + (target - current) * (1 - Math.exp(-dt / tau));
}

function updateBodyRates(
  rates: BodyRates,
  controls: Controls,
  cfg: SimConfig['controls'],
  dt: number,
): BodyRates {
  const ease = (current: number, input: number, maxRate: number) =>
    easeRate(current, input * toRadians(maxRate), cfg.responseTime, cfg.releaseTime, dt);
  return {
    roll: ease(rates.roll, controls.roll, cfg.rollRate),
    pitch: ease(rates.pitch, controls.pitch, cfg.pitchRate),
    yaw: ease(rates.yaw, controls.yaw, cfg.yawRate),
  };
}

function horizontal(v: Vec3): Vec3 {
  return vec3(v.x, v.y, 0);
}

/**
 * Advances the simulation by `dt` seconds.
 * `groundHeight` is the terrain height under the aircraft if known this frame.
 */
export function step(
  state: AircraftState,
  controls: Controls,
  model: FlightModel,
  groundHeight: number | undefined,
  dt: number,
): AircraftState {
  if (state.status === 'crashed' || dt <= 0) return state;

  const { aircraft, aerodynamics: aero, controls: rates, ground: gnd, environment: env } = model;
  const ground = groundHeight ?? state.groundHeight;
  const onGround = state.status === 'ground';
  const throttle = clamp(controls.throttle, 0, 1);

  // Attitude: pilot input (smoothed rates), then aerodynamic stability.
  const bodyRates = updateBodyRates(
    onGround ? { ...state.bodyRates, roll: 0 } : state.bodyRates,
    { ...controls, roll: onGround ? 0 : controls.roll },
    rates,
    dt,
  );
  let attitude = state.attitude;
  attitude = rotateBody(attitude, 'roll', bodyRates.roll * dt);
  attitude = rotateBody(attitude, 'pitch', bodyRates.pitch * dt);
  attitude = rotateBody(attitude, 'yaw', bodyRates.yaw * dt);

  let velocity = state.velocity;
  const airspeed = length(velocity);

  if (onGround) {
    // Wheels: no roll, limited nose-up, and the aircraft moves where it points.
    const hpr = hprFromAttitude(attitude);
    attitude = attitudeFromHPR({
      heading: hpr.heading,
      pitch: clamp(hpr.pitch, 0, toRadians(gnd.maxGroundPitch)),
      roll: 0,
    });
    const groundSpeed = length(horizontal(velocity));
    velocity = scale(normalize(horizontal(attitude.forward)), groundSpeed);
  } else if (airspeed >= aero.minAeroSpeed) {
    attitude = applyStability(state, attitude, velocity, airspeed, model, dt);
  }

  // Forces and velocity.
  const forces = computeForces({ ...state, attitude, velocity, throttle }, model);
  velocity = add(velocity, scale(forces.total, dt / aircraft.weight));

  if (onGround) {
    const friction = gnd.rollingFriction * env.gravity * dt;
    const h = horizontal(velocity);
    const hs = length(h);
    const newHs = Math.max(0, hs - friction);
    velocity = vec3(
      hs > 0 ? (h.x * newHs) / hs : 0,
      hs > 0 ? (h.y * newHs) / hs : 0,
      Math.max(0, velocity.z),
    );
  }

  // Position.
  const latRad = toRadians(state.lat);
  let lat = state.lat + toDegrees((velocity.y * dt) / env.earthRadius);
  let lon = state.lon + toDegrees((velocity.x * dt) / (env.earthRadius * Math.cos(latRad)));
  lat = clamp(lat, -90, 90);
  if (lon > 180) lon -= 360;
  if (lon < -180) lon += 360;
  let height = state.height + velocity.z * dt;

  // Ground contact.
  let status: FlightStatus = state.status;
  const agl = height - ground;
  if (agl <= 0) {
    height = ground;
    if (status === 'airborne') {
      const hpr = hprFromAttitude(attitude);
      const hardImpact =
        velocity.z < -gnd.maxLandingSinkRate ||
        Math.abs(hpr.roll) > toRadians(gnd.maxLandingRoll) ||
        hpr.pitch < toRadians(gnd.minLandingPitch);
      status = hardImpact ? 'crashed' : 'ground';
      if (status === 'ground') {
        attitude = attitudeFromHPR({ heading: hpr.heading, pitch: 0, roll: 0 });
        velocity = horizontal(velocity);
      }
    }
    velocity = vec3(velocity.x, velocity.y, Math.max(0, velocity.z));
  } else if (status === 'ground' && agl > gnd.liftoffHeight) {
    status = 'airborne';
  }

  return {
    lat,
    lon,
    height,
    attitude,
    bodyRates,
    velocity,
    throttle,
    status,
    groundHeight: ground,
  };
}
