import {
  Cartesian3,
  Cartographic,
  Math as CesiumMath,
  PerspectiveFrustum,
  sampleTerrainMostDetailed,
  type TerrainProvider,
  type Viewer,
} from 'cesium';
import { hprFromAttitude } from './attitude';
import type { AircraftState } from './physics';

/**
 * Returns the terrain surface height (metres above the WGS84 ellipsoid) at a
 * point. Providers without tile availability (the plain ellipsoid) have no
 * relief, so the ground is at 0. A failed sample also falls back to 0 with a
 * warning rather than leaving the camera unplaced.
 */
export async function sampleGroundHeight(
  terrainProvider: TerrainProvider,
  lat: number,
  lon: number,
): Promise<number> {
  if (!terrainProvider.availability) {
    return 0;
  }
  try {
    const [sample] = await sampleTerrainMostDetailed(terrainProvider, [
      Cartographic.fromDegrees(lon, lat),
    ]);
    if (sample && Number.isFinite(sample.height)) {
      return sample.height;
    }
  } catch (error) {
    console.warn('[airium] terrain sampling failed, assuming ground at 0 m', error);
  }
  return 0;
}

/**
 * Synchronous terrain height under a point from the currently loaded tiles,
 * or undefined if that area is not loaded yet. Cheap enough to call per frame.
 */
export function loadedGroundHeight(viewer: Viewer, lat: number, lon: number): number | undefined {
  const h = viewer.scene.globe.getHeight(Cartographic.fromDegrees(lon, lat));
  return h !== undefined && Number.isFinite(h) ? h : undefined;
}

export function setCameraFov(viewer: Viewer, fovDegrees: number): void {
  if (viewer.camera.frustum instanceof PerspectiveFrustum) {
    viewer.camera.frustum.fov = CesiumMath.toRadians(fovDegrees);
  }
}

/** Cockpit view: the camera sits at the aircraft and shares its attitude. */
export function placeCamera(viewer: Viewer, state: AircraftState): void {
  const { heading, pitch, roll } = hprFromAttitude(state.attitude);
  viewer.camera.setView({
    destination: Cartesian3.fromDegrees(state.lon, state.lat, state.height),
    orientation: { heading, pitch, roll },
  });
}
