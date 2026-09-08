import { hprFromAttitude } from '../sim/attitude';
/** AI decisions run on simulation time; physics and weapons retain final authority. */
import { AI, type AIConfig, type Difficulty } from './config';
import {
  fly,
  formationTarget,
  pursuit,
  terrainCeiling,
  type Contact,
  type Pursuit,
} from './flight';
import { aircraftTarget } from '../sim/behaviour';
import {
  isAircraft,
  isSurface,
  isProjectile,
  type AircraftEntity,
  type Entity,
  type SurfaceEntity,
} from '../sim/entities';
import { bearing, enuOffset, groundDistance, offsetLatLon } from '../sim/geo';
import { add, clamp, dot, length, normalize, sub, toRadians } from '../sim/math3d';
import type { TerrainQuery, World } from '../sim/world';
import { enemies, inCone, launchEnvelope } from '../weapons/targeting';
import { gunLead } from '../weapons/ballistics';
import type { AutopilotTarget } from '../sim/autopilot';
export type AIMode = 'patrol' | 'detect' | 'engage' | 'defend' | 'disengage' | 'rtb';
export interface AIState {
  mode: AIMode;
  since: number;
  targetId: string | null;
  lastSeen: number;
  contact: Contact | null;
  home: { lat: number; lon: number; height: number };
  aim: AutopilotTarget;
  ceiling: number;
  nextDecision: number;
  nextLaunch: number;
  burstUntil: number;
  nextBurst: number;
  threatSince: number | null;
  defendUntil: number;
  extendUntil: number;
  pursuing: Pursuit;
  engageOrdered: boolean;
  ammo: number;
  lockId: string | null;
  rng: number;
  aimBias: number;
}
export class AISystem {
  private states = new Map<string, AIState>();
  difficulty: Difficulty;
  constructor(
    private readonly world: World,
    readonly cfg: AIConfig = AI,
  ) {
    this.difficulty = cfg.difficulty;
  }
  reset(): void {
    this.states.clear();
  }
  state(id: string): AIState | undefined {
    return this.states.get(id);
  }
  private create(e: Entity): AIState {
    let seed = this.cfg.seed;
    for (const c of e.id) seed = (Math.imul(seed, 31) + c.charCodeAt(0)) >>> 0;
    const s: AIState = {
      mode: 'patrol',
      since: this.world.time,
      targetId: null,
      lastSeen: 0,
      contact: null,
      home: { lat: e.lat, lon: e.lon, height: e.height },
      aim: { heading: 0, altitude: e.height, speed: this.cfg.tuning.cruiseSpeed },
      ceiling: 0,
      nextDecision: 0,
      nextLaunch: 0,
      burstUntil: 0,
      nextBurst: 0,
      threatSince: null,
      defendUntil: 0,
      extendUntil: 0,
      pursuing: 'pure',
      engageOrdered: e.ai?.role !== 'wingman',
      ammo: e.ai?.role === 'sam' ? this.cfg.tuning.samAmmo : this.cfg.tuning.aaaAmmo,
      lockId: null,
      rng: seed,
      aimBias: 0,
    };
    this.states.set(e.id, s);
    return s;
  }
  private random(s: AIState): number {
    s.rng = (Math.imul(1664525, s.rng) + 1013904223) >>> 0;
    return s.rng / 4294967296;
  }
  private mode(s: AIState, mode: AIMode): void {
    if (s.mode !== mode) {
      s.mode = mode;
      s.since = this.world.time;
    }
  }
  commandWingmen(engage: boolean): void {
    for (const e of this.world.aircraft())
      if (e.alive && e.faction === 'friendly' && e.ai?.role === 'wingman') {
        const s = this.states.get(e.id) ?? this.create(e);
        s.engageOrdered = engage;
        s.targetId = null;
        s.contact = null;
        s.lockId = null;
        e.weapons.lockId = null;
        e.weapons.targetId = null;
        this.mode(s, 'patrol');
      }
    const player = this.world.player();
    if (player) this.world.combat.notify(player, engage ? 'WINGMEN ENGAGE' : 'WINGMEN REJOIN');
  }
  step(terrain: TerrainQuery): void {
    for (const id of this.states.keys()) if (!this.world.get(id)?.alive) this.states.delete(id);
    for (const e of [...this.world.entities]) {
      if (!e.alive || (!isAircraft(e) && !isSurface(e)) || (isAircraft(e) && e.controlledByPlayer))
        continue;
      if (!e.ai) continue;
      const s = this.states.get(e.id) ?? this.create(e);
      if (this.world.time >= s.nextDecision) {
        s.nextDecision = this.world.time + 1 / this.cfg.tuning.decisionHz;
        if (isAircraft(e)) this.decide(e, s, terrain);
        else this.surface(e, s);
      }
      if (isAircraft(e)) {
        e.controls = fly(
          e,
          s.aim,
          s.ceiling,
          this.cfg.presets[this.difficulty]!,
          this.cfg.tuning,
          this.world.env.environment.gravity,
        );
        this.employ(e, s);
      }
    }
  }
  private decide(e: AircraftEntity, s: AIState, terrain: TerrainQuery): void {
    const world = this.world,
      t = world.time,
      cfg = this.cfg.tuning,
      level = this.cfg.presets[this.difficulty]!,
      R = world.env.environment.earthRadius;
    s.ceiling = terrainCeiling(e, terrain, R, cfg);
    s.aim = aircraftTarget(e, R);
    const depleted =
      e.state.fuel / e.type.airframe.fuelCapacity < cfg.bingoFraction ||
      e.health / e.maxHealth < cfg.retreatHealth ||
      e.weapons.ammo.gun + e.weapons.ammo.ir + e.weapons.ammo.radar === 0;
    if (depleted && s.mode !== 'disengage' && s.mode !== 'rtb') this.mode(s, 'disengage');
    if (s.mode === 'disengage' || s.mode === 'rtb') {
      e.weapons.lockId = null;
      s.lockId = null;
      if (t - s.since > cfg.disengageSeconds) this.mode(s, 'rtb');
      const away = s.contact ? bearing(s.contact, e, R) : e.cruise.heading;
      const atHome = groundDistance(e, s.home, R) < 1500;
      s.aim = {
        heading:
          s.mode === 'disengage'
            ? away
            : atHome
              ? bearing(s.home, e, R) + Math.PI / 2
              : bearing(e, s.home, R),
        altitude: Math.max(s.home.height, s.ceiling),
        speed: cfg.cruiseSpeed,
      };
      return;
    }
    const threats = world.sensors.threats(e).filter((x) => x.level === 'launch');
    const gunThreat = world.entities.find(
      (x) =>
        isAircraft(x) &&
        x.alive &&
        enemies(e.faction, x.faction) &&
        x.weapons.selected === 'gun' &&
        x.controls.fire &&
        length(enuOffset(e, x, R)) < cfg.gunRange &&
        inCone(x.attitude.forward, enuOffset(x, e, R), 5) &&
        world.sensors.visible(e, x),
    );
    const danger = threats[0]?.id ?? gunThreat?.id;
    if (danger) {
      s.threatSince ??= t;
      if (t - s.threatSince >= level.reactionSeconds * 0.5) {
        this.mode(s, 'defend');
        s.defendUntil = t + 3;
        const threat = world.get(danger)!;
        const heading = bearing(e, threat, R);
        const missile = isProjectile(threat) && threat.kind === 'missile';
        s.aim = {
          heading: heading + (missile && threat.weaponId === 'radar' ? Math.PI / 2 : 0),
          altitude: Math.max(s.ceiling, e.height + (e.height - s.ceiling > 1200 ? -700 : 500)),
          speed: cfg.cruiseSpeed * 1.1,
        };
        if (
          missile &&
          length(enuOffset(e, threat, R)) <= world.combat.cfg.countermeasures.effectiveRange
        )
          world.combat.command(e.id, 'countermeasures');
        return;
      }
    } else s.threatSince = null;
    if (s.mode === 'defend' && t < s.defendUntil) {
      s.aim = {
        heading: e.cruise.heading + Math.PI / 2,
        altitude: Math.max(s.ceiling, e.height + 300),
        speed: cfg.cruiseSpeed,
      };
      return;
    }
    if (s.mode === 'defend') this.mode(s, 'patrol');
    if (e.ai?.role === 'wingman' && !s.engageOrdered) {
      const leader = world.get(e.ai.leaderId);
      if (leader?.alive && isAircraft(leader)) {
        const mates = world
          .aircraft()
          .filter((a) => a.alive && a.ai?.role === 'wingman' && a.ai.leaderId === leader.id)
          .sort((a, b) => a.id.localeCompare(b.id));
        s.aim = formationTarget(e, leader, mates.indexOf(e), R, cfg);
      }
      this.mode(s, 'patrol');
      return;
    }
    const tracks = world.sensors.targets(e).filter((x) => isAircraft(world.get(x.id)!));
    const track = tracks.find((x) => x.id === s.targetId) ?? tracks[0];
    if (track) {
      const target = world.get(track.id)!;
      if (s.targetId !== track.id) {
        s.targetId = track.id;
        this.mode(s, 'detect');
      }
      s.contact = {
        lat: target.lat,
        lon: target.lon,
        height: target.height,
        velocity: { ...target.velocity },
        attitude: target.attitude,
      };
      s.lastSeen = t;
      if (s.mode === 'patrol') this.mode(s, 'detect');
    } else if (
      s.targetId &&
      (!world.get(s.targetId)?.alive || t - s.lastSeen > cfg.memorySeconds)
    ) {
      s.targetId = null;
      s.contact = null;
      this.mode(s, 'patrol');
    }
    if (!s.contact) return;
    if (s.mode === 'detect' && t - s.since >= level.reactionSeconds) {
      this.mode(s, 'engage');
      s.nextLaunch = Math.max(s.nextLaunch, t + level.reactionSeconds);
    }
    if (s.mode === 'engage') {
      const age = t - s.lastSeen,
        p = offsetLatLon(s.contact, s.contact.velocity.x * age, s.contact.velocity.y * age, R);
      const solution = pursuit(
        e,
        { ...s.contact, ...p, height: s.contact.height + s.contact.velocity.z * age },
        R,
        cfg,
      );
      if (solution.mode === 'extend') {
        if (s.extendUntil === 0) s.extendUntil = t + cfg.extendSeconds;
        if (t >= s.extendUntil) {
          solution.mode = 'lead';
          solution.aim.heading = bearing(e, p, R);
        }
      } else if (dot(normalize(enuOffset(e, p, R)), e.attitude.forward) > 0.2) s.extendUntil = 0;
      s.aim = solution.aim;
      s.pursuing = solution.mode;
      s.aimBias = (this.random(s) * 2 - 1) * toRadians(level.aimError);
      s.aim.heading += s.aimBias;
    }
    const target = s.targetId ? world.get(s.targetId) : undefined;
    e.weapons.targetId = target?.id ?? null;
    e.weapons.lockId = s.mode === 'engage' && track ? (target?.id ?? null) : null;
    s.lockId = e.weapons.lockId;
  }
  private employ(e: AircraftEntity, s: AIState): void {
    e.controls.fire = false;
    if (
      s.mode !== 'engage' ||
      !s.targetId ||
      e.height + Math.min(0, e.velocity.z) * 6 < s.ceiling ||
      length(e.velocity) < this.cfg.tuning.minSpeed
    )
      return;
    const target = this.world.get(s.targetId),
      R = this.world.env.environment.earthRadius,
      cfg = this.cfg.tuning,
      level = this.cfg.presets[this.difficulty]!;
    if (
      !target?.alive ||
      !this.world.sensors.targets(e).some((t) => t.id === target.id) ||
      !this.world.sensors.visible(e, target)
    )
      return;
    const relative = enuOffset(e, target, R),
      range = length(relative),
      time = this.world.time;
    if (time >= s.nextLaunch) {
      const id =
        range < this.world.combat.cfg.types.ir.maxRange * 0.6 && e.weapons.ammo.ir > 0
          ? 'ir'
          : 'radar';
      if (
        launchEnvelope(
          e,
          target,
          this.world.combat.cfg.types[id],
          e.weapons.lockId === target.id,
          R,
        ).allowed &&
        e.weapons.ammo[id] > 0
      ) {
        const missile = this.world.combat.launch(e, id);
        if (missile) {
          s.nextLaunch = time + level.launchSpacing;
          if (this.random(s) > level.missilePk) missile.guidance = 'lost';
        }
      }
    }
    if (range > cfg.gunRange || s.pursuing === 'extend') return;
    const gun = this.world.combat.cfg.types.gun;
    const lead = gunLead(
      enuOffset(this.world.combat.muzzle(e, 'gun'), target, R),
      sub(target.velocity, e.velocity),
      gun.muzzleVelocity,
      gun.dragFactor,
      this.world.env.environment.gravity,
      gun.lifetime,
    );
    if (!lead) return;
    s.aim.altitude = e.height + normalize(lead.direction).z * range;
    s.aim.heading = Math.atan2(lead.direction.x, lead.direction.y) + s.aimBias;
    const attitude = hprFromAttitude(e.attitude);
    const desiredPitch = Math.atan2(
      lead.direction.z,
      Math.hypot(lead.direction.x, lead.direction.y),
    );
    const bankLoad = 1 / Math.max(0.2, Math.cos(attitude.roll));
    const load = clamp(
      bankLoad +
        cfg.gunPitchGain * (desiredPitch - attitude.pitch) -
        cfg.gunPitchDamping * e.state.bodyRates.pitch,
      0.2,
      Math.min(level.maxG, e.type.limits.maxLoadFactor),
    );
    e.controls.pitch =
      load >= 1
        ? (load - 1) / (e.type.limits.maxLoadFactor - 1)
        : (load - 1) / (1 - e.type.limits.minLoadFactor);
    const angle = toRadians(cfg.gunCone);
    if (dot(normalize(lead.direction), e.attitude.forward) < Math.cos(angle)) return;
    if (time >= s.nextBurst) {
      s.burstUntil = time + cfg.burstSeconds;
      s.nextBurst = s.burstUntil + cfg.burstPause;
    }
    e.weapons.selected = 'gun';
    e.controls.fire = time < s.burstUntil;
    // World fires once after all aircraft physics updates, using the normal cannon/inventory path.
  }
  private surface(e: SurfaceEntity, s: AIState): void {
    const cfg = this.cfg.tuning,
      level = this.cfg.presets[this.difficulty]!,
      R = this.world.env.environment.earthRadius,
      t = this.world.time;
    const sam = e.ai?.role === 'sam',
      max = sam ? cfg.samRange : cfg.aaaRange,
      min = sam ? cfg.samMinRange : 100;
    const target = this.world.sensors
      .targets(e)
      .map((track) => this.world.get(track.id)!)
      .find(
        (x) =>
          isAircraft(x) &&
          x.height - e.height > 30 &&
          length(enuOffset(e, x, R)) >= min &&
          length(enuOffset(e, x, R)) <= max,
      );
    if (!target || s.ammo <= 0) {
      s.targetId = null;
      s.lockId = null;
      this.mode(s, 'patrol');
      return;
    }
    if (target.id !== s.targetId) {
      s.targetId = target.id;
      s.lockId = null;
      this.mode(s, 'detect');
    }
    if (t - s.since < level.reactionSeconds) return;
    this.mode(s, 'engage');
    s.lockId = target.id;
    if (t < s.nextLaunch) return;
    const direction = enuOffset({ ...e, height: e.height + e.radius + 2 }, target, R),
      gun = this.world.combat.cfg.types.gun;
    const lead = sam
      ? normalize(direction)
      : gunLead(
          direction,
          sub(target.velocity, e.velocity),
          gun.muzzleVelocity,
          gun.dragFactor,
          this.world.env.environment.gravity,
          gun.lifetime,
        )?.direction;
    if (!lead) return;
    // One short burst per reload; independent random aim for every projectile.
    const count = Math.min(s.ammo, sam ? 1 : cfg.aaaBurstRounds);
    for (let i = 0; i < count; i++) {
      const error = toRadians(sam ? level.aimError : cfg.aaaDispersion + level.aimError);
      const aim = normalize(
        add(lead, {
          x: (this.random(s) - 0.5) * error,
          y: (this.random(s) - 0.5) * error,
          z: (this.random(s) - 0.5) * error,
        }),
      );
      const p = this.world.combat.launchSurface(e, target, sam ? 'radar' : 'gun', aim);
      if (p) {
        if (sam && this.random(s) > level.missilePk) p.guidance = 'lost';
      }
    }
    s.nextLaunch = t + (sam ? cfg.samReload : cfg.aaaReload);
  }
}
