import type { DamageType } from '../combat/damage';

export type WeaponCategory = 'bow' | 'staff' | 'hammer' | 'blade' | 'polearm' | 'wand' | 'other';

/**
 * How a Chaos Drop weapon is used. Every weapon is swung or fired on the attack key: the map
 * is big enough, and cluttered enough, that a weapon going off on its own mostly meant firing
 * into a column. What limits a drop is what it carries - a few shots and a lifetime - not who
 * decides when it goes off.
 */
export interface WeaponActivation {
  /** Seconds from the press to the shot or the hit. This is the telegraph others react to. */
  windup: number;
  /** Shots or swings before the weapon is spent. */
  shots: number;
  /** Seconds of recovery after each use, during which the attack key does nothing. */
  recovery: number;
  /** Seconds the weapon may be carried; it rusts away unused rather than being hoarded. */
  duration: number;
  consumeAfterUse: boolean;
  /** Whether the holder may drop it early (grab key). */
  canCancel: boolean;
  canMoveDuringActivation: boolean;
  canRotateDuringActivation: boolean;
  /** Seconds after this weapon is consumed before the same player can pick up another. */
  cooldown: number;
}

export type ProjectileType = 'arrow' | 'fireball' | 'melee' | 'axe' | 'bolt';

export interface ProjectileDefinition {
  type: ProjectileType;
  /** Launch speed along the holder's facing (melee: unused). */
  speed: number;
  /** Vertical acceleration; 0 flies straight. */
  gravity: number;
  /** Collision radius of the flying thing, or of the melee hit sphere. */
  radius: number;
  /** Melee: how far in front of the holder the hit sphere sits. */
  reach: number;
  /** Seconds before it fizzles if it hits nothing. */
  lifetime: number;
  damageType: DamageType;
  /** Impulse given to whatever it hits directly. */
  knockback: number;
  /** >0 makes it explode on impact, shoving everything within this radius. */
  explosionRadius: number;
  explosionImpulse: number;
}

/**
 * Everything the game knows about a weapon, in one data record. Models are KayKit glTF file
 * names (see assets/ASSET_INVENTORY.md); they are authored at human scale, hence `scale`.
 */
export interface WeaponDefinition {
  id: string;
  name: string;
  category: WeaponCategory;
  /** File name in the weapons pack, without extension. */
  model: string;
  /** Uniform scale that makes the model fit a 0.72-unit-tall character. */
  scale: number;
  /** Half-size of the pickup's physics box while it lies in the arena. */
  pickupHalfSize: number;
  /** Euler rotation (radians) applied when held, so e.g. a bow stands upright in the hand. */
  heldRotation: [number, number, number];
  /**
   * The point on the model the hands close around, in model units (before `scale`). KayKit
   * origins sit mid-shaft, so a weapon held at its origin is gripped halfway up: a hammer ends
   * up clutched under its own head. Measure the handle and put the grip near its lower end.
   */
  grip: [number, number, number];
  activation: WeaponActivation;
  projectile: ProjectileDefinition;
  /** Colour used by the countdown sprite and effects, as a hex number. */
  color: number;
}
