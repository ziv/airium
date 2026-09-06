/**
 * Keyboard source: turns window key events into held actions and one-shot
 * presses according to the configured key bindings. No Cesium, no physics.
 */
import { clamp } from '../sim/math3d';
import type { KeyBindings, KeyboardConfig } from '../sim/sim-config';
import { type Action, type HeldAction, type PressAction, isHeldAction } from './actions';

/** Roll/pitch/yaw demands from one device, each -1..1 (pitch positive = pull). */
export interface AxisInput {
  roll: number;
  pitch: number;
  yaw: number;
}

export const NEUTRAL_AXES: AxisInput = { roll: 0, pitch: 0, yaw: 0 };

/** Inverts the bindings into a key → action lookup. */
export function keyToActionMap(keys: KeyBindings): Map<string, Action> {
  const map = new Map<string, Action>();
  for (const action of Object.keys(keys) as Action[]) {
    for (const key of keys[action]) map.set(key, action);
  }
  return map;
}

/** Pure mapping from the set of held actions to control axes. */
export function axesFromHeld(held: ReadonlySet<HeldAction>): AxisInput {
  const on = (a: HeldAction) => (held.has(a) ? 1 : 0);
  return {
    roll: on('rollRight') - on('rollLeft'),
    pitch: on('noseUp') - on('noseDown'),
    yaw: on('yawRight') - on('yawLeft'),
  };
}

/**
 * Moves an axis toward its target: a held key ramps the deflection up over
 * `rampTime` seconds (so a tap is a small input) and a released key lets it
 * fall back over `releaseTime`.
 */
export function rampAxis(
  current: number,
  target: number,
  dt: number,
  rampTime: number,
  releaseTime: number,
): number {
  const toward = target !== 0 && Math.sign(target) === Math.sign(current || target);
  const time = toward ? rampTime : releaseTime;
  const maxDelta = time > 0 ? dt / time : Infinity;
  return current + clamp(target - current, -maxDelta, maxDelta);
}

export class KeyboardSource {
  private readonly map: Map<string, Action>;
  private readonly held = new Set<HeldAction>();
  private presses: PressAction[] = [];
  private current: AxisInput = NEUTRAL_AXES;

  constructor(
    target: Window,
    keys: KeyBindings,
    private readonly cfg: KeyboardConfig,
  ) {
    this.map = keyToActionMap(keys);
    target.addEventListener('keydown', this.onKeyDown);
    target.addEventListener('keyup', this.onKeyUp);
    target.addEventListener('blur', () => this.held.clear());
  }

  /** Advances the axis ramps; call once per frame with the real frame time. */
  update(dt: number): void {
    const target = axesFromHeld(this.held);
    const ramp = (c: number, t: number) =>
      rampAxis(c, t, dt, this.cfg.axisRampTime, this.cfg.axisReleaseTime);
    this.current = {
      roll: ramp(this.current.roll, target.roll),
      pitch: ramp(this.current.pitch, target.pitch),
      yaw: ramp(this.current.yaw, target.yaw),
    };
  }

  axes(): AxisInput {
    return this.current;
  }

  isHeld(action: HeldAction): boolean {
    return this.held.has(action);
  }

  /** Presses since the last call, in order. */
  takePresses(): PressAction[] {
    const out = this.presses;
    this.presses = [];
    return out;
  }

  private onKeyDown = (event: KeyboardEvent) => {
    // Leave browser shortcuts (Ctrl/Cmd/Alt combinations) alone.
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const action = this.map.get(event.key);
    if (action === undefined) return;
    event.preventDefault();
    if (event.repeat) return;
    if (isHeldAction(action)) this.held.add(action);
    else this.presses.push(action);
  };

  private onKeyUp = (event: KeyboardEvent) => {
    const action = this.map.get(event.key);
    if (action !== undefined && isHeldAction(action)) this.held.delete(action);
  };
}
