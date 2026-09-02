import { hprFromAttitude } from './sim/attitude';
import { toDegrees } from './sim/math3d';
import type { AircraftState, Forces } from './sim/physics';

const MS_TO_KT = 1.943844;

const pad = (s: string, w: number) => s.padStart(w);
const deg = (rad: number, w = 6) =>
  pad(`${toDegrees(rad) >= 0 ? '+' : ''}${toDegrees(rad).toFixed(1)}°`, w);
const num = (v: number, digits: number, w: number) => pad(v.toFixed(digits), w);

export function formatHud(state: AircraftState, forces: Forces): string {
  const hpr = hprFromAttitude(state.attitude);
  const headingDeg = Math.round(toDegrees(hpr.heading)) % 360;
  const agl = state.height - state.groundHeight;
  const status = state.status.toUpperCase();
  const lines = [
    `AIRIUM  [${status}]${state.status === 'crashed' ? '   press R to reset' : ''}`,
    `THR ${num(state.throttle * 100, 0, 4)}%   ROLL ${deg(hpr.roll)}   PITCH ${deg(hpr.pitch)}   HDG ${pad(String(headingDeg).padStart(3, '0'), 4)}   AOA ${deg(forces.angleOfAttack)}`,
    `IAS ${num(forces.airspeed, 1, 6)} m/s (${num(forces.airspeed * MS_TO_KT, 0, 4)} kt)   VS ${num(state.velocity.z, 1, 6)} m/s   AGL ${num(agl, 0, 6)} m   ALT ${num(state.height, 0, 6)} m`,
    `LAT ${num(state.lat, 5, 10)}   LON ${num(state.lon, 5, 10)}   CL ${num(forces.liftCoefficient, 2, 5)}   CD ${num(forces.dragCoefficient, 3, 6)}`,
    ``,
    `← → roll   ↓ ↑ pitch (↓ = nose up)   [ ] yaw   + - throttle   R reset`,
  ];
  return lines.join('\n');
}

export class Hud {
  private readonly el: HTMLPreElement;

  constructor(parent: HTMLElement) {
    this.el = document.createElement('pre');
    this.el.id = 'hud';
    parent.appendChild(this.el);
  }

  update(state: AircraftState, forces: Forces): void {
    this.el.textContent = formatHud(state, forces);
    this.el.classList.toggle('crashed', state.status === 'crashed');
  }
}
