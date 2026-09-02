/**
 * Start configuration: where and how the aircraft (and therefore the camera)
 * begins. Pure TypeScript, no Cesium imports, so it is unit-testable in Node.
 *
 * Units:
 *   lat, lon  degrees (WGS84)
 *   height    metres above the terrain surface (above ground level)
 *   heading   degrees, 0 = north, increasing clockwise (90 = east)
 *   speed     metres per second
 *   fov       vertical field of view in degrees
 */
export interface StartConfig {
  lat: number;
  lon: number;
  height: number;
  heading: number;
  speed: number;
  fov: number;
}

export const START_CONFIG_KEYS: readonly (keyof StartConfig)[] = [
  'lat',
  'lon',
  'height',
  'heading',
  'speed',
  'fov',
];

interface Range {
  min: number;
  max: number;
}

const RANGES: Record<keyof StartConfig, Range> = {
  lat: { min: -90, max: 90 },
  lon: { min: -180, max: 180 },
  height: { min: 0, max: 100_000 },
  heading: { min: 0, max: 360 },
  speed: { min: 0, max: 1_000 },
  fov: { min: 1, max: 179 },
};

export class StartConfigError extends Error {
  constructor(message: string) {
    super(`Invalid start configuration: ${message}`);
    this.name = 'StartConfigError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Validates an arbitrary value (e.g. parsed JSON) as a complete StartConfig.
 * Every key must be present and a finite number inside its allowed range.
 * Heading is normalised so 360 becomes 0.
 */
export function validateStartConfig(input: unknown): StartConfig {
  if (!isRecord(input)) {
    throw new StartConfigError('expected an object');
  }

  const out: Partial<StartConfig> = {};
  for (const key of START_CONFIG_KEYS) {
    const value = input[key];
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new StartConfigError(`"${key}" must be a finite number`);
    }
    const { min, max } = RANGES[key];
    if (value < min || value > max) {
      throw new StartConfigError(`"${key}" must be between ${min} and ${max}, got ${value}`);
    }
    out[key] = value;
  }

  const config = out as StartConfig;
  config.heading = config.heading % 360;
  return config;
}

/**
 * Reads optional overrides from a URL query string, e.g. `?lat=32&lon=34.8`.
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
      throw new StartConfigError(`query parameter "${key}" is not a number: "${raw}"`);
    }
    overrides[key] = value;
  }

  return overrides;
}

/** Combines the base config with query-string overrides and validates the result. */
export function resolveStartConfig(base: unknown, search = ''): StartConfig {
  const baseConfig = validateStartConfig(base);
  const overrides = parseStartOverrides(search);
  return validateStartConfig({ ...baseConfig, ...overrides });
}
