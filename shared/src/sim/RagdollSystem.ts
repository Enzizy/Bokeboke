import type { SpawnPoint } from '../maps/MapDefinition';
import type { EventQueue } from './events';
import type { PlayerPhysics } from './PlayerPhysics';
import { RAGDOLL } from './tuning';

export type PostureState = 'upright' | 'ragdoll' | 'recovering' | 'eliminated';

interface Posture {
  state: PostureState;
  timer: number;
  /** Knockdown power accumulated from recent hits; falling over happens at the threshold. */
  wobble: number;
}

/**
 * Knockdown, tumbling and getting back up. A downed player is the same capsule with its
 * rotations unlocked, so it topples, rolls and can be pushed off ledges by the physics alone.
 * Limb floppiness is presentation (client-side), which keeps this to one body per player.
 */
export class RagdollSystem {
  private readonly postures = new Map<number, Posture>();
  private readonly events: EventQueue;

  constructor(events: EventQueue) {
    this.events = events;
  }

  stateOf(playerId: number): PostureState {
    return this.postures.get(playerId)?.state ?? 'upright';
  }

  isUpright(playerId: number): boolean {
    return this.stateOf(playerId) === 'upright';
  }

  /** A hit landed: shove the player and maybe knock them over. */
  hit(player: PlayerPhysics, direction: { x: number; z: number }, impulse: number, power: number, byPlayerId: number | null): void {
    const posture = this.posture(player.id);
    if (posture.state === 'eliminated') return;
    if (posture.state !== 'upright') {
      // Already down: just kick the body around some more.
      player.body.applyImpulse({ x: direction.x * impulse, y: impulse * 0.4, z: direction.z * impulse }, true);
      return;
    }
    posture.wobble += power;
    if (posture.wobble >= RAGDOLL.threshold) {
      player.body.applyImpulse({ x: direction.x * impulse, y: impulse * 0.3, z: direction.z * impulse }, true);
      this.knockdown(player, byPlayerId);
    } else {
      player.shove(direction, impulse);
    }
  }

  /** Puts the player on the floor immediately (throws, heavy hits). */
  knockdown(player: PlayerPhysics, byPlayerId: number | null): void {
    const posture = this.posture(player.id);
    if (posture.state === 'ragdoll' || posture.state === 'eliminated') return;
    posture.state = 'ragdoll';
    player.posture = 'ragdoll';
    posture.timer = 0;
    posture.wobble = 0;
    player.attack = null;
    player.attackTimer = 0;
    player.staggerTimer = 0;

    const body = player.body;
    body.setEnabledRotations(true, true, true, true);
    body.setAngularDamping(RAGDOLL.angularDamping);
    body.collider(0).setFriction(RAGDOLL.friction);
    // Topple over in a random direction so the capsule doesn't just slide while standing.
    const a = player.id * 2.399 + posture.timer; // deterministic, differs per player
    body.setAngvel({ x: Math.cos(a) * RAGDOLL.topple, y: 0, z: Math.sin(a) * RAGDOLL.topple }, true);
    this.events.push({ type: 'knockdown', playerId: player.id, byPlayerId });
  }

  /** Fell out of the arena: switch the body off until respawn. */
  eliminate(player: PlayerPhysics): void {
    const posture = this.posture(player.id);
    if (posture.state === 'eliminated') return;
    const p = player.body.translation();
    posture.state = 'eliminated';
    player.posture = 'eliminated';
    posture.timer = 0;
    posture.wobble = 0;
    player.body.setEnabled(false);
    this.events.push({ type: 'eliminated', playerId: player.id, position: { x: p.x, y: p.y, z: p.z } });
  }

  /** Back to upright at a spawn point, whatever state the player was in (round reset). */
  reset(player: PlayerPhysics, spawn: SpawnPoint): void {
    const posture = this.posture(player.id);
    posture.state = 'upright';
    posture.timer = 0;
    posture.wobble = 0;
    player.posture = 'upright';
    player.body.setEnabled(true);
    player.respawn(spawn);
  }

  /**
   * Per player, per fixed step. Returns true if the player was respawned this step. Where to
   * respawn is asked for only at that moment, so it can depend on where everyone is by then.
   */
  update(player: PlayerPhysics, dt: number, spawn: () => SpawnPoint, respawnsAllowed: boolean): boolean {
    const posture = this.posture(player.id);
    posture.timer += dt;
    switch (posture.state) {
      case 'upright':
        posture.wobble = Math.max(0, posture.wobble - RAGDOLL.wobbleDecay * dt);
        return false;
      case 'ragdoll': {
        const v = player.body.linvel();
        const w = player.body.angvel();
        const moving = Math.hypot(v.x, v.y, v.z) > RAGDOLL.settleSpeed || Math.hypot(w.x, w.y, w.z) > RAGDOLL.settleSpeed * 2;
        if (posture.timer >= RAGDOLL.maxDownTime || (posture.timer >= RAGDOLL.minDownTime && !moving)) this.startRecovery(player, posture);
        return false;
      }
      case 'recovering':
        if (posture.timer >= RAGDOLL.recoverTime) {
          posture.state = 'upright';
          player.posture = 'upright';
          posture.timer = 0;
        }
        return false;
      case 'eliminated':
        if (respawnsAllowed && posture.timer >= RAGDOLL.respawnDelay) {
          posture.state = 'upright';
          player.posture = 'upright';
          posture.timer = 0;
          player.body.setEnabled(true);
          player.respawn(spawn());
          this.events.push({ type: 'respawn', playerId: player.id });
          return true;
        }
        return false;
      default:
        return false;
    }
  }

  private startRecovery(player: PlayerPhysics, posture: Posture): void {
    posture.state = 'recovering';
    player.posture = 'recovering';
    posture.timer = 0;
    player.standUp();
    this.events.push({ type: 'recover', playerId: player.id });
  }

  private posture(playerId: number): Posture {
    let posture = this.postures.get(playerId);
    if (!posture) {
      posture = { state: 'upright', timer: 0, wobble: 0 };
      this.postures.set(playerId, posture);
    }
    return posture;
  }
}
