/**
 * Rapier collision groups: the high 16 bits say what a collider IS, the low 16 what it
 * COLLIDES WITH. Two colliders touch only if each one's membership overlaps the other's filter.
 * Players get their own bit so a held object can stop colliding with just its grabber.
 */
const WORLD = 1 << 0;
const DYNAMIC = 1 << 9;
const ALL = 0xffff;
const MAX_PLAYER_BIT = 8;

function pack(membership: number, filter: number): number {
  return ((membership & 0xffff) << 16) | (filter & 0xffff);
}

/** Bit identifying one player. Ids beyond 8 share the generic dynamic bit. */
export function playerBit(playerId: number): number {
  return playerId >= 1 && playerId <= MAX_PLAYER_BIT ? 1 << playerId : DYNAMIC;
}

export const STATIC_GROUPS = pack(WORLD, ALL);
export const DYNAMIC_GROUPS = pack(DYNAMIC, ALL);

export function playerGroups(playerId: number): number {
  return pack(playerBit(playerId), ALL);
}

/** Groups for a dynamic body that should pass through one particular player. */
export function heldByGroups(playerId: number): number {
  return pack(DYNAMIC, ALL & ~playerBit(playerId));
}
