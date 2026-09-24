import type RAPIER_T from '@dimforge/rapier3d-compat';
import type { Damageable, DamageHit } from '../combat/damage';
import type { Vec3 } from '../types';
import type { EventQueue } from '../sim/events';
import { PhysicsWorld, RAPIER } from '../sim/PhysicsWorld';
import { DYNAMIC_GROUPS } from '../sim/collisionGroups';
import type { CrateDefinition } from './crateDefinitions';

export interface CrateState {
  id: number;
  type: string;
  x: number;
  y: number;
  z: number;
  qx: number;
  qy: number;
  qz: number;
  qw: number;
  hp: number;
  maxHp: number;
  /** Increments on every hit so the view can trigger a wobble even if hp didn't change. */
  hits: number;
}

/**
 * A physical, breakable box. It knows how much punishment it takes and when it is done;
 * what pops out of it is the ChaosDropSystem's business.
 */
export class ChaosCrate implements Damageable {
  readonly id: number;
  readonly def: CrateDefinition;
  readonly body: RAPIER_T.RigidBody;
  hp: number;
  hits = 0;
  private readonly events: EventQueue;
  /** Where the crate was when its body was removed; the drop system needs it after destroy(). */
  private lastPosition: Vec3 | null = null;

  constructor(physics: PhysicsWorld, events: EventQueue, id: number, def: CrateDefinition, position: Vec3) {
    this.id = id;
    this.def = def;
    this.hp = def.hp;
    this.events = events;

    const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(position.x, position.y, position.z)
      .setAngularDamping(1.5)
      .setLinearDamping(0.2);
    this.body = physics.world.createRigidBody(bodyDesc);
    const colliderDesc = RAPIER.ColliderDesc.cuboid(def.halfSize, def.halfSize, def.halfSize)
      .setMass(def.mass)
      .setFriction(0.8)
      .setRestitution(0.15)
      .setCollisionGroups(DYNAMIC_GROUPS);
    physics.world.createCollider(colliderDesc, this.body);
  }

  get broken(): boolean {
    return this.hp <= 0;
  }

  applyDamage(hit: DamageHit): void {
    if (this.broken) return;
    this.hp = Math.max(0, this.hp - hit.amount);
    this.hits++;
    // Shove it a little upward too so it visibly hops on every hit.
    this.body.applyImpulseAtPoint(
      { x: hit.direction.x * hit.impulse, y: hit.impulse * 0.35, z: hit.direction.z * hit.impulse },
      hit.point,
      true,
    );
    this.events.push({ type: 'crate-hit', crateId: this.id, hp: this.hp, maxHp: this.def.hp, point: hit.point, direction: hit.direction });
  }

  position(): Vec3 {
    if (this.lastPosition) return this.lastPosition;
    const p = this.body.translation();
    return { x: p.x, y: p.y, z: p.z };
  }

  destroy(physics: PhysicsWorld): void {
    this.lastPosition = this.position();
    physics.world.removeRigidBody(this.body);
  }

  state(): CrateState {
    const p = this.body.translation();
    const q = this.body.rotation();
    return { id: this.id, type: this.def.id, x: p.x, y: p.y, z: p.z, qx: q.x, qy: q.y, qz: q.z, qw: q.w, hp: this.hp, maxHp: this.def.hp, hits: this.hits };
  }
}
