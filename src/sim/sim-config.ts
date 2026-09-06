/**
 * World configuration: where the flight starts, the environment, the ground
 * rules, time integration, graphics, input and camera settings. Everything
 * lives in `start.config.json`; the aircraft itself is described by an
 * aircraft type file (see `src/aircraft`). Pure TypeScript, no Cesium imports.
 *
 * Angles in the file are degrees, lengths metres, speeds m/s.
 */
import { ACTIONS, type Action } from '../input/actions';
import {
  ConfigError,
  isRecord,
  type SectionSpec,
  validateSection,
  validateSectionMap,
} from './validate';

export { ConfigError as SimConfigError } from './validate';

/** Where and how the flight begins. */
export interface StartConfig {
  /** Degrees (WGS84). */
  lat: number;
  lon: number;
  /** Metres above the terrain surface. 0 starts on the wheels. */
  height: number;
  /** Degrees, 0 = north, clockwise. */
  heading: number;
  /** Metres per second. */
  speed: number;
  /** Vertical field of view in degrees. */
  fov: number;
  /** Aircraft type id from the registry in `src/aircraft`. */
  aircraft: string;
  /** Simulation date/time as ISO 8601 (for sun position and lighting); blank = now. */
  time: string;
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
  /** m/s² */
  gravity: number;
  /** kg/m³ */
  seaLevelAirDensity: number;
  /** Metres; density falls off as exp(-height / scaleHeight). */
  densityScaleHeight: number;
  /** Metres; used to convert ground motion into lat/lon. */
  earthRadius: number;
  /** Kelvin at sea level (ISA: 288.15). */
  seaLevelTemperature: number;
  /** Kelvin per metre in the troposphere (ISA: 0.0065). */
  lapseRate: number;
  /** Metres; temperature is constant above this (ISA: 11 000). */
  tropopauseHeight: number;
  /** Specific gas constant of air, J/(kg·K). */
  gasConstant: number;
  /** Ratio of specific heats (1.4 for air). */
  heatCapacityRatio: number;
}

/** Time integration. */
export interface SimulationConfig {
  /** Fixed physics steps per second. */
  physicsHz: number;
  /** Longest real-time gap (seconds) simulated per frame; larger gaps are clamped. */
  maxFrameSeconds: number;
  /** Slowest time scale selectable with the time keys. */
  minTimeScale: number;
  /** Fastest time scale. */
  maxTimeScale: number;
  /** Multiplier applied per time key press. */
  timeScaleStep: number;
}

/** One rendering quality level. */
export interface GraphicsPreset {
  /** Terrain detail: lower is sharper and heavier (Cesium default 2). */
  maximumScreenSpaceError: number;
  /** Terrain tiles kept in memory. */
  tileCacheSize: number;
  /** Preload neighbouring/parent tiles so fast flight has fewer holes. */
  preloadTiles: boolean;
  /** Distance fog. */
  fog: boolean;
  /** MSAA samples (1 = off). */
  msaaSamples: number;
  /** Post-process anti-aliasing. */
  fxaa: boolean;
  /** Render resolution relative to the canvas (1 = native). */
  resolutionScale: number;
  /** Sun lighting on the globe. */
  lighting: boolean;
  /** Sky and ground atmosphere. */
  atmosphere: boolean;
}

export interface GraphicsConfig {
  /** Key into `presets`. */
  preset: string;
  /** Load Cesium OSM Buildings (needs an Ion token). */
  osmBuildings: boolean;
  presets: Record<string, GraphicsPreset>;
}

export type KeyBindings = Record<Action, string[]>;

export interface KeyboardConfig {
  /** Seconds a held key takes to reach full stick deflection (a tap is a small input). */
  axisRampTime: number;
  /** Seconds for the deflection to return to neutral after release. */
  axisReleaseTime: number;
}

export interface GamepadAxes {
  roll: number;
  pitch: number;
  yaw: number;
  throttle: number;
}

