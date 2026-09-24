import type { Vec3 } from '../types';

/** Every source of damage in the game. Add a type here and a number in DAMAGE_AMOUNT; nothing else. */
export type DamageType =
  | 'punch'
  | 'kick'
  | 'heavy'
  | 'hammer'
  | 'arrow'
  | 'explosive'
  | 'blade'
  | 'pierce'
  | 'chop'
  | 'magic';

/** How much of a crate's durability each damage type removes. The only place these numbers live. */
export const DAMAGE_AMOUNT: Record<DamageType, number> = {
  punch: 1,
  kick: 1,
  heavy: 2,
  hammer: 3,
  arrow: 1,
  explosive: 5,
  blade: 1,
  pierce: 2,
  chop: 3,
  magic: 1,
};

/**
 * How much health each damage type takes off a player (crates use DAMAGE_AMOUNT instead).
 * Fists are a war of attrition; a Chaos Drop is how you actually finish someone.
 */
export const PLAYER_DAMAGE: Record<DamageType, number> = {
  punch: 9,
  kick: 15,
  heavy: 20,
  hammer: 45, // three connected mace swings end anyone, with room to spare
  arrow: 15,
  explosive: 34,
  blade: 12, // fast and cheap: the dagger wins by landing five of these, not one
  pierce: 22, // the spear pays for its reach by being slower than a dagger
  chop: 30, // axe and halberd: heavy, but not a mace
  magic: 11,
};

/** How much each damage type pushes a player towards falling over (see RAGDOLL.threshold). */
export const KNOCKDOWN_POWER: Record<DamageType, number> = {
  punch: 0.4,
  kick: 0.75,
  heavy: 0.75,
  hammer: 1.2,
  arrow: 0.3,
  explosive: 2,
  blade: 0.25, // barely rocks anyone; the dagger is for chipping, not flooring
  pierce: 0.8,
  chop: 1,
  magic: 0.2,
};

/** One instance of damage arriving at something. */
export interface DamageHit {
  type: DamageType;
  amount: number;
  /** Player responsible, if any (for scoring later). */
  sourcePlayerId: number | null;
  /** World-space point of contact and the direction the hit travels. */
  point: Vec3;
  direction: Vec3;
  /** Physical shove to apply, in impulse units (mass * velocity). */
  impulse: number;
}

/** Anything that can take damage: crates now; breakable props, players later. */
export interface Damageable {
  applyDamage(hit: DamageHit): void;
}
