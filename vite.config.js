import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// The app builds to one self-contained docs/index.html that also runs offline.
// Files in public/ (examples gallery) are copied next to it.
// docs/ is committed and served by GitHub Pages (main branch, /docs folder).
export default defineConfig({
  base: './',
  plugins: [tailwindcss(), viteSingleFile({ removeViteModuleLoader: true })],
  build: { outDir: 'docs', chunkSizeWarningLimit: 4096 },
});
