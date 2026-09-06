import {
  type AircraftEntity,
  type Entity,
  type ProjectileEntity,
  isAircraft,
  isProjectile,
} from '../sim/entities';
import { enuOffset } from '../sim/geo';
import {
  type Vec3,
  ZERO,
  add,
  sub,
  scale,
  length,
  normalize,
  dot,
  toRadians,
  clamp,
} from '../sim/math3d';
import { attitudeFromHPR } from '../sim/attitude';
import type { World, TerrainQuery } from '../sim/world';
import {
  ballisticStep,
  blastDamage,
  movePosition,
  proportionalNavigation,
  segmentSphere,
  terrainImpact,
  type Position,
} from './ballistics';
import { WEAPON_IDS, type WeaponId, type WeaponsConfig } from './config';
import type { WeaponCommand } from './state';
import { decoyProbability, inCone, launchEnvelope, targetList, validTarget } from './targeting';

export interface CombatEffect extends Position {
  id: number;
  kind: 'explosion' | 'flare' | 'chaff' | 'launch';
  started: number;
  duration: number;
  radius: number;
  velocity: Vec3;
}

export interface CombatEvent {
  kind: 'empty' | 'shot' | 'launch' | 'hit' | 'kill' | 'decoy';
  ownerId: string;
  targetId?: string;
  weaponId?: WeaponId;
}

/** Weapons share World ownership and fixed time; no renderer, browser or wall clock dependency. */
export class CombatSystem {
  effects: CombatEffect[] = [];
  private events: CombatEvent[] = [];
  private commands: { ownerId: string; command: WeaponCommand }[] = [];
  private rng: number;
  private effectId = 0;
  constructor(
    private readonly world: World,
    readonly cfg: WeaponsConfig,
  ) {
    this.rng = cfg.seed;
  }

  reset(): void {
    this.effects = [];
    this.events = [];
    this.commands = [];
    this.rng = this.cfg.seed;
    this.effectId = 0;
  }
  takeEvents(): CombatEvent[] {
    const events = this.events;
    this.events = [];
    return events;
  }
  private emit(event: CombatEvent): void {
    if (this.events.length >= 1024) this.events.shift();
    this.events.push(event);
  }
  private random(): number {
    this.rng = (Math.imul(1664525, this.rng) + 1013904223) >>> 0;
    return this.rng / 0x100000000;
  }
  command(ownerId: string, command: WeaponCommand): void {
    this.commands.push({ ownerId, command });
  }
  private get R(): number {
    return this.world.env.environment.earthRadius;
  }

  notify(owner: AircraftEntity, message: string): void {
    owner.weapons.message = message;
    owner.weapons.messageUntil = this.world.time + 2;
  }

  target(owner: AircraftEntity): Entity | undefined {
    const w = owner.weapons;
    const id = w.lockId ?? w.targetId;
    const target = id ? this.world.get(id) : undefined;
    return target && validTarget(owner, target) ? target : undefined;
  }

  /** IR can acquire a boresight target without a radar lock. Radar always requires designation. */
  missileTarget(owner: AircraftEntity, id: WeaponId): Entity | undefined {
    const w = owner.weapons;
    if (w.lockId) return this.target(owner);
    if (id !== 'ir') return undefined;
    const cfg = this.cfg.types.ir;
    const selected = this.target(owner);
    if (
      selected &&
      isAircraft(selected) &&
      inCone(owner.attitude.forward, enuOffset(owner, selected, this.R), cfg.seekerCone)
    )
      return selected;
    return targetList(owner, this.world.entities, this.R, cfg.maxRange).find(
      (e) =>
        isAircraft(e) &&
        inCone(owner.attitude.forward, enuOffset(owner, e, this.R), cfg.seekerCone),
    );
  }

