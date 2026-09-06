/**
 * Small schema validator shared by the world configuration and the aircraft
 * type files. A section is a flat object; every key has a spec: a numeric
 * range, a boolean, a string, an enum, or a list of strings.
 */

export interface Range {
  min: number;
  max: number;
}

export type FieldSpec =
  | Range
  | { type: 'boolean' }
  | { type: 'string' }
  | { type: 'enum'; values: readonly string[] }
  | { type: 'stringList' };

export type SectionSpec<T> = { [K in keyof T]: FieldSpec };

export class ConfigError extends Error {
  constructor(message: string) {
    super(`Invalid configuration: ${message}`);
    this.name = 'ConfigError';
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isRange(spec: FieldSpec): spec is Range {
  return 'min' in spec;
}

function validateField(path: string, value: unknown, spec: FieldSpec): unknown {
  if (isRange(spec)) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new ConfigError(`"${path}" must be a finite number`);
    }
    if (value < spec.min || value > spec.max) {
      throw new ConfigError(`"${path}" must be between ${spec.min} and ${spec.max}, got ${value}`);
    }
    return value;
  }
  switch (spec.type) {
    case 'boolean':
      if (typeof value !== 'boolean') throw new ConfigError(`"${path}" must be true or false`);
      return value;
    case 'string':
      if (typeof value !== 'string') throw new ConfigError(`"${path}" must be a string`);
      return value;
    case 'enum':
      if (typeof value !== 'string' || !spec.values.includes(value)) {
        throw new ConfigError(`"${path}" must be one of ${spec.values.join(', ')}`);
      }
      return value;
    case 'stringList':
      if (!Array.isArray(value) || !value.every((v) => typeof v === 'string')) {
        throw new ConfigError(`"${path}" must be a list of strings`);
      }
      return [...value];
  }
}

/**
 * Validates `input` as a section named `name` against `spec`. Every key in the
 * spec must be present with a value of the right type and range; unknown keys
 * are rejected so typos in the JSON surface immediately.
 */
export function validateSection<T>(name: string, input: unknown, spec: SectionSpec<T>): T {
  if (!isRecord(input)) {
    throw new ConfigError(`"${name}" must be an object`);
  }
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(spec)) {
    out[key] = validateField(`${name}.${key}`, input[key], spec[key as keyof T]);
  }
  for (const key of Object.keys(input)) {
    if (!(key in spec)) {
      throw new ConfigError(`"${name}.${key}" is not a known setting`);
    }
  }
  return out as T;
}

/** Validates a map of sections, e.g. `{ low: {...}, medium: {...} }`, all with the same spec. */
export function validateSectionMap<T>(
  name: string,
  input: unknown,
  spec: SectionSpec<T>,
): Record<string, T> {
  if (!isRecord(input)) {
    throw new ConfigError(`"${name}" must be an object`);
  }
  const out: Record<string, T> = {};
  for (const key of Object.keys(input)) {
    out[key] = validateSection(`${name}.${key}`, input[key], spec);
  }
  return out;
}
