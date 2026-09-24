import type { EventQueue } from '../sim/events';
import type { PlayerInput } from '../sim/PlayerInput';
import type { PlayerPhysics } from '../sim/PlayerPhysics';
import type { ProjectileSystem } from './ProjectileSystem';
import type { WeaponDefinition } from './WeaponDefinition';
import { ATTACK_BUFFER } from '../combat/attacks';
import { weaponDefinition } from './weaponCatalog';

/** `ready` is waiting for the attack key (or recovering); `arming` is a wind-up in progress. */
export type WeaponPhase = 'ready' | 'arming';

/**
 * A beat between picking a weapon up and being able to use it, so you do not swing the
 * instant you walk over one. Kept shorter than ATTACK_BUFFER, or an eager press during it
 * would expire unheard and the first attack would simply go missing.
 */
const READY_DELAY = 0.15;

/** What the client shows above a holder's head. */
export interface HeldWeaponState {
  weaponId: string;
  phase: WeaponPhase;
  /** Seconds until the wind-up lands, or until the recovery ends. */
  timer: number;
  /** Shots or swings left. */
  shotsLeft: number;
}

interface Activation {
  def: WeaponDefinition;
  phase: WeaponPhase;
  timer: number;
  shotsLeft: number;
  /** Seconds of life left before the weapon expires unused. */
  duration: number;
  grabWasDown: boolean;
  attackWasDown: boolean;
  /** Seconds left on a press that arrived while the weapon was still busy. */
  attackBuffered: number;
}

/**
 * Chaos Drop weapons in someone's hands. The holder picks the moment - a press starts a
 * wind-up long enough for a target to react, the shot or swing lands when it ends, and the
 * recovery afterwards makes a miss cost something. What runs out is ammunition and time.
 */
export class WeaponActivationSystem {
  private readonly active = new Map<number, Activation>();
  private readonly cooldowns = new Map<number, number>();
  private readonly events: EventQueue;
  private readonly projectiles: ProjectileSystem;

  constructor(events: EventQueue, projectiles: ProjectileSystem) {
    this.events = events;
    this.projectiles = projectiles;
  }

  /** Players on cooldown can't pick up another weapon yet. */
  canPickUp(playerId: number): boolean {
    return (this.cooldowns.get(playerId) ?? 0) <= 0;
  }

  stateOf(playerId: number): HeldWeaponState | null {
    const a = this.active.get(playerId);
    if (!a) return null;
    return { weaponId: a.def.id, phase: a.phase, timer: Math.max(0, a.timer), shotsLeft: a.shotsLeft };
  }

  /** Per player, per fixed step, before the world advances. */
  update(player: PlayerPhysics, input: PlayerInput, dt: number): void {
    this.cooldowns.set(player.id, Math.max(0, (this.cooldowns.get(player.id) ?? 0) - dt));

    let a = this.active.get(player.id);
    if (!player.heldWeapon) {
      if (a) this.active.delete(player.id);
      return;
    }
    if (!a || a.def.id !== player.heldWeapon) {
      a = this.begin(player, weaponDefinition(player.heldWeapon));
    }

    // Weapons that forbid moving/turning freeze the holder in place.
    player.frozen = !a.def.activation.canMoveDuringActivation;
    player.turnLocked = !a.def.activation.canRotateDuringActivation;

    // Cancelling (grab key) is only possible when the weapon allows it.
    const grabPressed = input.grab && !a.grabWasDown;
    a.grabWasDown = input.grab;
    if (grabPressed && a.def.activation.canCancel) {
      this.consume(player, a, 'cancelled');
      return;
    }

    if (player.posture !== 'upright') return; // knocked down: everything waits

    const act = a.def.activation;
    a.duration -= dt; // even unused, a Chaos Drop never lasts forever
    if (a.duration <= 0) {
      this.consume(player, a, 'expired');
      return;
    }
    a.timer = Math.max(0, a.timer - dt);
    a.attackBuffered = Math.max(0, a.attackBuffered - dt);
    if (input.punch && !a.attackWasDown) a.attackBuffered = ATTACK_BUFFER;
    a.attackWasDown = input.punch;

    if (a.phase === 'arming') {
      if (a.timer > 0) return;
      this.launch(player, a); // the wind-up is over: this is where it arrives
      a.phase = 'ready';
      a.timer = act.recovery;
      a.shotsLeft--;
      if (a.shotsLeft <= 0) this.consume(player, a, 'used');
      return;
    }
    if (a.attackBuffered <= 0 || a.timer > 0) return;
    a.attackBuffered = 0;
    a.phase = 'arming';
    a.timer = act.windup;
    // Melee winds up a swing; anything else takes aim. The client animates from this.
    const attack = a.def.projectile.type === 'melee' ? 'heavy' : 'shoot';
    player.attack = attack;
    player.attackTimer = act.windup + 0.3;
    this.events.push({ type: 'attack', playerId: player.id, attack });
  }

  private begin(player: PlayerPhysics, def: WeaponDefinition): Activation {
    const act = def.activation;
    const a: Activation = {
      def,
      phase: 'ready',
      timer: READY_DELAY,
      shotsLeft: act.shots,
      duration: act.duration,
      grabWasDown: true,
      attackWasDown: true, // holding the key while picking it up shouldn't fire straight away
      attackBuffered: 0,
    };
    this.active.set(player.id, a);
    this.events.push({ type: 'weapon-armed', playerId: player.id, weaponId: def.id, delay: act.windup });
    return a;
  }

  /** Sends the weapon's projectile (or melee sphere) on its way and tells the client. */
  private launch(player: PlayerPhysics, a: Activation): void {
    const projectileId = this.projectiles.fire(player, a.def.projectile);
    this.events.push({ type: 'weapon-fired', playerId: player.id, weaponId: a.def.id, projectileId, projectile: a.def.projectile.type });
  }

  private consume(player: PlayerPhysics, a: Activation, reason: 'used' | 'expired' | 'cancelled'): void {
    this.active.delete(player.id);
    player.frozen = false;
    player.turnLocked = false;
    if (a.def.activation.consumeAfterUse || reason === 'cancelled') {
      player.heldWeapon = null;
      this.cooldowns.set(player.id, a.def.activation.cooldown);
      this.events.push({ type: 'weapon-consumed', playerId: player.id, weaponId: a.def.id, reason });
    }
  }
}
