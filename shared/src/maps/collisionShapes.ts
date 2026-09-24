import type { AssetPack } from '../types';

/**
 * An axis-aligned box in the model's local space: half extents + centre offset from the
 * model origin (which is at the base centre for every Kenney Mini piece).
 */
export interface BoxShape {
  hx: number;
  hy: number;
  hz: number;
  ox: number;
  oy: number;
  oz: number;
}

function box(hx: number, hy: number, hz: number, ox = 0, oy = hy, oz = 0): BoxShape {
  return { hx, hy, hz, ox, oy, oz };
}

/** A 1x1 floor tile: a thin slab whose top surface is exactly y=0. */
const FLOOR = [box(0.5, 0.05, 0.5, 0, -0.05, 0)];

/** Four boxes approximating `stairs` (rises towards -Z, 0.5 high over 1 unit). */
function stairs(): BoxShape[] {
  const steps: BoxShape[] = [];
  for (let i = 0; i < 4; i++) {
    const top = (i + 1) * 0.125;
    steps.push(box(0.5, top / 2, 0.125, 0, top / 2, 0.375 - i * 0.25));
  }
  return steps;
}

/**
 * Simple colliders for every model that needs one, measured from the GLB bounds
 * (see assets/ASSET_INVENTORY.md). Models missing here get no collider - deliberate for
 * decor, a bug for anything a player can touch. `ArenaSystem` warns about the latter.
 */
const SHAPES: Record<AssetPack, Record<string, BoxShape[]>> = {
  characters: {},
  arena: {
    'floor': FLOOR,
    'floor-detail': FLOOR,
    'block': [box(0.5, 0.25, 0.5)],
    'border-straight': [box(0.5, 0.2, 0.3)],
    'border-corner': [box(0.4, 0.2, 0.4, -0.1, 0.2, -0.1)],
    'column': [box(0.3, 0.5, 0.3)],
    'column-damaged': [box(0.3, 0.36, 0.3)],
    'statue': [box(0.3, 0.67, 0.3)],
    'weapon-rack': [box(0.39, 0.235, 0.225, 0, 0.235, 0.075)],
    'wall': [box(0.5, 0.5, 0.3)],
    'wall-gate': [box(0.5, 0.5, 0.3)],
    'wall-corner': [box(0.4, 0.5, 0.4, -0.1, 0.5, -0.1)],
    'stairs': stairs(),
    'stairs-corner': [box(0.5, 0.25, 0.5)],
    'stairs-corner-inner': [box(0.5, 0.25, 0.5)],
    'tree': [box(0.15, 0.96, 0.15)],
    'bricks': [box(0.39, 0.2, 0.42)],
    'trophy': [box(0.28, 0.24, 0.23)],
  },
  skate: {},
  arcade: {},
  market: {},
  dungeon: {},
  forest: {},
  weapons: {},
};

export function collisionShapes(pack: AssetPack, model: string): BoxShape[] | undefined {
  return SHAPES[pack][model];
}
