/**
 * Graphical HUD drawn on a full-screen canvas above the Cesium canvas.
 * Symbols that refer to the world are projected through the current camera
 * so they stay true in every view; everything else is fixed on screen.
 */
import { toDegrees } from '../sim/math3d';
import type { HudConfig } from '../sim/sim-config';
import type { HudData } from './hud-data';
import {
  altitudeFor,
  altitudeTicks,
  aoaFraction,
  flashOn,
  headingDegrees,
  ladderLine,
  ladderPitches,
  massFor,
  speedFor,
  speedTicks,
  tapeTicks,
  verticalSpeedFor,
} from './layout';
import {
  type Projected,
  type ScreenPoint,
  type Viewport,
  clampToEdge,
  projectDirection,
} from './projection';

const CRASH_COLOR = '#ff6b6b';
const WARNING_COLOR = '#ffd166';
const DEG = Math.PI / 180;

export class HudCanvas {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private width = 1;
  private height = 1;
  private dpr = 1;

  constructor(
    parent: HTMLElement,
    private readonly cfg: HudConfig,
    private readonly win: Window,
  ) {
    this.canvas = document.createElement('canvas');
    this.canvas.id = 'hud-canvas';
    parent.appendChild(this.canvas);
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('HUD: 2D canvas context unavailable');
    this.ctx = ctx;
    this.resize();
    win.addEventListener('resize', () => this.resize());
  }

  set visible(show: boolean) {
    this.canvas.hidden = !show;
  }

  get visible(): boolean {
    return !this.canvas.hidden;
  }

  private resize(): void {
    this.dpr = this.win.devicePixelRatio || 1;
    this.width = this.win.innerWidth;
    this.height = this.win.innerHeight;
    this.canvas.width = Math.round(this.width * this.dpr);
    this.canvas.height = Math.round(this.height * this.dpr);
  }

  /** `fov` is the camera's frustum fov in radians (see `Viewport`). */
  draw(d: HudData, fov: number): void {
    if (this.canvas.hidden) return;
    const { ctx, width: w, height: h } = this;
    const vp: Viewport = { width: w, height: h, fov };
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.globalAlpha = this.cfg.brightness;
    ctx.strokeStyle = this.cfg.color;
    ctx.fillStyle = this.cfg.color;
    ctx.lineWidth = 1.5;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    this.font(1);

    this.drawLadder(d, vp);
    this.drawBoresight(d, vp);
    this.drawFlightPath(d, vp);
    this.drawTarget(d, vp);
    this.drawHeadingTape(d);
    this.drawAirspeedTape(d);
    this.drawAltitudeTape(d);
    this.drawEngineAndFuel(d);
    this.drawConfigIndicators(d);
    this.drawCorners(d);
    this.drawWarnings(d);
    this.drawStatus(d);
  }

  // ---- helpers ------------------------------------------------------------

  private font(scale: number, weight = ''): void {
    this.ctx.font =
      `${weight} ${Math.round(this.cfg.fontSize * scale)}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`.trim();
  }

  private text(
    s: string,
    x: number,
    y: number,
    align: CanvasTextAlign = 'left',
    baseline: CanvasTextBaseline = 'middle',
  ): void {
    this.ctx.textAlign = align;
    this.ctx.textBaseline = baseline;
    this.ctx.fillText(s, x, y);
  }

