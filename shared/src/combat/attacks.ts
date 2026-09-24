import type { DamageType } from './damage';

export type AttackId = 'punch' | 'kick';

export interface AttackDefinition {
  id: AttackId;
  damageType: DamageType;
  /** Hit sphere: centre this far in front of the attacker's chest, this radius. */
  reach: number;
  radius: number;
  /** Shove applied to whatever is hit (impulse units). Players have mass 1. */
  impulse: number;
  /** Seconds before the same attack can be used again. */
  cooldown: number;
  /** Seconds the attack animation locks the player's animation state. */
  duration: number;
  /** Delay after the press before the hit is checked, so the swing has visibly started. */
  hitDelay: number;
}

/**
 * How long a press is remembered while you are still busy. Without it, hitting the key a few
 * frames before your recovery ends does nothing at all, which reads as the game ignoring you.
 */
export const ATTACK_BUFFER = 0.2;

export const ATTACKS: Record<AttackId, AttackDefinition> = {
  punch: { id: 'punch', damageType: 'punch', reach: 0.35, radius: 0.32, impulse: 2.5, cooldown: 0.45, duration: 0.42, hitDelay: 0.12 },
  kick: { id: 'kick', damageType: 'kick', reach: 0.4, radius: 0.36, impulse: 4, cooldown: 0.65, duration: 0.53, hitDelay: 0.18 },
};
