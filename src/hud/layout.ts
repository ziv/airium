/**
 * Pure layout math for the HUD: unit conversion, tape ticks, pitch ladder
 * geometry, warning prediction and flashing.
 */
import { type Vec3, clamp, vec3 } from '../sim/math3d';
import type { Units } from '../sim/sim-config';

export const MS_TO_KT = 1.943844;
export const M_TO_FT = 3.28084;
export const MS_TO_FPM = 196.8504;
export const KG_TO_LB = 2.204623;

export interface Quantity {
  value: number;
  unit: string;
}

export function speedFor(ms: number, units: Units): Quantity {
  return units === 'imperial' ? { value: ms * MS_TO_KT, unit: 'kt' } : { value: ms, unit: 'm/s' };
}

export function altitudeFor(m: number, units: Units): Quantity {
  return units === 'imperial' ? { value: m * M_TO_FT, unit: 'ft' } : { value: m, unit: 'm' };
}

export function verticalSpeedFor(ms: number, units: Units): Quantity {
  return units === 'imperial' ? { value: ms * MS_TO_FPM, unit: 'fpm' } : { value: ms, unit: 'm/s' };
}

export function massFor(kg: number, units: Units): Quantity {
  return units === 'imperial' ? { value: kg * KG_TO_LB, unit: 'lb' } : { value: kg, unit: 'kg' };
}

/** Tick spacing per unit system: [minor, major] steps in display units. */
export function speedTicks(units: Units): [number, number] {
  return units === 'imperial' ? [10, 50] : [10, 50];
}

export function altitudeTicks(units: Units): [number, number] {
  return units === 'imperial' ? [100, 500] : [50, 250];
}

export interface TapeTick {
  /** Pixels from the tape centre; positive toward higher values. */
  offset: number;
  value: number;
  major: boolean;
}

/**
 * Ticks of a scrolling tape centred on `value`. `wrap` makes the values
 * modular (headings: 360). Only ticks within `halfExtent` pixels are returned,
 * lowest value first.
 */
export function tapeTicks(
  value: number,
  pxPerUnit: number,
  minorStep: number,
  majorStep: number,
  halfExtent: number,
  wrap?: number,
): TapeTick[] {
  const span = halfExtent / pxPerUnit;
  const first = Math.ceil((value - span) / minorStep) * minorStep;
  const last = Math.floor((value + span) / minorStep) * minorStep;
  const ticks: TapeTick[] = [];
  for (let v = first; v <= last + 1e-9; v += minorStep) {
    const rounded = Math.round(v / minorStep) * minorStep;
    const shown = wrap === undefined ? rounded : ((rounded % wrap) + wrap) % wrap;
    ticks.push({
      offset: (rounded - value) * pxPerUnit,
      value: shown,
      major: Math.abs(rounded / majorStep - Math.round(rounded / majorStep)) < 1e-9,
    });
  }
  return ticks;
}

/** Pitch angles (degrees) of the ladder lines to draw around the current pitch, horizon included. */
export function ladderPitches(pitchDeg: number, spacingDeg: number, rangeDeg: number): number[] {
  const lo = Math.max(-90, pitchDeg - rangeDeg);
  const hi = Math.min(90, pitchDeg + rangeDeg);
  const out: number[] = [];
  for (let p = Math.ceil(lo / spacingDeg) * spacingDeg; p <= hi + 1e-9; p += spacingDeg) {
    out.push(Math.round(p));
  }
  return out;
}

/** Unit direction in ENU for an azimuth (from north, clockwise) and elevation, radians. */
export function directionFromAzEl(azimuth: number, elevation: number): Vec3 {
  const ce = Math.cos(elevation);
  return vec3(Math.sin(azimuth) * ce, Math.cos(azimuth) * ce, Math.sin(elevation));
}

export interface LadderLine {
  /** Degrees. */
  pitch: number;
  /** Directions of the four line ends: outer left, inner left, inner right, outer right. */
  ends: [Vec3, Vec3, Vec3, Vec3];
}

/**
 * A ladder line is a pair of segments at constant elevation, centred on the
 * aircraft heading with a gap in the middle. Being world-fixed directions,
 * they roll with the aircraft when projected through the cockpit camera.
 */
export function ladderLine(
  headingRad: number,
  pitchDeg: number,
  halfWidthRad: number,
  gapRad: number,
): LadderLine {
  const el = (pitchDeg * Math.PI) / 180;
  const inner = Math.min(gapRad, halfWidthRad);
  return {
    pitch: pitchDeg,
    ends: [
      directionFromAzEl(headingRad - halfWidthRad, el),
      directionFromAzEl(headingRad - inner, el),
      directionFromAzEl(headingRad + inner, el),
      directionFromAzEl(headingRad + halfWidthRad, el),
    ],
  };
}

/** PULL UP: descending and predicted to reach the ground within `seconds`. */
export function pullUpWarning(agl: number, verticalSpeed: number, seconds: number): boolean {
  if (verticalSpeed >= 0 || seconds <= 0) return false;
  return agl / -verticalSpeed < seconds;
}

/** Square-wave flashing: on for the first half of every cycle. */
export function flashOn(timeSeconds: number, hz: number): boolean {
  if (hz <= 0) return true;
  return Math.floor(timeSeconds * hz * 2) % 2 === 0;
}

/** Heading in whole degrees, 0..359. */
export function headingDegrees(headingRad: number): number {
  const d = Math.round((headingRad * 180) / Math.PI) % 360;
  return d < 0 ? d + 360 : d;
}

/** Fraction of the AoA limit currently used, 0..1. */
export function aoaFraction(aoaRad: number, maxAoaDeg: number): number {
  return clamp((aoaRad * 180) / Math.PI / maxAoaDeg, 0, 1);
}