  step(dt: number): void {
    this.effects = this.effects.filter((e) => this.world.time - e.started < e.duration);
    for (const e of this.effects) Object.assign(e, movePosition(e, scale(e.velocity, dt), this.R));
    for (const { ownerId, command } of this.commands) {
      const owner = this.world.get(ownerId);
      if (!owner || !isAircraft(owner) || !owner.alive) continue;
      const w = owner.weapons;
      if (command === 'countermeasures') {
        this.releaseCountermeasures(owner);
        continue;
      }
      if (command === 'target') {
        const list = targetList(owner, this.world.entities, this.R, this.cfg.types.radar.maxRange);
        const index = list.findIndex((e) => e.id === w.targetId);
        w.targetId = list[(index + 1) % list.length]?.id ?? null;
        w.lockId = null;
      } else if (command === 'lock') {
        if (w.lockId) w.lockId = null;
        else {
          const target = this.target(owner);
          if (
            target &&
            inCone(
              owner.attitude.forward,
              enuOffset(owner, target, this.R),
              this.cfg.types.radar.gimbalLimit,
            )
          )
            w.lockId = target.id;
          else this.notify(owner, 'SELECT TARGET IN FRONT');
        }
      } else {
        const choices: Partial<Record<WeaponCommand, WeaponId>> = {
          selectGun: 'gun',
          selectIR: 'ir',
          selectRadar: 'radar',
          selectAG: w.selected === 'bomb' ? 'rocket' : 'bomb',
        };
        w.selected =
          choices[command] ?? WEAPON_IDS[(WEAPON_IDS.indexOf(w.selected) + 1) % WEAPON_IDS.length]!;
      }
    }
    this.commands = [];
    for (const e of this.world.entities) {
      if (!isAircraft(e) || !e.alive) continue;
      const w = e.weapons;
      w.countermeasureCooldown = Math.max(0, w.countermeasureCooldown - dt);
      if (w.lockId) {
        const t = this.target(e);
        if (
          !t ||
          length(enuOffset(e, t, this.R)) > this.cfg.types.radar.maxRange ||
          !inCone(e.attitude.forward, enuOffset(e, t, this.R), this.cfg.types.radar.gimbalLimit)
        )
          w.lockId = null;
      }
    }
  }

  fire(owner: AircraftEntity, held: boolean, dt: number): void {
    const w = owner.weapons;
    const automatic = w.selected === 'gun' || w.selected === 'rocket';
    const trigger = held && (automatic || !w.wasFiring);
    w.cooldown -= dt;
    if (!trigger || !owner.alive) {
      w.cooldown = Math.max(0, w.cooldown);
      w.wasFiring = held;
      return;
    }
    if (w.ammo[w.selected] === 0) {
      if (!w.wasFiring) this.emit({ kind: 'empty', ownerId: owner.id, weaponId: w.selected });
      this.notify(owner, 'EMPTY');
      w.cooldown = 0;
      w.wasFiring = held;
      return;
    }
    // Bound the backlog to this step: idle time never earns a burst of extra rounds.
    w.cooldown = Math.max(w.cooldown, -dt);
    while (w.cooldown < -1e-9 && w.ammo[w.selected] > 0) {
      if (!this.launch(owner, w.selected)) {
        w.cooldown = 0;
        break;
      }
      w.cooldown += 1 / this.cfg.types[w.selected].roundsPerSecond;
      if (!automatic) break;
    }
    w.wasFiring = held;
  }

