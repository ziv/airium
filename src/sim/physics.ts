import type { AircraftType } from '../aircraft/aircraft-type';
import {
  type Attitude,
  attitudeFromHPR,
  hprFromAttitude,
  orthonormalize,
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
import type { EnvironmentConfig, GroundConfig, StartConfig } from './sim-config';

/**
 * Pilot input. Axes are -1..1 (pitch: positive = pull), throttle 0..1 is
 * military power; the afterburner is a separate switch. Gear, airbrake and
 * brakes are the commanded positions.
 */
export interface Controls {
  roll: number;
  pitch: number;
  yaw: number;
  throttle: number;
  afterburner: boolean;
  gearDown: boolean;
  airbrake: boolean;
  brakes: boolean;
}

export const NEUTRAL_CONTROLS: Controls = {
  roll: 0,
  pitch: 0,
  yaw: 0,
  throttle: 0,
  afterburner: false,
  gearDown: false,
  airbrake: false,
  brakes: false,
};

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
  afterburner: boolean;
  /** Fuel on board, kg. */
  fuel: number;
  /** Landing gear position: 0 = up, 1 = down. */
  gear: number;
  airbrake: boolean;
  status: FlightStatus;
  /** Why the flight ended, when crashed. */
  crashReason: string | null;
  /** Ellipsoid height of the terrain under the aircraft, from the last successful sample. */
  groundHeight: number;
  /** Load factor (g) from the last step. */
  loadFactor: number;
  /** Highest load factor seen since the start. */
  peakLoadFactor: number;
}

export interface Forces {
  thrust: Vec3;
  lift: Vec3;
  drag: Vec3;
  gravity: Vec3;
  total: Vec3;
  /** Total mass including fuel, kg. */
  mass: number;
  airspeed: number;
  mach: number;
  /** Dynamic pressure, Pa. */
  dynamicPressure: number;
  angleOfAttack: number;
  liftCoefficient: number;
  dragCoefficient: number;
  /** Lift along the body up axis divided by weight. */
  loadFactor: number;
  thrustMagnitude: number;
}

/** Everything the physics needs: the aircraft type plus the world's ground rules and environment. */
export interface FlightModel {
  aircraft: AircraftType;
  ground: GroundConfig;
  environment: EnvironmentConfig;
}

export function createInitialState(
  start: Pick<StartConfig, 'lat' | 'lon' | 'height' | 'heading' | 'speed'>,
  groundHeight: number,
  aircraft: AircraftType,
): AircraftState {
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
    afterburner: false,
    fuel: aircraft.airframe.fuelCapacity,
    gear: onGround ? 1 : 0,
    airbrake: false,
    status: onGround ? 'ground' : 'airborne',
    crashReason: null,
    groundHeight,
    loadFactor: onGround ? 0 : 1,
    peakLoadFactor: 1,
  };
}

export function airDensity(height: number, env: EnvironmentConfig): number {
  return env.seaLevelAirDensity * Math.exp(-Math.max(height, 0) / env.densityScaleHeight);
}

/** ISA temperature (K): linear lapse up to the tropopause, constant above. */
export function airTemperature(height: number, env: EnvironmentConfig): number {
  const h = clamp(height, 0, env.tropopauseHeight);
  return Math.max(1, env.seaLevelTemperature - env.lapseRate * h);
}

export function speedOfSound(height: number, env: EnvironmentConfig): number {
  return Math.sqrt(env.heatCapacityRatio * env.gasConstant * airTemperature(height, env));
}

/**
 * Lift coefficient as a function of angle of attack (radians): linear up to
 * the stall angle, then decaying linearly to zero at the zero-lift angle.
 * `cl0` is the value at zero AoA.
 */
