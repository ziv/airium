import { autopilot, DEFAULT_GAINS, type AutopilotTarget } from '../sim/autopilot';
import { hprFromAttitude } from '../sim/attitude';
import type { AircraftEntity, Entity } from '../sim/entities';
import { bearing, enuOffset, offsetLatLon } from '../sim/geo';
import { add, clamp, dot, length, normalize, scale, toRadians, type Vec3 } from '../sim/math3d';
import type { Controls } from '../sim/physics';
import type { TerrainQuery } from '../sim/world';
import type { DifficultyConfig, Tuning } from './config';
export interface Contact {
  lat: number;
  lon: number;
  height: number;
  velocity: Vec3;
  attitude: Entity['attitude'];
}
export type Pursuit = 'pure' | 'lead' | 'lag' | 'extend';
export function pursuit(
  owner: AircraftEntity,
  target: Contact,
  R: number,
  cfg: Tuning,
): { aim: AutopilotTarget; mode: Pursuit } {
  const v = enuOffset(owner, target, R),
    range = length(v),
    ahead = dot(normalize(v), owner.attitude.forward);
  const mode: Pursuit =
    ahead < -0.2 && range < cfg.overshootRange
      ? 'extend'
      : range < cfg.overshootRange
        ? 'lag'
        : range > cfg.gunRange
          ? 'lead'
          : 'pure';
  if (mode === 'extend')
    return {
      mode,
      aim: {
        heading: Math.atan2(owner.velocity.x, owner.velocity.y),
        altitude: owner.height + 300,
        speed: cfg.cruiseSpeed,
      },
    };
  const time =
    mode === 'lead'
      ? Math.min(cfg.leadSeconds, range / Math.max(cfg.minSpeed, length(owner.velocity)))
      : mode === 'lag'
        ? -2
        : 0;
  const aim = offsetLatLon(target, target.velocity.x * time, target.velocity.y * time, R);
  return {
    mode,
    aim: {
      heading: bearing(owner, aim, R),
      altitude: target.height + target.velocity.z * time,
      speed: cfg.cruiseSpeed,
    },
  };
}
export function formationTarget(
  owner: AircraftEntity,
  leader: AircraftEntity,
  slot: number,
  R: number,
  cfg: Tuning,
): AutopilotTarget {
  const side = slot % 2 === 0 ? 1 : -1,
    row = Math.floor(slot / 2) + 1;
  const offset = add(
    scale(leader.attitude.forward, -cfg.formationSpacing * row),
    scale(leader.attitude.right, cfg.formationSpacing * side * row),
  );
  const station = offsetLatLon(leader, offset.x, offset.y, R),
    error = enuOffset(owner, { ...station, height: leader.height + offset.z }, R);
  // Follow the leader's velocity near the station rather than orbiting a moving point.
  const desired = add(leader.velocity, scale(error, 0.12));
  return {
    heading: Math.atan2(desired.x, desired.y),
    altitude: leader.height + offset.z,
    speed: clamp(length(desired), cfg.minSpeed, cfg.cruiseSpeed * 1.3),
  };
}
export function terrainCeiling(
  owner: AircraftEntity,
  terrain: TerrainQuery,
  R: number,
  cfg: Tuning,
): number {
  let ceiling = terrain(owner.lat, owner.lon) ?? owner.groundHeight;
  const hpr = hprFromAttitude(owner.attitude),
    speed = Math.max(cfg.minSpeed, length(owner.velocity));
  for (let i = 1; i <= cfg.terrainSamples; i++) {
    const time = (cfg.terrainLookahead * i) / cfg.terrainSamples;
    // Sweep a corridor so a banking fighter does not turn into an unsampled ridge.
    for (const offset of [-0.45, 0, 0.45]) {
      const heading = hpr.heading + offset,
        p = offsetLatLon(
          owner,
          Math.sin(heading) * speed * time,
          Math.cos(heading) * speed * time,
          R,
        );
      ceiling = Math.max(ceiling, terrain(p.lat, p.lon) ?? owner.groundHeight);
    }
  }
  return ceiling + cfg.terrainFloor;
}
export function fly(
  owner: AircraftEntity,
  aim: AutopilotTarget,
  ceiling: number,
  level: DifficultyConfig,
  cfg: Tuning,
  gravity: number,
): Controls {
  const state = owner.state,
    speed = length(owner.velocity),
    hpr = hprFromAttitude(owner.attitude);
  const unsafe =
    state.status !== 'ground' &&
    (state.height < ceiling || state.height + Math.min(0, state.velocity.z) * 6 < ceiling);
  const maxG = Math.min(level.maxG, owner.type.limits.maxLoadFactor);
  const controls = autopilot(
    state,
    { ...aim, altitude: Math.max(aim.altitude, ceiling), speed: Math.max(cfg.minSpeed, aim.speed) },
    owner.type,
    gravity,
    {
      ...DEFAULT_GAINS,
      maxBank: unsafe ? toRadians(15) : Math.acos(1 / maxG),
      maxClimbRate: unsafe ? 100 : 60,
    },
  );
  const pitchLimit = (maxG - 1) / Math.max(0.01, owner.type.limits.maxLoadFactor - 1);
  controls.pitch = Math.min(controls.pitch, pitchLimit);
  if (unsafe) {
    controls.roll = clamp(-hpr.roll * 3, -1, 1);
    if (Math.abs(hpr.roll) < toRadians(35)) controls.pitch = pitchLimit;
    controls.throttle = 1;
    controls.afterburner = owner.type.engine.afterburnerThrust > 0;
  }
  if (speed < cfg.minSpeed && !unsafe) {
    controls.roll = clamp(-hpr.roll * 2, -1, 1);
    controls.pitch = Math.min(controls.pitch, 0.05);
    controls.throttle = 1;
    controls.afterburner = owner.type.engine.afterburnerThrust > 0;
  }
  return controls;
}
