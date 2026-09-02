import {
  EllipsoidTerrainProvider,
  ImageryLayer,
  Ion,
  OpenStreetMapImageryProvider,
  Terrain,
  type TerrainProvider,
  Viewer,
} from 'cesium';
import type { AppConfig } from './config';

export interface World {
  viewer: Viewer;
  /** Resolves once the terrain provider is ready to be sampled. */
  terrainReady: Promise<TerrainProvider>;
}

/**
 * Creates the Cesium world viewer.
 *
 * With an Ion token we get Cesium World Terrain and Bing/Ion imagery.
 * Without one we fall back to OpenStreetMap tiles on a smooth ellipsoid so
 * the globe still renders for anyone who clones the repo.
 *
 * The viewer is set up as a simulator canvas, not a map: the stock navigation
 * widgets and mouse camera controls are disabled so only the simulation moves
 * the camera.
 */
export function createViewer(container: HTMLElement, config: AppConfig): World {
  const tokenFree = config.ionToken === null;

  if (!tokenFree) {
    Ion.defaultAccessToken = config.ionToken as string;
  }

  const baseOptions: Viewer.ConstructorOptions = {
    animation: false,
    timeline: false,
    baseLayerPicker: false,
    geocoder: false,
    homeButton: false,
    sceneModePicker: false,
    navigationHelpButton: false,
    fullscreenButton: true,
    selectionIndicator: false,
    infoBox: false,
  };

  let viewer: Viewer;
  let terrainReady: Promise<TerrainProvider>;

  if (tokenFree) {
    const terrainProvider = new EllipsoidTerrainProvider();
    viewer = new Viewer(container, {
      ...baseOptions,
      baseLayer: new ImageryLayer(
        new OpenStreetMapImageryProvider({ url: 'https://tile.openstreetmap.org/' }),
      ),
      terrainProvider,
    });
    terrainReady = Promise.resolve(terrainProvider);
    console.info(
      '[airium] VITE_CESIUM_ION_TOKEN not set; using OpenStreetMap imagery and ellipsoid terrain.',
    );
  } else {
    const terrain = Terrain.fromWorldTerrain();
    viewer = new Viewer(container, { ...baseOptions, terrain });
    terrainReady = new Promise((resolve, reject) => {
      terrain.readyEvent.addEventListener((provider) => resolve(provider));
      terrain.errorEvent.addEventListener((error) => reject(error));
    });
  }

  // The simulation owns the camera; disable mouse/touch camera navigation.
  viewer.scene.screenSpaceCameraController.enableInputs = false;

  return { viewer, terrainReady };
}
