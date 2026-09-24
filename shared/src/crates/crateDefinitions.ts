export interface CrateDefinition {
  id: string;
  /** Hits to break, with punch = 1. */
  hp: number;
  /** Half extents of the cube collider. 0.35 makes it about character height. */
  halfSize: number;
  mass: number;
  /** Which DROP_POOLS entry this crate releases from. */
  dropPool: string;
  /** Launch velocity of the ejected weapon: up, plus a random sideways component. */
  ejectUp: number;
  ejectSide: number;
}

export const CRATES: Record<string, CrateDefinition> = {
  standard: { id: 'standard', hp: 5, halfSize: 0.35, mass: 3, dropPool: 'standard', ejectUp: 5.5, ejectSide: 1.5 },
};

export function crateDefinition(id: string): CrateDefinition {
  const def = CRATES[id];
  if (!def) throw new Error(`Unknown crate type "${id}"`);
  return def;
}

/** Spawner settings; a map may override any of them. Prototype values, not final balance. */
export interface CrateSpawnConfig {
  crateType: string;
  /** Seconds after the match starts before the first crate can appear. */
  firstDelay: number;
  /** Seconds between spawns while below maxActive. */
  interval: number;
  maxActive: number;
  /** Extra wait after a crate is destroyed before the next one can appear. */
  cooldownAfterDestroy: number;
  /** Height above the spawn point the crate drops from. */
  dropHeight: number;
}

export const DEFAULT_CRATE_SPAWN: CrateSpawnConfig = {
  crateType: 'standard',
  firstDelay: 4,
  interval: 5,
  maxActive: 3,
  cooldownAfterDestroy: 2,
  dropHeight: 3,
};
