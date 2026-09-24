import * as THREE from 'three';
import type { CrateState } from '@shared/crates/ChaosCrate';
import { crateDefinition } from '@shared/crates/crateDefinitions';
import { buildCratePieces, type CratePiece } from './crateGeometry';

/** How many crack marks show at each damage stage (index = hits taken). */
const CRACKS_PER_STAGE = [0, 0, 2, 5, 8];
const WOBBLE_TIME = 0.45;

/**
 * The visual crate: a bundle of separate low-poly pieces so it can fly apart. Pose comes from
 * the sim every frame; the wobble and damage cracks are presentation-only and layered on top.
 */
export class ChaosCrateView {
  readonly root = new THREE.Group();
  readonly halfSize: number;
  private readonly wobbleGroup = new THREE.Group();
  private readonly pieces: CratePiece[];
  private readonly cracks: THREE.Mesh[];
  private wobble = 0;
  private hitsSeen = 0;

  constructor(state: CrateState) {
    const def = crateDefinition(state.type);
    this.halfSize = def.halfSize;
    const built = buildCratePieces(def.halfSize);
    this.pieces = built.pieces;
    this.cracks = built.cracks;
    for (const piece of this.pieces) this.wobbleGroup.add(piece.mesh);
    for (const crack of this.cracks) this.wobbleGroup.add(crack);
    this.root.add(this.wobbleGroup);
    this.root.name = `crate:${state.id}`;
    this.hitsSeen = state.hits;
    this.setDamageStage(state.maxHp - state.hp);
  }

  /** Copies the sim pose and returns true if a new hit landed since the last sync. */
  sync(state: CrateState): boolean {
    this.root.position.set(state.x, state.y, state.z);
    this.root.quaternion.set(state.qx, state.qy, state.qz, state.qw);
    const newHit = state.hits > this.hitsSeen;
    if (newHit) {
      this.hitsSeen = state.hits;
      this.wobble = 1;
      this.setDamageStage(state.maxHp - state.hp);
    }
    return newHit;
  }

  update(dt: number): void {
    if (this.wobble <= 0) return;
    this.wobble = Math.max(0, this.wobble - dt / WOBBLE_TIME);
    const t = (1 - this.wobble) * WOBBLE_TIME;
    const k = Math.sin(t * 38) * this.wobble;
    this.wobbleGroup.scale.set(1 + k * 0.12, 1 - k * 0.18, 1 + k * 0.12);
    this.wobbleGroup.rotation.z = k * 0.12;
    this.wobbleGroup.rotation.x = k * 0.08;
  }

  /**
   * Hands every piece over, positioned in world space, so a debris system can throw them.
   * The view is empty afterwards and should be removed from the scene.
   */
  explode(): { mesh: THREE.Mesh; localOffset: THREE.Vector3 }[] {
    this.root.updateWorldMatrix(true, true);
    const out: { mesh: THREE.Mesh; localOffset: THREE.Vector3 }[] = [];
    for (const piece of this.pieces) {
      const mesh = piece.mesh;
      const localOffset = mesh.position.clone();
      mesh.getWorldPosition(mesh.position);
      mesh.getWorldQuaternion(mesh.quaternion);
      mesh.scale.setScalar(1);
      this.wobbleGroup.remove(mesh);
      out.push({ mesh, localOffset });
    }
    return out;
  }

  private setDamageStage(stage: number): void {
    const visible = CRACKS_PER_STAGE[Math.min(stage, CRACKS_PER_STAGE.length - 1)] ?? 0;
    this.cracks.forEach((crack, i) => (crack.visible = i < visible));
    // Heavy damage: panels darken and the frame sags a little.
    const heavy = stage >= 4;
    for (const piece of this.pieces) {
      const material = piece.mesh.material as THREE.MeshStandardMaterial;
      material.color.copy(piece.baseColor).multiplyScalar(heavy ? 0.75 : stage >= 3 ? 0.88 : 1);
    }
    this.wobbleGroup.rotation.y = heavy ? 0.06 : 0;
  }
}
