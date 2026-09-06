/**
 * Gamepad source (Gamepad API). Polled once per frame: stick axes become
 * roll/pitch/yaw with a dead zone and response curve, an optional throttle
 * axis drives the throttle directly, and buttons are either held (brakes,
 * throttle up/down) or edge-detected into one-shot presses.
 */
import type { GamepadButtons, GamepadConfig } from '../sim/sim-config';
import type { PressAction } from './actions';
import { type AxisInput, NEUTRAL_AXES } from './keyboard';

/** Dead zone then power curve, sign preserved; result -1..1. */
export function shapeAxis(value: number, deadZone: number, curve: number): number {
  const v = Math.max(-1, Math.min(1, value));
  const a = Math.abs(v);
  if (a <= deadZone) return 0;
  const t = (a - deadZone) / (1 - deadZone);
  return Math.sign(v) * Math.pow(t, curve);
}

/** Throttle axis: pushed forward (-1) is full power, pulled back (+1) is idle. */
export function throttleFromAxis(value: number): number {
  return Math.max(0, Math.min(1, (1 - value) / 2));
}

/** Press-type buttons, in the order they are reported. */
const PRESS_BUTTONS: readonly (keyof GamepadButtons & PressAction)[] = [
  'afterburner',
  'gear',
  'airbrake',
  'camera',
  'reset',
  'pause',
];

/** Actions whose button went from up to down between two polls. */
export function pressedEdges(
  previous: readonly boolean[],
  current: readonly boolean[],
  buttons: GamepadButtons,
): PressAction[] {
  const out: PressAction[] = [];
  for (const action of PRESS_BUTTONS) {
    const index = buttons[action];
    if (index < 0) continue;
    if (current[index] === true && previous[index] !== true) out.push(action);
  }
  return out;
}

export interface GamepadReading {
  axes: AxisInput;
  /** 0..1 when a throttle axis is assigned. */
  throttle: number | undefined;
  /** Only meaningful when `throttle` is defined. */
  afterburner: boolean;
  throttleUp: boolean;
  throttleDown: boolean;
  brakes: boolean;
  buttons: boolean[];
}

/** Pure interpretation of one gamepad state. */
export function readGamepad(
  axes: readonly number[],
  buttons: readonly boolean[],
  cfg: GamepadConfig,
): GamepadReading {
  const axis = (index: number) => (index >= 0 ? (axes[index] ?? 0) : 0);
  const button = (index: number) => index >= 0 && buttons[index] === true;
  const shaped = (index: number) => shapeAxis(axis(index), cfg.deadZone, cfg.curve);
  const pitchSign = cfg.invertPitch ? -1 : 1;
  const throttleAxis = cfg.axes.throttle;
  const throttle = throttleAxis >= 0 ? throttleFromAxis(axis(throttleAxis)) : undefined;
  return {
    axes: {
      roll: shaped(cfg.axes.roll),
      // A stick pulled back reads positive on the Gamepad API; that is a pull.
      pitch: pitchSign * shaped(cfg.axes.pitch),
      yaw: shaped(cfg.axes.yaw),
    },
    throttle,
    afterburner: throttle !== undefined && throttle >= cfg.afterburnerAbove,
    throttleUp: button(cfg.buttons.throttleUp),
    throttleDown: button(cfg.buttons.throttleDown),
    brakes: button(cfg.buttons.brakes),
    buttons: [...buttons],
  };
}

const NO_READING: GamepadReading = {
  axes: NEUTRAL_AXES,
  throttle: undefined,
  afterburner: false,
  throttleUp: false,
  throttleDown: false,
  brakes: false,
  buttons: [],
};

export class GamepadSource {
  private reading: GamepadReading = NO_READING;
  private previousButtons: boolean[] = [];
  private presses: PressAction[] = [];
  private throttleDelta = 0;
  connected = false;

  constructor(
    private readonly navigator: Navigator,
    private readonly cfg: GamepadConfig,
  ) {}

  /** Reads the first connected gamepad. `dt` is the real frame time in seconds. */
  poll(dt: number): void {
    const pads =
      typeof this.navigator.getGamepads === 'function' ? this.navigator.getGamepads() : [];
    const pad = pads.find((p): p is Gamepad => p !== null && p.connected);
    this.connected = pad !== undefined;
    if (!pad) {
      this.reading = NO_READING;
      this.previousButtons = [];
      return;
    }
    const buttons = pad.buttons.map((b) => b.pressed);
    this.reading = readGamepad(pad.axes, buttons, this.cfg);
    this.presses.push(...pressedEdges(this.previousButtons, buttons, this.cfg.buttons));
    this.previousButtons = buttons;
    if (this.reading.throttleUp) this.throttleDelta += this.cfg.throttleRate * dt;
    if (this.reading.throttleDown) this.throttleDelta -= this.cfg.throttleRate * dt;
  }

  axes(): AxisInput {
    return this.reading.axes;
  }

  throttleAxis(): number | undefined {
    return this.reading.throttle;
  }

  afterburnerAxis(): boolean {
    return this.reading.afterburner;
  }

  brakes(): boolean {
    return this.reading.brakes;
  }

  takePresses(): PressAction[] {
    const out = this.presses;
    this.presses = [];
    return out;
  }

  /** Throttle change accumulated from the throttle buttons since the last call. */
  takeThrottleDelta(): number {
    const d = this.throttleDelta;
    this.throttleDelta = 0;
    return d;
  }
}