export interface GamepadButtons {
  throttleUp: number;
  throttleDown: number;
  afterburner: number;
  gear: number;
  brakes: number;
  airbrake: number;
  camera: number;
  reset: number;
  pause: number;
}

export interface GamepadConfig {
  /** Stick travel ignored around the centre, 0..1. */
  deadZone: number;
  /** Response curve exponent (1 = linear, 2 = soft centre). */
  curve: number;
  /** Throttle-axis fraction above which the afterburner lights (1 = never). */
  afterburnerAbove: number;
  /** Throttle change per second while a throttle button is held. */
  throttleRate: number;
  /** Push the pitch axis forward for nose down (true) or nose up. */
  invertPitch: boolean;
  /** Axis indices (-1 = unassigned). */
  axes: GamepadAxes;
  /** Button indices (-1 = unassigned). */
  buttons: GamepadButtons;
}

export interface MouseConfig {
  /** Degrees of cockpit look per pixel of right-button drag. */
  lookSensitivity: number;
  /** Seconds for the cockpit view to return to boresight after release. */
  lookReturnTime: number;
  /** Degrees of orbit per pixel of left-button drag. */
  orbitSensitivity: number;
  /** Orbit distance multiplier per wheel notch. */
  zoomStep: number;
  /** Mouse flight: fraction of the half-window that gives full deflection. */
  flightSensitivity: number;
  /** Start with mouse flight on. */
  mouseFlight: boolean;
}

export interface InputConfig {
  keys: KeyBindings;
  keyboard: KeyboardConfig;
  gamepad: GamepadConfig;
  mouse: MouseConfig;
}

export interface CameraConfig {
  /** Chase camera: metres behind and above the aircraft, and smoothing time constant. */
  chaseDistance: number;
  chaseHeight: number;
  chaseSmoothing: number;
  /** Orbit camera: initial distance and limits. */
  orbitDistance: number;
  orbitMinDistance: number;
  orbitMaxDistance: number;
  /** Fly-by camera: seconds of flight ahead where it waits, and distance at which it relocates. */
  flybyLead: number;
  flybyMaxDistance: number;
  /** Near clipping plane, metres. */
  nearPlane: number;
}

export type Units = 'metric' | 'imperial';

/** Graphical HUD settings. */
export interface HudConfig {
  /** metric: m/s, m; imperial: knots, feet, ft/min. */
  units: Units;
  /** CSS hex colour of the symbology, e.g. "#9cff9c". */
  color: string;
  /** Opacity of the symbology, 0.1..1. */
  brightness: number;
  /** Base font size in CSS pixels. */
  fontSize: number;
  /** Show the radar altitude when below this height above ground, metres. */
  radarAltitudeBelow: number;
  /** PULL UP when the predicted time to ground is under this many seconds. */
  pullUpSeconds: number;
  /** Warning flash rate. */
  flashHz: number;
  /** Degrees between pitch ladder lines. */
  ladderSpacing: number;
  /** Ladder lines are drawn within this many degrees of the current pitch. */
  ladderRange: number;
}

/** Cesium Ion access. */
export interface IonConfig {
  /** Ion access token, or null to run token-free (OpenStreetMap imagery, no terrain). */
  token: string | null;
}

export interface SimConfig {
  ion: IonConfig;
  start: StartConfig;
  ground: GroundConfig;
  environment: EnvironmentConfig;
  simulation: SimulationConfig;
  graphics: GraphicsConfig;
  input: InputConfig;
  camera: CameraConfig;
  hud: HudConfig;
}

const START: SectionSpec<StartConfig> = {
  lat: { min: -90, max: 90 },
  lon: { min: -180, max: 180 },
  height: { min: 0, max: 100_000 },
  heading: { min: 0, max: 360 },
  speed: { min: 0, max: 1_000 },
  fov: { min: 1, max: 179 },
  aircraft: { type: 'string' },
  time: { type: 'string' },
};

