/**
 * A surface unit type (ground unit or ship): size, toughness, speed and how
 * it is drawn. Loaded from `src/units/<id>.json`.
 */
import { ConfigError, isRecord, validateSection } from '../sim/validate';

export interface UnitModel {
  /** glTF/GLB file, relative to the site root. */
  uri: string;
  scale: number;
}

export interface UnitType {
  id: string;
  name: string;
  kind: 'ground-unit' | 'ship';
  /** Collision sphere radius, metres. */
  radius: number;
  health: number;
  /** Cruise speed along a route, m/s (0 = static). */
  speed: number;
  model: UnitModel;
}

const UNIT = {
  name: { type: 'string' },
  kind: { type: 'enum', values: ['ground-unit', 'ship'] },
  radius: { min: 0.1, max: 1_000 },
  health: { min: 1, max: 1_000_000 },
  speed: { min: 0, max: 200 },
} as const;

const MODEL = { uri: { type: 'string' }, scale: { min: 0.001, max: 1_000 } } as const;

export function validateUnitType(id: string, input: unknown): UnitType {
  if (!isRecord(input)) throw new ConfigError(`unit "${id}" must be an object`);
  const { model, ...rest } = input;
  const head = validateSection<Omit<UnitType, 'id' | 'model'>>(id, rest, UNIT);
  if (head.name.trim() === '') throw new ConfigError(`unit "${id}": "name" must not be empty`);
  return { id, ...head, model: validateSection<UnitModel>(`${id}.model`, model, MODEL) };
}
