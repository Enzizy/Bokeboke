import * as THREE from 'three';
import type { WeaponDefinition } from '@shared/weapons/WeaponDefinition';
import { weaponDefinition } from '@shared/weapons/weaponCatalog';
import type { PickupState } from '@shared/weapons/WeaponPickup';
import type { AssetLoader } from '../assets/AssetLoader';
import { weaponRef } from '../assets/assetPaths';

/**
 * A weapon model, scaled to character size. Used both for pickups lying in the arena
 * (following their physics body) and for weapons in a player's hand (parented to a bone).
 */
export class WeaponView {
  readonly root = new THREE.Group();
  readonly def: WeaponDefinition;
  private readonly model: THREE.Group;

  private constructor(def: WeaponDefinition, model: THREE.Group) {
    this.model = model;
    this.def = def;
    model.scale.setScalar(def.scale);
    // KayKit models put the grip at the origin; centre the model so pickups tumble sensibly.
    const box = new THREE.Box3().setFromObject(model);
    const centre = box.getCenter(new THREE.Vector3());
    model.position.sub(centre);
    this.root.add(model);
    this.root.name = `weapon:${def.id}`;
  }

  static async create(loader: AssetLoader, weaponId: string): Promise<WeaponView> {
    const def = weaponDefinition(weaponId);
    const loaded = await loader.load(weaponRef(def.model));
    return new WeaponView(def, loader.instantiate(loaded));
  }

  syncPickup(state: PickupState): void {
    this.root.position.set(state.x, state.y, state.z);
    this.root.quaternion.set(state.qx, state.qy, state.qz, state.qw);
  }

  /** Poses the weapon for the hands: the grip point at the anchor, business end pointing up. */
  poseInHand(): void {
    // Undo the pickup centring and hang the model from its grip instead (model units -> root units).
    const [gx, gy, gz] = this.def.grip;
    this.model.position.set(-gx, -gy, -gz).multiplyScalar(this.def.scale);
    const [rx, ry, rz] = this.def.heldRotation;
    this.root.rotation.set(rx, ry, rz);
    this.root.position.set(0, 0, 0);
  }
}