const GROUND: SectionSpec<GroundConfig> = {
  maxLandingSinkRate: { min: 0, max: 1_000 },
  maxLandingRoll: { min: 0, max: 180 },
  minLandingPitch: { min: -90, max: 0 },
  rollingFriction: { min: 0, max: 1 },
  maxGroundPitch: { min: 0, max: 89 },
  liftoffHeight: { min: 0, max: 100 },
};

const ENVIRONMENT: SectionSpec<EnvironmentConfig> = {
  gravity: { min: 0, max: 1_000 },
  seaLevelAirDensity: { min: 0, max: 100 },
  densityScaleHeight: { min: 1, max: 1_000_000 },
  earthRadius: { min: 1_000, max: 1_000_000_000 },
  seaLevelTemperature: { min: 1, max: 1_000 },
  lapseRate: { min: 0, max: 1 },
  tropopauseHeight: { min: 0, max: 1_000_000 },
  gasConstant: { min: 1, max: 10_000 },
  heatCapacityRatio: { min: 1, max: 2 },
};

const SIMULATION: SectionSpec<SimulationConfig> = {
  physicsHz: { min: 1, max: 10_000 },
  maxFrameSeconds: { min: 0.001, max: 10 },
  minTimeScale: { min: 0.01, max: 1 },
  maxTimeScale: { min: 1, max: 100 },
  timeScaleStep: { min: 1.01, max: 10 },
};

const GRAPHICS_PRESET: SectionSpec<GraphicsPreset> = {
  maximumScreenSpaceError: { min: 0.5, max: 64 },
  tileCacheSize: { min: 10, max: 100_000 },
  preloadTiles: { type: 'boolean' },
  fog: { type: 'boolean' },
  msaaSamples: { min: 1, max: 16 },
  fxaa: { type: 'boolean' },
  resolutionScale: { min: 0.1, max: 4 },
  lighting: { type: 'boolean' },
  atmosphere: { type: 'boolean' },
};

const GAMEPAD_AXES: SectionSpec<GamepadAxes> = {
  roll: { min: -1, max: 31 },
  pitch: { min: -1, max: 31 },
  yaw: { min: -1, max: 31 },
  throttle: { min: -1, max: 31 },
};

const GAMEPAD_BUTTONS: SectionSpec<GamepadButtons> = {
  throttleUp: { min: -1, max: 63 },
  throttleDown: { min: -1, max: 63 },
  afterburner: { min: -1, max: 63 },
  gear: { min: -1, max: 63 },
  brakes: { min: -1, max: 63 },
  airbrake: { min: -1, max: 63 },
  camera: { min: -1, max: 63 },
  reset: { min: -1, max: 63 },
  pause: { min: -1, max: 63 },
};

const GAMEPAD: SectionSpec<Omit<GamepadConfig, 'axes' | 'buttons'>> = {
  deadZone: { min: 0, max: 0.9 },
  curve: { min: 0.1, max: 5 },
  afterburnerAbove: { min: 0, max: 1 },
  throttleRate: { min: 0.01, max: 10 },
  invertPitch: { type: 'boolean' },
};

const KEYBOARD: SectionSpec<KeyboardConfig> = {
  axisRampTime: { min: 0, max: 10 },
  axisReleaseTime: { min: 0, max: 10 },
};

const MOUSE: SectionSpec<MouseConfig> = {
  lookSensitivity: { min: 0.001, max: 10 },
  lookReturnTime: { min: 0, max: 10 },
  orbitSensitivity: { min: 0.001, max: 10 },
  zoomStep: { min: 1.001, max: 3 },
  flightSensitivity: { min: 0.05, max: 1 },
  mouseFlight: { type: 'boolean' },
};