  /** Shared by player and future AI; inventory and envelope checks cannot be bypassed. */
  launch(owner: AircraftEntity, id: WeaponId): ProjectileEntity | null {
    if (!owner.alive || owner.weapons.ammo[id] <= 0) return null;
    const cfg = this.cfg.types[id];
    const target = cfg.seeker === 'none' ? undefined : this.missileTarget(owner, id);
    if (cfg.seeker !== 'none') {
      const gate = launchEnvelope(
        owner,
        target,
        cfg,
        !!target && (id === 'ir' || owner.weapons.lockId === target.id),
        this.R,
      );
      if (!gate.allowed) {
        this.notify(owner, gate.reason);
        return null;
      }
    }
    const position = this.muzzle(owner, id);
    const a = owner.attitude;
    const spread = Math.tan(toRadians(cfg.dispersion)) * Math.sqrt(this.random());
    const azimuth = this.random() * Math.PI * 2;
    const direction = normalize(
      add(
        a.forward,
        add(scale(a.right, spread * Math.cos(azimuth)), scale(a.up, spread * Math.sin(azimuth))),
      ),
    );
    const projectile = this.world.spawnProjectile({
      kind: id === 'gun' ? 'bullet' : id === 'ir' || id === 'radar' ? 'missile' : id,
      ownerId: owner.id,
      faction: owner.faction,
      ...position,
      attitude: a,
      velocity: add(owner.velocity, scale(direction, cfg.muzzleVelocity)),
      ttl: cfg.lifetime,
      dragFactor: cfg.dragFactor,
      radius: cfg.radius,
      damage: cfg.damage,
      weaponId: id,
      targetId: target?.id,
      groundHeight: owner.groundHeight,
    });
    if (!projectile) {
      this.notify(owner, 'WEAPON POOL BUSY');
      return null;
    }
    projectile.name = cfg.name;
    owner.weapons.ammo[id]--;
    this.emit({ kind: id === 'gun' ? 'shot' : 'launch', ownerId: owner.id, weaponId: id });
    if (id !== 'gun') this.effect(position, 'launch', 0.3, 8, owner.velocity);
    return projectile;
  }

  muzzle(owner: AircraftEntity, id: WeaponId): Position {
    const cfg = this.cfg.types[id],
      a = owner.attitude;
    return movePosition(
      owner,
      add(
        add(scale(a.forward, cfg.muzzleForward), scale(a.right, cfg.muzzleRight)),
        scale(a.up, cfg.muzzleUp),
      ),
      this.R,
    );
  }

  releaseCountermeasures(owner: AircraftEntity): void {
    const w = owner.weapons,
      cfg = this.cfg.countermeasures;
    if (w.countermeasureCooldown > 0) return;
    if (w.flare === 0 && w.chaff === 0) {
      this.notify(owner, 'NO COUNTERMEASURES');
      return;
    }
    w.countermeasureCooldown = cfg.interval;
    const released: ('flare' | 'chaff')[] = [];
    for (const decoy of ['flare', 'chaff'] as const) {
      if (w[decoy] <= 0) continue;
      w[decoy]--;
      released.push(decoy);
      this.effect(
        owner,
        decoy,
        cfg.lifetime,
        decoy === 'flare' ? 4 : 10,
        add(scale(owner.velocity, 0.35), scale(owner.attitude.right, decoy === 'flare' ? -25 : 25)),
      );
    }
    this.notify(owner, 'COUNTERMEASURES');
    for (const p of this.world.entities) {
      if (
        !isProjectile(p) ||
        !p.alive ||
        p.targetId !== owner.id ||
        !p.weaponId ||
        p.guidance === 'lost'
      )
        continue;
      const weapon = this.cfg.types[p.weaponId];
      if (weapon.seeker === 'radar' && p.guidance !== 'active') continue; // datalink is not a seeker
      const offset = enuOffset(p, owner, this.R);
      const aspect = dot(normalize(offset), owner.attitude.forward);
      for (const decoy of released) {
        if (this.random() < decoyProbability(weapon.seeker, decoy, aspect, length(offset), cfg)) {
          p.guidance = 'lost';
          this.emit({ kind: 'decoy', ownerId: owner.id, targetId: p.id, weaponId: p.weaponId });
          break;
        }
      }
    }
  }

