import type { Vec3 } from '../types';
import type { EntityRef } from './EntityRegistry';
import type { ProjectileType } from '../weapons/WeaponDefinition';
import type { DamageType } from '../combat/damage';

/**
 * Things that happened during a sim update that the presentation layer wants to react to
 * (effects, sounds, animation triggers). Drained by the client after each update; over the
 * network they become the server's event stream.
 */
export type SimEvent =
  | { type: 'attack'; playerId: number; attack: string }
  | { type: 'crate-spawned'; crateId: number; position: Vec3 }
  | { type: 'crate-hit'; crateId: number; hp: number; maxHp: number; point: Vec3; direction: Vec3 }
  | { type: 'crate-broken'; crateId: number; position: Vec3 }
  | { type: 'weapon-ejected'; pickupId: number; weaponId: string; position: Vec3 }
  | { type: 'mine-placed'; mineId: number; position: Vec3 }
  | { type: 'mine-armed'; mineId: number }
  | { type: 'mine-triggered'; mineId: number }
  | { type: 'mine-gone'; mineId: number }
  | { type: 'weapon-picked-up'; pickupId: number; weaponId: string; playerId: number }
  | { type: 'grab'; playerId: number; target: EntityRef }
  | { type: 'release'; playerId: number; target: EntityRef; reason: 'release' | 'throw' | 'escape' | 'timeout' }
  | { type: 'throw'; playerId: number; target: EntityRef }
  | { type: 'knockdown'; playerId: number; byPlayerId: number | null }
  | { type: 'player-damaged'; playerId: number; byPlayerId: number | null; damageType: DamageType; hp: number; maxHp: number }
  | { type: 'player-ko'; playerId: number; byPlayerId: number | null }
  | { type: 'recover'; playerId: number }
  | { type: 'eliminated'; playerId: number; position: Vec3 }
  | { type: 'respawn'; playerId: number }
  | { type: 'map-changed'; mapId: string }
  | { type: 'round-countdown'; round: number; seconds: number }
  | { type: 'round-start'; round: number }
  | { type: 'round-over'; round: number; winnerId: number | null; wins: Record<number, number> }
  | { type: 'match-over'; winnerId: number | null; wins: Record<number, number> }
  | { type: 'weapon-armed'; playerId: number; weaponId: string; delay: number }
  | { type: 'weapon-fired'; playerId: number; weaponId: string; projectileId: number; projectile: ProjectileType }
  | { type: 'weapon-consumed'; playerId: number; weaponId: string; reason: 'used' | 'expired' | 'cancelled' }
  | { type: 'projectile-hit'; projectileId: number; projectile: ProjectileType; point: Vec3 }
  | { type: 'projectile-gone'; projectileId: number }
  | { type: 'explosion'; position: Vec3; radius: number };

export class EventQueue {
  private events: SimEvent[] = [];
  private readonly listeners: ((event: SimEvent) => void)[] = [];

  /** Systems that keep count of what others did (scoring) hear every event as it happens. */
  listen(listener: (event: SimEvent) => void): void {
    this.listeners.push(listener);
  }

  push(event: SimEvent): void {
    this.events.push(event);
    for (const listener of this.listeners) listener(event);
  }

  /** Returns everything since the last drain and clears the queue. */
  drain(): SimEvent[] {
    const out = this.events;
    this.events = [];
    return out;
  }
}
