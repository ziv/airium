import {
  Cartesian2,
  Cartesian3,
  Cartographic,
  Color,
  ConstantPositionProperty,
  ImageryLayer,
  Math as CesiumMath,
  OpenStreetMapImageryProvider,
  Rectangle,
  SceneMode,
  ScreenSpaceEventType,
  Viewer,
} from 'cesium';

/** A separate, disposable map: no simulation or flight input is active here. */
export function createLocationMap(
  host: HTMLElement,
  latitude: HTMLInputElement,
  longitude: HTMLInputElement,
): () => void {
  host.innerHTML = `<div class="map-toolbar"><strong>Starting location</strong><button type="button" class="map-world">World</button><button type="button" class="map-center">Center on start</button></div><div class="location-map" aria-label="Starting location map"></div><p class="map-caption">Click to place your start · Drag to pan · Scroll to zoom</p><p class="map-note">Mission entities stay at their configured coordinates.</p>`;
  const canvasHost = host.querySelector<HTMLElement>('.location-map')!;
  let viewer: Viewer;
  try {
    viewer = new Viewer(canvasHost, {
      sceneMode: SceneMode.SCENE2D,
      animation: false,
      timeline: false,
      baseLayerPicker: false,
      geocoder: false,
      homeButton: false,
      sceneModePicker: false,
      navigationHelpButton: false,
      fullscreenButton: false,
      selectionIndicator: false,
      infoBox: false,
      requestRenderMode: true,
      baseLayer: new ImageryLayer(
        new OpenStreetMapImageryProvider({ url: 'https://tile.openstreetmap.org/' }),
      ),
    });
  } catch {
    canvasHost.textContent =
      'Map unavailable. Set the latitude and longitude in flight conditions.';
    return () => {};
  }
  viewer.canvas.setAttribute(
    'aria-label',
    'World map. Click to choose a starting location, or enter latitude and longitude.',
  );
  const caption = host.querySelector<HTMLElement>('.map-caption')!;
  const marker = viewer.entities.add({
    position: Cartesian3.fromDegrees(Number(longitude.value), Number(latitude.value)),
    point: {
      pixelSize: 12,
      color: Color.fromCssColorString('#95e7c8'),
      outlineColor: Color.BLACK,
      outlineWidth: 2,
    },
  });
  const coordinates = () => {
    const lat = latitude.valueAsNumber;
    const lon = longitude.valueAsNumber;
    return Number.isFinite(lat) &&
      Number.isFinite(lon) &&
      Math.abs(lat) <= 90 &&
      Math.abs(lon) <= 180
      ? { lat, lon }
      : null;
  };
  const update = () => {
    const point = coordinates();
    if (!point) return;
    marker.position = new ConstantPositionProperty(Cartesian3.fromDegrees(point.lon, point.lat));
    caption.textContent = `${point.lat.toFixed(5)}°, ${point.lon.toFixed(5)}° · Click to move · Drag / scroll to navigate`;
    viewer.scene.requestRender();
  };
  const center = () => {
    const point = coordinates();
    if (point)
      viewer.camera.setView({ destination: Cartesian3.fromDegrees(point.lon, point.lat, 600_000) });
  };
  viewer.screenSpaceEventHandler.removeInputAction(ScreenSpaceEventType.LEFT_DOUBLE_CLICK);
  viewer.screenSpaceEventHandler.setInputAction((event: { position: Cartesian2 }) => {
    const picked = viewer.camera.pickEllipsoid(event.position, viewer.scene.globe.ellipsoid);
    if (!picked) return;
    const point = Cartographic.fromCartesian(picked);
    latitude.value = CesiumMath.toDegrees(point.latitude).toFixed(6);
    longitude.value = CesiumMath.toDegrees(point.longitude).toFixed(6);
    latitude.dispatchEvent(new Event('input', { bubbles: true }));
    longitude.dispatchEvent(new Event('input', { bubbles: true }));
  }, ScreenSpaceEventType.LEFT_CLICK);
  latitude.addEventListener('input', update);
  longitude.addEventListener('input', update);
  host
    .querySelector('.map-world')!
    .addEventListener('click', () =>
      viewer.camera.setView({ destination: Rectangle.fromDegrees(-180, -85, 180, 85) }),
    );
  host.querySelector('.map-center')!.addEventListener('click', center);
  update();
  center();
  const resize = new ResizeObserver(() => {
    viewer.resize();
    viewer.scene.requestRender();
  });
  resize.observe(canvasHost);
  return () => {
    resize.disconnect();
    latitude.removeEventListener('input', update);
    longitude.removeEventListener('input', update);
    viewer.destroy();
  };
}
