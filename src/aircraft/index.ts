/**
 * Registry of aircraft types. Add a JSON file next to this one and list it
 * here; `start.aircraft` in the world configuration (or `?aircraft=` in the
 * URL) selects the player's type by key.
 */
import { ConfigError } from '../sim/validate';
import { type AircraftType, validateAircraftType } from './aircraft-type';
import f16 from './f16.json';
import trainer from './trainer.json';

const SOURCES: Record<string, unknown> = { f16, trainer };

export const AIRCRAFT_IDS: readonly string[] = Object.keys(SOURCES);

const cache = new Map<string, AircraftType>();

export function getAircraftType(id: string): AircraftType {
  const cached = cache.get(id);
  if (cached) return cached;
  const source = SOURCES[id];
  if (source === undefined) {
    throw new ConfigError(`unknown aircraft "${id}" (known: ${AIRCRAFT_IDS.join(', ')})`);
  }
  const type = validateAircraftType(id, source);
  cache.set(id, type);
  return type;
}
