import { describe, expect, it } from 'vitest';
import startJson from '../start.config.json';
import { validateSimConfig } from '../sim/sim-config';
import { mergeAxes, stepThrottle } from './controls';
import { pressedEdges, readGamepad, shapeAxis, throttleFromAxis } from './gamepad';
import { KeyboardSource, axesFromHeld, keyToActionMap, rampAxis } from './keyboard';
import { formatLegend, legendEntries } from './legend';
import { decayLook, flightAxesFromPointer } from './mouse';

const { input } = validateSimConfig(startJson);

describe('keyboard', () => {
  it('retains a short fire tap until consumed and ignores key-repeat', () => {
    const target = new EventTarget();
    const keyboard = new KeyboardSource(target as unknown as Window, input.keys, input.keyboard);
    const key = (type: string, repeat = false) =>
      Object.assign(new Event(type, { cancelable: true }), {
        key: ' ',
        repeat,
        ctrlKey: false,
        metaKey: false,
        altKey: false,
      });
    target.dispatchEvent(key('keydown'));
    target.dispatchEvent(key('keyup'));
    expect(keyboard.isHeld('fire')).toBe(false);
    expect(keyboard.takeFirePress()).toBe(true);
    expect(keyboard.takeFirePress()).toBe(false);
    target.dispatchEvent(key('keydown', true));
    expect(keyboard.takeFirePress()).toBe(false);
    target.dispatchEvent(key('keydown'));
    target.dispatchEvent(new Event('blur'));
    expect(keyboard.takeFirePress()).toBe(false);
  });
  it('maps every bound key to its action', () => {
    const map = keyToActionMap(input.keys);
    expect(map.get('ArrowLeft')).toBe('rollLeft');
    expect(map.get('g')).toBe('gear');
    expect(map.get('G')).toBe('gear');
    expect(map.get('F2')).toBe('cameraChase');
    expect(map.get('x')).toBe('countermeasures');
    expect(map.get(' ')).toBe('fire');
    expect(map.get('Enter')).toBe('selectWeapon');
  });

  it('is neutral with nothing held and cancels opposing keys', () => {
    expect(axesFromHeld(new Set())).toEqual({ roll: 0, pitch: 0, yaw: 0 });
    expect(axesFromHeld(new Set(['rollLeft', 'rollRight'])).roll).toBe(0);
  });

  it('follows the flight-sim convention: nose up is a pull', () => {
    expect(axesFromHeld(new Set(['noseUp'])).pitch).toBe(1);
    expect(axesFromHeld(new Set(['noseDown'])).pitch).toBe(-1);
    expect(axesFromHeld(new Set(['rollRight'])).roll).toBe(1);
    expect(axesFromHeld(new Set(['yawLeft'])).yaw).toBe(-1);
  });
});

describe('stepThrottle', () => {
  const idle = { throttle: 0, afterburner: false };

  it('steps by the configured amount and clamps to [0, 1]', () => {
    expect(stepThrottle(idle, 1, 0.05, true)).toEqual({ throttle: 0.05, afterburner: false });
    expect(stepThrottle({ throttle: 0.98, afterburner: false }, 1, 0.05, true).throttle).toBe(1);
    expect(stepThrottle({ throttle: 0.1, afterburner: false }, 1, 0.1, true).throttle).toBe(0.2);
    expect(stepThrottle(idle, -1, 0.05, true)).toEqual(idle);
  });

  it('lights the afterburner past 100 % and cuts it first on the way down', () => {
    const mil = { throttle: 1, afterburner: false };
    const ab = stepThrottle(mil, 1, 0.05, true);
    expect(ab).toEqual({ throttle: 1, afterburner: true });
    expect(stepThrottle(ab, -1, 0.05, true)).toEqual(mil);
    expect(stepThrottle(mil, -1, 0.05, true)).toEqual({ throttle: 0.95, afterburner: false });
  });

  it('never lights an afterburner the aircraft does not have', () => {
    expect(stepThrottle({ throttle: 1, afterburner: false }, 1, 0.05, false)).toEqual({
      throttle: 1,
      afterburner: false,
    });
  });
});

describe('mergeAxes', () => {
  it('sums devices and clamps to the stick travel', () => {
    const merged = mergeAxes(
      { roll: 0.7, pitch: -1, yaw: 0 },
      { roll: 0.7, pitch: 0.5, yaw: -0.2 },
    );
    expect(merged).toEqual({ roll: 1, pitch: -0.5, yaw: -0.2 });
  });
});

