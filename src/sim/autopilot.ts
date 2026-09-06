/**
 * A simple autopilot that turns the flight model's controls toward a heading,
 * altitude and speed. Enough for holding patterns and waypoint flying; the
 * combat AI (M9) builds on it.
 */
import type { AircraftType } from '../aircraft/aircraft-type';
import { hprFromAttitude } from './attitude';
import { headingError } from './geo';
import { clamp, length, toRadians } from './math3d';
import { type AircraftState, type Controls, NEUTRAL_CONTROLS } from './physics';

export interface AutopilotTarget {
  /** Radians, 0 = north, clockwise. */
  heading: number;
  /** Metres above the ellipsoid. */
  altitude: number;
  /** m/s. */
  speed: number;
}

export interface AutopilotGains {
  /** Bank limit, radians. */
  maxBank: number;
  /** Bank per radian of heading error. */
  headingGain: number;
  /** Roll input per radian of bank error. */
  rollGain: number;
  /** Climb rate (m/s) per metre of altitude error. */
  altitudeGain: number;
  /** m/s. */
  maxClimbRate: number;
  /** Extra g per m/s of climb-rate error. */
  climbGain: number;
  /** Throttle per m/s of speed error, around a cruise setting. */
  speedGain: number;
  cruiseThrottle: number;
  /** Light the afterburner when this far below the target speed, m/s. */
  afterburnerBelow: number;
}

export const DEFAULT_GAINS: AutopilotGains = {
  maxBank: toRadians(60),
  headingGain: 2.5,
  rollGain: 2,
  altitudeGain: 0.08,
  maxClimbRate: 40,
  climbGain: 0.15,
  speedGain: 0.03,
  cruiseThrottle: 0.6,
  afterburnerBelow: 40,
};

export function autopilot(
  state: AircraftState,
  target: AutopilotTarget,
  type: AircraftType,
  gravity: number,
  gains: AutopilotGains = DEFAULT_GAINS,
): Controls {
  const hpr = hprFromAttitude(state.attitude);
  const onGround = state.status === 'ground';

  // Lateral: bank toward the target heading, roll toward that bank.
  const hdgErr = headingError(hpr.heading, target.heading);
  const bankTarget = clamp(gains.headingGain * hdgErr, -gains.maxBank, gains.maxBank);
  const roll = clamp(gains.rollGain * (bankTarget - hpr.roll), -1, 1);

  // Vertical: climb-rate demand from the altitude error, turned into a g demand
  // that also carries the extra lift a bank needs.
  const climbDemand = clamp(
    gains.altitudeGain * (target.altitude - state.height),
    -gains.maxClimbRate,
    gains.maxClimbRate,
  );
  const extraG = clamp(gains.climbGain * (climbDemand - state.velocity.z), -1, 1.5);
  const bankLoad = 1 / Math.max(Math.cos(Math.min(Math.abs(hpr.roll), toRadians(80))), 0.2);
  const loadFactor = clamp(
    bankLoad * (1 + extraG * (gravity / gravity)),
    0.2,
    type.limits.maxLoadFactor,
  );
  const pitch =
    loadFactor >= 1
      ? (loadFactor - 1) / Math.max(type.limits.maxLoadFactor - 1, 0.01)
      : (loadFactor - 1) / Math.max(1 - type.limits.minLoadFactor, 0.01);

  // Speed: proportional throttle, afterburner for a large deficit.
  const speedErr = target.speed - length(state.velocity);
  const throttle = clamp(gains.cruiseThrottle + gains.speedGain * speedErr, 0, 1);
  const afterburner = type.engine.afterburnerThrust > 0 && speedErr > gains.afterburnerBelow;

  return {
    ...NEUTRAL_CONTROLS,
    roll: onGround ? 0 : roll,
    pitch: onGround ? 1 : clamp(pitch, -1, 1),
    throttle: onGround ? 1 : throttle,
    afterburner: onGround ? type.engine.afterburnerThrust > 0 : afterburner,
    gearDown: onGround,
  };
}
