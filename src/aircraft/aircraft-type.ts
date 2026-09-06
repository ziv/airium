/**
 * An aircraft type: everything about how one kind of aircraft flies. Loaded
 * from `src/aircraft/<id>.json` and validated here. Pure TypeScript so the
 * physics tests can use it without Cesium.
 *
 * Units: kg, m, m², N, m/s, kg/s, degrees for angles, degrees/s for rates.
 */
import { ConfigError, isRecord, validateSection } from '../sim/validate';

export interface AirframeConfig {
  /** Mass without fuel, kg. */
  emptyMass: number;
  /** Internal fuel, kg. */
  fuelCapacity: number;
  /** Reference wing area, m². */
  wingArea: number;
  /** Lift coefficient at zero angle of attack. */
  liftCoefficient: number;
  /** Zero-lift drag coefficient (CD0) at low Mach. */
  dragCoefficient: number;
}

export interface EngineConfig {
  /** Thrust at 100 % throttle without afterburner, N, at sea level. */
  militaryThrust: number;
  /** Thrust with the afterburner lit, N, at sea level. 0 = no afterburner. */
  afterburnerThrust: number;
  /** Fuel flow at idle (throttle 0), kg/s. */
  idleFuelFlow: number;
  /** Fuel flow at 100 % throttle, kg/s. */
  militaryFuelFlow: number;
  /** Fuel flow with the afterburner lit, kg/s. */
  afterburnerFuelFlow: number;
}

export interface AerodynamicsConfig {
  /** Lift-curve slope per radian of angle of attack. */
  liftSlope: number;
  /** Angle of attack (degrees) where lift peaks. */
  stallAngle: number;
  /** Angle of attack (degrees) where lift has decayed to zero after the stall. */
  zeroLiftAngle: number;
  /** Induced drag: CD = CD0 + factor * CL². */
  inducedDragFactor: number;
  /** Airspeed (m/s) below which no aerodynamic forces are computed. */
  minAeroSpeed: number;
  /** Mach number where the transonic drag rise starts (CD0 multiplier 1 below it). */
  machDragOnset: number;
  /** Mach number where the drag rise peaks. */
  machDragPeak: number;
  /** CD0 multiplier at and beyond the peak. */
  machDragPeakFactor: number;
}

export interface LimitsConfig {
  /** Load factor the fly-by-wire commands at full back stick, g. */
  maxLoadFactor: number;
  /** Load factor at full forward stick, g (negative). */
  minLoadFactor: number;
  /** Angle-of-attack limiter, degrees. */
  maxAngleOfAttack: number;
  /** Overspeed warning above this Mach number. */
  maxMach: number;
  /** Overspeed warning above this airspeed, m/s. */
  maxAirspeed: number;
}

export interface ControlsConfig {
  /** Maximum roll rate, degrees/s, reached with full control authority. */
  rollRate: number;
  /** Maximum rate at which the nose follows the commanded angle of attack, degrees/s. */
  pitchRate: number;
  /** Maximum rudder yaw rate, degrees/s. */
  yawRate: number;
  /** Seconds for a rotation rate to build up after a key is pressed (exponential time constant). */
  responseTime: number;
  /** Seconds for a rotation rate to die away after release. */
  releaseTime: number;
  /** Fraction of full throttle per key press. */
  throttleStep: number;
  /**
   * Dynamic pressure (Pa) at which the controls have full authority; below it the
   * rates scale down linearly, so the aircraft goes soft when slow.
   */
  referenceDynamicPressure: number;
}

export interface GearConfig {
  /** Seconds for the gear to travel between up and down. */
  transitTime: number;
  /** Drag coefficient added when the gear is down. */
  dragCoefficient: number;
  /** Airspeed (m/s) above which the extended gear is overspeeding. */
  maxSpeed: number;
  /** Deceleration from the wheel brakes on the ground, m/s². */
  brakeDeceleration: number;
}

export interface AirbrakeConfig {
  /** Drag coefficient added when the airbrake is out. */
  dragCoefficient: number;
}

export interface ModelConfig {
  /** glTF/GLB file, relative to the site root. */
  uri: string;
  /** Uniform scale applied to the model. */
  scale: number;
  /** Cockpit camera position, metres ahead of the model origin ... */
  cockpitForward: number;
  /** ... and above it. */
  cockpitUp: number;
}

export interface AircraftType {
  id: string;
  name: string;
  airframe: AirframeConfig;
  engine: EngineConfig;
  aerodynamics: AerodynamicsConfig;
  limits: LimitsConfig;
  controls: ControlsConfig;
  gear: GearConfig;
  airbrake: AirbrakeConfig;
  model: ModelConfig;
}

