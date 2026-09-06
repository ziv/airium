import { Cartographic, sampleTerrainMostDetailed, type TerrainProvider, type Viewer } from 'cesium';

/**
 * Returns the terrain surface height (metres above the WGS84 ellipsoid) at a
 * point. Providers without tile availability (the plain ellipsoid) have no
 * relief, so the ground is at 0. A failed sample also falls back to 0 with a
 * warning rather than leaving the aircraft unplaced.
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

/** Terrain heights outside this range (metres) are treated as not-yet-loaded garbage. */
const MIN_PLAUSIBLE_GROUND = -500;
const MAX_PLAUSIBLE_GROUND = 9_000;

/**
 * Synchronous terrain height under a point from the currently loaded tiles,
 * or undefined when it cannot be trusted. Cheap enough to call per frame.
 *
 * `globe.getHeight` happily answers from coarse or partially loaded tiles
 * (we have seen -72 km and +1600 m over a 670 m valley), so the value is only
 * used once the globe reports all its tiles loaded and it is physically
 * plausible. Callers fall back to the last known ground height otherwise.
 */
export function loadedGroundHeight(viewer: Viewer, lat: number, lon: number): number | undefined {
  if (!viewer.scene.globe.tilesLoaded) return undefined;
  const h = viewer.scene.globe.getHeight(Cartographic.fromDegrees(lon, lat));
  if (h === undefined || !Number.isFinite(h)) return undefined;
  return h >= MIN_PLAUSIBLE_GROUND && h <= MAX_PLAUSIBLE_GROUND ? h : undefined;
}
