/**
 * Everything the HUD renderer draws, assembled once per frame from the
 * simulation. Pure so the mapping can be unit-tested.
 */
import { hprFromAttitude } from '../sim/attitude';
import { type Vec3, length, normalize } from '../sim/math3d';
import type { AircraftState, FlightModel, Forces } from '../sim/physics';
import type { HudConfig, Units } from '../sim/sim-config';
import { type Warnings, activeWarnings } from '../sim/warnings';
import { pullUpWarning } from './layout';
import type { CameraPose } from './projection';
import type { CombatHud } from './combat-data';

/** Target symbology, filled in by the sensors and weapons milestones. */
export interface TargetSymbology {
  /** Direction from the aircraft, ENU. */
  direction: Vec3;
  /** Metres. */
  range: number;
  /** Closing speed, m/s (positive = closing). */
  closure: number;
  locked: boolean;
  label?: string;
  aspect?: number;
}

export interface HudData {
  units: Units;
  /** Seconds, for flashing. */
  time: number;
  status: AircraftState['status'];
  crashReason: string | null;
  /** Radians. */
  heading: number;
  pitch: number;
  roll: number;
  airspeed: number;
  mach: number;
  /** Metres above the ellipsoid. */
  altitude: number;
  /** Metres above ground. */
  agl: number;
  verticalSpeed: number;
  loadFactor: number;
  peakLoadFactor: number;
  /** Radians. */
  angleOfAttack: number;
  /** Degrees. */
  maxAngleOfAttack: number;
  throttle: number;
  afterburner: boolean;
  fuel: number;
  fuelCapacity: number;
  gear: number;
  airbrake: boolean;
  brakes: boolean;
  /** Labels in display order, PULL UP first. */
  warnings: string[];
  /** Nose direction, ENU. */
  boresight: Vec3;
  /** Velocity direction, ENU (nose when too slow to fly). */
  flightPath: Vec3;
  pose: CameraPose;
  cameraMode: string;
  paused: boolean;
  timeScale: number;
  waypointHeading?: number;
  target?: TargetSymbology;
  weapon?: string;
  combat?: CombatHud;
  restartKey?: string;
}

export interface HudExtras {
  pose: CameraPose;
  cameraMode: string;
  paused: boolean;
  timeScale: number;
  units: Units;
  brakes: boolean;
  time: number;
  waypointHeading?: number;
  target?: TargetSymbology;
  weapon?: string;
  combat?: CombatHud;
  restartKey?: string;
}

export function buildHudData(
  state: AircraftState,
  forces: Forces,
  warnings: Warnings,
  model: FlightModel,
  cfg: Pick<HudConfig, 'pullUpSeconds'>,
  extras: HudExtras,
): HudData {
  const hpr = hprFromAttitude(state.attitude);
  const agl = state.height - state.groundHeight;
  const labels = activeWarnings(warnings);
  if (state.status === 'airborne' && pullUpWarning(agl, state.velocity.z, cfg.pullUpSeconds)) {
    labels.unshift('PULL UP');
  }
  const flying = length(state.velocity) >= model.aircraft.aerodynamics.minAeroSpeed;
  return {
    units: extras.units,
    time: extras.time,
    status: state.status,
    crashReason: state.crashReason,
    heading: hpr.heading,
    pitch: hpr.pitch,
    roll: hpr.roll,
    airspeed: forces.airspeed,
    mach: forces.mach,
    altitude: state.height,
    agl,
    verticalSpeed: state.velocity.z,
    loadFactor: forces.loadFactor,
    peakLoadFactor: state.peakLoadFactor,
    angleOfAttack: forces.angleOfAttack,
    maxAngleOfAttack: model.aircraft.limits.maxAngleOfAttack,
    throttle: state.throttle,
    afterburner: state.afterburner,
    fuel: state.fuel,
    fuelCapacity: model.aircraft.airframe.fuelCapacity,
    gear: state.gear,
    airbrake: state.airbrake,
    brakes: extras.brakes,
    warnings: labels,
    boresight: state.attitude.forward,
    flightPath: flying ? normalize(state.velocity) : state.attitude.forward,
    pose: extras.pose,
    cameraMode: extras.cameraMode,
    paused: extras.paused,
    timeScale: extras.timeScale,
    ...(extras.waypointHeading !== undefined ? { waypointHeading: extras.waypointHeading } : {}),
    ...(extras.target !== undefined ? { target: extras.target } : {}),
    ...(extras.weapon !== undefined ? { weapon: extras.weapon } : {}),
    ...(extras.combat !== undefined ? { combat: extras.combat } : {}),
    ...(extras.restartKey !== undefined ? { restartKey: extras.restartKey } : {}),
  };
}
