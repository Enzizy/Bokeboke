import type { EventQueue } from '../sim/events';
import type { PlayerPhysics } from '../sim/PlayerPhysics';
import type { RagdollSystem } from '../sim/RagdollSystem';
import { HEALTH, RAGDOLL } from '../sim/tuning';
import { KNOCKDOWN_POWER, PLAYER_DAMAGE, type DamageType } from './damage';

/** A knockout hits harder than the blow that caused it, so the last hit sends the body flying. */
const KO_IMPULSE = 1.6;

/**
 * Player health. Every hit that reaches a player comes through here: it takes the HP off and
 * hands the physical shove to the ragdoll system. At zero the player is knocked out - they
 * tumble for a moment, then drop out of the round exactly as if they had fallen off the edge.
 * Health lasts a round: it refills on every reset and respawn.
 */
export class HealthSystem {
  private readonly hp = new Map<number, number>();
  /** Players who are out cold, counting down to being counted out. */
  private readonly koTimers = new Map<number, number>();
  /** Seconds since each player last took a hit, which is what regeneration waits on. */
  private readonly sinceHit = new Map<number, number>();
  private readonly events: EventQueue;
  private readonly ragdoll: RagdollSystem;

  constructor(events: EventQueue, ragdoll: RagdollSystem) {
    this.events = events;
    this.ragdoll = ragdoll;
  }

  get max(): number {
    return HEALTH.max;
  }

  hpOf(playerId: number): number {
    return this.hp.get(playerId) ?? HEALTH.max;
  }

  /** True while the player is out cold but still tumbling. */
  isKnockedOut(playerId: number): boolean {
    return this.koTimers.has(playerId);
  }

  reset(playerId: number): void {
    this.hp.set(playerId, HEALTH.max);
    this.koTimers.delete(playerId);
    this.sinceHit.set(playerId, HEALTH.regenDelay);
  }

  /**
   * A hit landed on a player: health first, then the shove. The damage type decides both how
   * much it takes off and how hard it rocks them, so one table stays in charge of each.
   */
  applyHit(victim: PlayerPhysics, type: DamageType, direction: { x: number; z: number }, impulse: number, byPlayerId: number | null): void {
    if (victim.posture === 'eliminated') return;
    if (this.isKnockedOut(victim.id)) {
      this.ragdoll.hit(victim, direction, impulse, KNOCKDOWN_POWER[type], byPlayerId); // already out; just kick them along
      return;
    }
    const hp = Math.max(0, this.hpOf(victim.id) - PLAYER_DAMAGE[type]);
    this.hp.set(victim.id, hp);
    this.sinceHit.set(victim.id, 0); // regeneration starts again from here
    this.events.push({ type: 'player-damaged', playerId: victim.id, byPlayerId, damageType: type, hp, maxHp: HEALTH.max });
    if (hp > 0) {
      this.ragdoll.hit(victim, direction, impulse, KNOCKDOWN_POWER[type], byPlayerId);
      return;
    }
    // Out cold: enough power to guarantee the topple, and extra shove so the last hit reads.
    this.ragdoll.hit(victim, direction, impulse * KO_IMPULSE, RAGDOLL.threshold + KNOCKDOWN_POWER[type], byPlayerId);
    this.koTimers.set(victim.id, HEALTH.koDelay);
    this.events.push({ type: 'player-ko', playerId: victim.id, byPlayerId });
  }

  /**
   * Per player, per fixed step: heals whoever has been left alone long enough, and counts a
   * knocked-out player out once they have finished flying.
   */
  update(player: PlayerPhysics, dt: number): void {
    this.regenerate(player, dt);
    const left = this.koTimers.get(player.id);
    if (left === undefined) return;
    if (left - dt > 0) {
      this.koTimers.set(player.id, left - dt);
      return;
    }
    this.koTimers.delete(player.id);
    this.ragdoll.eliminate(player);
  }

  /** Quiet for long enough, and health comes back - unless you are already out cold. */
  private regenerate(player: PlayerPhysics, dt: number): void {
    if (this.isKnockedOut(player.id) || player.posture === 'eliminated') return;
    const quiet = (this.sinceHit.get(player.id) ?? HEALTH.regenDelay) + dt;
    this.sinceHit.set(player.id, quiet);
    if (quiet < HEALTH.regenDelay) return;
    const hp = this.hpOf(player.id);
    if (hp >= HEALTH.max || hp <= 0) return;
    this.hp.set(player.id, Math.min(HEALTH.max, hp + HEALTH.regenRate * dt));
  }
}
