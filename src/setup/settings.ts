import { AI, difficultyFromSearch, validateAI } from '../ai/config';
import { AIRCRAFT_IDS, getAircraftType } from '../aircraft';
import { validateAircraftType } from '../aircraft/aircraft-type';
import { getMission, MISSION_IDS } from '../missions';
import { SENSORS, validateSensors } from '../sensors/config';
import { resolveSimConfig, validateSimConfig } from '../sim/sim-config';
import { validateMission } from '../sim/spawn';
import startJson from '../start.config.json';
import { getUnitType, UNIT_IDS } from '../units';
import { validateUnitType } from '../units/unit-type';
import { validateWeapons, WEAPONS } from '../weapons/config';

export function defaultSettings(search = '') {
  return structuredClone({
    sim: resolveSimConfig(startJson, search),
    aircraft: Object.fromEntries(AIRCRAFT_IDS.map((id) => [id, getAircraftType(id)])),
    units: Object.fromEntries(UNIT_IDS.map((id) => [id, getUnitType(id)])),
    missions: Object.fromEntries(MISSION_IDS.map((id) => [id, getMission(id)])),
    ai: { ...AI, difficulty: difficultyFromSearch(search) },
    weapons: WEAPONS,
    sensors: SENSORS,
  });
}
export type Settings = ReturnType<typeof defaultSettings>;

export function validateSettings(settings: Settings): Settings {
  const sim = validateSimConfig(settings.sim);
  if (!settings.aircraft[sim.start.aircraft]) throw new Error('Select a known aircraft.');
  if (sim.start.mission && !settings.missions[sim.start.mission])
    throw new Error('Select a known mission.');
  if (sim.start.time && !Number.isFinite(Date.parse(sim.start.time)))
    throw new Error('Enter a valid flight date and time.');
  return {
    sim,
    aircraft: Object.fromEntries(
      Object.entries(settings.aircraft).map(([id, value]) => [id, validateAircraftType(id, value)]),
    ),
    units: Object.fromEntries(
      Object.entries(settings.units).map(([id, value]) => [
        id,
        validateUnitType(
          id,
          Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'id')),
        ),
      ]),
    ),
    missions: Object.fromEntries(
      Object.entries(settings.missions).map(([id, value]) => [
        id,
        validateMission(value, { aircraft: AIRCRAFT_IDS, units: UNIT_IDS }),
      ]),
    ),
    ai: validateAI(settings.ai),
    weapons: validateWeapons(settings.weapons),
    sensors: validateSensors(settings.sensors),
  };
}
