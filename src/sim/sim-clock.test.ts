import { describe, expect, it } from 'vitest';
import { SimClock } from './sim-clock';

const cfg = {
  physicsHz: 100,
  maxFrameSeconds: 0.1,
  minTimeScale: 0.25,
  maxTimeScale: 4,
  timeScaleStep: 2,
};

describe('SimClock', () => {
  it('converts frame time into whole fixed steps and keeps the remainder', () => {
    const clock = new SimClock(cfg);
    expect(clock.fixedDt).toBeCloseTo(0.01);
    expect(clock.advance(0.025)).toBe(2);
    expect(clock.advance(0.005)).toBe(1);
    expect(clock.advance(0)).toBe(0);
  });

  it('clamps long gaps to maxFrameSeconds', () => {
    const clock = new SimClock(cfg);
    expect(clock.advance(5)).toBe(10);
  });

  it('runs no steps while paused and discards the time', () => {
    const clock = new SimClock(cfg);
    clock.togglePause();
    expect(clock.paused).toBe(true);
    expect(clock.advance(0.05)).toBe(0);
    expect(clock.effectiveScale).toBe(0);
    clock.togglePause();
    expect(clock.advance(0.01)).toBe(1);
  });

  it('scales time within the configured bounds', () => {
    const clock = new SimClock(cfg);
    expect(clock.faster()).toBe(2);
    expect(clock.faster()).toBe(4);
    expect(clock.faster()).toBe(4);
    expect(clock.advance(0.01)).toBe(4);
    expect(clock.slower()).toBe(2);
    expect(clock.slower()).toBe(1);
    expect(clock.slower()).toBe(0.5);
    expect(clock.slower()).toBe(0.25);
    expect(clock.slower()).toBe(0.25);
    clock.reset();
    expect(clock.advance(0.04)).toBe(1);
  });
});