  private acceleration(p: ProjectileEntity): Vec3 {
    if (!p.weaponId) return ZERO;
    const cfg = this.cfg.types[p.weaponId],
      gravity = this.world.env.environment.gravity;
    if (p.age < cfg.launchDelay) return ZERO;
    let powered =
      p.age < cfg.launchDelay + cfg.burnTime
        ? scale(p.attitude.forward, cfg.motorThrust / cfg.mass)
        : ZERO;
    if (cfg.seeker === 'none' || p.guidance === 'lost') return powered;
    const target = p.targetId ? this.world.get(p.targetId) : undefined;
    if (!target || !target.alive) {
      p.guidance = 'lost';
      return powered;
    }
    const r = enuOffset(p, target, this.R);
    if (!inCone(p.attitude.forward, r, cfg.gimbalLimit)) {
      p.guidance = 'lost';
      return powered;
    }
    if (cfg.seeker === 'radar' && p.guidance !== 'active') {
      if (length(r) <= cfg.activeRange && inCone(p.attitude.forward, r, cfg.seekerCone))
        p.guidance = 'active';
      else {
        const owner = this.world.get(p.ownerId);
        if (!owner || !owner.alive || !isAircraft(owner) || owner.weapons.lockId !== p.targetId) {
          p.guidance = 'lost';
          return powered;
        }
      }
    }
    let nav = add(
      proportionalNavigation(
        r,
        sub(target.velocity, p.velocity),
        p.velocity,
        cfg.navigationConstant,
        cfg.maxG * gravity,
      ),
      { x: 0, y: 0, z: gravity },
    );
    nav = scale(nav, Math.min(1, (cfg.maxG * gravity) / Math.max(length(nav), 1e-9)));
    powered = add(powered, nav);
    return powered;
  }

  stepProjectile(
    p: ProjectileEntity,
    terrain: TerrainQuery,
    dt: number,
    previous: ReadonlyMap<string, Position>,
  ): void {
    const h = Math.min(dt, Math.max(0, p.ttl));
    const cfg = p.weaponId ? this.cfg.types[p.weaponId] : null;
    const start: Position = { lat: p.lat, lon: p.lon, height: p.height };
    const step = ballisticStep(
      p.velocity,
      h,
      this.world.env.environment.gravity,
      p.dragFactor,
      this.acceleration(p),
    );
    const next = movePosition(p, step.displacement, this.R);
    const groundHit = terrainImpact(start, next, terrain, p.groundHeight, this.R);
    let first = groundHit?.fraction ?? Infinity;
    let hit: Entity | undefined;
    const armed = !cfg || p.distanceTravelled >= cfg.minRange;
    if (this.world.cfg.collisions) {
      for (const target of this.world.entities) {
        if (
          !target.alive ||
          isProjectile(target) ||
          target.kind === 'waypoint' ||
          target.id === p.ownerId
        )
          continue;
        const before = previous.get(target.id) ?? target;
        const startOffset = enuOffset(before, start, this.R);
        const endOffset = enuOffset(target, next, this.R);
        const radius =
          target.radius + (armed ? Math.max(p.radius, cfg?.fuzeRadius ?? 0) : p.radius);
        // Cheap axis rejection before the quadratic. Includes target motion during the step.
        if (
          Math.min(startOffset.z, endOffset.z) > radius ||
          Math.max(startOffset.z, endOffset.z) < -radius ||
          Math.min(startOffset.y, endOffset.y) > radius ||
          Math.max(startOffset.y, endOffset.y) < -radius ||
          Math.min(startOffset.x, endOffset.x) > radius ||
          Math.max(startOffset.x, endOffset.x) < -radius
        )
          continue;
        const fraction = segmentSphere(startOffset, endOffset, radius);
        if (fraction !== null && fraction <= first) {
          first = fraction;
          hit = target;
        }
      }
    }
    Object.assign(
      p,
      Number.isFinite(first) ? movePosition(start, scale(step.displacement, first), this.R) : next,
    );
    p.velocity = step.velocity;
    p.groundHeight = terrain(p.lat, p.lon) ?? p.groundHeight;
    p.distanceTravelled += length(step.displacement) * (Number.isFinite(first) ? first : 1);
    p.age += h;
    p.ttl -= dt;
    if (length(p.velocity) > 0.01)
      p.attitude = attitudeFromHPR({
        heading: Math.atan2(p.velocity.x, p.velocity.y),
        pitch: Math.asin(clamp(normalize(p.velocity).z, -1, 1)),
        roll: 0,
      });
    if (p.age - p.trailAt >= 0.05 || p.kind === 'bullet') {
      p.trail.push({ lat: p.lat, lon: p.lon, height: p.height });
      if (p.trail.length > (p.kind === 'bullet' ? 2 : 80)) p.trail.shift();
      p.trailAt = p.age;
    }
    if (Number.isFinite(first)) {
      if (!hit && groundHit) p.height = groundHit.ground;
      if (armed && cfg && cfg.warheadRadius > 0) this.explode(p, cfg.damage, cfg.warheadRadius);
      else if (hit)
        this.damage(hit, p.impactDamage, p.ownerId, `hit by ${p.name}`, p.weaponId ?? undefined);
      this.world.kill(p, hit ? 'impact' : 'ground');
    } else if (p.ttl <= 0) this.world.kill(p, 'expired');
  }

