import * as THREE from 'three';
import type { MapDefinition, MapPiece } from '@shared/maps/MapDefinition';
import type { ModelRef } from '@shared/types';
import type { AssetLoader } from '../assets/AssetLoader';

/** Models placed at least this many times are drawn as one instanced mesh each. */
const INSTANCE_THRESHOLD = 4;

/**
 * Builds the visual side of a map from its data definition.
 * Every unique model is loaded once. Models that appear all over the map - floor tiles,
 * border pieces, the blocks under the rim - are drawn as instanced meshes, so a wider arena
 * costs more tiles but barely more draw calls; one-offs like the statue stay plain clones.
 * Physics colliders are NOT created here - that's the ArenaSystem's job.
 */
export class MapView {
  readonly root = new THREE.Group();
  private readonly loader: AssetLoader;

  constructor(loader: AssetLoader) {
    this.loader = loader;
    this.root.name = 'map';
  }

  async build(map: MapDefinition): Promise<void> {
    this.clear();
    this.root.name = `map:${map.id}`;
    await this.loader.loadAll(uniqueModelRefs(map));

    const byModel = new Map<string, MapPiece[]>();
    for (const piece of map.pieces) {
      const list = byModel.get(piece.model);
      if (list) list.push(piece);
      else byModel.set(piece.model, [piece]);
    }

    for (const [model, placements] of byModel) {
      const loaded = await this.loader.load({ pack: map.pack, model });
      if (placements.length >= INSTANCE_THRESHOLD) {
        for (const mesh of instanceModel(loaded.scene, placements)) this.root.add(mesh);
        continue;
      }
      for (const piece of placements) {
        const instance = this.loader.instantiate(loaded);
        instance.name = model;
        placePiece(instance, piece);
        this.root.add(instance);
      }
    }
  }

  clear(): void {
    for (const child of this.root.children) {
      if ((child as THREE.InstancedMesh).isInstancedMesh) (child as THREE.InstancedMesh).dispose();
    }
    this.root.clear();
  }
}

/**
 * One InstancedMesh per (geometry, material) inside the model, carrying every placement.
 * The prototype's own transforms are baked in, so a model built from several parts still
 * lands exactly where a plain clone would.
 */
function instanceModel(prototype: THREE.Object3D, placements: MapPiece[]): THREE.InstancedMesh[] {
  prototype.updateWorldMatrix(true, true);
  const out: THREE.InstancedMesh[] = [];
  const piece = new THREE.Matrix4();
  const world = new THREE.Matrix4();

  prototype.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    const instanced = new THREE.InstancedMesh(mesh.geometry, mesh.material, placements.length);
    instanced.name = `${prototype.name || 'piece'}:instanced`;
    instanced.castShadow = mesh.castShadow;
    instanced.receiveShadow = mesh.receiveShadow;
    placements.forEach((placement, index) => {
      piece.compose(
        new THREE.Vector3(placement.x, placement.y, placement.z),
        new THREE.Quaternion().setFromAxisAngle(UP, (placement.rotY ?? 0) * (Math.PI / 2)),
        ONE,
      );
      instanced.setMatrixAt(index, world.multiplyMatrices(piece, mesh.matrixWorld));
    });
    instanced.instanceMatrix.needsUpdate = true;
    out.push(instanced);
  });
  return out;
}

const UP = new THREE.Vector3(0, 1, 0);
const ONE = new THREE.Vector3(1, 1, 1);

function placePiece(object: THREE.Object3D, piece: MapPiece): void {
  object.position.set(piece.x, piece.y, piece.z);
  object.rotation.y = (piece.rotY ?? 0) * (Math.PI / 2);
}

function uniqueModelRefs(map: MapDefinition): ModelRef[] {
  const names = new Set(map.pieces.map((p) => p.model));
  return [...names].map((model) => ({ pack: map.pack, model }));
}
