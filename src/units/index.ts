/** Registry of surface unit types, keyed by file name; see `src/aircraft` for the pattern. */
import { ConfigError } from '../sim/validate';
import patrolBoat from './patrol-boat.json';
import samSite from './sam-site.json';
import truck from './truck.json';
import { type UnitType, validateUnitType } from './unit-type';

const SOURCES: Record<string, unknown> = { 'sam-site': samSite, truck, 'patrol-boat': patrolBoat };

export const UNIT_IDS: readonly string[] = Object.keys(SOURCES);

const cache = new Map<string, UnitType>();

export function getUnitType(id: string): UnitType {
  const cached = cache.get(id);
  if (cached) return cached;
  const source = SOURCES[id];
  if (source === undefined) {
    throw new ConfigError(`unknown unit "${id}" (known: ${UNIT_IDS.join(', ')})`);
  }
  const type = validateUnitType(id, source);
  cache.set(id, type);
  return type;
}
