import type { EventQueue } from '../sim/events';
import type { PlayerInput } from '../sim/PlayerInput';
import type { PlayerPhysics } from '../sim/PlayerPhysics';
import { THROW } from '../sim/tuning';
import type { GrabSystem } from './GrabSystem';
import type { RagdollSystem } from '../sim/RagdollSystem';

/**
 * Turns a hold into a launch. Pressing punch while holding something throws it along the
 * grabber's facing with some lift; players lose control for a moment so the flight registers.
 */
export class ThrowSystem {
  private readonly pressed = new Map<number, boolean>();
  private readonly grab: GrabSystem;
  private readonly events: EventQueue;
  private readonly players: Map<number, PlayerPhysics>;
  private readonly ragdoll: RagdollSystem;

  constructor(grab: GrabSystem, events: EventQueue, players: Map<number, PlayerPhysics>, ragdoll: RagdollSystem) {
    this.grab = grab;
    this.events = events;
    this.players = players;
    this.ragdoll = ragdoll;
  }

  /** Per player, before the world steps. Must run before the CombatSystem so the press is a throw, not a punch. */
  applyInput(player: PlayerPhysics, input: PlayerInput): void {
    const wasPressed = this.pressed.get(player.id) ?? false;
    this.pressed.set(player.id, input.punch);
    if (!input.punch || wasPressed) return;
    const hold = this.grab.holdOf(player.id);
    if (!hold) return;

    const body = this.grab.targetBody(hold.target);
    this.grab.release(player.id, 'throw');
    if (!body) return;

    const facing = player.facing();
    const isPlayer = hold.target.kind === 'player';
    const speed = isPlayer ? THROW.playerSpeed : THROW.crateSpeed;
    const up = isPlayer ? THROW.playerUp : THROW.crateUp;
    const horizontal = speed * Math.sqrt(1 - up * up);
    body.setLinvel({ x: facing.x * horizontal, y: speed * up, z: facing.z * horizontal }, true);
    if (isPlayer) {
      const victim = this.players.get(hold.target.id);
      if (victim) this.ragdoll.knockdown(victim, player.id);
    }
    // A short recoil so the thrower can't instantly re-grab or punch.
    player.attackTimer = 0.25;
    player.attack = 'punch';
    this.events.push({ type: 'throw', playerId: player.id, target: hold.target });
  }
}
