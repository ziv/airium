/** Registry of missions (spawn descriptions), keyed by file name. */
import { AIRCRAFT_IDS } from '../aircraft';
import { type Mission, validateMission } from '../sim/spawn';
import { ConfigError } from '../sim/validate';
import { UNIT_IDS } from '../units';
import coastalPatrol from './coastal-patrol.json';

const SOURCES: Record<string, unknown> = { 'coastal-patrol': coastalPatrol };

export const MISSION_IDS: readonly string[] = Object.keys(SOURCES);

const cache = new Map<string, Mission>();

export function getMission(id: string): Mission {
  const cached = cache.get(id);
  if (cached) return cached;
  const source = SOURCES[id];
  if (source === undefined) {
    throw new ConfigError(`unknown mission "${id}" (known: ${MISSION_IDS.join(', ')})`);
  }
  const mission = validateMission(source, { aircraft: AIRCRAFT_IDS, units: UNIT_IDS });
  cache.set(id, mission);
  return mission;
}
