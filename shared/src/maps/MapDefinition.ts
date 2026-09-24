import type { AssetPack, Vec3 } from '../types';

/**
 * How the physics side should treat a placed piece.
 * - 'static'  : solid, immovable (floors, walls, columns). Gets a box collider sized from its bounds.
 * - 'decor'   : visual only, no collider (banners, trees outside the play area).
 * - 'prop'    : dynamic, grabbable/throwable body (barrels, bricks, trophies).
 */
export type PieceKind = 'static' | 'decor' | 'prop';

/** One placed model. Positions are in world units; rotY is in quarter turns (0-3) to keep data readable. */
export interface MapPiece {
  model: string;
  x: number;
  y: number;
  z: number;
  rotY?: number;
  kind?: PieceKind;
}

/**
 * A hand-placed world-space box collider. Used where per-piece boxes would be wrong or
 * wasteful: one slab under a whole floor (no seams to trip on), invisible walls, etc.
 */
export interface MapCollider {
  x: number;
  y: number;
  z: number;
  hx: number;
  hy: number;
  hz: number;
}

export interface SpawnPoint extends Vec3 {
  /** Facing angle in radians around Y. */
  yaw: number;
}

export interface CameraSetup {
  /** Where the camera sits when it has to show the whole arena; also sets the viewing angle. */
  position: Vec3;
  target: Vec3;
  /** How close the camera comes when the players it follows are all together. */
  followDistance?: number;
}

export interface MapDefinition {
  id: string;
  name: string;
  /** The asset pack every piece of this map is loaded from. */
  pack: AssetPack;
  pieces: MapPiece[];
  /** Extra colliders not derived from pieces. */
  colliders: MapCollider[];
  spawns: SpawnPoint[];
  /** Where Chaos Crates may drop in (the crate falls from above these points). */
  crateSpawns: Vec3[];
  /** Players whose position falls below this height are eliminated. */
  killY: number;
  camera: CameraSetup;
  /** Sky / clear colour as a hex number, chosen to suit the pack's palette. */
  skyColor: number;
}

/** Default piece kind when a MapPiece doesn't say. Most pieces are solid. */
export function pieceKind(piece: MapPiece): PieceKind {
  return piece.kind ?? 'static';
}
