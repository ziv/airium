/**
 * Camera rig: cockpit (with mouse look), chase (smoothed, behind and above),
 * orbit (mouse drag and wheel) and fly-by (fixed point the jet passes).
 * Everything is computed in the aircraft's ENU frame and converted to
 * Earth-fixed for Cesium.
 */
import {
  Cartesian3,
  Math as CesiumMath,
  Matrix3,
  Matrix4,
  PerspectiveFrustum,
  type Viewer,
} from 'cesium';
import type { CameraPose } from '../hud/projection';
import type { Look, OrbitInput } from '../input/mouse';
import { hprFromAttitude } from '../sim/attitude';
import {
  type Vec3,
  UP,
  add,
  clamp,
  cross,
  length,
  normalize,
  rotateAboutAxis,
  scale,
  sub,
  toRadians,
  vec3,
} from '../sim/math3d';
import type { AircraftState } from '../sim/physics';
import type { CameraConfig } from '../sim/sim-config';
import { aircraftPosition, enuFrame, enuPoint, enuVector } from './frames';

export type CameraMode = 'cockpit' | 'chase' | 'orbit' | 'flyby';

export const CAMERA_MODES: readonly CameraMode[] = ['cockpit', 'chase', 'orbit', 'flyby'];

/** Where the pilot's eyes are relative to the model origin, metres. */
export interface CockpitOffset {
  forward: number;
  up: number;
}

interface View {
  /** ENU offset of the camera from the aircraft. */
  offset: Vec3;
  /** ENU view direction and up. */
  direction: Vec3;
  up: Vec3;
}

const MAX_ORBIT_ELEVATION = toRadians(85);
const scratchRotation = new Matrix3();
const scratchVector = new Cartesian3();

function orthonormalUp(direction: Vec3, up: Vec3): Vec3 {
  const right = normalize(cross(direction, up));
  if (length(right) === 0) return normalize(cross(cross(direction, UP), direction));
  return normalize(cross(right, direction));
}

/** Exponential smoothing factor for a time constant `tau` over `dt`. */
function blend(dt: number, tau: number): number {
  return tau > 0 ? 1 - Math.exp(-dt / tau) : 1;
}

function lerp(a: Vec3, b: Vec3, t: number): Vec3 {
  return add(a, scale(sub(b, a), t));
}

export function setCameraFov(viewer: Viewer, fovDegrees: number): void {
  if (viewer.camera.frustum instanceof PerspectiveFrustum) {
    viewer.camera.frustum.fov = CesiumMath.toRadians(fovDegrees);
  }
}

export class CameraRig {
  mode: CameraMode = 'cockpit';
  private chaseOffset: Vec3 | null = null;
  private chaseUp: Vec3 = UP;
  private orbitAzimuth = 0;
  private orbitElevation = toRadians(12);
  private orbitDistance: number;
  private flybyPoint: Cartesian3 | null = null;
  private readonly position = new Cartesian3();
  private readonly frame = new Matrix4();
  private readonly destination = new Cartesian3();
  private readonly direction = new Cartesian3();
  private readonly up = new Cartesian3();

  constructor(
    private readonly viewer: Viewer,
    private readonly cfg: CameraConfig,
    private cockpit: CockpitOffset,
  ) {
    this.orbitDistance = clamp(cfg.orbitDistance, cfg.orbitMinDistance, cfg.orbitMaxDistance);
    if (viewer.camera.frustum instanceof PerspectiveFrustum) {
      viewer.camera.frustum.near = cfg.nearPlane;
    }
  }

  setCockpit(offset: CockpitOffset): void {
    this.cockpit = offset;
  }

  setMode(mode: CameraMode): void {
    this.mode = mode;
    this.chaseOffset = null;
    this.flybyPoint = null;
  }

  next(): CameraMode {
    const i = CAMERA_MODES.indexOf(this.mode);
    this.setMode(CAMERA_MODES[(i + 1) % CAMERA_MODES.length] ?? 'cockpit');
    return this.mode;
  }

  /** Field of view of the camera frustum, radians (see `Viewport`). */
  get fov(): number {
    const f = this.viewer.camera.frustum;
    return f instanceof PerspectiveFrustum ? (f.fov ?? Math.PI / 3) : Math.PI / 3;
  }

  /** Camera orientation in the aircraft's ENU frame, from the last update. */
  pose(): CameraPose {
    const rotation = Matrix4.getMatrix3(this.frame, scratchRotation);
    Matrix3.transpose(rotation, rotation);
    const toEnu = (v: Cartesian3): Vec3 => {
      const r = Matrix3.multiplyByVector(rotation, v, scratchVector);
      return vec3(r.x, r.y, r.z);
    };
    const { camera } = this.viewer;
    return {
      forward: toEnu(camera.direction),
      right: toEnu(camera.right),
      up: toEnu(camera.up),
      position: toEnu(Cartesian3.subtract(camera.positionWC, this.position, new Cartesian3())),
    };
  }

