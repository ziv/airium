/** Bounded primitive pools: tracers, missile/rocket smoke, decoys, explosions and wreck smoke. */
import {
  Cartesian3,
  Color,
  Material,
  PointPrimitiveCollection,
  PolylineCollection,
  type PointPrimitive,
  type Polyline,
  type Viewer,
} from 'cesium';
import { isProjectile } from '../sim/entities';
import type { World } from '../sim/world';
import type { Position } from '../weapons/ballistics';

export class CombatRenderer {
  private readonly lines: PolylineCollection;
  private readonly points: PointPrimitiveCollection;
  private readonly trails = new Map<string, Polyline>();
  private readonly particles = new Map<string, PointPrimitive>();
  private readonly freeLines: Polyline[] = [];
  private readonly freePoints: PointPrimitive[] = [];
  constructor(private readonly viewer: Viewer) {
    this.lines = viewer.scene.primitives.add(new PolylineCollection());
    this.points = viewer.scene.primitives.add(new PointPrimitiveCollection());
  }

  update(world: World): void {
    const seenLines = new Set<string>(),
      seenPoints = new Set<string>();
    const particle = (id: string, p: Position, color: Color, metres: number, minPixels = 2) => {
      seenPoints.add(id);
      let point = this.particles.get(id);
      if (!point) {
        point = this.freePoints.pop() ?? this.points.add({});
        this.particles.set(id, point);
      }
      point.show = true;
      point.position = Cartesian3.fromDegrees(p.lon, p.lat, p.height);
      point.color = color;
      const distance = Cartesian3.distance(this.viewer.camera.positionWC, point.position);
      point.pixelSize = Math.max(
        minPixels,
        Math.min(180, (metres * this.viewer.canvas.clientHeight) / Math.max(10, distance)),
      );
      point.outlineWidth = 0;
    };
    for (const e of world.entities) {
      if (isProjectile(e) && e.alive && e.kind !== 'bomb' && e.trail.length > 1) {
        seenLines.add(e.id);
        let line = this.trails.get(e.id);
        if (!line) {
          line = this.freeLines.pop() ?? this.lines.add({ material: Material.fromType('Color') });
          this.trails.set(e.id, line);
        }
        line.show = true;
        line.width = e.kind === 'bullet' ? 2 : 3;
        line.material.uniforms['color'] =
          e.kind === 'bullet' ? Color.YELLOW : Color.WHITE.withAlpha(0.45);
        line.positions = e.trail.map((p) => Cartesian3.fromDegrees(p.lon, p.lat, p.height));
      }
      if (isProjectile(e) || e.kind === 'waypoint') continue;
      const smoking = !e.alive || (e.kind === 'aircraft' && e.health < e.maxHealth * 0.75);
      if (!smoking) continue;
      for (let i = 0; i < 6; i++) {
        const age = (world.time * 0.4 + i / 6) % 1;
        particle(
          `smoke-${e.id}-${i}`,
          { lat: e.lat, lon: e.lon, height: e.height + 5 + age * 100 },
          Color.DIMGRAY.withAlpha((1 - age) * 0.7),
          12 + age * 32,
        );
      }
    }
    for (const effect of world.combat.effects) {
      const age = Math.max(0, Math.min(1, (world.time - effect.started) / effect.duration));
      const explosion = effect.kind === 'explosion';
      const color =
        effect.kind === 'chaff'
          ? Color.LIGHTSKYBLUE
          : effect.kind === 'flare'
            ? Color.YELLOW
            : Color.ORANGE;
      particle(
        `effect-${effect.id}`,
        effect,
        color.withAlpha(1 - age * 0.9),
        effect.radius * (explosion ? 0.3 + age * 2 : 1),
        explosion ? 8 : 5,
      );
      if (explosion) {
        particle(
          `core-${effect.id}`,
          effect,
          Color.LIGHTYELLOW.withAlpha((1 - age) * 0.8),
          effect.radius * 0.4 * (1 - age),
          3,
        );
      }
    }
    for (const [id, line] of this.trails)
      if (!seenLines.has(id)) {
        line.show = false;
        this.freeLines.push(line);
        this.trails.delete(id);
      }
    for (const [id, point] of this.particles)
      if (!seenPoints.has(id)) {
        point.show = false;
        this.freePoints.push(point);
        this.particles.delete(id);
      }
  }
}
