/**
 * Merges keyboard, gamepad and mouse into the `Controls` the physics consumes,
 * and owns the pilot's toggles (throttle, afterburner, gear, airbrake).
 * Presses that concern the rest of the game (reset, pause, cameras, ...) are
 * handed on untouched.
 */
import { clamp } from '../sim/math3d';
import type { Controls } from '../sim/physics';
import type { InputConfig } from '../sim/sim-config';
import type { PressAction } from './actions';
import { GamepadSource } from './gamepad';
import { type AxisInput, KeyboardSource } from './keyboard';
import { MouseSource } from './mouse';

export interface ThrottleState {
  /** 0..1 military power. */
  throttle: number;
  afterburner: boolean;
}

const EPS = 1e-6;

/**
 * One throttle key press. Up past 100 % lights the afterburner (when the
 * aircraft has one); down cuts the afterburner before reducing the throttle.
 */
export function stepThrottle(
  state: ThrottleState,
  direction: 1 | -1,
  step: number,
  hasAfterburner: boolean,
): ThrottleState {
  if (direction > 0) {
    if (state.throttle >= 1 - EPS) {
      return { throttle: 1, afterburner: hasAfterburner };
    }
    return { ...state, throttle: Math.min(1, Math.round((state.throttle + step) * 1e6) / 1e6) };
  }
  if (state.afterburner) return { ...state, afterburner: false };
  return { ...state, throttle: Math.max(0, Math.round((state.throttle - step) * 1e6) / 1e6) };
}

/** Sums axis demands from several devices, clamped to the stick travel. */
export function mergeAxes(...inputs: AxisInput[]): AxisInput {
  let roll = 0;
  let pitch = 0;
  let yaw = 0;
  for (const i of inputs) {
    roll += i.roll;
    pitch += i.pitch;
    yaw += i.yaw;
  }
  return { roll: clamp(roll, -1, 1), pitch: clamp(pitch, -1, 1), yaw: clamp(yaw, -1, 1) };
}

export interface AircraftInputTraits {
  /** Fraction of full throttle per key press. */
  throttleStep: number;
  hasAfterburner: boolean;
}

export class InputManager {
  readonly keyboard: KeyboardSource;
  readonly gamepad: GamepadSource;
  readonly mouse: MouseSource;
  private throttleState: ThrottleState = { throttle: 0, afterburner: false };
  private gearDown = true;
  private airbrake = false;
  private pending: PressAction[] = [];

  constructor(
    win: Window,
    canvas: HTMLElement,
    cfg: InputConfig,
    private traits: AircraftInputTraits,
  ) {
    this.keyboard = new KeyboardSource(win, cfg.keys, cfg.keyboard);
    this.gamepad = new GamepadSource(win.navigator, cfg.gamepad);
    this.mouse = new MouseSource(canvas, cfg.mouse, win);
  }

  setAircraft(traits: AircraftInputTraits): void {
    this.traits = traits;
  }

  /** Puts the toggles back to the start state. */
  reset(onGround: boolean): void {
    this.throttleState = { throttle: 0, afterburner: false };
    this.gearDown = onGround;
    this.airbrake = false;
  }

  /** Polls the devices and applies the pilot's own toggles. Call once per frame. */
  update(dt: number): void {
    this.keyboard.update(dt);
    this.gamepad.poll(dt);
    this.mouse.update(dt);
    for (const press of [...this.keyboard.takePresses(), ...this.gamepad.takePresses()]) {
      switch (press) {
        case 'throttleUp':
          this.throttleState = stepThrottle(
            this.throttleState,
            1,
            this.traits.throttleStep,
            this.traits.hasAfterburner,
          );
          break;
        case 'throttleDown':
          this.throttleState = stepThrottle(
            this.throttleState,
            -1,
            this.traits.throttleStep,
            this.traits.hasAfterburner,
          );
          break;
        case 'afterburner':
          this.throttleState = {
            ...this.throttleState,
            afterburner: this.traits.hasAfterburner && !this.throttleState.afterburner,
          };
          break;
        case 'gear':
          this.gearDown = !this.gearDown;
          break;
        case 'airbrake':
          this.airbrake = !this.airbrake;
          break;
        case 'mouseFlight':
          this.mouse.mouseFlight = !this.mouse.mouseFlight;
          break;
        default:
          this.pending.push(press);
      }
    }
    const delta = this.gamepad.takeThrottleDelta();
    if (delta !== 0) {
      this.throttleState = {
        ...this.throttleState,
        throttle: clamp(this.throttleState.throttle + delta, 0, 1),
      };
    }
    const axisThrottle = this.gamepad.throttleAxis();
    if (axisThrottle !== undefined) {
      this.throttleState = {
        throttle: axisThrottle,
        afterburner: this.traits.hasAfterburner && this.gamepad.afterburnerAxis(),
      };
    }
  }

  /** Presses not handled here (reset, pause, time, cameras, buildings, debug), since the last call. */
  takePresses(): PressAction[] {
    const out = this.pending;
    this.pending = [];
    return out;
  }

  controls(): Controls {
    const axes = mergeAxes(this.keyboard.axes(), this.gamepad.axes(), this.mouse.flightAxes());
    return {
      ...axes,
      throttle: this.throttleState.throttle,
      afterburner: this.throttleState.afterburner,
      gearDown: this.gearDown,
      airbrake: this.airbrake,
      brakes: this.keyboard.isHeld('brakes') || this.gamepad.brakes(),
    };
  }

  /** Human-readable device summary for the HUD. */
  devices(): string {
    const parts = ['keyboard'];
    if (this.gamepad.connected) parts.push('gamepad');
    if (this.mouse.mouseFlight) parts.push('mouse flight');
    return parts.join(' + ');
  }
}