  /** Whether the own-aircraft model should be drawn in this view. */
  get showsOwnAircraft(): boolean {
    return this.mode !== 'cockpit';
  }

  /** `dt` is the real frame time, used for smoothing. */
  update(state: AircraftState, dt: number, look: Look, orbit: OrbitInput): void {
    aircraftPosition(state, this.position);
    enuFrame(this.position, this.frame);

    if (this.mode === 'flyby') {
      this.updateFlyby(state);
      return;
    }

    let view: View;
    switch (this.mode) {
      case 'chase':
        view = this.chaseView(state, dt);
        break;
      case 'orbit':
        view = this.orbitView(state, orbit);
        break;
      default:
        view = this.cockpitView(state, look);
    }
    this.apply(view);
  }

  private apply(view: View): void {
    enuPoint(this.frame, view.offset, this.destination);
    enuVector(this.frame, view.direction, this.direction);
    enuVector(this.frame, orthonormalUp(view.direction, view.up), this.up);
    this.viewer.camera.setView({
      destination: this.destination,
      orientation: { direction: this.direction, up: this.up },
    });
  }

  private cockpitView(state: AircraftState, look: Look): View {
    const { forward, right, up } = state.attitude;
    // Look right = rotate about the canopy axis clockwise seen from above.
    let direction = rotateAboutAxis(forward, up, -look.yaw);
    const lookRight = rotateAboutAxis(right, up, -look.yaw);
    direction = rotateAboutAxis(direction, lookRight, look.pitch);
    const viewUp = rotateAboutAxis(up, lookRight, look.pitch);
    return {
      offset: add(scale(forward, this.cockpit.forward), scale(up, this.cockpit.up)),
      direction,
      up: viewUp,
    };
  }

  private chaseView(state: AircraftState, dt: number): View {
    const { forward, up } = state.attitude;
    const target = add(scale(forward, -this.cfg.chaseDistance), scale(up, this.cfg.chaseHeight));
    const k = blend(dt, this.cfg.chaseSmoothing);
    this.chaseOffset = this.chaseOffset === null ? target : lerp(this.chaseOffset, target, k);
    this.chaseUp = normalize(lerp(this.chaseUp, up, k));
    // Aim a little ahead of the aircraft so it sits low in the frame.
    const aim = scale(forward, this.cfg.chaseDistance * 0.5);
    return {
      offset: this.chaseOffset,
      direction: normalize(sub(aim, this.chaseOffset)),
      up: this.chaseUp,
    };
  }

  private orbitView(state: AircraftState, input: OrbitInput): View {
    if (this.chaseOffset === null) {
      // First frame in orbit: start behind the aircraft.
      this.orbitAzimuth = hprFromAttitude(state.attitude).heading + Math.PI;
      this.chaseOffset = UP;
    }
    this.orbitAzimuth += input.azimuth;
    this.orbitElevation = clamp(
      this.orbitElevation + input.elevation,
      -MAX_ORBIT_ELEVATION,
      MAX_ORBIT_ELEVATION,
    );
    this.orbitDistance = clamp(
      this.orbitDistance * input.zoom,
      this.cfg.orbitMinDistance,
      this.cfg.orbitMaxDistance,
    );
    const ce = Math.cos(this.orbitElevation);
    const offset = scale(
      vec3(
        ce * Math.sin(this.orbitAzimuth),
        ce * Math.cos(this.orbitAzimuth),
        Math.sin(this.orbitElevation),
      ),
      this.orbitDistance,
    );
    return { offset, direction: normalize(scale(offset, -1)), up: UP };
  }

  private updateFlyby(state: AircraftState): void {
    let relocate = this.flybyPoint === null;
    if (this.flybyPoint !== null) {
      const toPoint = Cartesian3.distance(this.position, this.flybyPoint);
      const fromCamera = Cartesian3.subtract(this.position, this.flybyPoint, this.direction);
      const velocity = enuVector(this.frame, state.velocity, this.up);
      const receding = Cartesian3.dot(fromCamera, velocity) > 0;
      // Too far to see, or it has passed and is leaving: pick a new spot ahead.
      relocate =
        toPoint > this.cfg.flybyMaxDistance ||
        (receding && toPoint > this.cfg.flybyMaxDistance * 0.5);
    }
    if (relocate) {
      const { right, up } = state.attitude;
      const ahead = add(
        add(scale(state.velocity, this.cfg.flybyLead), scale(right, 60)),
        scale(up, 15),
      );
      this.flybyPoint = enuPoint(this.frame, ahead, new Cartesian3());
    }
    const point = this.flybyPoint as Cartesian3;
    Cartesian3.subtract(this.position, point, this.direction);
    Cartesian3.normalize(this.direction, this.direction);
    enuVector(this.frame, UP, this.up);
    Cartesian3.clone(point, this.destination);
    this.viewer.camera.setView({
      destination: this.destination,
      orientation: { direction: this.direction, up: this.up },
    });
  }
}
