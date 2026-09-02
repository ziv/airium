import type { Controls } from './sim/physics';

/** Keyboard map. Flight-sim convention: arrow down pulls the nose up. */
export const KEYS = {
  rollLeft: ['ArrowLeft'],
  rollRight: ['ArrowRight'],
  noseUp: ['ArrowDown'],
  noseDown: ['ArrowUp'],
  yawLeft: ['['],
  yawRight: [']'],
  throttleUp: ['+', '='],
  throttleDown: ['-', '_'],
  reset: ['r', 'R'],
} as const;

const ALL_HANDLED_KEYS = new Set<string>(Object.values(KEYS).flat());

function axis(
  pressed: ReadonlySet<string>,
  negative: readonly string[],
  positive: readonly string[],
) {
  const neg = negative.some((k) => pressed.has(k)) ? 1 : 0;
  const pos = positive.some((k) => pressed.has(k)) ? 1 : 0;
  return pos - neg;
}

/** Pure mapping from the set of currently pressed keys to control axes. */
export function axesFromKeys(
  pressed: ReadonlySet<string>,
): Pick<Controls, 'roll' | 'pitch' | 'yaw'> {
  return {
    roll: axis(pressed, KEYS.rollLeft, KEYS.rollRight),
    pitch: axis(pressed, KEYS.noseDown, KEYS.noseUp),
    yaw: axis(pressed, KEYS.yawLeft, KEYS.yawRight),
  };
}

/** Returns the throttle after a key press, or the same value if the key is not a throttle key. */
export function applyThrottleKey(throttle: number, key: string, step: number): number {
  if ((KEYS.throttleUp as readonly string[]).includes(key)) {
    return Math.min(1, Math.round((throttle + step) * 1e6) / 1e6);
  }
  if ((KEYS.throttleDown as readonly string[]).includes(key)) {
    return Math.max(0, Math.round((throttle - step) * 1e6) / 1e6);
  }
  return throttle;
}

/** Tracks held keys and throttle from window keyboard events. */
export class KeyboardInput {
  private readonly pressed = new Set<string>();
  private resetRequested = false;
  throttle = 0;

  constructor(
    target: Window,
    private readonly throttleStep: number,
  ) {
    target.addEventListener('keydown', this.onKeyDown);
    target.addEventListener('keyup', this.onKeyUp);
    target.addEventListener('blur', () => this.pressed.clear());
  }

  controls(): Controls {
    return { ...axesFromKeys(this.pressed), throttle: this.throttle };
  }

  /** True once per reset key press. */
  consumeReset(): boolean {
    const r = this.resetRequested;
    this.resetRequested = false;
    return r;
  }

  private onKeyDown = (event: KeyboardEvent) => {
    if (!ALL_HANDLED_KEYS.has(event.key)) return;
    event.preventDefault();
    if (event.repeat) return;
    this.pressed.add(event.key);
    this.throttle = applyThrottleKey(this.throttle, event.key, this.throttleStep);
    if ((KEYS.reset as readonly string[]).includes(event.key)) {
      this.resetRequested = true;
    }
  };

  private onKeyUp = (event: KeyboardEvent) => {
    this.pressed.delete(event.key);
  };
}
