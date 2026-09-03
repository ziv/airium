import {
  EllipsoidTerrainProvider,
  ImageryLayer,
  Ion,
  OpenStreetMapImageryProvider,
  Terrain,
  type TerrainProvider,
  Viewer,
} from 'cesium';

export interface World {
  viewer: Viewer;
  /** Resolves once the terrain provider is ready to be sampled. */
  terrainReady: Promise<TerrainProvider>;
}

/** Switches a viewer to OpenStreetMap imagery on a smooth ellipsoid. */
function useTokenFreeWorld(viewer: Viewer): TerrainProvider {
  const terrainProvider = new EllipsoidTerrainProvider();
  viewer.scene.terrainProvider = terrainProvider;
  viewer.imageryLayers.removeAll();
  viewer.imageryLayers.add(
    new ImageryLayer(new OpenStreetMapImageryProvider({ url: 'https://tile.openstreetmap.org/' })),
  );
  return terrainProvider;
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
export function createViewer(container: HTMLElement, ionToken: string | null): World {
  const tokenFree = ionToken === null;

  if (ionToken !== null) {
    Ion.defaultAccessToken = ionToken;
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
      '[airium] no ion.token in start.config.json; using OpenStreetMap imagery and ellipsoid terrain.',
    );
  } else {
    const terrain = Terrain.fromWorldTerrain();
    viewer = new Viewer(container, { ...baseOptions, terrain });
    const v = viewer;
    terrainReady = new Promise((resolve) => {
      terrain.readyEvent.addEventListener((provider) => resolve(provider));
      terrain.errorEvent.addEventListener((error) => {
        // Typically a 403: the token is not valid for this origin. Keep flying token-free.
        console.warn(
          '[airium] Cesium Ion rejected the token (is this origin allowed for it?); falling back to OpenStreetMap imagery and ellipsoid terrain.',
          error,
        );
        resolve(useTokenFreeWorld(v));
      });
    });
  }

  // The simulation owns the camera; disable mouse/touch camera navigation.
  viewer.scene.screenSpaceCameraController.enableInputs = false;

  return { viewer, terrainReady };
}