export function liftCoefficient(
  cl0: number,
  aoa: number,
  aero: AircraftType['aerodynamics'],
): number {
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

/** Multiplier on CD0 from compressibility: 1 below the onset Mach, rising linearly to the peak. */
export function machDragFactor(mach: number, aero: AircraftType['aerodynamics']): number {
  if (mach <= aero.machDragOnset) return 1;
  if (mach >= aero.machDragPeak) return aero.machDragPeakFactor;
  const t = (mach - aero.machDragOnset) / (aero.machDragPeak - aero.machDragOnset);
  return 1 + t * (aero.machDragPeakFactor - 1);
}

/** Thrust in newtons at the current throttle/afterburner setting and altitude. 0 when out of fuel. */
export function thrustAvailable(
  throttle: number,
  afterburner: boolean,
  fuel: number,
  height: number,
  model: FlightModel,
): number {
  if (fuel <= 0) return 0;
  const { engine } = model.aircraft;
  const env = model.environment;
  const densityRatio = airDensity(height, env) / env.seaLevelAirDensity;
  const lit = afterburner && engine.afterburnerThrust > 0;
  const seaLevel = lit ? engine.afterburnerThrust : engine.militaryThrust * clamp(throttle, 0, 1);
  return seaLevel * densityRatio;
}

/** Fuel consumption in kg/s. */
export function fuelFlow(
  throttle: number,
  afterburner: boolean,
  engine: AircraftType['engine'],
): number {
  if (afterburner && engine.afterburnerThrust > 0) return engine.afterburnerFuelFlow;
  return (
    engine.idleFuelFlow + (engine.militaryFuelFlow - engine.idleFuelFlow) * clamp(throttle, 0, 1)
  );
}

/** Load factor the fly-by-wire asks for at a given stick position: 1 g at neutral. */
export function commandedLoadFactor(pitchInput: number, limits: AircraftType['limits']): number {
  const p = clamp(pitchInput, -1, 1);
  return p >= 0 ? 1 + p * (limits.maxLoadFactor - 1) : 1 + p * (1 - limits.minLoadFactor);
}

/**
 * Angle of attack (radians) whose lift equals `loadFactor` times the weight at
 * the given dynamic pressure, clamped to the AoA limiter.
 */
export function commandedAngleOfAttack(
  loadFactor: number,
  dynamicPressure: number,
  mass: number,
  model: FlightModel,
): number {
  const { airframe, aerodynamics: aero, limits } = model.aircraft;
  if (dynamicPressure <= 0 || aero.liftSlope <= 0) return 0;
  const clRequired =
    (mass * model.environment.gravity * loadFactor) / (dynamicPressure * airframe.wingArea);
  const limit = toRadians(limits.maxAngleOfAttack);
  return clamp((clRequired - airframe.liftCoefficient) / aero.liftSlope, -limit, limit);
}

/** Fraction of full control authority available at this dynamic pressure. */
export function controlAuthority(
  dynamicPressure: number,
  controls: AircraftType['controls'],
): number {
  return clamp(dynamicPressure / controls.referenceDynamicPressure, 0, 1);
}

export function computeForces(state: AircraftState, model: FlightModel): Forces {
  const { airframe, aerodynamics: aero, gear, airbrake } = model.aircraft;
  const env = model.environment;
  const { forward, up } = state.attitude;
  const mass = airframe.emptyMass + Math.max(0, state.fuel);
  const gravity = vec3(0, 0, -mass * env.gravity);
  const thrustMagnitude = thrustAvailable(
    state.throttle,
    state.afterburner,
    state.fuel,
    state.height,
    model,
  );
  const thrust = scale(forward, thrustMagnitude);

  const v = state.velocity;
  const airspeed = length(v);
  const mach = airspeed / speedOfSound(state.height, env);
  const dynamicPressure = 0.5 * airDensity(state.height, env) * airspeed * airspeed;
  const extraDrag =
    gear.dragCoefficient * clamp(state.gear, 0, 1) +
    (state.airbrake ? airbrake.dragCoefficient : 0);

  let lift: Vec3 = ZERO;
  let drag: Vec3 = ZERO;
  let angleOfAttack = 0;
  let cl = liftCoefficient(airframe.liftCoefficient, 0, aero);
  let cd =
    airframe.dragCoefficient * machDragFactor(mach, aero) +
    aero.inducedDragFactor * cl * cl +
    extraDrag;
  let loadFactor = 0;

  if (airspeed >= aero.minAeroSpeed) {
    const vhat = scale(v, 1 / airspeed);
    angleOfAttack = Math.atan2(-dot(v, up), dot(v, forward));
    cl = liftCoefficient(airframe.liftCoefficient, angleOfAttack, aero);
    cd =
      airframe.dragCoefficient * machDragFactor(mach, aero) +
      aero.inducedDragFactor * cl * cl +
      extraDrag;
    const qS = dynamicPressure * airframe.wingArea;
    const liftDir = normalize(sub(up, scale(vhat, dot(up, vhat))));
    lift = scale(liftDir, qS * cl);
    drag = scale(vhat, -qS * cd);
    loadFactor = dot(lift, up) / (mass * env.gravity);
  }

  const total = add(add(add(thrust, lift), drag), gravity);
  return {
    thrust,
    lift,
    drag,
    gravity,
    total,
    mass,
    airspeed,
    mach,
    dynamicPressure,
    angleOfAttack,
    liftCoefficient: cl,
    dragCoefficient: cd,
    loadFactor,
    thrustMagnitude,
  };
}

/**
 * Turns the nose toward the velocity vector offset by the commanded angle of
 * attack, by at most `maxAngle` radians: the fly-by-wire pitch channel and the
 * weathervane stability in one.
 */
function seekNose(att: Attitude, velocity: Vec3, alpha: number, maxAngle: number): Attitude {
  const vhat = normalize(velocity);
  const target = normalize(rotateAboutAxis(vhat, att.right, alpha));
  const cosAngle = clamp(dot(att.forward, target), -1, 1);
  const angle = Math.acos(cosAngle);
  if (angle < 1e-5 || maxAngle <= 0) return att;
  const axis = normalize(cross(att.forward, target));
  if (axis === ZERO) return att;
  return rotateAttitude(att, axis, Math.min(angle, maxAngle));
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
  input: { roll: number; pitch: number; yaw: number },
  cfg: AircraftType['controls'],
  dt: number,
): BodyRates {
  const ease = (current: number, command: number, maxRate: number) =>
    easeRate(current, command * toRadians(maxRate), cfg.responseTime, cfg.releaseTime, dt);
  return {
    roll: ease(rates.roll, input.roll, cfg.rollRate),
    pitch: ease(rates.pitch, input.pitch, cfg.pitchRate),
    yaw: ease(rates.yaw, input.yaw, cfg.yawRate),
  };
}

function horizontal(v: Vec3): Vec3 {
  return vec3(v.x, v.y, 0);
}

function moveToward(value: number, target: number, maxDelta: number): number {
  if (maxDelta <= 0) return value;
  return value + clamp(target - value, -maxDelta, maxDelta);
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

  const { aircraft: ac, ground: gnd, environment: env } = model;
  const ground = groundHeight ?? state.groundHeight;
  const onGround = state.status === 'ground';
  const engineOut = state.fuel <= 0;
  const throttle = clamp(controls.throttle, 0, 1);
  const afterburner = controls.afterburner && !engineOut && ac.engine.afterburnerThrust > 0;
  const mass = ac.airframe.emptyMass + Math.max(0, state.fuel);

  const airspeed0 = length(state.velocity);
  const q = 0.5 * airDensity(state.height, env) * airspeed0 * airspeed0;
  const authority = controlAuthority(q, ac.controls);

  // Gear travels toward the commanded position.
  const gear = moveToward(
    state.gear,
    controls.gearDown ? 1 : 0,
    ac.gear.transitTime > 0 ? dt / ac.gear.transitTime : 1,
  );

  // Attitude: pilot input as smoothed body rates. In the air pitch goes through
  // the fly-by-wire g-command below; on the wheels it rotates the nose directly.
  const bodyRates = updateBodyRates(
    onGround ? { ...state.bodyRates, roll: 0 } : state.bodyRates,
    {
      roll: onGround ? 0 : controls.roll * authority,
      pitch: onGround ? controls.pitch * authority : 0,
      yaw: onGround ? controls.yaw : controls.yaw * authority,
    },
    ac.controls,
    dt,
  );
  let attitude = state.attitude;
  attitude = rotateBody(attitude, 'roll', bodyRates.roll * dt);
  attitude = rotateBody(attitude, 'pitch', bodyRates.pitch * dt);
  attitude = rotateBody(attitude, 'yaw', bodyRates.yaw * dt);

  let velocity = state.velocity;

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
  } else if (airspeed0 >= ac.aerodynamics.minAeroSpeed) {
    const alpha = commandedAngleOfAttack(
      commandedLoadFactor(controls.pitch, ac.limits),
      q,
      mass,
      model,
    );
    const rate = toRadians(ac.controls.pitchRate) * Math.max(authority, 0.1);
    attitude = seekNose(attitude, velocity, alpha, rate * dt);
  }

  // Forces and velocity.
  const forces = computeForces(
    { ...state, attitude, velocity, throttle, afterburner, gear, airbrake: controls.airbrake },
    model,
  );
  velocity = add(velocity, scale(forces.total, dt / mass));

  if (onGround) {
    const decel =
      gnd.rollingFriction * env.gravity + (controls.brakes ? ac.gear.brakeDeceleration : 0);
    const h = horizontal(velocity);
    const hs = length(h);
    const newHs = Math.max(0, hs - decel * dt);
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
  let crashReason = state.crashReason;
  const agl = height - ground;
  if (agl <= 0) {
    height = ground;
    if (status === 'airborne') {
      const hpr = hprFromAttitude(attitude);
      if (velocity.z < -gnd.maxLandingSinkRate) crashReason = 'hard landing';
      else if (Math.abs(hpr.roll) > toRadians(gnd.maxLandingRoll)) crashReason = 'wing strike';
      else if (hpr.pitch < toRadians(gnd.minLandingPitch)) crashReason = 'nose-first impact';
      else if (gear < 0.99) crashReason = 'gear-up landing';
      status = crashReason === null ? 'ground' : 'crashed';
      if (status === 'ground') {
        attitude = attitudeFromHPR({ heading: hpr.heading, pitch: 0, roll: 0 });
        velocity = horizontal(velocity);
      }
    }
    velocity = vec3(velocity.x, velocity.y, Math.max(0, velocity.z));
  } else if (status === 'ground' && agl > gnd.liftoffHeight) {
    status = 'airborne';
  }

  const fuel = Math.max(0, state.fuel - fuelFlow(throttle, afterburner, ac.engine) * dt);
  const loadFactor = forces.loadFactor;

  return {
    lat,
    lon,
    height,
    attitude,
    bodyRates,
    velocity,
    throttle,
    afterburner: afterburner && fuel > 0,
    fuel,
    gear,
    airbrake: controls.airbrake,
    status,
    crashReason,
    groundHeight: ground,
    loadFactor,
    peakLoadFactor: Math.max(state.peakLoadFactor, loadFactor),
  };
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpVec(a: Vec3, b: Vec3, t: number): Vec3 {
  return add(a, scale(sub(b, a), t));
}

/**
 * State for rendering between two consecutive physics steps: position,
 * attitude and velocity are blended by `t` (0 = `from`, 1 = `to`); every
 * discrete field comes from `to`.
 */
export function interpolateState(from: AircraftState, to: AircraftState, t: number): AircraftState {
  if (t <= 0 || from === to) return from;
  if (t >= 1) return to;
  let lon = from.lon;
  let dLon = to.lon - lon;
  if (dLon > 180) dLon -= 360;
  if (dLon < -180) dLon += 360;
  lon = lerp(lon, lon + dLon, t);
  if (lon > 180) lon -= 360;
  if (lon < -180) lon += 360;
  return {
    ...to,
    lat: lerp(from.lat, to.lat, t),
    lon,
    height: lerp(from.height, to.height, t),
    velocity: lerpVec(from.velocity, to.velocity, t),
    attitude: orthonormalize({
      forward: lerpVec(from.attitude.forward, to.attitude.forward, t),
      right: lerpVec(from.attitude.right, to.attitude.right, t),
      up: lerpVec(from.attitude.up, to.attitude.up, t),
    }),
  };
}
