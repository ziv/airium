/**
 * Everything the pilot can do, independent of which device does it. Key and
 * gamepad bindings in the configuration map onto these names.
 */

/** Actions that are active while a key or button is held. */
export const HELD_ACTIONS = [
  'rollLeft',
  'rollRight',
  'noseUp',
  'noseDown',
  'yawLeft',
  'yawRight',
  'brakes',
] as const;

/** Actions that fire once per press. */
export const PRESS_ACTIONS = [
  'throttleUp',
  'throttleDown',
  'afterburner',
  'gear',
  'airbrake',
  'reset',
  'pause',
  'timeFaster',
  'timeSlower',
  'camera',
  'cameraCockpit',
  'cameraChase',
  'cameraOrbit',
  'cameraFlyby',
  'mouseFlight',
  'buildings',
  'units',
  'debug',
] as const;

export type HeldAction = (typeof HELD_ACTIONS)[number];
export type PressAction = (typeof PRESS_ACTIONS)[number];
export type Action = HeldAction | PressAction;

export const ACTIONS: readonly Action[] = [...HELD_ACTIONS, ...PRESS_ACTIONS];

export const HELD_ACTION_SET: ReadonlySet<string> = new Set(HELD_ACTIONS);

export function isHeldAction(action: Action): action is HeldAction {
  return HELD_ACTION_SET.has(action);
}

/** Short description of each action for the on-screen legend and README. */
export const ACTION_LABELS: Record<Action, string> = {
  rollLeft: 'roll left',
  rollRight: 'roll right',
  noseUp: 'nose up',
  noseDown: 'nose down',
  yawLeft: 'yaw left',
  yawRight: 'yaw right',
  brakes: 'wheel brakes (hold)',
  throttleUp: 'throttle up (past 100 % lights the afterburner)',
  throttleDown: 'throttle down (cuts the afterburner first)',
  afterburner: 'afterburner on/off',
  gear: 'landing gear up/down',
  airbrake: 'airbrake in/out',
  reset: 'reset to the start',
  pause: 'pause',
  timeFaster: 'time scale faster',
  timeSlower: 'time scale slower',
  camera: 'next camera',
  cameraCockpit: 'cockpit camera',
  cameraChase: 'chase camera',
  cameraOrbit: 'orbit camera (drag to rotate, wheel to zoom)',
  cameraFlyby: 'fly-by camera',
  mouseFlight: 'mouse flight on/off',
  buildings: '3D buildings on/off',
  units: 'HUD units metric/imperial',
  debug: 'debug panel on/off',
};

/** Human-readable key name for legends. */
export function keyLabel(key: string): string {
  switch (key) {
    case 'ArrowLeft':
      return '←';
    case 'ArrowRight':
      return '→';
    case 'ArrowUp':
      return '↑';
    case 'ArrowDown':
      return '↓';
    case ' ':
      return 'Space';
    default:
      return key.length === 1 ? key.toUpperCase() : key;
  }
}
