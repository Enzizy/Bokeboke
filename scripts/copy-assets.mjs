/**
 * Copies just the model folders the game actually loads into the built client, so `client/dist`
 * is a self-contained upload. The packs also ship FBX and OBJ duplicates of everything, which
 * would triple the size of the download for files nothing ever opens.
 *
 * The layout has to match what `assetPaths.ts` asks for: Vite serves `assets/` at the site root
 * during development, so `dist/` needs the same folders at its own root.
 */
import { cp, mkdir, readdir, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const from = join(root, 'assets');
const to = join(root, 'client', 'dist');

/** Every folder a pack needs: the models, and the texture atlas they reference as a sibling. */
const FOLDERS = [
  'characters/mini-characters/Models/GLB format',
  'maps/arena/Models/GLB format',
  'weapons/KayKit_FantasyWeaponsBits_1.0_FREE/Assets/gltf',
];

async function sizeOf(path) {
  let total = 0;
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const full = join(path, entry.name);
    total += entry.isDirectory() ? await sizeOf(full) : (await stat(full)).size;
  }
  return total;
}

await mkdir(to, { recursive: true });
let copied = 0;
for (const folder of FOLDERS) {
  const source = join(from, folder);
  await cp(source, join(to, folder), { recursive: true });
  copied += await sizeOf(source);
}
console.log(`copied ${(copied / 1024 / 1024).toFixed(1)} MB of models into client/dist`);
