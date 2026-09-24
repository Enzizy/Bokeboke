import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

// The original Kenney packs in /assets are served as-is (no copies). GLB files reference
// their texture as a sibling "Textures/colormap.png", so the folder layout must be preserved.
export default defineConfig({
  // Relative, so the build works served from a subfolder (itch.io) as well as a domain root.
  base: './',
  publicDir: fileURLToPath(new URL('../assets', import.meta.url)),
  resolve: {
    alias: {
      '@shared': fileURLToPath(new URL('../shared/src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    // Listen on every interface so a second machine on the same network can open the game.
    host: true,
    fs: { allow: ['..'] },
  },
  build: {
    // Don't copy the whole assets tree (FBX/OBJ duplicates) into dist. Deployment copies
    // only the "GLB format" folders; see README.
    copyPublicDir: false,
  },
});
