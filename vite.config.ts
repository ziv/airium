import { defineConfig } from 'vitest/config';
import cesium from 'vite-plugin-cesium';

export default defineConfig({
  plugins: [cesium()],
  test: {
    include: ['src/**/*.test.ts'],
  },
});
