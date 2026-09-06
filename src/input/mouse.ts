/**
 * Mouse source. Three jobs, all optional:
 *  - cockpit look: hold the right button and drag; the view returns to the
 *    boresight after release;
 *  - orbit camera: left-drag rotates, the wheel zooms (the camera decides
 *    whether to use these);
 *  - mouse flight: the pointer position relative to the window centre acts
 *    as the stick when enabled.
 */
import { clamp, toRadians } from '../sim/math3d';
import type { MouseConfig } from '../sim/sim-config';
import { type AxisInput, NEUTRAL_AXES } from './keyboard';

/** Cockpit look offset from the boresight, radians (yaw positive = right, pitch positive = up). */
export interface Look {
  yaw: number;
  pitch: number;
}

export const NO_LOOK: Look = { yaw: 0, pitch: 0 };

/** Orbit camera input since the last frame: angles in radians, zoom as a distance multiplier. */
export interface OrbitInput {
  azimuth: number;
  elevation: number;
  zoom: number;
}

const NO_ORBIT: OrbitInput = { azimuth: 0, elevation: 0, zoom: 1 };

/** Stick deflection from the pointer position: below the centre pulls, right of it rolls right. */
export function flightAxesFromPointer(
  x: number,
  y: number,
  width: number,
  height: number,
  sensitivity: number,
): AxisInput {
  const halfW = Math.max(1, width / 2) * sensitivity;
  const halfH = Math.max(1, height / 2) * sensitivity;
  return {
    roll: clamp((x - width / 2) / halfW, -1, 1),
    pitch: clamp((y - height / 2) / halfH, -1, 1),
    yaw: 0,
  };
}

/** Eases the look back toward the boresight with the configured return time. */
export function decayLook(look: Look, dt: number, returnTime: number): Look {
  if (returnTime <= 0) return NO_LOOK;
  const k = 1 - Math.exp(-dt / returnTime);
  return { yaw: look.yaw - look.yaw * k, pitch: look.pitch - look.pitch * k };
}

const MAX_LOOK_YAW = toRadians(160);
const MAX_LOOK_PITCH = toRadians(89);

export class MouseSource {
  mouseFlight: boolean;
  private lookOffset: Look = NO_LOOK;
  private looking = false;
  private orbit: OrbitInput = NO_ORBIT;
  private pointerX: number;
  private pointerY: number;

  constructor(
    private readonly target: HTMLElement,
    private readonly cfg: MouseConfig,
    private readonly win: Window,
  ) {
    this.mouseFlight = cfg.mouseFlight;
    this.pointerX = win.innerWidth / 2;
    this.pointerY = win.innerHeight / 2;
    target.addEventListener('pointerdown', this.onPointerDown);
    target.addEventListener('pointermove', this.onPointerMove);
    target.addEventListener('pointerup', this.onPointerUp);
    target.addEventListener('pointercancel', this.onPointerUp);
    target.addEventListener('wheel', this.onWheel, { passive: false });
    target.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  /** Advances the look return; call once per frame with the real frame time. */
  update(dt: number): void {
    if (!this.looking) {
      this.lookOffset = decayLook(this.lookOffset, dt, this.cfg.lookReturnTime);
    }
  }

  look(): Look {
    return this.lookOffset;
  }

  /** Orbit drag and wheel input since the last call. */
  takeOrbit(): OrbitInput {
    const out = this.orbit;
    this.orbit = NO_ORBIT;
    return out;
  }

  flightAxes(): AxisInput {
    if (!this.mouseFlight) return NEUTRAL_AXES;
    return flightAxesFromPointer(
      this.pointerX,
      this.pointerY,
      this.win.innerWidth,
      this.win.innerHeight,
      this.cfg.flightSensitivity,
    );
  }

  private onPointerDown = (event: PointerEvent) => {
    if (event.button === 2) {
      this.looking = true;
      this.target.setPointerCapture?.(event.pointerId);
    }
    if (event.button === 0) {
      this.target.setPointerCapture?.(event.pointerId);
    }
    event.preventDefault();
  };

  private onPointerMove = (event: PointerEvent) => {
    this.pointerX = event.clientX;
    this.pointerY = event.clientY;
    const perPixelLook = toRadians(this.cfg.lookSensitivity);
    const perPixelOrbit = toRadians(this.cfg.orbitSensitivity);
    if (this.looking && (event.buttons & 2) !== 0) {
      this.lookOffset = {
        yaw: clamp(
          this.lookOffset.yaw + event.movementX * perPixelLook,
          -MAX_LOOK_YAW,
          MAX_LOOK_YAW,
        ),
        pitch: clamp(
          this.lookOffset.pitch - event.movementY * perPixelLook,
          -MAX_LOOK_PITCH,
          MAX_LOOK_PITCH,
        ),
      };
    } else if ((event.buttons & 1) !== 0) {
      this.orbit = {
        azimuth: this.orbit.azimuth + event.movementX * perPixelOrbit,
        elevation: this.orbit.elevation - event.movementY * perPixelOrbit,
        zoom: this.orbit.zoom,
      };
    }
  };

  private onPointerUp = (event: PointerEvent) => {
    if (event.button === 2 || event.type === 'pointercancel') this.looking = false;
  };

  private onWheel = (event: WheelEvent) => {
    event.preventDefault();
    const notches = Math.sign(event.deltaY);
    if (notches === 0) return;
    this.orbit = { ...this.orbit, zoom: this.orbit.zoom * Math.pow(this.cfg.zoomStep, notches) };
  };
}