describe('gamepad', () => {
  it('shapes the axis with a dead zone and curve', () => {
    expect(shapeAxis(0.05, 0.1, 1)).toBe(0);
    expect(shapeAxis(-0.05, 0.1, 1)).toBe(0);
    expect(shapeAxis(1, 0.1, 2)).toBe(1);
    expect(shapeAxis(-1, 0.1, 2)).toBe(-1);
    expect(shapeAxis(0.55, 0.1, 1)).toBeCloseTo(0.5);
    expect(shapeAxis(0.55, 0.1, 2)).toBeCloseTo(0.25);
    expect(shapeAxis(2, 0, 1)).toBe(1);
  });

  it('reads the throttle axis with forward as full power', () => {
    expect(throttleFromAxis(-1)).toBe(1);
    expect(throttleFromAxis(1)).toBe(0);
    expect(throttleFromAxis(0)).toBe(0.5);
  });

  it('reads sticks, throttle and held buttons per the configured indices', () => {
    const cfg = {
      ...input.gamepad,
      axes: { roll: 0, pitch: 1, yaw: 2, throttle: 3 },
      deadZone: 0,
      curve: 1,
    };
    const r = readGamepad(
      [0.5, -0.25, 0, -1],
      [false, false, false, false, false, true, true],
      cfg,
    );
    expect(r.axes).toEqual({ roll: 0.5, pitch: -0.25, yaw: 0 });
    expect(r.throttle).toBe(1);
    expect(r.afterburner).toBe(true);
    expect(r.throttleUp).toBe(true);
    expect(r.brakes).toBe(true);
    const inverted = readGamepad([0, -0.25, 0, 1], [], { ...cfg, invertPitch: true });
    expect(inverted.axes.pitch).toBe(0.25);
    expect(inverted.afterburner).toBe(false);
    expect(
      readGamepad([0, 0, 0], [], { ...cfg, axes: { ...cfg.axes, throttle: -1 } }).throttle,
    ).toBeUndefined();
  });

  it('turns button down-edges into presses', () => {
    const buttons = input.gamepad.buttons;
    const now = [] as boolean[];
    now[buttons.gear] = true;
    now[buttons.camera] = true;
    expect(pressedEdges([], now, buttons)).toEqual(['gear', 'camera']);
    expect(pressedEdges(now, now, buttons)).toEqual([]);
    const unassigned = { ...buttons, gear: -1 };
    expect(pressedEdges([], now, unassigned)).toEqual(['camera']);
  });

  it('maps the trigger and combat button edges without repeating held actions', () => {
    const buttons = input.gamepad.buttons;
    const current: boolean[] = [];
    for (const index of [
      buttons.fire,
      buttons.selectWeapon,
      buttons.target,
      buttons.lock,
      buttons.countermeasures,
    ])
      current[index] = true;
    expect(readGamepad([], current, input.gamepad).fire).toBe(true);
    expect(pressedEdges([], current, buttons)).toEqual([
      'selectWeapon',
      'target',
      'lock',
      'countermeasures',
    ]);
    expect(pressedEdges(current, current, buttons)).toEqual([]);
  });
});

describe('mouse', () => {
  it('turns the pointer offset into stick deflection', () => {
    expect(flightAxesFromPointer(500, 400, 1000, 800, 0.5)).toEqual({ roll: 0, pitch: 0, yaw: 0 });
    // Full deflection at half of the half-window when the sensitivity is 0.5.
    expect(flightAxesFromPointer(750, 600, 1000, 800, 0.5)).toEqual({ roll: 1, pitch: 1, yaw: 0 });
    expect(flightAxesFromPointer(375, 300, 1000, 800, 0.5)).toEqual({
      roll: -0.5,
      pitch: -0.5,
      yaw: 0,
    });
    expect(flightAxesFromPointer(0, 0, 1000, 800, 0.5).roll).toBe(-1);
  });

  it('returns the look to the boresight with the configured time constant', () => {
    const look = { yaw: 1, pitch: -0.5 };
    const after = decayLook(look, 0.3, 0.3);
    expect(after.yaw).toBeCloseTo(Math.exp(-1));
    expect(after.pitch).toBeCloseTo(-0.5 * Math.exp(-1));
    expect(decayLook(look, 0.01, 0)).toEqual({ yaw: 0, pitch: 0 });
  });
});

describe('legend', () => {
  it('is generated from the bindings', () => {
    const entries = legendEntries(input.keys);
    expect(entries[0]).toEqual({ keys: '← →', label: 'roll' });
    expect(entries.find((e) => e.label === 'gear')).toEqual({ keys: 'G', label: 'gear' });
    expect(entries.find((e) => e.label === 'cameras')?.keys).toBe('F1/F2/F3/F4');
    const rebound = { ...input.keys, gear: ['l'] };
    expect(legendEntries(rebound).find((e) => e.label === 'gear')?.keys).toBe('L');
  });

  it('wraps into lines', () => {
    const text = formatLegend(legendEntries(input.keys), 40);
    expect(text.split('\n').length).toBeGreaterThan(1);
    for (const line of text.split('\n')) expect(line.length).toBeLessThanOrEqual(45);
    expect(text).toContain('← → roll');
  });
});

describe('rampAxis', () => {
  it('builds up over the ramp time while held, so a tap is a small input', () => {
    expect(rampAxis(0, 1, 0.1, 0.5, 0.1)).toBeCloseTo(0.2);
    expect(rampAxis(0.2, 1, 0.1, 0.5, 0.1)).toBeCloseTo(0.4);
    expect(rampAxis(0.9, 1, 0.1, 0.5, 0.1)).toBe(1);
    expect(rampAxis(0, -1, 0.1, 0.5, 0.1)).toBeCloseTo(-0.2);
  });

  it('falls back over the release time, and reverses through neutral at the release rate', () => {
    expect(rampAxis(1, 0, 0.05, 0.5, 0.1)).toBeCloseTo(0.5);
    expect(rampAxis(0.05, 0, 0.05, 0.5, 0.1)).toBe(0);
    expect(rampAxis(0.5, -1, 0.05, 0.5, 0.1)).toBeCloseTo(0);
  });

  it('is instant with zero times', () => {
    expect(rampAxis(0, 1, 0.01, 0, 0)).toBe(1);
    expect(rampAxis(1, 0, 0.01, 0, 0)).toBe(0);
  });
});
