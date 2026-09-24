import type { AssetPack, ModelRef } from '@shared/types';

/** Where a pack keeps its models, relative to /assets (served by Vite as the site root). */
interface PackLayout {
  dir: string;
  modelDir: string;
  ext: 'glb' | 'gltf';
}

/**
 * Folder names come straight from the downloaded packs and are never renamed.
 * Kenney packs ship GLB (texture referenced as a sibling "Textures/colormap.png");
 * KayKit ships glTF + .bin + one texture in the same folder. Both load with GLTFLoader.
 */
const PACKS: Record<AssetPack, PackLayout> = {
  characters: { dir: 'characters/mini-characters', modelDir: 'Models/GLB format', ext: 'glb' },
  arena: { dir: 'maps/arena', modelDir: 'Models/GLB format', ext: 'glb' },
  skate: { dir: 'maps/skate', modelDir: 'Models/GLB format', ext: 'glb' },
  arcade: { dir: 'maps/arcade', modelDir: 'Models/GLB format', ext: 'glb' },
  market: { dir: 'maps/market', modelDir: 'Models/GLB format', ext: 'glb' },
  dungeon: { dir: 'maps/dungeon', modelDir: 'Models/GLB format', ext: 'glb' },
  forest: { dir: 'maps/forest', modelDir: 'Models/GLB format', ext: 'glb' },
  weapons: { dir: 'weapons/KayKit_FantasyWeaponsBits_1.0_FREE', modelDir: 'Assets/gltf', ext: 'gltf' },
};

export function modelUrl(ref: ModelRef): string {
  const pack = PACKS[ref.pack];
  const path = `${pack.dir}/${pack.modelDir}/${ref.model}.${pack.ext}`;
  // No leading slash: the game may be served from a subfolder, and an absolute path would
  // look for the models at the root of whatever domain is hosting it.
  return path.split('/').map(encodeURIComponent).join('/');
}

export function characterRef(model: string): ModelRef {
  return { pack: 'characters', model };
}

export function weaponRef(model: string): ModelRef {
  return { pack: 'weapons', model };
}
