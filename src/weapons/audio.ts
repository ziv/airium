import type { Threat } from '../sensors/system';
import type { CombatEvent } from './system';

/** The M7 empty-trigger click; richer combat audio belongs to M11. No sound assets needed. */
export class WeaponAudio {
  private context: AudioContext | null = null;
  constructor(win: Window) {
    const unlock = () => {
      this.context ??= new AudioContext();
      void this.context.resume().catch(() => {});
    };
    win.addEventListener('keydown', unlock, { once: true });
    win.addEventListener('pointerdown', unlock, { once: true });
  }
  private nextTone = 0;
  sensors(irLocked: boolean, threats: readonly Threat[]): void {
    const ctx = this.context;
    if (!ctx || ctx.state !== 'running' || ctx.currentTime < this.nextTone) return;
    const launch = threats.some((t) => t.level === 'launch');
    const lock = threats.some((t) => t.level === 'lock');
    if (!launch && !lock && !irLocked) return;
    const oscillator = ctx.createOscillator(),
      gain = ctx.createGain();
    oscillator.frequency.value = launch ? 1200 : lock ? 800 : 450;
    gain.gain.setValueAtTime(0.025, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.12);
    oscillator.connect(gain);
    gain.connect(ctx.destination);
    oscillator.start();
    oscillator.stop(ctx.currentTime + 0.13);
    oscillator.onended = () => {
      oscillator.disconnect();
      gain.disconnect();
    };
    this.nextTone = ctx.currentTime + (launch ? 0.25 : lock ? 0.6 : 0.35);
  }
  play(events: readonly CombatEvent[], playerId: string): void {
    const ctx = this.context;
    if (!ctx || ctx.state !== 'running') return;
    for (const event of events) {
      if (event.kind !== 'empty' || event.ownerId !== playerId) continue;
      const oscillator = ctx.createOscillator(),
        gain = ctx.createGain();
      oscillator.type = 'square';
      oscillator.frequency.value = 120;
      gain.gain.setValueAtTime(0.035, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.035);
      oscillator.connect(gain);
      gain.connect(ctx.destination);
      oscillator.start();
      oscillator.stop(ctx.currentTime + 0.04);
      oscillator.onended = () => {
        oscillator.disconnect();
        gain.disconnect();
      };
    }
  }
}
