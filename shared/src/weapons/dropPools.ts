/**
 * A weighted entry in a drop pool. Weights are relative, not percentages. An entry with no
 * `weaponId` is a rigged crate: it coughs up a booby trap rather than something to fight with.
 */
export interface DropEntry {
  weaponId?: string;
  /** Marks the entry as a trap. Kept separate from weapons so a mine is never "held". */
  mine?: boolean;
  weight: number;
}

/** Which weapons a crate type can release. Add entries here to grow the pool. */
export const DROP_POOLS: Record<string, readonly DropEntry[]> = {
  // Weights lean towards the quick, forgiving weapons: the match-enders should feel like a
  // moment, not the default.
  standard: [
    { weaponId: 'quick-dagger', weight: 1.5 },
    { weaponId: 'spark-wand', weight: 1.5 },
    { weaponId: 'magic-bow', weight: 1.2 },
    { weaponId: 'throwing-axe', weight: 1.2 },
    { weaponId: 'war-spear', weight: 1.2 },
    { weaponId: 'magic-staff', weight: 1 },
    { weaponId: 'great-halberd', weight: 1 },
    { weaponId: 'mega-hammer', weight: 1 },
    // Roughly one crate in six is rigged. Often enough to make opening one a decision.
    { mine: true, weight: 1.8 },
  ],
};

export function dropPool(id: string): readonly DropEntry[] {
  const pool = DROP_POOLS[id];
  if (!pool || pool.length === 0) throw new Error(`Drop pool "${id}" is missing or empty`);
  return pool;
}
