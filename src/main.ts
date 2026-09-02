import 'cesium/Build/Cesium/Widgets/widgets.css';
import './style.css';
import { loadConfig } from './config';
import { applyStartConfig } from './sim/camera';
import { resolveStartConfig } from './sim/start-config';
import startJson from './start.config.json';
import { createViewer } from './viewer';

const container = document.getElementById('cesiumContainer');
if (!container) {
  throw new Error('Missing #cesiumContainer element in index.html');
}

const config = loadConfig(import.meta.env);
const start = resolveStartConfig(startJson, window.location.search);

const { viewer, terrainReady } = createViewer(container, config);

applyStartConfig(viewer, start, terrainReady).then((ellipsoidHeight) => {
  console.info('[airium] start', { ...start, ellipsoidHeight });
});
