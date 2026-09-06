/** Arcade weapon tuning in SI units; angles are half-cones in degrees. */
import { ConfigError, isRecord, validateSection, type SectionSpec } from '../sim/validate';
import source from './weapons.json';

export const WEAPON_IDS = ['gun', 'ir', 'radar', 'bomb', 'rocket'] as const;
export type WeaponId = (typeof WEAPON_IDS)[number];
export type Seeker = 'none' | 'ir' | 'radar';

export interface WeaponConfig {
  name: string;
  seeker: Seeker;
  roundsPerSecond: number;
  muzzleVelocity: number;
  muzzleForward: number;
  muzzleRight: number;
  muzzleUp: number;
  dispersion: number;
  lifetime: number;
  mass: number;
  dragFactor: number;
  radius: number;
  damage: number;
  warheadRadius: number;
  fuzeRadius: number;
  motorThrust: number;
  burnTime: number;
  launchDelay: number;
  maxG: number;
  navigationConstant: number;
  seekerCone: number;
  gimbalLimit: number;
  minRange: number;
  maxRange: number;
  activeRange: number;
}

export interface Loadout {
  health: number;
  gun: number;
  ir: number;
  radar: number;
  bomb: number;
  rocket: number;
  chaff: number;
  flare: number;
}

export interface WeaponsConfig {
  seed: number;
  types: Record<WeaponId, WeaponConfig>;
  countermeasures: {
    interval: number;
    lifetime: number;
    effectiveRange: number;
    flareChance: number;
    chaffChance: number;
  };
  damage: { engineLoss: number; controlLoss: number; fuelLeak: number };
}

const positive = { min: 0.001, max: 1_000_000 };
const nonnegative = { min: 0, max: 1_000_000 };
const angle = { min: 0, max: 180 };
const fraction = { min: 0, max: 1 };
const WEAPON: SectionSpec<WeaponConfig> = {
  name: { type: 'string' },
  seeker: { type: 'enum', values: ['none', 'ir', 'radar'] },
  roundsPerSecond: { min: 0.01, max: 1000 },
  muzzleVelocity: nonnegative,
  muzzleForward: { min: -100, max: 100 },
  muzzleRight: { min: -100, max: 100 },
  muzzleUp: { min: -100, max: 100 },
  dispersion: { min: 0, max: 10 },
  lifetime: { min: 0.01, max: 300 },
  mass: positive,
  dragFactor: { min: 0, max: 1 },
  radius: positive,
  damage: nonnegative,
  warheadRadius: nonnegative,
  fuzeRadius: nonnegative,
  motorThrust: nonnegative,
  burnTime: nonnegative,
  launchDelay: nonnegative,
  maxG: { min: 0, max: 100 },
  navigationConstant: { min: 0, max: 10 },
  seekerCone: angle,
  gimbalLimit: angle,
  minRange: nonnegative,
  maxRange: positive,
  activeRange: nonnegative,
};

export function validateLoadout(input: unknown, path = 'combat'): Loadout {
  const spec = Object.fromEntries(
    ['health', ...WEAPON_IDS, 'chaff', 'flare'].map((k) => [
      k,
      k === 'health' ? positive : { min: 0, max: 10000 },
    ]),
  ) as SectionSpec<Loadout>;
  const result = validateSection<Loadout>(path, input, spec);
  for (const key of [...WEAPON_IDS, 'chaff', 'flare'] as const) {
    if (!Number.isInteger(result[key])) throw new ConfigError(`${path}.${key} must be an integer`);
  }
  return result;
}

export function validateWeapons(input: unknown): WeaponsConfig {
  if (!isRecord(input) || !isRecord(input['types']))
    throw new ConfigError('weapons.types must be an object');
  const types = {} as Record<WeaponId, WeaponConfig>;
  for (const id of WEAPON_IDS) {
    const w = validateSection<WeaponConfig>(`weapons.types.${id}`, input['types'][id], WEAPON);
    if (
      w.minRange >= w.maxRange ||
      w.seekerCone > w.gimbalLimit ||
      w.activeRange > w.maxRange ||
      w.launchDelay + w.burnTime > w.lifetime ||
      w.fuzeRadius > w.warheadRadius
    ) {
      throw new ConfigError(`weapons.types.${id}: invalid range, seeker, motor or fuze envelope`);
    }
    const expected = id === 'ir' || id === 'radar' ? id : 'none';
    if (w.seeker !== expected)
      throw new ConfigError(`weapons.types.${id}.seeker must be ${expected}`);
    types[id] = w;
  }
  for (const key of Object.keys(input['types']))
    if (!WEAPON_IDS.includes(key as WeaponId)) throw new ConfigError(`unknown weapon ${key}`);
  const { seed } = validateSection<{ seed: number }>(
    'weapons',
    { seed: input['seed'] },
    { seed: { min: 0, max: 0xffffffff } },
  );
  if (!Number.isInteger(seed)) throw new ConfigError('weapons.seed must be an integer');
  return {
    seed,
    types,
    countermeasures: validateSection<WeaponsConfig['countermeasures']>(
      'weapons.countermeasures',
      input['countermeasures'],
      {
        interval: positive,
        lifetime: { min: 0.01, max: 30 },
        effectiveRange: positive,
        flareChance: fraction,
        chaffChance: fraction,
      },
    ),
    damage: validateSection<WeaponsConfig['damage']>('weapons.damage', input['damage'], {
      engineLoss: fraction,
      controlLoss: fraction,
      fuelLeak: { min: 0, max: 100 },
    }),
  };
}

export const WEAPONS = validateWeapons(source);