  damage(
    target: Entity,
    amount: number,
    ownerId: string,
    reason: string,
    weaponId?: WeaponId,
  ): void {
    if (!target.alive || target.kind === 'waypoint' || amount <= 0) return;
    target.health = Math.max(0, target.health - amount);
    this.emit({ kind: 'hit', ownerId, targetId: target.id, weaponId });
    if (isAircraft(target)) {
      const severity = 1 - target.health / target.maxHealth;
      target.systems.engine = 1 - severity * this.cfg.damage.engineLoss;
      target.systems.controls = 1 - severity * this.cfg.damage.controlLoss;
      target.systems.fuelLeak = severity * this.cfg.damage.fuelLeak;
      const type = target.type;
      target.model = {
        ...target.model,
        aircraft: {
          ...type,
          engine: {
            ...type.engine,
            militaryThrust: type.engine.militaryThrust * target.systems.engine,
            afterburnerThrust: type.engine.afterburnerThrust * target.systems.engine,
          },
          controls: {
            ...type.controls,
            rollRate: type.controls.rollRate * target.systems.controls,
            pitchRate: type.controls.pitchRate * target.systems.controls,
            yawRate: type.controls.yawRate * target.systems.controls,
          },
        },
      };
    }
    if (target.health <= 0) this.world.kill(target, reason, ownerId);
  }

  private explode(p: ProjectileEntity, damage: number, radius: number): void {
    this.effect(p, 'explosion', 1.5, radius);
    if (!this.world.cfg.collisions) return;
    for (const target of this.world.entities) {
      if (!target.alive || isProjectile(target) || target.kind === 'waypoint') continue;
      const distance = Math.max(0, length(enuOffset(p, target, this.R)) - target.radius);
      this.damage(
        target,
        blastDamage(damage, distance, radius),
        p.ownerId,
        `destroyed by ${p.name}`,
        p.weaponId ?? undefined,
      );
    }
  }

  destroyed(target: Entity, ownerId?: string): void {
    if (isProjectile(target) || target.kind === 'waypoint') return;
    this.effect(target, 'explosion', 2, Math.max(15, target.radius * 3));
    if (ownerId) {
      target.killedBy = ownerId;
      const owner = this.world.get(ownerId);
      if (owner && isAircraft(owner) && validTarget(owner, { ...target, alive: true })) {
        owner.weapons.kills++;
        this.notify(owner, `DESTROYED ${target.name}`);
      }
      this.emit({ kind: 'kill', ownerId, targetId: target.id });
    }
  }

  private effect(
    p: Position,
    kind: CombatEffect['kind'],
    duration: number,
    radius: number,
    velocity = ZERO,
  ): void {
    if (this.effects.length >= 256) this.effects.shift();
    this.effects.push({
      lat: p.lat,
      lon: p.lon,
      height: p.height,
      id: this.effectId++,
      kind,
      started: this.world.time,
      duration,
      radius,
      velocity,
    });
  }
}
