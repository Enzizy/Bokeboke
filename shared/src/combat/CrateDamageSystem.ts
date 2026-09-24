import { DAMAGE_AMOUNT, type Damageable, type DamageHit, type DamageType } from './damage';
import type { Vec3 } from '../types';

/**
 * Routes damage to whatever owns a hit rigid body. Attackers never talk to crates directly:
 * they describe the hit (type, point, direction, shove) and this decides the amount from the
 * damage table and delivers it. Anything Damageable can register - crates today, more later.
 */
export class CrateDamageSystem {
  private readonly targets = new Map<number, Damageable>();

  register(bodyHandle: number, target: Damageable): void {
    this.targets.set(bodyHandle, target);
  }

  unregister(bodyHandle: number): void {
    this.targets.delete(bodyHandle);
  }

  isDamageable(bodyHandle: number): boolean {
    return this.targets.has(bodyHandle);
  }

  /** Returns true if the body was damageable and took the hit. */
  damage(
    bodyHandle: number,
    type: DamageType,
    sourcePlayerId: number | null,
    point: Vec3,
    direction: Vec3,
    impulse: number,
  ): boolean {
    const target = this.targets.get(bodyHandle);
    if (!target) return false;
    const hit: DamageHit = { type, amount: DAMAGE_AMOUNT[type], sourcePlayerId, point, direction, impulse };
    target.applyDamage(hit);
    return true;
  }
}
