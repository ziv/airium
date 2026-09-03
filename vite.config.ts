import { defineConfig } from 'vitest/config';
import { viteStaticCopy } from 'vite-plugin-static-copy';

/**
 * Public base path. GitHub Pages serves a project site from
 * https://<user>.github.io/<repo>/, so production builds (and `vite preview`,
 * which serves them) are rooted at /airium/ while the dev server stays at /.
 * Override with BASE_PATH (e.g. BASE_PATH=/ for a custom domain, or
 * /my-fork/ for a renamed repository). Vite rewrites every URL in index.html
 * to match, and CESIUM_BASE_URL below follows the same base.
 */
const basePath = (production: boolean): string =>
  process.env['BASE_PATH'] ?? (production ? '/airium/' : '/');

const cesiumSource = 'node_modules/cesium/Build/Cesium';

export default defineConfig(({ command, isPreview }) => {
  const base = basePath(command === 'build' || isPreview === true);
  return {
    base,
    define: {
      // Cesium loads its Workers, Assets and Widgets from here at runtime.
      CESIUM_BASE_URL: JSON.stringify(`${base}cesium/`),
    },
    plugins: [
      // Cesium's runtime files are not importable modules; ship them as static files.
      viteStaticCopy({
        targets: [
          {
            src: `${cesiumSource}/{Workers,ThirdParty,Assets,Widgets}/**`,
            dest: 'cesium',
            // Drop the node_modules/cesium/Build/Cesium prefix so files land in dist/cesium/<dir>/.
            rename: { stripBase: cesiumSource.split('/').length },
          },
        ],
      }),
    ],
    test: {
      include: ['src/**/*.test.ts'],
    },
  };
});
