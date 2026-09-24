import type { WeaponActivation, WeaponDefinition } from './WeaponDefinition';

/** Sensible defaults; each weapon overrides what makes it special. */
const BASE: WeaponActivation = {
  windup: 0.25,
  shots: 1,
  recovery: 0.8,
  duration: 20,
  consumeAfterUse: true,
  canCancel: false,
  canMoveDuringActivation: true,
  canRotateDuringActivation: true,
  cooldown: 0.5,
};

/**
 * The Chaos Drop pool. You aim and fire these yourself, on the attack key; the limitation is
 * what each one carries. A few shots, a visible wind-up before each, and a lifetime that runs
 * out whether you use it or not - so picking one up is a commitment, not a power-up you sit on.
 */
export const WEAPONS: Record<string, WeaponDefinition> = {
  'magic-bow': {
    id: 'magic-bow',
    name: 'Magic Bow',
    category: 'bow',
    model: 'bow_B_withString',
    scale: 0.4,
    pickupHalfSize: 0.16,
    heldRotation: [0, Math.PI / 2, Math.PI / 2],
    grip: [0, 0, 0], // the riser really is at the origin on this one
    color: 0x5ad0ff,
    // Five quick arrows: the reward for actually lining a shot up across the arena.
    activation: { ...BASE, windup: 0.2, shots: 5, recovery: 0.5, duration: 25 },
    projectile: {
      type: 'arrow', speed: 15, gravity: -3, radius: 0.09, reach: 0, lifetime: 2.5,
      damageType: 'arrow', knockback: 3.5, explosionRadius: 0, explosionImpulse: 0,
    },
  },
  'magic-staff': {
    id: 'magic-staff',
    name: 'Fireball Staff',
    category: 'staff',
    model: 'staff_B',
    scale: 0.38,
    pickupHalfSize: 0.14,
    heldRotation: [0, 0, 0],
    grip: [0, -0.25, 0], // shaft runs -0.86..0.68, crystal above that: hold it low
    color: 0xff7a2a,
    // Two fireballs, each with a long enough wind-up to dive out of the way of.
    activation: { ...BASE, windup: 0.5, shots: 2, recovery: 1.6, duration: 25 },
    projectile: {
      type: 'fireball', speed: 9, gravity: 0, radius: 0.2, reach: 0, lifetime: 3,
      damageType: 'explosive', knockback: 4, explosionRadius: 1.7, explosionImpulse: 7,
    },
  },
  'mega-hammer': {
    id: 'mega-hammer',
    name: 'Mega Hammer',
    category: 'hammer',
    model: 'hammer_B',
    scale: 0.45,
    pickupHalfSize: 0.2,
    heldRotation: [-0.2, 0, 0], // leans back over the shoulder instead of across the face
    grip: [0, -0.3, 0], // handle runs -0.47..0.28, spiked head above 0.41: hold the handle
    color: 0xffd23f,
    // Three swings, each slow enough to see coming and heavy enough to nearly end someone.
    activation: { ...BASE, windup: 0.35, shots: 3, recovery: 1.2, duration: 15, cooldown: 0.8 },
    projectile: {
      type: 'melee', speed: 0, gravity: 0, radius: 0.7, reach: 0.55, lifetime: 0,
      damageType: 'hammer', knockback: 9, explosionRadius: 0, explosionImpulse: 0,
    },
  },
  'quick-dagger': {
    id: 'quick-dagger',
    name: 'Quick Dagger',
    category: 'blade',
    model: 'dagger_A',
    scale: 0.4,
    pickupHalfSize: 0.12,
    heldRotation: [0.5, 0, 0], // held forward, ready to stab rather than presented like a sword
    grip: [0, -0.12, 0], // handle runs -0.26..0.1, crossguard above it
    color: 0xc8d4e0,
    // Eight quick stabs. Nothing here floors anyone; it wins by never letting you rest.
    activation: { ...BASE, windup: 0.12, shots: 8, recovery: 0.3, duration: 20, cooldown: 0.4 },
    projectile: {
      type: 'melee', speed: 0, gravity: 0, radius: 0.34, reach: 0.38, lifetime: 0,
      damageType: 'blade', knockback: 1.6, explosionRadius: 0, explosionImpulse: 0,
    },
  },
  'war-spear': {
    id: 'war-spear',
    name: 'War Spear',
    category: 'polearm',
    model: 'spear_A',
    scale: 0.3,
    pickupHalfSize: 0.18,
    heldRotation: [1.35, 0, 0], // levelled off, pointing where the holder is facing
    grip: [0, -0.35, 0], // a 3-unit pole: hold it well back so most of it is out front
    color: 0xd8c7a0,
    // Five thrusts that land from outside anyone's punching range - that reach is the weapon.
    activation: { ...BASE, windup: 0.3, shots: 5, recovery: 0.75, duration: 20 },
    projectile: {
      type: 'melee', speed: 0, gravity: 0, radius: 0.42, reach: 0.95, lifetime: 0,
      damageType: 'pierce', knockback: 5.5, explosionRadius: 0, explosionImpulse: 0,
    },
  },
  'great-halberd': {
    id: 'great-halberd',
    name: 'Great Halberd',
    category: 'polearm',
    model: 'halberd',
    scale: 0.32,
    pickupHalfSize: 0.2,
    heldRotation: [-0.15, 0, 0],
    grip: [0, -0.5, 0], // shaft runs -0.93..0.4, the head sits above that
    color: 0x9fb3c8,
    // A slow, wide sweep: the only weapon that clears a crowd instead of picking one target.
    activation: { ...BASE, windup: 0.45, shots: 4, recovery: 1.4, duration: 18, cooldown: 0.7 },
    projectile: {
      type: 'melee', speed: 0, gravity: 0, radius: 1, reach: 0.6, lifetime: 0,
      damageType: 'chop', knockback: 7, explosionRadius: 0, explosionImpulse: 0,
    },
  },
  'throwing-axe': {
    id: 'throwing-axe',
    name: 'Throwing Axe',
    category: 'blade',
    model: 'axe_A',
    scale: 0.5,
    pickupHalfSize: 0.16,
    heldRotation: [0, 0, 0],
    grip: [0, -0.2, 0], // handle runs -0.37..0.2, head above it
    color: 0xb0c4d8,
    // Three axes that tumble away on an arc. They drop as they fly, so distance has to be read.
    activation: { ...BASE, windup: 0.25, shots: 3, recovery: 0.8, duration: 20 },
    projectile: {
      type: 'axe', speed: 11, gravity: -7, radius: 0.16, reach: 0, lifetime: 2.5,
      damageType: 'chop', knockback: 5, explosionRadius: 0, explosionImpulse: 0,
    },
  },
  'spark-wand': {
    id: 'spark-wand',
    name: 'Spark Wand',
    category: 'wand',
    model: 'wand_A',
    scale: 0.45,
    pickupHalfSize: 0.12,
    heldRotation: [0.35, 0, 0],
    grip: [0, -0.2, 0],
    color: 0x7ae6c8,
    // Six small bolts, fired about as fast as you can press. Chip damage at range.
    activation: { ...BASE, windup: 0.1, shots: 6, recovery: 0.28, duration: 20, cooldown: 0.4 },
    projectile: {
      type: 'bolt', speed: 16, gravity: 0, radius: 0.12, reach: 0, lifetime: 1.6,
      damageType: 'magic', knockback: 1.8, explosionRadius: 0, explosionImpulse: 0,
    },
  },
};

export function weaponDefinition(id: string): WeaponDefinition {
  const def = WEAPONS[id];
  if (!def) throw new Error(`Unknown weapon "${id}"`);
  return def;
}

/** True when the weapon hits what is right in front of you rather than firing something. */
export function isMeleeWeapon(id: string | null): boolean {
  return id !== null && WEAPONS[id]?.projectile.type === 'melee';
}
