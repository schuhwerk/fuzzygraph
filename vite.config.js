import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// The app builds to one self-contained dist/index.html that also runs offline.
// Files in public/ (examples gallery) are copied next to it.
export default defineConfig({
  base: './',
  plugins: [tailwindcss(), viteSingleFile({ removeViteModuleLoader: true })],
  build: { chunkSizeWarningLimit: 4096 },
});
