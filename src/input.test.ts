import { describe, expect, it } from 'vitest';
import { applyThrottleKey, axesFromKeys } from './input';

describe('axesFromKeys', () => {
  it('is neutral with nothing pressed', () => {
    expect(axesFromKeys(new Set())).toEqual({ roll: 0, pitch: 0, yaw: 0 });
  });

  it('maps arrows and brackets to axes', () => {
    expect(axesFromKeys(new Set(['ArrowRight'])).roll).toBe(1);
    expect(axesFromKeys(new Set(['ArrowLeft'])).roll).toBe(-1);
    expect(axesFromKeys(new Set(['ArrowDown'])).pitch).toBe(1);
    expect(axesFromKeys(new Set(['ArrowUp'])).pitch).toBe(-1);
    expect(axesFromKeys(new Set([']'])).yaw).toBe(1);
    expect(axesFromKeys(new Set(['['])).yaw).toBe(-1);
  });

  it('cancels opposing keys', () => {
    expect(axesFromKeys(new Set(['ArrowLeft', 'ArrowRight'])).roll).toBe(0);
  });
});

describe('applyThrottleKey', () => {
  it('steps by the configured amount and clamps to [0, 1]', () => {
    expect(applyThrottleKey(0, '+', 0.05)).toBe(0.05);
    expect(applyThrottleKey(0, '=', 0.05)).toBe(0.05);
    expect(applyThrottleKey(0.05, '-', 0.05)).toBe(0);
    expect(applyThrottleKey(0, '-', 0.05)).toBe(0);
    expect(applyThrottleKey(0.98, '+', 0.05)).toBe(1);
    expect(applyThrottleKey(0.1, '+', 0.1)).toBe(0.2);
  });

  it('ignores other keys', () => {
    expect(applyThrottleKey(0.3, 'ArrowUp', 0.05)).toBe(0.3);
  });
});
