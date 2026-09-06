/**
 * Mission spawn format: which entities exist when a mission starts. Parsed
 * and validated like the world configuration; turned into entities once the
 * terrain heights under the spawn points are known.
 */
import type { AircraftType } from '../aircraft/aircraft-type';
import type { UnitType } from '../units/unit-type';
import {
  type Behaviour,
  type Entity,
  type Faction,
  type Route,
  type Waypoint,
  createAircraftEntity,
  createSurfaceEntity,
  createWaypointEntity,
} from './entities';
import { type FlightModel, createInitialState } from './physics';
import type { EnvironmentConfig, GroundConfig } from './sim-config';
import { ConfigError, isRecord, validateSection } from './validate';

export type WaypointSpec = Waypoint;

export type BehaviourSpec =
  | { mode: 'straight' }
  | {
      mode: 'orbit';
      lat: number;
      lon: number;
      radius: number;
      altitude: number;
      speed: number;
      clockwise: boolean;
    }
  | { mode: 'waypoints'; waypoints: WaypointSpec[]; loop: boolean };

export interface RouteSpec {
  waypoints: WaypointSpec[];
  loop: boolean;
}

interface SpawnBase {
  id: string;
  name: string;
  lat: number;
  lon: number;
}

export interface AircraftSpawn extends SpawnBase {
  kind: 'aircraft';
  type: string;
  faction: Faction;
  /** Metres above the terrain at the spawn point; 0 = on the wheels. */
  height: number;
  heading: number;
  speed: number;
  behaviour: BehaviourSpec;
}

export interface UnitSpawn extends SpawnBase {
  kind: 'ground-unit' | 'ship';
  type: string;
  faction: Faction;
  heading: number;
  route: RouteSpec | null;
}

export interface WaypointSpawn extends SpawnBase {
  kind: 'waypoint';
  /** Metres above the ellipsoid. */
  height: number;
}

export type EntitySpawn = AircraftSpawn | UnitSpawn | WaypointSpawn;

export interface Mission {
  name: string;
  description: string;
  entities: EntitySpawn[];
}

const FACTIONS = ['player', 'friendly', 'hostile', 'neutral'] as const;
const KINDS = ['aircraft', 'ground-unit', 'ship', 'waypoint'] as const;

const LAT = { min: -90, max: 90 };
const LON = { min: -180, max: 180 };

const WAYPOINT_REQUIRED = { lat: LAT, lon: LON, height: { min: -500, max: 100_000 } };
const WAYPOINT_SPEED = { min: 0, max: 1_000 };

function validateWaypoints(path: string, input: unknown): WaypointSpec[] {
  if (!Array.isArray(input) || input.length === 0) {
    throw new ConfigError(`"${path}" must be a non-empty list of waypoints`);
  }
  return input.map((raw, i) => {
    if (!isRecord(raw)) throw new ConfigError(`"${path}[${i}]" must be an object`);
    const { speed, ...rest } = raw;
    const wp = validateSection<Omit<Waypoint, 'speed'>>(`${path}[${i}]`, rest, WAYPOINT_REQUIRED);
    if (speed === undefined) return wp;
    return {
      ...wp,
      ...validateSection<{ speed: number }>(`${path}[${i}]`, { speed }, { speed: WAYPOINT_SPEED }),
    };
  });
}

function validateRoute(path: string, input: unknown): RouteSpec | null {
  if (input === undefined || input === null) return null;
  if (!isRecord(input)) throw new ConfigError(`"${path}" must be an object`);
  const { waypoints, ...rest } = input;
  const head = validateSection<{ loop: boolean }>(path, rest, { loop: { type: 'boolean' } });
  return { waypoints: validateWaypoints(`${path}.waypoints`, waypoints), loop: head.loop };
}

function validateBehaviour(path: string, input: unknown): BehaviourSpec {
  if (input === undefined) return { mode: 'straight' };
  if (!isRecord(input)) throw new ConfigError(`"${path}" must be an object`);
  const mode = input['mode'];
  switch (mode) {
    case 'straight':
      validateSection(path, input, { mode: { type: 'string' } });
      return { mode: 'straight' };
    case 'orbit':
      return validateSection<Extract<BehaviourSpec, { mode: 'orbit' }>>(path, input, {
        mode: { type: 'enum', values: ['orbit'] },
        lat: LAT,
        lon: LON,
        radius: { min: 100, max: 200_000 },
        altitude: { min: -500, max: 100_000 },
        speed: { min: 1, max: 1_000 },
        clockwise: { type: 'boolean' },
      });
    case 'waypoints': {
      const { waypoints, ...rest } = input;
      const head = validateSection<{ mode: 'waypoints'; loop: boolean }>(path, rest, {
        mode: { type: 'enum', values: ['waypoints'] },
        loop: { type: 'boolean' },
      });
      return {
        mode: 'waypoints',
        waypoints: validateWaypoints(`${path}.waypoints`, waypoints),
        loop: head.loop,
      };
    }
    default:
      throw new ConfigError(`"${path}.mode" must be one of straight, orbit, waypoints`);
  }
}

export interface KnownTypes {
  aircraft: readonly string[];
  units: readonly string[];
}

