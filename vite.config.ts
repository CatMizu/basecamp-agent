import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { resolve } from 'node:path';

export default defineConfig({
  plugins: [viteSingleFile()],
  root: resolve(__dirname, 'src/modules/mcp/ui/my-plate'),
  build: {
    outDir: resolve(__dirname, 'dist/ui'),
    emptyOutDir: false,
    rollupOptions: {
      input: resolve(__dirname, 'src/modules/mcp/ui/my-plate/my-plate.html'),
    },
  },
});