const AIRFRAME = {
  emptyMass: { min: 1, max: 1_000_000 },
  fuelCapacity: { min: 0, max: 1_000_000 },
  wingArea: { min: 0.1, max: 10_000 },
  liftCoefficient: { min: -1, max: 5 },
  dragCoefficient: { min: 0, max: 5 },
};

const ENGINE = {
  militaryThrust: { min: 0, max: 10_000_000 },
  afterburnerThrust: { min: 0, max: 10_000_000 },
  idleFuelFlow: { min: 0, max: 100 },
  militaryFuelFlow: { min: 0, max: 100 },
  afterburnerFuelFlow: { min: 0, max: 100 },
};

const AERODYNAMICS = {
  liftSlope: { min: 0, max: 20 },
  stallAngle: { min: 1, max: 89 },
  zeroLiftAngle: { min: 1, max: 90 },
  inducedDragFactor: { min: 0, max: 5 },
  minAeroSpeed: { min: 0.01, max: 100 },
  machDragOnset: { min: 0.1, max: 10 },
  machDragPeak: { min: 0.1, max: 10 },
  machDragPeakFactor: { min: 1, max: 50 },
};

const LIMITS = {
  maxLoadFactor: { min: 1, max: 30 },
  minLoadFactor: { min: -30, max: 1 },
  maxAngleOfAttack: { min: 1, max: 89 },
  maxMach: { min: 0.1, max: 10 },
  maxAirspeed: { min: 1, max: 5_000 },
};

const CONTROLS = {
  rollRate: { min: 0, max: 720 },
  pitchRate: { min: 0, max: 720 },
  yawRate: { min: 0, max: 720 },
  responseTime: { min: 0, max: 30 },
  releaseTime: { min: 0, max: 30 },
  throttleStep: { min: 0.001, max: 1 },
  referenceDynamicPressure: { min: 1, max: 1_000_000 },
};

const GEAR = {
  transitTime: { min: 0, max: 60 },
  dragCoefficient: { min: 0, max: 5 },
  maxSpeed: { min: 1, max: 5_000 },
  brakeDeceleration: { min: 0, max: 100 },
};

const AIRBRAKE = { dragCoefficient: { min: 0, max: 5 } };

const MODEL = {
  uri: { type: 'string' },
  scale: { min: 0.001, max: 1_000 },
  cockpitForward: { min: -100, max: 100 },
  cockpitUp: { min: -100, max: 100 },
} as const;

/** Validates one aircraft type file. `id` is the registry key (file name). */
export function validateAircraftType(id: string, input: unknown): AircraftType {
  if (!isRecord(input)) {
    throw new ConfigError(`aircraft "${id}" must be an object`);
  }
  const name = input['name'];
  if (typeof name !== 'string' || name.trim() === '') {
    throw new ConfigError(`aircraft "${id}": "name" must be a non-empty string`);
  }
  const p = (section: string) => `${id}.${section}`;
  const type: AircraftType = {
    id,
    name,
    airframe: validateSection<AirframeConfig>(p('airframe'), input['airframe'], AIRFRAME),
    engine: validateSection<EngineConfig>(p('engine'), input['engine'], ENGINE),
    aerodynamics: validateSection<AerodynamicsConfig>(
      p('aerodynamics'),
      input['aerodynamics'],
      AERODYNAMICS,
    ),
    limits: validateSection<LimitsConfig>(p('limits'), input['limits'], LIMITS),
    controls: validateSection<ControlsConfig>(p('controls'), input['controls'], CONTROLS),
    gear: validateSection<GearConfig>(p('gear'), input['gear'], GEAR),
    airbrake: validateSection<AirbrakeConfig>(p('airbrake'), input['airbrake'], AIRBRAKE),
    model: validateSection<ModelConfig>(p('model'), input['model'], MODEL),
  };
  const aero = type.aerodynamics;
  if (aero.zeroLiftAngle <= aero.stallAngle) {
    throw new ConfigError(
      `aircraft "${id}": "aerodynamics.zeroLiftAngle" must exceed "stallAngle"`,
    );
  }
  if (aero.machDragPeak < aero.machDragOnset) {
    throw new ConfigError(
      `aircraft "${id}": "aerodynamics.machDragPeak" must not be below "machDragOnset"`,
    );
  }
  if (type.limits.maxAngleOfAttack > aero.stallAngle) {
    throw new ConfigError(
      `aircraft "${id}": "limits.maxAngleOfAttack" must not exceed "aerodynamics.stallAngle"`,
    );
  }
  return type;
}
