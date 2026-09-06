/**
 * Fixed-step clock: turns real frame time into a number of physics steps,
 * with pause and a bounded time scale. Pure, so the loop logic is testable.
 */
import { clamp } from './math3d';
import type { SimulationConfig } from './sim-config';

export class SimClock {
  readonly fixedDt: number;
  paused = false;
  timeScale = 1;
  private accumulator = 0;

  constructor(private readonly cfg: SimulationConfig) {
    this.fixedDt = 1 / cfg.physicsHz;
  }

  /**
   * Accounts for `realSeconds` of wall-clock time and returns how many fixed
   * steps to run. Long gaps (tab in the background) are clamped so the sim
   * never tries to catch up on minutes at once. Paused frames run no steps
   * and discard the time.
   */
  advance(realSeconds: number): number {
    if (this.paused || !(realSeconds > 0)) {
      this.accumulator = 0;
      return 0;
    }
    this.accumulator += Math.min(this.cfg.maxFrameSeconds, realSeconds) * this.timeScale;
    const steps = Math.floor(this.accumulator / this.fixedDt);
    this.accumulator -= steps * this.fixedDt;
    return steps;
  }

  /**
   * Fraction of a fixed step accumulated since the last step, 0..1. Render
   * between the previous and current state with it for smooth motion.
   */
  get alpha(): number {
    return this.accumulator / this.fixedDt;
  }

  /** Simulated seconds per real second, given the current scale and pause state. */
  get effectiveScale(): number {
    return this.paused ? 0 : this.timeScale;
  }

  togglePause(): boolean {
    this.paused = !this.paused;
    return this.paused;
  }

  faster(): number {
    this.timeScale = this.snap(this.timeScale * this.cfg.timeScaleStep);
    return this.timeScale;
  }

  slower(): number {
    this.timeScale = this.snap(this.timeScale / this.cfg.timeScaleStep);
    return this.timeScale;
  }

  /** Drops any partial step, e.g. after a reset. */
  reset(): void {
    this.accumulator = 0;
  }

  private snap(scale: number): number {
    const s = clamp(scale, this.cfg.minTimeScale, this.cfg.maxTimeScale);
    // Land exactly on 1 when passing through it so "normal speed" is exact.
    return Math.abs(s - 1) < 1e-9 ? 1 : Math.round(s * 1e6) / 1e6;
  }
}
