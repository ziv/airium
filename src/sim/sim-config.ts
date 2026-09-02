/**
 * Simulation configuration. Everything tunable lives in `start.config.json`;
 * nothing about the flight model is hard-coded in the physics.
 * Pure TypeScript, no Cesium imports, so it is unit-testable in Node.
 *
 * Angles in the file are degrees, lengths metres, speeds m/s, forces newtons.
 */

/** Where and how the flight begins. */
export interface StartConfig {
  /** Degrees (WGS84). */
  lat: number;
  lon: number;
  /** Metres above the terrain surface. */
  height: number;
  /** Degrees, 0 = north, clockwise. */
  heading: number;
  /** Metres per second. */
  speed: number;
  /** Vertical field of view in degrees. */
  fov: number;
}

/** What the aircraft is. */
export interface AircraftConfig {
  /** Mass in kilograms. */
  weight: number;
  /** Reference wing area in square metres. */
  wingArea: number;
  /** Dimensionless lift coefficient at zero angle of attack. */
  liftCoefficient: number;
  /** Dimensionless zero-lift drag coefficient (CD0). */
  dragCoefficient: number;
  /** Newtons at 100 % throttle. */
  maxThrust: number;
}

/** Shape of the aerodynamic model. */
export interface AerodynamicsConfig {
  /** Lift-curve slope per radian of angle of attack. */
  liftSlope: number;
  /** Angle of attack (degrees) where lift peaks. */
  stallAngle: number;
  /** Angle of attack (degrees) where lift has decayed to zero after the stall. */
  zeroLiftAngle: number;
  /** Induced drag: CD = CD0 + factor * CL^2. */
  inducedDragFactor: number;
  /**
   * Load factor (g) the aircraft trims to with neutral controls: the nose seeks the angle of
   * attack whose lift equals this many times the weight (clamped to the stall). 0 disables trim,
   * so the nose simply weathervanes onto the velocity vector.
   */
  trimLoadFactor: number;
  /** Airspeed (m/s) below which no aerodynamic forces are computed. */
  minAeroSpeed: number;
  /** Weathervane stability: nose turns toward the velocity at this many degrees/s per m/s ... */
  stabilityRatePerSpeed: number;
  /** ... capped at this rate in degrees/s. */
  stabilityMaxRate: number;
}

/** How the pilot's keys move the aircraft. */
export interface ControlsConfig {
  /** Degrees per second while the key is held. */
  rollRate: number;
  pitchRate: number;
  yawRate: number;
  /** Fraction of full throttle per key press (0.05 = 5 %). */
  throttleStep: number;
}

/** Ground contact rules. */
export interface GroundConfig {
  /** Sink rate (m/s) above which a touchdown is a crash. */
  maxLandingSinkRate: number;
  /** Bank (degrees) above which a touchdown is a crash. */
  maxLandingRoll: number;
  /** Nose-down pitch (degrees, negative) below which a touchdown is a crash. */
  minLandingPitch: number;
  /** Rolling friction coefficient on the wheels. */
  rollingFriction: number;
  /** Maximum nose-up pitch (degrees) while on the wheels. */
  maxGroundPitch: number;
  /** Height above ground (m) at which a rolling aircraft counts as airborne. */
  liftoffHeight: number;
}

/** Physical constants of the world. */
export interface EnvironmentConfig {
  /** m/s^2 */
  gravity: number;
  /** kg/m^3 */
  seaLevelAirDensity: number;
  /** Metres; density falls off as exp(-height / scaleHeight). */
  densityScaleHeight: number;
  /** Metres; used to convert ground motion into lat/lon. */
  earthRadius: number;
}

/** Time integration. */
export interface SimulationConfig {
  /** Fixed physics steps per second. */
  physicsHz: number;
  /** Longest real-time gap (seconds) simulated per frame; larger gaps (e.g. a paused tab) are clamped. */
  maxFrameSeconds: number;
}

export interface SimConfig {
  start: StartConfig;
  aircraft: AircraftConfig;
  aerodynamics: AerodynamicsConfig;
  controls: ControlsConfig;
  ground: GroundConfig;
  environment: EnvironmentConfig;
  simulation: SimulationConfig;
}

interface Range {
  min: number;
  max: number;
}

type Ranges<T> = Record<keyof T, Range>;

const START_RANGES: Ranges<StartConfig> = {
  lat: { min: -90, max: 90 },
  lon: { min: -180, max: 180 },
  height: { min: 0, max: 100_000 },
  heading: { min: 0, max: 360 },
  speed: { min: 0, max: 1_000 },
  fov: { min: 1, max: 179 },
};

const AIRCRAFT_RANGES: Ranges<AircraftConfig> = {
  weight: { min: 1, max: 1_000_000 },
  wingArea: { min: 0.1, max: 10_000 },
  liftCoefficient: { min: 0, max: 5 },
  dragCoefficient: { min: 0, max: 5 },
  maxThrust: { min: 0, max: 10_000_000 },
};

