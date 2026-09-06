import type { Loadout, WeaponId } from './config';

export interface WeaponState {
  selected: WeaponId;
  ammo: Record<WeaponId, number>;
  chaff: number;
  flare: number;
  targetId: string | null;
  lockId: string | null;
  cooldown: number;
  countermeasureCooldown: number;
  wasFiring: boolean;
  message: string;
  messageUntil: number;
  kills: number;
}

export function createWeaponState(loadout: Loadout): WeaponState {
  return {
    selected: 'gun',
    ammo: {
      gun: loadout.gun,
      ir: loadout.ir,
      radar: loadout.radar,
      bomb: loadout.bomb,
      rocket: loadout.rocket,
    },
    chaff: loadout.chaff,
    flare: loadout.flare,
    targetId: null,
    lockId: null,
    cooldown: 0,
    countermeasureCooldown: 0,
    wasFiring: false,
    message: '',
    messageUntil: 0,
    kills: 0,
  };
}

export type WeaponCommand =
  | 'selectWeapon'
  | 'selectGun'
  | 'selectIR'
  | 'selectRadar'
  | 'selectAG'
  | 'target'
  | 'lock'
  | 'countermeasures';
