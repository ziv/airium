/**
 * On-screen key legend generated from the bindings, so it can never drift
 * from what the keys actually do.
 */
import type { KeyBindings } from '../sim/sim-config';
import { type Action, keyLabel } from './actions';

export interface LegendEntry {
  keys: string;
  label: string;
}

/** Actions shown as a pair (first key of each) with one label. */
const PAIRS: readonly [Action, Action, string][] = [
  ['rollLeft', 'rollRight', 'roll'],
  ['noseUp', 'noseDown', 'nose up/down'],
  ['yawLeft', 'yawRight', 'yaw'],
  ['throttleUp', 'throttleDown', 'throttle'],
  ['timeFaster', 'timeSlower', 'time'],
];

const SINGLES: readonly [Action, string][] = [
  ['afterburner', 'afterburner'],
  ['gear', 'gear'],
  ['airbrake', 'airbrake'],
  ['brakes', 'brakes'],
  ['camera', 'camera'],
  ['mouseFlight', 'mouse flight'],
  ['buildings', 'buildings'],
  ['pause', 'pause'],
  ['debug', 'debug'],
  ['reset', 'reset'],
];

const CAMERA_KEYS: readonly Action[] = [
  'cameraCockpit',
  'cameraChase',
  'cameraOrbit',
  'cameraFlyby',
];

const first = (keys: KeyBindings, action: Action): string | undefined => {
  const key = keys[action][0];
  return key === undefined ? undefined : keyLabel(key);
};

export function legendEntries(keys: KeyBindings): LegendEntry[] {
  const out: LegendEntry[] = [];
  for (const [a, b, label] of PAIRS) {
    const ka = first(keys, a);
    const kb = first(keys, b);
    if (ka !== undefined && kb !== undefined) out.push({ keys: `${ka} ${kb}`, label });
  }
  for (const [action, label] of SINGLES) {
    const k = first(keys, action);
    if (k !== undefined) out.push({ keys: k, label });
  }
  const cams = CAMERA_KEYS.map((a) => first(keys, a)).filter((k): k is string => k !== undefined);
  if (cams.length > 0) out.push({ keys: cams.join('/'), label: 'cameras' });
  return out;
}

/** Legend as lines of `keys label` groups, wrapped at roughly `width` characters. */
export function formatLegend(entries: LegendEntry[], width = 96): string {
  const lines: string[] = [];
  let line = '';
  for (const { keys, label } of entries) {
    const item = `${keys} ${label}`;
    if (line.length > 0 && line.length + 3 + item.length > width) {
      lines.push(line);
      line = item;
    } else {
      line = line.length === 0 ? item : `${line}   ${item}`;
    }
  }
  if (line.length > 0) lines.push(line);
  return lines.join('\n');
}