function validateEntity(path: string, input: unknown, known: KnownTypes): EntitySpawn {
  if (!isRecord(input)) throw new ConfigError(`"${path}" must be an object`);
  const kind = input['kind'];
  if (typeof kind !== 'string' || !(KINDS as readonly string[]).includes(kind)) {
    throw new ConfigError(`"${path}.kind" must be one of ${KINDS.join(', ')}`);
  }
  const name = typeof input['name'] === 'string' ? input['name'] : undefined;
  const withoutName = { ...input };
  delete withoutName['name'];
  switch (kind as (typeof KINDS)[number]) {
    case 'aircraft': {
      const { behaviour, ...rest } = withoutName;
      const head = validateSection<Omit<AircraftSpawn, 'behaviour' | 'name'>>(path, rest, {
        id: { type: 'string' },
        kind: { type: 'enum', values: ['aircraft'] },
        type: { type: 'enum', values: known.aircraft },
        faction: { type: 'enum', values: FACTIONS },
        lat: LAT,
        lon: LON,
        height: { min: 0, max: 100_000 },
        heading: { min: 0, max: 360 },
        speed: { min: 0, max: 1_000 },
      });
      return {
        ...head,
        name: name ?? head.id,
        behaviour: validateBehaviour(`${path}.behaviour`, behaviour),
      };
    }
    case 'ground-unit':
    case 'ship': {
      const { route, ...rest } = withoutName;
      const head = validateSection<Omit<UnitSpawn, 'route' | 'name'>>(path, rest, {
        id: { type: 'string' },
        kind: { type: 'enum', values: ['ground-unit', 'ship'] },
        type: { type: 'enum', values: known.units },
        faction: { type: 'enum', values: FACTIONS },
        lat: LAT,
        lon: LON,
        heading: { min: 0, max: 360 },
      });
      return { ...head, name: name ?? head.id, route: validateRoute(`${path}.route`, route) };
    }
    case 'waypoint': {
      const head = validateSection<Omit<WaypointSpawn, 'name'>>(path, withoutName, {
        id: { type: 'string' },
        kind: { type: 'enum', values: ['waypoint'] },
        lat: LAT,
        lon: LON,
        height: { min: -500, max: 100_000 },
      });
      return { ...head, name: name ?? head.id };
    }
  }
}

export function validateMission(input: unknown, known: KnownTypes): Mission {
  if (!isRecord(input)) throw new ConfigError('mission must be an object');
  const { entities, ...rest } = input;
  const head = validateSection<{ name: string; description: string }>('mission', rest, {
    name: { type: 'string' },
    description: { type: 'string' },
  });
  if (!Array.isArray(entities)) throw new ConfigError('"mission.entities" must be a list');
  const seen = new Set<string>();
  const list = entities.map((raw, i) => {
    const e = validateEntity(`mission.entities[${i}]`, raw, known);
    if (e.id.trim() === '' || e.id === 'player') {
      throw new ConfigError(
        `"mission.entities[${i}].id" must be a non-empty id other than "player"`,
      );
    }
    if (seen.has(e.id)) throw new ConfigError(`"mission.entities": duplicate id "${e.id}"`);
    seen.add(e.id);
    return e;
  });
  return { ...head, entities: list };
}

export interface SpawnDeps {
  aircraftType: (id: string) => AircraftType;
  unitType: (id: string) => UnitType;
  ground: GroundConfig;
  environment: EnvironmentConfig;
}

function toRoute(spec: RouteSpec | null): Route | null {
  return spec
    ? { waypoints: spec.waypoints.map((w) => ({ ...w })), loop: spec.loop, index: 0 }
    : null;
}

function toBehaviour(spec: BehaviourSpec): Behaviour {
  if (spec.mode === 'waypoints') {
    return {
      mode: 'waypoints',
      route: toRoute({ waypoints: spec.waypoints, loop: spec.loop }) as Route,
    };
  }
  return spec;
}

/**
 * Builds the entities of a mission. `groundHeights` maps entity id to the
 * terrain height at its spawn point (missing = 0).
 */
export function createEntities(
  mission: Mission,
  groundHeights: ReadonlyMap<string, number>,
  deps: SpawnDeps,
): Entity[] {
  return mission.entities.map((spawn): Entity => {
    const ground = groundHeights.get(spawn.id) ?? 0;
    switch (spawn.kind) {
      case 'aircraft': {
        const type = deps.aircraftType(spawn.type);
        const model: FlightModel = {
          aircraft: type,
          ground: deps.ground,
          environment: deps.environment,
        };
        return createAircraftEntity({
          id: spawn.id,
          name: spawn.name,
          faction: spawn.faction,
          type,
          model,
          state: createInitialState(spawn, ground, type),
          controlledByPlayer: false,
          behaviour: toBehaviour(spawn.behaviour),
        });
      }
      case 'ground-unit':
      case 'ship':
        return createSurfaceEntity({
          id: spawn.id,
          name: spawn.name,
          faction: spawn.faction,
          type: deps.unitType(spawn.type),
          lat: spawn.lat,
          lon: spawn.lon,
          groundHeight: ground,
          heading: spawn.heading,
          route: toRoute(spawn.route),
        });
      case 'waypoint':
        return createWaypointEntity(spawn);
    }
  });
}
