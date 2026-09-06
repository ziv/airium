/**
 * Applies the `graphics` configuration to the Cesium scene: quality presets,
 * settings that keep terrain and models stable at jet speeds, time of day
 * and the optional OSM Buildings layer.
 */
import { type Cesium3DTileset, JulianDate, createOsmBuildingsAsync, type Viewer } from 'cesium';
import type { GraphicsPreset } from '../sim/sim-config';

export function applyGraphicsPreset(viewer: Viewer, preset: GraphicsPreset): void {
  const { scene } = viewer;
  const { globe } = scene;
  globe.maximumScreenSpaceError = preset.maximumScreenSpaceError;
  globe.tileCacheSize = preset.tileCacheSize;
  globe.preloadSiblings = preset.preloadTiles;
  globe.preloadAncestors = preset.preloadTiles;
  globe.enableLighting = preset.lighting;
  globe.showGroundAtmosphere = preset.atmosphere;
  if (scene.skyAtmosphere) scene.skyAtmosphere.show = preset.atmosphere;
  scene.fog.enabled = preset.fog;
  scene.msaaSamples = preset.msaaSamples;
  scene.postProcessStages.fxaa.enabled = preset.fxaa;
  viewer.resolutionScale = preset.resolutionScale;
}

/** Settings that are the same for every preset. */
export function tuneForFlight(viewer: Viewer): void {
  const { scene } = viewer;
  // Render every frame; the simulation moves the camera continuously.
  scene.requestRenderMode = false;
  viewer.targetFrameRate = 60;
  // Models and the camera must not show through hills.
  scene.globe.depthTestAgainstTerrain = true;
  // Keep the ground drawn right under the aircraft when it is on the runway.
  scene.globe.backFaceCulling = true;
  scene.logarithmicDepthBuffer = true;
}

/**
 * Sets the scene clock (sun position and lighting) to the given ISO 8601
 * instant, or to now when blank, and lets it run at real time.
 */
export function setTimeOfDay(viewer: Viewer, iso: string): void {
  const { clock } = viewer;
  const trimmed = iso.trim();
  if (trimmed.length > 0) {
    try {
      clock.currentTime = JulianDate.fromIso8601(trimmed);
    } catch (error) {
      console.warn(
        `[airium] start.time "${trimmed}" is not a valid ISO 8601 date; using now`,
        error,
      );
      clock.currentTime = JulianDate.now();
    }
  } else {
    clock.currentTime = JulianDate.now();
  }
  clock.multiplier = 1;
  clock.shouldAnimate = true;
}

/** Cesium OSM Buildings, loaded on first use. Needs an Ion token. */
export class Buildings {
  private tileset: Cesium3DTileset | null = null;
  private loading: Promise<void> | null = null;
  private wanted: boolean;

  constructor(
    private readonly viewer: Viewer,
    initiallyOn: boolean,
    private readonly available: boolean,
  ) {
    this.wanted = initiallyOn && available;
    if (this.wanted) void this.load();
  }

  get enabled(): boolean {
    return this.wanted;
  }

  /** Flips the layer; returns the new state (always false without a token). */
  toggle(): boolean {
    if (!this.available) {
      console.info('[airium] OSM Buildings need a Cesium Ion token');
      return false;
    }
    this.wanted = !this.wanted;
    if (this.tileset) this.tileset.show = this.wanted;
    else if (this.wanted) void this.load();
    return this.wanted;
  }

  private load(): Promise<void> {
    if (this.loading) return this.loading;
    this.loading = createOsmBuildingsAsync()
      .then((tileset) => {
        this.tileset = tileset;
        tileset.show = this.wanted;
        this.viewer.scene.primitives.add(tileset);
      })
      .catch((error: unknown) => {
        console.warn('[airium] could not load OSM Buildings', error);
        this.wanted = false;
        this.loading = null;
      });
    return this.loading;
  }
}