const CAMERA: SectionSpec<CameraConfig> = {
  chaseDistance: { min: 1, max: 10_000 },
  chaseHeight: { min: -1_000, max: 10_000 },
  chaseSmoothing: { min: 0, max: 10 },
  orbitDistance: { min: 1, max: 100_000 },
  orbitMinDistance: { min: 1, max: 100_000 },
  orbitMaxDistance: { min: 1, max: 1_000_000 },
  flybyLead: { min: 0, max: 60 },
  flybyMaxDistance: { min: 10, max: 100_000 },
  nearPlane: { min: 0.01, max: 1_000 },
};

const HUD: SectionSpec<HudConfig> = {
  units: { type: 'enum', values: ['metric', 'imperial'] },
  color: { type: 'string' },
  brightness: { min: 0.1, max: 1 },
  fontSize: { min: 8, max: 40 },
  radarAltitudeBelow: { min: 0, max: 20_000 },
  pullUpSeconds: { min: 0, max: 60 },
  flashHz: { min: 0.5, max: 10 },
  ladderSpacing: { min: 1, max: 30 },
  ladderRange: { min: 5, max: 90 },
};

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

export const START_CONFIG_KEYS = Object.keys(START) as (keyof StartConfig)[];

/**
 * The `ion` section is optional. A missing section, missing key, or blank
 * token means token-free mode; anything else must be a string.
 */
function validateIon(input: unknown): IonConfig {
  if (input === undefined) return { token: null };
  if (!isRecord(input)) {
    throw new ConfigError('"ion" must be an object');
  }
  const token = input['token'];
  if (token === undefined || token === null) return { token: null };
  if (typeof token !== 'string') {
    throw new ConfigError('"ion.token" must be a string');
  }
  const trimmed = token.trim();
  return { token: trimmed.length > 0 ? trimmed : null };
}

function validateGraphics(input: unknown): GraphicsConfig {
  if (!isRecord(input)) {
    throw new ConfigError('"graphics" must be an object');
  }
  const presets = validateSectionMap<GraphicsPreset>(
    'graphics.presets',
    input['presets'],
    GRAPHICS_PRESET,
  );
  const names = Object.keys(presets);
  if (names.length === 0) {
    throw new ConfigError('"graphics.presets" must define at least one preset');
  }
  const head = validateSection<{ preset: string; osmBuildings: boolean }>(
    'graphics',
    { preset: input['preset'], osmBuildings: input['osmBuildings'] },
    { preset: { type: 'enum', values: names }, osmBuildings: { type: 'boolean' } },
  );
  return { ...head, presets };
}

export function validateKeyBindings(input: unknown): KeyBindings {
  const spec = Object.fromEntries(
    ACTIONS.map((a) => [a, { type: 'stringList' }]),
  ) as SectionSpec<KeyBindings>;
  const keys = validateSection<KeyBindings>('input.keys', input, spec);
  const seen = new Map<string, Action>();
  for (const action of ACTIONS) {
    for (const key of keys[action]) {
      const other = seen.get(key);
      if (other !== undefined) {
        throw new ConfigError(`"input.keys": key "${key}" is bound to both ${other} and ${action}`);
      }
      seen.set(key, action);
    }
  }
  return keys;
}

function validateInput(input: unknown): InputConfig {
  if (!isRecord(input)) {
    throw new ConfigError('"input" must be an object');
  }
  const gamepadRaw = input['gamepad'];
  if (!isRecord(gamepadRaw)) {
    throw new ConfigError('"input.gamepad" must be an object');
  }
  const { axes, buttons, ...rest } = gamepadRaw;
  const gamepad: GamepadConfig = {
    ...validateSection<Omit<GamepadConfig, 'axes' | 'buttons'>>('input.gamepad', rest, GAMEPAD),
    axes: validateSection<GamepadAxes>('input.gamepad.axes', axes, GAMEPAD_AXES),
    buttons: validateSection<GamepadButtons>('input.gamepad.buttons', buttons, GAMEPAD_BUTTONS),
  };
  return {
    keys: validateKeyBindings(input['keys']),
    keyboard: validateSection<KeyboardConfig>('input.keyboard', input['keyboard'], KEYBOARD),
    gamepad,
    mouse: validateSection<MouseConfig>('input.mouse', input['mouse'], MOUSE),
  };
}

