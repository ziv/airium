import type { Track, Threat } from '../sensors/system';
import { isProjectile, type AircraftEntity } from '../sim/entities';
import { bearing, enuOffset } from '../sim/geo';
import {
  type Vec3,
  dot,
  length,
  normalize,
  sub,
  scale,
  toDegrees,
  clamp,
  add,
} from '../sim/math3d';
import type { TerrainQuery, World } from '../sim/world';
import { gunLead, predictImpact } from '../weapons/ballistics';
import { launchEnvelope } from '../weapons/targeting';
import type { TargetSymbology } from './hud-data';

export interface CombatHud {
  aiInfo: string;
  tracks: Track[];
  threats: Threat[];
  radarRange: number;
  radarAzimuth: number;
  radarLock: string | null;
  radarTarget: string | null;
  navigation?: { name: string; range: number; bearing: number };
  label: string;
  inventory: string;
  health: number;
  kills: number;
  message: string;
  systems: string[];
  incoming: boolean;
  target?: TargetSymbology;
  seeker?: Vec3;
  envelope?: { min: number; max: number; range: number; reason: string };
  shoot: boolean;
  pipper?: { direction: Vec3; label: string; time: number; finite: boolean };
  missile?: { time: number | null; phase: string };
  destroyed: boolean;
}

/** Simulation-only combat readout, used by both the canvas and acceptance tests. */
export function buildCombatHud(
  player: AircraftEntity,
  world: World,
  terrain: TerrainQuery,
): CombatHud {
  const w = player.weapons,
    combat = world.combat,
    cfg = combat.cfg.types[w.selected];
  const env = world.env.environment,
    R = env.earthRadius;
  const guided = cfg.seeker !== 'none';
  const target = guided
    ? (combat.missileTarget(player, w.selected) ?? combat.target(player))
    : combat.target(player);
  const out: CombatHud = {
    aiInfo: `AI ${world.ai.difficulty.toUpperCase()}  ${world.aircraft().filter((e) => e.alive && world.ai.state(e.id)?.mode === 'engage').length} ENGAGED`,
    tracks: world.sensors.tracks(player),
    threats: world.sensors.threats(player),
    radarRange: world.sensors.cfg.maxRange,
    radarAzimuth: world.sensors.cfg.azimuth,
    radarLock: w.lockId,
    radarTarget: w.targetId,
    label: `${cfg.name}  ${w.ammo[w.selected]}`,
    inventory: `FLR ${w.flare}  CHF ${w.chaff}`,
    health: player.health / player.maxHealth,
    kills: w.kills,
    message: world.time < w.messageUntil ? w.message : '',
    systems: [],
    incoming: world.sensors.threats(player).some((t) => t.level === 'launch'),
    shoot: false,
    destroyed: !!player.killedBy,
  };
  const waypoint = world.sensors.waypoint();
  if (waypoint)
    out.navigation = {
      name: waypoint.name,
      range: length(enuOffset(player, waypoint, R)),
      bearing: toDegrees(bearing(player, waypoint, R)),
    };
  if (player.systems.engine < 0.9)
    out.systems.push(`ENGINE ${Math.round(player.systems.engine * 100)}%`);
  if (player.systems.controls < 0.9)
    out.systems.push(`CONTROLS ${Math.round(player.systems.controls * 100)}%`);
  if (player.systems.fuelLeak > 0) out.systems.push('FUEL LEAK');
  if (target) {
    const direction = enuOffset(player, target, R),
      range = length(direction);
    out.target = {
      direction,
      range,
      closure: -dot(sub(target.velocity, player.velocity), normalize(direction)),
      locked:
        w.lockId === target.id ||
        (w.selected === 'ir' && combat.missileTarget(player, 'ir') === target),
      label: target.name,
      aspect: toDegrees(
        Math.acos(clamp(dot(normalize(direction), target.attitude.forward), -1, 1)),
      ),
    };
    if (w.selected === 'gun') {
      const lead = gunLead(
        enuOffset(combat.muzzle(player, 'gun'), target, R),
        sub(target.velocity, player.velocity),
        cfg.muzzleVelocity,
        cfg.dragFactor,
        env.gravity,
        cfg.lifetime,
      );
      if (lead) {
        out.pipper = { direction: lead.direction, label: 'LCOS', time: lead.time, finite: false };
        out.shoot =
          w.ammo.gun > 0 &&
          dot(lead.direction, player.attitude.forward) >
            Math.cos(Math.atan2(target.radius, Math.max(1, range)));
      }
    }
  }
  if (guided) {
    const gate = launchEnvelope(player, target, cfg, !!out.target?.locked, R);
    out.envelope = { min: cfg.minRange, max: cfg.maxRange, range: gate.range, reason: gate.reason };
    out.seeker = out.target?.locked ? out.target.direction : player.attitude.forward;
    out.shoot = gate.allowed && w.ammo[w.selected] > 0;
  }
  if (w.selected === 'bomb') {
    const position = combat.muzzle(player, 'bomb');
    const velocity = add(player.velocity, scale(player.attitude.forward, cfg.muzzleVelocity));
    const impact = predictImpact(
      position,
      velocity,
      env.gravity,
      cfg.dragFactor,
      R,
      terrain,
      player.groundHeight,
      cfg.lifetime,
    );
    if (impact)
      out.pipper = {
        direction: enuOffset(player, impact.point, R),
        label: 'CCIP',
        time: impact.time,
        finite: true,
      };
  }
  for (const e of world.entities) {
    if (!isProjectile(e) || !e.alive || e.kind !== 'missile') continue;
    if (e.ownerId !== player.id) continue;
    const t = e.targetId ? world.get(e.targetId) : undefined;
    const r = t ? enuOffset(e, t, R) : null;
    const closing = t && r ? -dot(sub(t.velocity, e.velocity), normalize(r)) : 0;
    const time = r && closing > 1 && e.guidance !== 'lost' ? length(r) / closing : null;
    const phase =
      e.guidance === 'lost'
        ? 'LOST'
        : e.age < combat.cfg.types[e.weaponId ?? 'ir'].launchDelay
          ? 'LAUNCH'
          : e.guidance === 'active'
            ? 'ACTIVE'
            : e.weaponId === 'radar'
              ? 'MIDCOURSE'
              : 'TRACK';
    out.missile = { time, phase };
  }
  return out;
}
