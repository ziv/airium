/**
 * Debug panel: the monospace text overlay with every number the simulation
 * knows, the frame/tile counters and the key legend. Toggled with the debug
 * key; the graphical HUD (`hud-canvas.ts`) is the primary display.
 */
import { hprFromAttitude } from '../sim/attitude';
import { toDegrees } from '../sim/math3d';
import type { AircraftState, Forces } from '../sim/physics';
import { type Warnings, activeWarnings } from '../sim/warnings';

const MS_TO_KT = 1.943844;

/** Things the HUD shows that are not part of the aircraft state. */
export interface HudInfo {
  aircraftName: string;
  cameraMode: string;
  paused: boolean;
  timeScale: number;
  devices: string;
  buildings: boolean;
  fps: number;
  tilesLoaded: boolean;
  /** Terrain tiles waiting to load. */
  tilesQueued: number;
  units: string;
}

const pad = (s: string, w: number) => s.padStart(w);
const deg = (rad: number, w = 6) =>
  pad(`${toDegrees(rad) >= 0 ? '+' : ''}${toDegrees(rad).toFixed(1)}°`, w);
const num = (v: number, digits: number, w: number) => pad(v.toFixed(digits), w);

function gearLabel(gear: number): string {
  if (gear >= 0.99) return 'DOWN';
  if (gear <= 0.01) return 'UP';
  return 'TRANSIT';
}

export function formatDebug(
  state: AircraftState,
  forces: Forces,
  warnings: Warnings,
  info: HudInfo,
  legend: string,
): string {
  const hpr = hprFromAttitude(state.attitude);
  const headingDeg = Math.round(toDegrees(hpr.heading)) % 360;
  const agl = state.height - state.groundHeight;
  const status =
    state.status === 'crashed'
      ? `CRASHED: ${state.crashReason ?? 'impact'}   press reset`
      : state.status.toUpperCase();
  const time = info.paused ? 'PAUSED' : `x${info.timeScale}`;
  const thrust = `${num(state.throttle * 100, 0, 3)}%${state.afterburner ? ' AB' : '   '}`;
  const flags = [
    `GEAR ${gearLabel(state.gear)}`,
    state.airbrake ? 'AIRBRAKE' : '',
    warnings.engineOut ? 'ENGINE OUT' : '',
  ]
    .filter((s) => s.length > 0)
    .join('   ');
  const lines = [
    `AIRIUM  ${info.aircraftName}  [${status}]   cam ${info.cameraMode}   ${time}   ${info.devices}`,
    `THR ${thrust}   FUEL ${num(state.fuel, 0, 5)} kg   ROLL ${deg(hpr.roll)}   PITCH ${deg(hpr.pitch)}   HDG ${pad(String(headingDeg).padStart(3, '0'), 4)}   AOA ${deg(forces.angleOfAttack)}   G ${num(forces.loadFactor, 1, 5)} (max ${num(state.peakLoadFactor, 1, 4)})`,
    `IAS ${num(forces.airspeed, 1, 6)} m/s (${num(forces.airspeed * MS_TO_KT, 0, 4)} kt)   M ${num(forces.mach, 2, 5)}   VS ${num(state.velocity.z, 1, 6)} m/s   AGL ${num(agl, 0, 6)} m   ALT ${num(state.height, 0, 6)} m   ${flags}`,
  ];
  const active = activeWarnings(warnings);
  if (active.length > 0) lines.push(`*** ${active.join('   ')} ***`);
  lines.push(
    `LAT ${num(state.lat, 5, 10)}   LON ${num(state.lon, 5, 10)}   CL ${num(forces.liftCoefficient, 2, 5)}   CD ${num(forces.dragCoefficient, 3, 6)}   Q ${num(forces.dynamicPressure, 0, 6)} Pa   THRUST ${num(forces.thrustMagnitude / 1000, 1, 6)} kN   MASS ${num(forces.mass, 0, 6)} kg`,
    `FPS ${num(info.fps, 0, 3)}   TILES ${info.tilesLoaded ? 'loaded' : `${info.tilesQueued} loading`}   BUILDINGS ${info.buildings ? 'on' : 'off'}   UNITS ${info.units}   RATES ${deg(state.bodyRates.roll)} ${deg(state.bodyRates.pitch)} ${deg(state.bodyRates.yaw)}/s`,
  );
  lines.push('', legend);
  return lines.join('\n');
}

export class DebugPanel {
  private readonly el: HTMLPreElement;

  constructor(
    parent: HTMLElement,
    private readonly legend: string,
  ) {
    this.el = document.createElement('pre');
    this.el.id = 'hud';
    this.el.hidden = true;
    parent.appendChild(this.el);
  }

  get visible(): boolean {
    return !this.el.hidden;
  }

  set visible(show: boolean) {
    this.el.hidden = !show;
  }

  toggle(): boolean {
    this.visible = !this.visible;
    return this.visible;
  }

  update(state: AircraftState, forces: Forces, warnings: Warnings, info: HudInfo): void {
    if (this.el.hidden) return;
    this.el.textContent = formatDebug(state, forces, warnings, info, this.legend);
    this.el.classList.toggle('crashed', state.status === 'crashed');
    this.el.classList.toggle(
      'warning',
      state.status !== 'crashed' && activeWarnings(warnings).length > 0,
    );
  }
}
