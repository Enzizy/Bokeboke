export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** Identifiers of the asset packs found in assets/ (see assets/ASSET_INVENTORY.md). */
export type AssetPack =
  | 'characters'
  | 'arena'
  | 'skate'
  | 'arcade'
  | 'market'
  | 'dungeon'
  | 'forest'
  | 'weapons';

/** A model reference: which pack it lives in and its file name without extension. */
export interface ModelRef {
  pack: AssetPack;
  model: string;
}
