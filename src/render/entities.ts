/**
 * Draws the world's entities: glTF models when close to the player, faction
 * coloured points when far or for projectiles. Primitives are pooled and
 * reused across entity lifetimes, and wrecks disappear when the world
 * removes them.
 */
import {
  Cartesian3,
  Color,
  Matrix4,
  Model,
  NearFarScalar,
  PointPrimitive,
  PointPrimitiveCollection,
  type Viewer,
} from 'cesium';
import type { Entity, Faction } from '../sim/entities';
import { enuOffset } from '../sim/geo';
import { length } from '../sim/math3d';
import type { World } from '../sim/world';
import { aircraftPosition, enuFrame, modelMatrix } from './frames';

export interface ModelSource {
  uri: string;
  scale: number;
}

/** Which model an entity is drawn with, or null for a point only. */
export type ModelLookup = (entity: Entity) => ModelSource | null;

const FACTION_COLORS: Record<Faction, Color> = {
  player: Color.WHITE,
  friendly: Color.fromCssColorString('#4da3ff'),
  hostile: Color.fromCssColorString('#ff4d4d'),
  neutral: Color.fromCssColorString('#e0e0e0'),
};

const WRECK_COLOR = Color.fromCssColorString('#808080');
const scratchPosition = new Cartesian3();
const PROJECTILE_COLOR = Color.fromCssColorString('#ffe066');

interface Slot {
  point: PointPrimitive;
  model: Model | null;
  /** URI the model was requested for, so a type change reloads it. */
  modelUri: string | null;
  loading: boolean;
}

export class EntityRenderer {
  private readonly points: PointPrimitiveCollection;
  private readonly slots = new Map<string, Slot>();
  private readonly freePoints: PointPrimitive[] = [];
  private readonly freeModels = new Map<string, Model[]>();
  private readonly position = new Cartesian3();
  private readonly frame = new Matrix4();
  private readonly matrix = new Matrix4();

  constructor(
    private readonly viewer: Viewer,
    private readonly lodDistance: number,
    private readonly modelFor: ModelLookup,
  ) {
    this.points = viewer.scene.primitives.add(new PointPrimitiveCollection());
  }

  /** Syncs the scene with the world. `player` is the entity distances are measured from. */
  update(world: World, playerId: string, earthRadius: number): void {
    const player = world.get(playerId);
    const seen = new Set<string>();
    for (const e of world.entities) {
      const isProjectile = e.kind === 'bullet' || e.kind === 'missile';
      if (e.id === playerId) continue;
      if (isProjectile && !e.alive) continue;
      seen.add(e.id);
      const slot = this.slotFor(e);
      const distance = player ? length(enuOffset(player, e, earthRadius)) : Infinity;
      const source = this.modelFor(e);
      const wantModel = source !== null && distance < this.lodDistance;
      this.syncPoint(slot, e, !wantModel || slot.model === null);
      if (wantModel) this.syncModel(slot, e, source);
      else if (slot.model) slot.model.show = false;
    }
    for (const [id, slot] of this.slots) {
      if (!seen.has(id)) {
        this.release(slot);
        this.slots.delete(id);
      }
    }
  }

  private slotFor(e: Entity): Slot {
    let slot = this.slots.get(e.id);
    if (!slot) {
      const point = this.freePoints.pop() ?? this.points.add({});
      slot = { point, model: null, modelUri: null, loading: false };
      this.slots.set(e.id, slot);
    }
    return slot;
  }

  private syncPoint(slot: Slot, e: Entity, show: boolean): void {
    const p = slot.point;
    p.show = show;
    if (!show) return;
    // The setter clones and marks the point dirty; writing into its Cartesian would not.
    p.position = Cartesian3.fromDegrees(e.lon, e.lat, e.height, undefined, scratchPosition);
    const isProjectile = e.kind === 'bullet' || e.kind === 'missile';
    p.color = !e.alive ? WRECK_COLOR : isProjectile ? PROJECTILE_COLOR : FACTION_COLORS[e.faction];
    p.pixelSize = e.kind === 'waypoint' ? 6 : isProjectile ? 3 : 8;
    p.outlineColor = Color.BLACK;
    p.outlineWidth = e.kind === 'waypoint' ? 1 : 2;
    p.scaleByDistance = new NearFarScalar(1_000, 1.3, 60_000, 0.6);
    p.disableDepthTestDistance = e.kind === 'waypoint' ? Number.POSITIVE_INFINITY : 0;
  }

  private syncModel(slot: Slot, e: Entity, source: ModelSource): void {
    if (slot.model && slot.modelUri === source.uri) {
      this.placeModel(slot.model, e);
      slot.model.show = true;
      return;
    }
    if (slot.loading) return;
    const pooled = this.freeModels.get(source.uri)?.pop();
    if (pooled) {
      slot.model = pooled;
      slot.modelUri = source.uri;
      this.placeModel(pooled, e);
      pooled.show = true;
      return;
    }
    slot.loading = true;
    const url = `${import.meta.env.BASE_URL}${source.uri}`;
    Model.fromGltfAsync({ url, scale: source.scale })
      .then((model) => {
        this.viewer.scene.primitives.add(model);
        slot.model = model;
        slot.modelUri = source.uri;
        slot.loading = false;
        model.show = false; // positioned on the next update
      })
      .catch((error: unknown) => {
        slot.loading = false;
        console.warn(`[airium] could not load model ${url}`, error);
      });
  }

  private placeModel(model: Model, e: Entity): void {
    Cartesian3.fromDegrees(e.lon, e.lat, e.height, undefined, this.position);
    enuFrame(this.position, this.frame);
    modelMatrix(this.frame, e.attitude, this.matrix);
    model.modelMatrix = Matrix4.clone(this.matrix, model.modelMatrix);
  }

  private release(slot: Slot): void {
    slot.point.show = false;
    this.freePoints.push(slot.point);
    if (slot.model && slot.modelUri) {
      slot.model.show = false;
      const pool = this.freeModels.get(slot.modelUri) ?? [];
      pool.push(slot.model);
      this.freeModels.set(slot.modelUri, pool);
    }
  }

  /** Number of live slots, for the debug panel. */
  get count(): number {
    return this.slots.size;
  }
}

// Keep the import used for entity positions consistent with the own-aircraft path.
export { aircraftPosition };
