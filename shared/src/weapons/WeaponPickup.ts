import type RAPIER_T from '@dimforge/rapier3d-compat';
import type { Vec3 } from '../types';
import { PhysicsWorld, RAPIER } from '../sim/PhysicsWorld';
import { DYNAMIC_GROUPS } from '../sim/collisionGroups';
import type { WeaponDefinition } from './WeaponDefinition';

export interface PickupState {
  id: number;
  weaponId: string;
  x: number;
  y: number;
  z: number;
  qx: number;
  qy: number;
  qz: number;
  qw: number;
}

/** A weapon lying in (or flying through) the arena as a small dynamic box, waiting to be collected. */
export class WeaponPickup {
  readonly id: number;
  readonly def: WeaponDefinition;
  readonly body: RAPIER_T.RigidBody;
  /** Pickups can't be collected for a moment after ejection, so they visibly fly first. */
  armTimer = 0.5;

  constructor(physics: PhysicsWorld, id: number, def: WeaponDefinition, position: Vec3, velocity: Vec3, spin: Vec3) {
    this.id = id;
    this.def = def;
    const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(position.x, position.y, position.z)
      .setLinvel(velocity.x, velocity.y, velocity.z)
      .setAngvel(spin)
      .setAngularDamping(2)
      .setLinearDamping(0.3)
      .setCcdEnabled(true);
    this.body = physics.world.createRigidBody(bodyDesc);
    const h = def.pickupHalfSize;
    const colliderDesc = RAPIER.ColliderDesc.cuboid(h, h, h).setMass(0.5).setFriction(0.9).setRestitution(0.3).setCollisionGroups(DYNAMIC_GROUPS);
    physics.world.createCollider(colliderDesc, this.body);
  }

  position(): Vec3 {
    const p = this.body.translation();
    return { x: p.x, y: p.y, z: p.z };
  }

  destroy(physics: PhysicsWorld): void {
    physics.world.removeRigidBody(this.body);
  }

  state(): PickupState {
    const p = this.body.translation();
    const q = this.body.rotation();
    return { id: this.id, weaponId: this.def.id, x: p.x, y: p.y, z: p.z, qx: q.x, qy: q.y, qz: q.z, qw: q.w };
  }
}
