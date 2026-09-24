import type RAPIER_T from '@dimforge/rapier3d-compat';
import type { MapCollider, MapDefinition, MapPiece } from '../maps/MapDefinition';
import { pieceKind } from '../maps/MapDefinition';
import { collisionShapes, type BoxShape } from '../maps/collisionShapes';
import { PhysicsWorld, RAPIER } from './PhysicsWorld';
import { STATIC_GROUPS } from './collisionGroups';

/**
 * Builds the static collision for a map and knows where its edges are.
 * Props are static for now; they become dynamic bodies with the InteractiveObjectSystem.
 */
export class ArenaSystem {
  map: MapDefinition;
  private readonly physics: PhysicsWorld;
  /** Models that needed a collider but have none in collisionShapes.ts - the client logs these. */
  readonly missingShapes: string[] = [];
  /** Everything this system put in the world, so it can take it all out again. */
  private readonly built: RAPIER_T.Collider[] = [];

  constructor(physics: PhysicsWorld, map: MapDefinition) {
    this.physics = physics;
    this.map = map;
    this.build();
  }

  /** Swaps in another map: the old arena is removed from the world and the new one built. */
  rebuild(map: MapDefinition): void {
    for (const collider of this.built) this.physics.world.removeCollider(collider, false);
    this.built.length = 0;
    this.missingShapes.length = 0;
    this.map = map;
    this.build();
  }

  private build(): void {
    for (const piece of this.map.pieces) this.addPiece(piece);
    for (const collider of this.map.colliders) this.addCollider(collider);
  }

  get staticColliders(): number {
    return this.built.length;
  }

  /** True once a body has fallen far enough below the arena to count as out. */
  isBelowKillPlane(y: number): boolean {
    return y < this.map.killY;
  }

  private addPiece(piece: MapPiece): void {
    if (pieceKind(piece) === 'decor') return;
    const shapes = collisionShapes(this.map.pack, piece.model);
    if (!shapes) {
      if (!this.missingShapes.includes(piece.model)) this.missingShapes.push(piece.model);
      return;
    }
    for (const shape of shapes) this.addBox(piece, shape);
  }

  private addCollider(c: MapCollider): void {
    const desc = RAPIER.ColliderDesc.cuboid(c.hx, c.hy, c.hz).setTranslation(c.x, c.y, c.z).setFriction(0.8).setCollisionGroups(STATIC_GROUPS);
    this.built.push(this.physics.world.createCollider(desc));
  }

  private addBox(piece: MapPiece, shape: BoxShape): void {
    const turns = ((piece.rotY ?? 0) % 4 + 4) % 4;
    const { ox, oz, hx, hz } = rotateQuarter(shape, turns);
    const desc = RAPIER.ColliderDesc.cuboid(hx, shape.hy, hz)
      .setTranslation(piece.x + ox, piece.y + shape.oy, piece.z + oz)
      .setFriction(0.8)
      .setCollisionGroups(STATIC_GROUPS);
    this.built.push(this.physics.world.createCollider(desc));
  }
}

/** Rotates a box's offset and swaps its extents for quarter turns about Y (matches Three's rotation.y). */
function rotateQuarter(s: BoxShape, turns: number): { ox: number; oz: number; hx: number; hz: number } {
  switch (turns) {
    case 1: return { ox: s.oz, oz: -s.ox, hx: s.hz, hz: s.hx };
    case 2: return { ox: -s.ox, oz: -s.oz, hx: s.hx, hz: s.hz };
    case 3: return { ox: -s.oz, oz: s.ox, hx: s.hz, hz: s.hx };
    default: return { ox: s.ox, oz: s.oz, hx: s.hx, hz: s.hz };
  }
}
