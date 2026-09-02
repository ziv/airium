import {
  Cartesian3,
  Cartographic,
  Math as CesiumMath,
  PerspectiveFrustum,
  sampleTerrainMostDetailed,
  type TerrainProvider,
  type Viewer,
} from 'cesium';
import type { StartConfig } from './start-config';

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

/** Converts a height above ground into a height above the ellipsoid. */
export function toEllipsoidHeight(groundHeight: number, heightAboveGround: number): number {
  return groundHeight + heightAboveGround;
}

/**
 * Places the camera at (lat, lon) and `config.height` metres above the terrain,
 * looking along `heading` with the nose level (pitch 0, roll 0) and the
 * configured vertical field of view.
 *
 * The camera is placed immediately using the ellipsoid as a provisional ground
 * so the start area is visible while terrain loads, then corrected once the
 * real ground height is known. Resolves with the ellipsoid height used.
 */
export async function applyStartConfig(
  viewer: Viewer,
  config: StartConfig,
  terrainReady: Promise<TerrainProvider>,
): Promise<number> {
  const { camera } = viewer;

  if (camera.frustum instanceof PerspectiveFrustum) {
    camera.frustum.fov = CesiumMath.toRadians(config.fov);
  }

  const place = (ellipsoidHeight: number) =>
    camera.setView({
      destination: Cartesian3.fromDegrees(config.lon, config.lat, ellipsoidHeight),
      orientation: {
        heading: CesiumMath.toRadians(config.heading),
        pitch: 0,
        roll: 0,
      },
    });

  place(toEllipsoidHeight(0, config.height));

  const provider = await terrainReady;
  const ground = await sampleGroundHeight(provider, config.lat, config.lon);
  const ellipsoidHeight = toEllipsoidHeight(ground, config.height);
  place(ellipsoidHeight);
  return ellipsoidHeight;
}