const AERODYNAMICS_RANGES: Ranges<AerodynamicsConfig> = {
  liftSlope: { min: 0, max: 20 },
  stallAngle: { min: 1, max: 89 },
  zeroLiftAngle: { min: 1, max: 90 },
  inducedDragFactor: { min: 0, max: 5 },
  trimLoadFactor: { min: 0, max: 10 },
  minAeroSpeed: { min: 0.01, max: 100 },
  stabilityRatePerSpeed: { min: 0, max: 90 },
  stabilityMaxRate: { min: 0, max: 360 },
};

const CONTROLS_RANGES: Ranges<ControlsConfig> = {
  rollRate: { min: 0, max: 720 },
  pitchRate: { min: 0, max: 720 },
  yawRate: { min: 0, max: 720 },
  throttleStep: { min: 0.001, max: 1 },
};

const GROUND_RANGES: Ranges<GroundConfig> = {
  maxLandingSinkRate: { min: 0, max: 1_000 },
  maxLandingRoll: { min: 0, max: 180 },
  minLandingPitch: { min: -90, max: 0 },
  rollingFriction: { min: 0, max: 1 },
  maxGroundPitch: { min: 0, max: 89 },
  liftoffHeight: { min: 0, max: 100 },
};

const ENVIRONMENT_RANGES: Ranges<EnvironmentConfig> = {
  gravity: { min: 0, max: 1_000 },
  seaLevelAirDensity: { min: 0, max: 100 },
  densityScaleHeight: { min: 1, max: 1_000_000 },
  earthRadius: { min: 1_000, max: 1_000_000_000 },
};

const SIMULATION_RANGES: Ranges<SimulationConfig> = {
  physicsHz: { min: 1, max: 10_000 },
  maxFrameSeconds: { min: 0.001, max: 10 },
};

const SECTION_RANGES = {
  start: START_RANGES,
  aircraft: AIRCRAFT_RANGES,
  aerodynamics: AERODYNAMICS_RANGES,
  controls: CONTROLS_RANGES,
  ground: GROUND_RANGES,
  environment: ENVIRONMENT_RANGES,
  simulation: SIMULATION_RANGES,
} as const;

export const SECTION_NAMES = Object.keys(SECTION_RANGES) as (keyof SimConfig)[];
export const START_CONFIG_KEYS = Object.keys(START_RANGES) as (keyof StartConfig)[];

export class SimConfigError extends Error {
  constructor(message: string) {
    super(`Invalid configuration: ${message}`);
    this.name = 'SimConfigError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validateSection<T extends string>(
  section: string,
  input: unknown,
  ranges: Record<T, Range>,
): Record<T, number> {
  if (!isRecord(input)) {
    throw new SimConfigError(`"${section}" must be an object`);
  }
  const out = {} as Record<T, number>;
  for (const key of Object.keys(ranges) as T[]) {
    const value = input[key];
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new SimConfigError(`"${section}.${key}" must be a finite number`);
    }
    const { min, max } = ranges[key];
    if (value < min || value > max) {
      throw new SimConfigError(
        `"${section}.${key}" must be between ${min} and ${max}, got ${value}`,
      );
    }
    out[key] = value;
  }
  return out;
}

/**
 * Validates an arbitrary value (e.g. parsed JSON) as a complete SimConfig.
 * Every section and key must be present, and every value a finite number
 * inside its allowed range. Heading is normalised so 360 becomes 0.
 */
export function validateSimConfig(input: unknown): SimConfig {
  if (!isRecord(input)) {
    throw new SimConfigError('expected an object');
  }
  const config = {} as Record<keyof SimConfig, Record<string, number>>;
  for (const section of SECTION_NAMES) {
    const ranges: Record<string, Range> = SECTION_RANGES[section];
    config[section] = validateSection(section, input[section], ranges);
  }
  const result = config as unknown as SimConfig;
  result.start.heading = result.start.heading % 360;
  if (result.aerodynamics.zeroLiftAngle <= result.aerodynamics.stallAngle) {
    throw new SimConfigError('"aerodynamics.zeroLiftAngle" must be greater than "stallAngle"');
  }
  return result;
}

/**
 * Reads optional start overrides from a URL query string, e.g. `?lat=32&lon=34.8`.
 * Unknown keys are ignored; known keys with non-numeric values are rejected.
 */
export function parseStartOverrides(search: string): Partial<StartConfig> {
  const params = new URLSearchParams(search);
  const overrides: Partial<StartConfig> = {};

  for (const key of START_CONFIG_KEYS) {
    const raw = params.get(key);
    if (raw === null) continue;
    const value = Number(raw);
    if (raw.trim() === '' || !Number.isFinite(value)) {
      throw new SimConfigError(`query parameter "${key}" is not a number: "${raw}"`);
    }
    overrides[key] = value;
  }

  return overrides;
}

/** Combines the base config with query-string start overrides and validates the result. */
export function resolveSimConfig(base: unknown, search = ''): SimConfig {
  const baseConfig = validateSimConfig(base);
  const overrides = parseStartOverrides(search);
  return validateSimConfig({
    ...baseConfig,
    start: { ...baseConfig.start, ...overrides },
  });
}
