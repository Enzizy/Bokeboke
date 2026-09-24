import type { MapCollider, MapPiece } from './MapDefinition';

export interface PlatformOptions {
  /** The platform is 2*half tiles wide, centred on the origin. */
  half: number;
  /** Half-width, in tiles, of the opening in the middle of each side. */
  gap: number;
}

export interface Platform {
  pieces: MapPiece[];
  colliders: MapCollider[];
  /** Centre of the outermost tile row: where the border sits, and the edge of the usable floor. */
  edge: number;
}

/**
 * Invisible walls along the rim are this tall. The border models are only knee-high and any
 * jump clears them, so without these you could hop onto the border and walk off the world.
 */
const RIM_HEIGHT = 1.4;

/** Deterministic pseudo-random so the floor-detail sprinkle is identical on client and server. */
function hash(x: number, z: number): number {
  const n = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453;
  return n - Math.floor(n);
}

/**
 * The bones every arena map shares: a square floating platform, a skirt of blocks under its
 * rim so it reads as solid, a low border with an opening in the middle of each side, and
 * invisible walls that keep players in except through those openings. A map built on this
 * only has to place its own furniture.
 *
 * Orientation facts (measured from the GLB vertex data, see assets/ASSET_INVENTORY.md):
 *  - `border-straight` runs along X at rotY 0.
 *  - `border-corner` fills the -X/-Z corner at rotY 0.
 */
export function buildPlatform({ half, gap }: PlatformOptions): Platform {
  const pieces: MapPiece[] = [];
  const edge = half - 0.5;
  const add = (model: string, x: number, y: number, z: number, rotY = 0, kind?: MapPiece['kind']): void => {
    const piece: MapPiece = { model, x, y, z, rotY };
    if (kind) piece.kind = kind;
    pieces.push(piece);
  };

  // Floor: tiles are visual only; one slab collider covers the platform so there are no seams.
  const colliders: MapCollider[] = [{ x: 0, y: -0.05, z: 0, hx: half, hy: 0.05, hz: half }];
  for (let i = 0; i < half * 2; i++) {
    for (let j = 0; j < half * 2; j++) {
      const x = i - edge;
      const z = j - edge;
      add(hash(x, z) < 0.12 ? 'floor-detail' : 'floor', x, 0, z, 0, 'decor');
    }
  }

  // Skirt of blocks under the perimeter so the platform reads as a solid slab (visual only).
  for (let i = 0; i < half * 2; i++) {
    const c = i - edge;
    add('block', c, -0.5, -edge, 0, 'decor');
    add('block', c, -0.5, edge, 0, 'decor');
    if (i !== 0 && i !== half * 2 - 1) {
      add('block', -edge, -0.5, c, 0, 'decor');
      add('block', edge, -0.5, c, 0, 'decor');
    }
  }

  // Borders, with the middle of each side left open: that is the way out of the arena.
  for (let i = 1; i < half * 2 - 1; i++) {
    const c = i - edge;
    if (Math.abs(c) < gap) continue;
    add('border-straight', c, 0, -edge, 0); // north edge, runs along X
    add('border-straight', c, 0, edge, 0); // south edge
    add('border-straight', -edge, 0, c, 1); // west edge, runs along Z
    add('border-straight', edge, 0, c, 1); // east edge
  }
  add('border-corner', -edge, 0, -edge, 0); // NW
  add('border-corner', -edge, 0, edge, 1); // SW
  add('border-corner', edge, 0, edge, 2); // SE
  add('border-corner', edge, 0, -edge, 3); // NE

  // Invisible walls matching the border and its gaps.
  const span = half - gap; // from the corner to the edge of the opening
  const centre = half - span / 2;
  for (const side of [-1, 1]) {
    for (const offset of [-centre, centre]) {
      colliders.push({ x: offset, y: RIM_HEIGHT / 2, z: side * half, hx: span / 2, hy: RIM_HEIGHT / 2, hz: 0.25 });
      colliders.push({ x: side * half, y: RIM_HEIGHT / 2, z: offset, hx: 0.25, hy: RIM_HEIGHT / 2, hz: span / 2 });
    }
  }

  return { pieces, colliders, edge };
}

/** Spawn points evenly spaced around a ring, all facing the middle. */
export function spawnRing(count: number, radius: number, offset = 0): { x: number; y: number; z: number; yaw: number }[] {
  const points = [];
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2 + offset;
    points.push({
      x: Math.cos(angle) * radius,
      y: 0.05,
      z: Math.sin(angle) * radius,
      yaw: Math.atan2(-Math.cos(angle), -Math.sin(angle)),
    });
  }
  return points;
}