/**
 * Validates an arbitrary value (e.g. parsed JSON) as a complete SimConfig.
 * Every section and key must be present with a value of the right type and
 * range. Heading is normalised so 360 becomes 0.
 */
export function validateSimConfig(input: unknown): SimConfig {
  if (!isRecord(input)) {
    throw new ConfigError('expected an object');
  }
  const result: SimConfig = {
    ion: validateIon(input['ion']),
    start: validateSection<StartConfig>('start', input['start'], START),
    ground: validateSection<GroundConfig>('ground', input['ground'], GROUND),
    environment: validateSection<EnvironmentConfig>(
      'environment',
      input['environment'],
      ENVIRONMENT,
    ),
    simulation: validateSection<SimulationConfig>('simulation', input['simulation'], SIMULATION),
    graphics: validateGraphics(input['graphics']),
    input: validateInput(input['input']),
    camera: validateSection<CameraConfig>('camera', input['camera'], CAMERA),
    hud: validateSection<HudConfig>('hud', input['hud'], HUD),
  };
  if (!HEX_COLOR.test(result.hud.color)) {
    throw new ConfigError('"hud.color" must be a hex colour like "#9cff9c"');
  }
  result.start.heading = result.start.heading % 360;
  if (result.start.aircraft.trim() === '') {
    throw new ConfigError('"start.aircraft" must name an aircraft type');
  }
  const sim = result.simulation;
  if (sim.minTimeScale > 1 || sim.maxTimeScale < 1) {
    throw new ConfigError('"simulation" time scale range must include 1');
  }
  const cam = result.camera;
  if (cam.orbitMinDistance > cam.orbitMaxDistance) {
    throw new ConfigError('"camera.orbitMinDistance" must not exceed "orbitMaxDistance"');
  }
  return result;
}

/** Start, graphics and HUD overrides that can come from the URL. */
export interface Overrides {
  start: Partial<StartConfig>;
  graphics: Partial<Pick<GraphicsConfig, 'preset' | 'osmBuildings'>>;
  hud: Partial<Pick<HudConfig, 'units'>>;
}

/**
 * Reads optional overrides from a URL query string, e.g. `?lat=32&lon=34.8`,
 * `?aircraft=trainer`, `?graphics=low`, `?buildings=1`, `?units=imperial`.
 * Unknown keys are ignored; known numeric keys with non-numeric values are rejected.
 */
export function parseOverrides(search: string): Overrides {
  const params = new URLSearchParams(search);
  const start: Partial<StartConfig> = {};

  for (const key of START_CONFIG_KEYS) {
    const raw = params.get(key);
    if (raw === null) continue;
    if (key === 'aircraft' || key === 'time') {
      start[key] = raw;
      continue;
    }
    const value = Number(raw);
    if (raw.trim() === '' || !Number.isFinite(value)) {
      throw new ConfigError(`query parameter "${key}" is not a number: "${raw}"`);
    }
    start[key] = value;
  }

  const graphics: Overrides['graphics'] = {};
  const preset = params.get('graphics');
  if (preset !== null) graphics.preset = preset;
  const buildings = params.get('buildings');
  if (buildings !== null) graphics.osmBuildings = buildings === '1' || buildings === 'true';

  const hud: Overrides['hud'] = {};
  const units = params.get('units');
  if (units !== null) hud.units = units as Units;

  return { start, graphics, hud };
}

/** Combines the base config with URL overrides and validates the result. */
export function resolveSimConfig(base: unknown, search = ''): SimConfig {
  const baseConfig = validateSimConfig(base);
  const overrides = parseOverrides(search);
  return validateSimConfig({
    ...baseConfig,
    start: { ...baseConfig.start, ...overrides.start },
    graphics: { ...baseConfig.graphics, ...overrides.graphics },
    hud: { ...baseConfig.hud, ...overrides.hud },
  });
}