  private line(a: ScreenPoint, b: ScreenPoint, dashed = false): void {
    const { ctx } = this;
    ctx.setLineDash(dashed ? [6, 5] : []);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  private box(x: number, y: number, bw: number, bh: number, fill = false): void {
    const { ctx } = this;
    if (fill) {
      ctx.save();
      ctx.globalAlpha *= 0.55;
      ctx.fillStyle = '#000';
      ctx.fillRect(x, y, bw, bh);
      ctx.restore();
    }
    ctx.strokeRect(x, y, bw, bh);
  }

  private arrow(at: ScreenPoint, angle: number, size: number): void {
    const { ctx } = this;
    ctx.save();
    ctx.translate(at.x, at.y);
    ctx.rotate(-angle);
    ctx.beginPath();
    ctx.moveTo(size, 0);
    ctx.lineTo(-size * 0.6, size * 0.6);
    ctx.lineTo(-size * 0.6, -size * 0.6);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  // ---- world-referenced symbols ------------------------------------------

  private drawLadder(d: HudData, vp: Viewport): void {
    const { ctx, width: w, height: h } = this;
    const cx = w / 2;
    const cy = h / 2;
    ctx.save();
    ctx.beginPath();
    ctx.rect(cx - w * 0.23, cy - h * 0.32, w * 0.46, h * 0.64);
    ctx.clip();
    this.font(0.9);
    const pitches = ladderPitches(toDegrees(d.pitch), this.cfg.ladderSpacing, this.cfg.ladderRange);
    for (const p of pitches) {
      const horizon = p === 0;
      const { ends } = ladderLine(d.heading, p, (horizon ? 14 : 5) * DEG, 2.2 * DEG);
      const [o1, i1, i2, o2] = ends.map((e) => projectDirection(e, d.pose, vp)) as [
        Projected,
        Projected,
        Projected,
        Projected,
      ];
      if (!(o1.visible && i1.visible && i2.visible && o2.visible)) continue;
      const dashed = p < 0;
      this.line(o1, i1, dashed);
      this.line(i2, o2, dashed);
      if (!horizon) {
        // Short ticks at the outer ends pointing toward the horizon.
        const tick = (o: ScreenPoint, i: ScreenPoint) => {
          const dx = o.x - i.x;
          const dy = o.y - i.y;
          const len = Math.hypot(dx, dy) || 1;
          // Perpendicular, toward the horizon side: down on screen for positive pitch.
          const sign = p > 0 ? 1 : -1;
          const nx = (-dy / len) * 8 * sign;
          const ny = (dx / len) * 8 * sign;
          const end = o.x < i.x ? { x: o.x - nx, y: o.y - ny } : { x: o.x + nx, y: o.y + ny };
          this.line(o, end);
        };
        tick(o1, i1);
        tick(o2, i2);
        const label = String(Math.abs(p));
        this.text(label, o1.x - 6, o1.y, 'right');
        this.text(label, o2.x + 6, o2.y, 'left');
      }
    }
    ctx.restore();
  }

  private drawBoresight(d: HudData, vp: Viewport): void {
    const p = projectDirection(d.boresight, d.pose, vp);
    if (!p.visible) return;
    const s = 6;
    this.line({ x: p.x - s * 2, y: p.y }, { x: p.x - s, y: p.y });
    this.line({ x: p.x + s, y: p.y }, { x: p.x + s * 2, y: p.y });
    this.line({ x: p.x, y: p.y - s * 2 }, { x: p.x, y: p.y - s });
    this.ctx.beginPath();
    this.ctx.arc(p.x, p.y, 1.5, 0, Math.PI * 2);
    this.ctx.fill();
  }

  private drawFlightPath(d: HudData, vp: Viewport): void {
    const { ctx } = this;
    const raw = projectDirection(d.flightPath, d.pose, vp);
    const p = clampToEdge(raw, vp, 40);
    const r = 9;
    ctx.setLineDash(p.clamped ? [4, 4] : []);
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    this.line({ x: p.x - r, y: p.y }, { x: p.x - r * 2.4, y: p.y });
    this.line({ x: p.x + r, y: p.y }, { x: p.x + r * 2.4, y: p.y });
    this.line({ x: p.x, y: p.y - r }, { x: p.x, y: p.y - r * 2 });
    if (p.clamped) this.arrow({ x: p.x, y: p.y }, p.angle, 7);

    // AoA bracket beside the marker: fill shows how much of the limiter is used.
    const bh = 44;
    const bx = p.x - r * 4.2;
    const top = p.y - bh / 2;
    this.line({ x: bx, y: top }, { x: bx, y: top + bh });
    this.line({ x: bx, y: top }, { x: bx + 5, y: top });
    this.line({ x: bx, y: top + bh }, { x: bx + 5, y: top + bh });
    const frac = aoaFraction(d.angleOfAttack, d.maxAngleOfAttack);
    const my = top + bh - frac * bh;
    this.line({ x: bx - 6, y: my }, { x: bx + 6, y: my });
  }

  private drawTarget(d: HudData, vp: Viewport): void {
    const t = d.target;
    if (!t) return;
    const raw = projectDirection(t.direction, d.pose, vp);
    const p = clampToEdge(raw, vp, 50);
    const s = 14;
    this.ctx.setLineDash(t.locked ? [] : [5, 4]);
    this.ctx.strokeRect(p.x - s, p.y - s, s * 2, s * 2);
    this.ctx.setLineDash([]);
    if (p.clamped) this.arrow({ x: p.x, y: p.y }, p.angle, 8);
    const range =
      d.units === 'imperial'
        ? `${(t.range / 1852).toFixed(1)} nm`
        : `${(t.range / 1000).toFixed(1)} km`;
    const closure = speedFor(t.closure, d.units);
    this.font(0.9);
    this.text(`${t.label ?? ''} ${range}`.trim(), p.x + s + 6, p.y - 8);
    this.text(
      `${closure.value >= 0 ? '+' : ''}${closure.value.toFixed(0)} ${closure.unit}`,
      p.x + s + 6,
      p.y + 8,
    );
    if (t.locked) this.text('LOCK', p.x, p.y - s - 8, 'center');
  }

  // ---- tapes --------------------------------------------------------------

  private drawHeadingTape(d: HudData): void {
    const { width: w, height: h } = this;
    const cx = w / 2;
    const y = h * 0.075;
    const halfExtent = w * 0.17;
    const pxPerDeg = halfExtent / 30;
    const hdg = toDegrees(d.heading);
    this.font(0.9);
    this.line({ x: cx - halfExtent, y }, { x: cx + halfExtent, y });
    for (const t of tapeTicks(hdg, pxPerDeg, 5, 10, halfExtent, 360)) {
      const x = cx + t.offset;
      const len = t.major ? 10 : 5;
      this.line({ x, y }, { x, y: y + len });
      if (t.major) {
        const v = Math.round(t.value) % 360;
        this.text(String(Math.round(v / 10)).padStart(2, '0'), x, y + 22, 'center');
      }
    }
    if (d.waypointHeading !== undefined) {
      let diff = ((d.waypointHeading - hdg + 540) % 360) - 180;
      diff = Math.max(-30, Math.min(30, diff));
      const x = cx + diff * pxPerDeg;
      this.arrow({ x, y: y - 6 }, -Math.PI / 2, 6);
    }
    // Current heading box with caret.
    this.arrow({ x: cx, y: y - 4 }, -Math.PI / 2, 6);
    this.font(1.1);
    const label = String(headingDegrees(d.heading)).padStart(3, '0');
    this.box(cx - 24, y - 34, 48, 22, true);
    this.text(label, cx, y - 23, 'center');
  }

  private verticalTape(
    x: number,
    value: number,
    unit: string,
    minor: number,
    major: number,
    windowHalf: number,
    labelsLeft: boolean,
  ): void {
    const { height: h } = this;
    const cy = h / 2;
    const halfExtent = h * 0.22;
    const pxPerUnit = halfExtent / windowHalf;
    const dir = labelsLeft ? -1 : 1;
    this.font(0.9);
    this.line({ x, y: cy - halfExtent }, { x, y: cy + halfExtent });
    for (const t of tapeTicks(value, pxPerUnit, minor, major, halfExtent)) {
      const y = cy - t.offset;
      const len = t.major ? 10 : 5;
      this.line({ x, y }, { x: x + dir * len, y });
      if (t.major)
        this.text(String(Math.round(t.value)), x + dir * 14, y, labelsLeft ? 'right' : 'left');
    }
    // Current value box with pointer.
    this.font(1.1);
    const bw = 66;
    const bx = labelsLeft ? x + 8 : x - 8 - bw;
    this.box(bx, cy - 12, bw, 24, true);
    this.arrow({ x: x + dir * -2, y: cy }, labelsLeft ? Math.PI : 0, 5);
    this.text(String(Math.round(value)), bx + bw / 2, cy, 'center');
    this.font(0.8);
    this.text(unit, x + dir * -8, cy - halfExtent - 12, labelsLeft ? 'left' : 'right');
  }

  private drawAirspeedTape(d: HudData): void {
    const { width: w, height: h } = this;
    const x = w / 2 - w * 0.3;
    const spd = speedFor(d.airspeed, d.units);
    const [minor, major] = speedTicks(d.units);
    this.verticalTape(
      x,
      spd.value,
      spd.unit,
      minor,
      major,
      d.units === 'imperial' ? 100 : 50,
      true,
    );
    const cy = h / 2;
    const y0 = cy + h * 0.22 + 22;
    this.font(1);
    this.text(`M ${d.mach.toFixed(2)}`, x - 40, y0, 'left');
    this.text(`G ${d.loadFactor.toFixed(1)}`, x - 40, y0 + 20, 'left');
    this.text(`MAX ${d.peakLoadFactor.toFixed(1)}`, x - 40, y0 + 40, 'left');
    this.text(`AOA ${toDegrees(d.angleOfAttack).toFixed(1)}°`, x - 40, y0 + 60, 'left');
  }

  private drawAltitudeTape(d: HudData): void {
    const { width: w, height: h } = this;
    const x = w / 2 + w * 0.3;
    const alt = altitudeFor(d.altitude, d.units);
    const [minor, major] = altitudeTicks(d.units);
    this.verticalTape(
      x,
      alt.value,
      alt.unit,
      minor,
      major,
      d.units === 'imperial' ? 1000 : 300,
      false,
    );
    const cy = h / 2;
    const y0 = cy + h * 0.22 + 22;
    this.font(1);
    if (d.agl < this.cfg.radarAltitudeBelow) {
      const r = altitudeFor(Math.max(0, d.agl), d.units);
      this.text(`R ${Math.round(r.value)}`, x + 40, y0, 'right');
    }
    const vs = verticalSpeedFor(d.verticalSpeed, d.units);
    const vsText = d.units === 'imperial' ? Math.round(vs.value / 10) * 10 : vs.value.toFixed(1);
    this.text(`VS ${vs.value >= 0 ? '+' : ''}${vsText}`, x + 40, y0 + 20, 'right');
  }

  // ---- fixed readouts ----------------------------------------------------

  private drawEngineAndFuel(d: HudData): void {
    const { width: w, height: h } = this;
    const x = w * 0.06;
    const y = h * 0.86;
    this.font(1);
    this.text(
      `THR ${Math.round(d.throttle * 100)
        .toString()
        .padStart(3)}%${d.afterburner ? '  AB' : ''}`,
      x,
      y,
    );
    const fuel = massFor(d.fuel, d.units);
    this.text(`FUEL ${Math.round(fuel.value)} ${fuel.unit}`, x, y + 22);
    const bw = w * 0.12;
    const frac = d.fuelCapacity > 0 ? Math.max(0, Math.min(1, d.fuel / d.fuelCapacity)) : 0;
    this.box(x, y + 36, bw, 6);
    this.ctx.fillRect(x, y + 36, bw * frac, 6);
  }

  private drawConfigIndicators(d: HudData): void {
    const { width: w, height: h } = this;
    const cx = w / 2;
    const y = h * 0.86;
    this.font(1);
    const items: { label: string; flash: boolean }[] = [];
    if (d.gear > 0.01) items.push({ label: 'GEAR', flash: d.gear < 0.99 });
    if (d.airbrake) items.push({ label: 'AIRBRAKE', flash: false });
    if (d.brakes) items.push({ label: 'BRAKES', flash: false });
    const gap = 14;
    const widths = items.map((i) => this.ctx.measureText(i.label).width + 16);
    const total = widths.reduce((a, b) => a + b, 0) + gap * Math.max(0, items.length - 1);
    let x = cx - total / 2;
    items.forEach((item, i) => {
      const bw = widths[i] ?? 0;
      if (!item.flash || flashOn(d.time, this.cfg.flashHz)) {
        this.box(x, y - 12, bw, 24);
        this.text(item.label, x + bw / 2, y, 'center');
      }
      x += bw + gap;
    });
  }

  private drawCorners(d: HudData): void {
    const { width: w, height: h } = this;
    this.font(0.9);
    this.text(`cam ${d.cameraMode}   ${d.units}`, w - 16, 16, 'right', 'top');
    this.text('` help', w - 44, h - 14, 'right', 'bottom');
    if (d.weapon) this.text(d.weapon, w - 16, h - 36, 'right', 'bottom');
  }

  private drawWarnings(d: HudData): void {
    if (d.warnings.length === 0 || d.status === 'crashed') return;
    if (!flashOn(d.time, this.cfg.flashHz)) return;
    const { ctx, width: w, height: h } = this;
    ctx.save();
    ctx.fillStyle = WARNING_COLOR;
    this.font(1.5, 'bold');
    let y = h / 2 + h * 0.17;
    for (const label of d.warnings) {
      this.text(label, w / 2, y, 'center');
      y += this.cfg.fontSize * 1.8;
    }
    ctx.restore();
  }

  private drawStatus(d: HudData): void {
    const { ctx, width: w, height: h } = this;
    const cx = w / 2;
    if (d.status === 'crashed') {
      ctx.save();
      ctx.fillStyle = CRASH_COLOR;
      this.font(2.4, 'bold');
      this.text('CRASHED', cx, h * 0.4, 'center');
      this.font(1.2);
      this.text(d.crashReason ?? 'impact', cx, h * 0.4 + 40, 'center');
      this.text('press R to reset', cx, h * 0.4 + 66, 'center');
      ctx.restore();
      return;
    }
    this.font(1.1, 'bold');
    if (d.paused) this.text('PAUSED', cx, h * 0.16, 'center');
    else if (d.timeScale !== 1) this.text(`TIME x${d.timeScale}`, cx, h * 0.16, 'center');
    if (d.status === 'ground') {
      this.font(0.9);
      this.text('ON GROUND', cx, h * 0.19, 'center');
    }
  }
}
