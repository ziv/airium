import { describe, expect, it } from 'vitest';
import { toRadians } from '../sim/math3d';
import {
  altitudeFor,
  aoaFraction,
  directionFromAzEl,
  flashOn,
  headingDegrees,
  ladderLine,
  ladderPitches,
  pullUpWarning,
  speedFor,
  tapeTicks,
  verticalSpeedFor,
} from './layout';

describe('units', () => {
  it('converts for the imperial HUD and passes metric through', () => {
    expect(speedFor(100, 'imperial')).toEqual({ value: 194.3844, unit: 'kt' });
    expect(speedFor(100, 'metric')).toEqual({ value: 100, unit: 'm/s' });
    expect(altitudeFor(1000, 'imperial').value).toBeCloseTo(3280.84);
    expect(verticalSpeedFor(5, 'imperial').value).toBeCloseTo(984.25);
  });
});

describe('tapeTicks', () => {
  it('scrolls: ticks move opposite to the value', () => {
    const at100 = tapeTicks(100, 2, 10, 50, 100);
    const at110 = tapeTicks(110, 2, 10, 50, 100);
    const t100 = at100.find((t) => t.value === 100);
    const t100later = at110.find((t) => t.value === 100);
    expect(t100?.offset).toBe(0);
    expect(t100later?.offset).toBe(-20);
  });

  it('only returns ticks within the extent and flags majors', () => {
    const ticks = tapeTicks(100, 2, 10, 50, 100);
    expect(ticks.map((t) => t.value)).toEqual([50, 60, 70, 80, 90, 100, 110, 120, 130, 140, 150]);
    expect(ticks.filter((t) => t.major).map((t) => t.value)).toEqual([50, 100, 150]);
  });

  it('wraps headings around 360', () => {
    const ticks = tapeTicks(355, 4, 5, 10, 60, 360);
    expect(ticks.map((t) => t.value)).toEqual([340, 345, 350, 355, 0, 5, 10]);
    expect(ticks.find((t) => t.value === 10)?.offset).toBe(60);
  });
});

describe('ladder', () => {
  it('picks lines around the current pitch and never beyond ±90', () => {
    expect(ladderPitches(0, 5, 10)).toEqual([-10, -5, 0, 5, 10]);
    expect(ladderPitches(87, 5, 10)).toEqual([80, 85, 90]);
    expect(ladderPitches(-3, 10, 15)).toEqual([-10, 0, 10]);
  });

  it('builds a line at constant elevation centred on the heading with a gap', () => {
    const line = ladderLine(toRadians(90), 10, toRadians(5), toRadians(2));
    const [o1, i1, i2, o2] = line.ends;
    for (const e of line.ends) expect(e.z).toBeCloseTo(Math.sin(toRadians(10)));
    expect(o1.y).toBeGreaterThan(i1.y);
    expect(i1.y).toBeGreaterThan(0);
    expect(i2.y).toBeLessThan(0);
    expect(o2.y).toBeLessThan(i2.y);
    expect(directionFromAzEl(0, 0)).toEqual({ x: 0, y: 1, z: 0 });
  });
});

describe('warnings and misc', () => {
  it('predicts ground contact within the lookahead', () => {
    expect(pullUpWarning(100, -20, 6)).toBe(true);
    expect(pullUpWarning(200, -20, 6)).toBe(false);
    expect(pullUpWarning(100, 5, 6)).toBe(false);
    expect(pullUpWarning(10, -20, 0)).toBe(false);
  });

  it('flashes as a square wave', () => {
    expect(flashOn(0, 2)).toBe(true);
    expect(flashOn(0.3, 2)).toBe(false);
    expect(flashOn(0.6, 2)).toBe(true);
    expect(flashOn(5, 0)).toBe(true);
  });

  it('formats headings and AoA fractions', () => {
    expect(headingDegrees(toRadians(359.7))).toBe(0);
    expect(headingDegrees(toRadians(-10))).toBe(350);
    expect(aoaFraction(toRadians(12.5), 25)).toBeCloseTo(0.5);
    expect(aoaFraction(toRadians(40), 25)).toBe(1);
  });
});
