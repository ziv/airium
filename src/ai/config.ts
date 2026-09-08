import source from './ai.json';
import { ConfigError, isRecord, validateSection, validateSectionMap } from '../sim/validate';
export const DIFFICULTIES = ['easy', 'medium', 'hard'] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];
export interface DifficultyConfig {
  reactionSeconds: number;
  aimError: number;
  maxG: number;
  missilePk: number;
  launchSpacing: number;
}
export interface Tuning {
  extendSeconds: number;
  gunPitchGain: number;
  gunPitchDamping: number;
  aaaBurstRounds: number;
  decisionHz: number;
  terrainLookahead: number;
  terrainFloor: number;
  terrainSamples: number;
  cruiseSpeed: number;
  minSpeed: number;
  memorySeconds: number;
  disengageSeconds: number;
  bingoFraction: number;
  retreatHealth: number;
  gunRange: number;
  gunCone: number;
  burstSeconds: number;
  burstPause: number;
  leadSeconds: number;
  overshootRange: number;
  formationSpacing: number;
  samRange: number;
  samMinRange: number;
  samAmmo: number;
  samReload: number;
  aaaRange: number;
  aaaAmmo: number;
  aaaReload: number;
  aaaDispersion: number;
}
export interface AIConfig {
  difficulty: Difficulty;
  seed: number;
  tuning: Tuning;
  presets: Record<string, DifficultyConfig>;
}
export interface AISpec {
  role: 'combat' | 'wingman' | 'sam' | 'aaa';
  leaderId: string;
}
export function validateAISpec(input: unknown, path: string): AISpec {
  if (!isRecord(input)) throw new ConfigError(`${path} must be an object`);
  return validateSection<AISpec>(
    path,
    { leaderId: '', ...input },
    {
      role: { type: 'enum', values: ['combat', 'wingman', 'sam', 'aaa'] },
      leaderId: { type: 'string' },
    },
  );
}
export function validateAI(input: unknown): AIConfig {
  if (!isRecord(input)) throw new ConfigError('ai must be an object');
  const { tuning, presets, ...head } = input;
  const base = validateSection<Pick<AIConfig, 'difficulty' | 'seed'>>('ai', head, {
    difficulty: { type: 'enum', values: DIFFICULTIES },
    seed: { min: 0, max: 4294967295 },
  });
  if (!Number.isInteger(base.seed)) throw new ConfigError('ai.seed must be an integer');
  const positive = { min: 0.01, max: 100000 };
  const cfg = validateSection<Tuning>('ai.tuning', tuning, {
    extendSeconds: positive,
    gunPitchGain: positive,
    gunPitchDamping: positive,
    aaaBurstRounds: { min: 1, max: 100 },
    decisionHz: { min: 1, max: 60 },
    terrainLookahead: positive,
    terrainFloor: positive,
    terrainSamples: { min: 2, max: 64 },
    cruiseSpeed: positive,
    minSpeed: positive,
    memorySeconds: positive,
    disengageSeconds: positive,
    bingoFraction: { min: 0, max: 1 },
    retreatHealth: { min: 0, max: 1 },
    gunRange: positive,
    gunCone: { min: 0.01, max: 10 },
    burstSeconds: positive,
    burstPause: positive,
    leadSeconds: positive,
    overshootRange: positive,
    formationSpacing: positive,
    samRange: positive,
    samMinRange: positive,
    samAmmo: { min: 0, max: 10000 },
    samReload: positive,
    aaaRange: positive,
    aaaAmmo: { min: 0, max: 10000 },
    aaaReload: positive,
    aaaDispersion: { min: 0, max: 10 },
  });
  for (const key of ['terrainSamples', 'samAmmo', 'aaaAmmo', 'aaaBurstRounds'] as const)
    if (!Number.isInteger(cfg[key])) throw new ConfigError(`ai.${key} must be an integer`);
  if (cfg.minSpeed >= cfg.cruiseSpeed || cfg.samMinRange >= cfg.samRange)
    throw new ConfigError('ai speed/range bounds invalid');
  const levels = validateSectionMap<DifficultyConfig>('ai.presets', presets, {
    reactionSeconds: positive,
    aimError: { min: 0, max: 10 },
    maxG: { min: 1.1, max: 9 },
    missilePk: { min: 0, max: 1 },
    launchSpacing: positive,
  });
  if (Object.keys(levels).length !== 3 || DIFFICULTIES.some((d) => !levels[d]))
    throw new ConfigError('ai requires easy, medium and hard presets');
  return { ...base, tuning: cfg, presets: levels };
}
export const AI = validateAI(source);
export function difficultyFromSearch(search: string): Difficulty {
  const value = new URLSearchParams(search).get('difficulty') ?? AI.difficulty;
  if (!(DIFFICULTIES as readonly string[]).includes(value))
    throw new ConfigError('difficulty must be easy, medium or hard');
  return value as Difficulty;
}
