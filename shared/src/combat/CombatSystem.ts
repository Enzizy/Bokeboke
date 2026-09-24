import type { EntityRegistry } from '../sim/EntityRegistry';
import type { EventQueue } from '../sim/events';
import { PhysicsWorld, RAPIER } from '../sim/PhysicsWorld';
import type { PlayerInput } from '../sim/PlayerInput';
import type { PlayerPhysics } from '../sim/PlayerPhysics';
import { ATTACKS, ATTACK_BUFFER, type AttackDefinition, type AttackId } from './attacks';
import type { CrateDamageSystem } from './CrateDamageSystem';
import type { DamageType } from './damage';
import type { HealthSystem } from './HealthSystem';

interface AttackTrack {
  cooldown: number;
  /** Time until the pending attack's hit check fires; negative when nothing is pending. */
  hitIn: number;
  pending: AttackDefinition | null;
  pressed: Record<AttackId, boolean>;
  /** Seconds left on a press made while still busy, so near-misses still land. */
  buffered: Record<AttackId, number>;
}

const NO_ROTATION = { x: 0, y: 0, z: 0, w: 1 };

/**
 * Punches and kicks. An attack is a short sphere check in front of the attacker a few frames
 * after the press; whatever is inside gets shoved, and damageable things take damage of the
 * attack's type (or the held weapon's type). Player-vs-player knockdown arrives with ragdolls.
 */
export class CombatSystem {
  private readonly tracks = new Map<number, AttackTrack>();
  private readonly physics: PhysicsWorld;
  private readonly events: EventQueue;
  private readonly registry: EntityRegistry;
  private readonly damage: CrateDamageSystem;
  private readonly players: Map<number, PlayerPhysics>;
  private readonly health: HealthSystem;

  constructor(
    physics: PhysicsWorld,
    events: EventQueue,
    registry: EntityRegistry,
    damage: CrateDamageSystem,
    players: Map<number, PlayerPhysics>,
    health: HealthSystem,
  ) {
    this.physics = physics;
    this.events = events;
    this.registry = registry;
    this.damage = damage;
    this.players = players;
    this.health = health;
  }

  /** Called once per fixed step per player, before the world advances. */
  applyInput(player: PlayerPhysics, input: PlayerInput, dt: number): void {
    const track = this.track(player.id);
    track.cooldown = Math.max(0, track.cooldown - dt);

    this.consider(player, track, 'punch', input.punch, dt);
    this.consider(player, track, 'kick', input.kick, dt);

    if (track.pending) {
      track.hitIn -= dt;
      if (track.hitIn <= 0) {
        this.resolveHit(player, track.pending);
        track.pending = null;
      }
    }
  }

  private consider(player: PlayerPhysics, track: AttackTrack, id: AttackId, down: boolean, dt: number): void {
    const wasDown = track.pressed[id];
    track.pressed[id] = down;
    track.buffered[id] = Math.max(0, track.buffered[id] - dt);
    if (down && !wasDown) track.buffered[id] = ATTACK_BUFFER;
    if (track.buffered[id] <= 0 || track.cooldown > 0 || player.attackTimer > 0 || player.grabbing || player.grabbedBy !== null) return;
    // A weapon owns the attack key while it is held; the activation system fires it.
    if (id === 'punch' && player.heldWeapon !== null) return;
    if (player.posture !== 'upright') return;
    const attack = ATTACKS[id];
    track.buffered[id] = 0;
    track.cooldown = attack.cooldown;
    track.pending = attack;
    track.hitIn = attack.hitDelay;
    player.attack = id;
    player.attackTimer = attack.duration;
    this.events.push({ type: 'attack', playerId: player.id, attack: id });
  }

  private resolveHit(attacker: PlayerPhysics, attack: AttackDefinition): void {
    const facing = attacker.facing();
    const centre = attacker.body.translation();
    const point = { x: centre.x + facing.x * attack.reach, y: centre.y, z: centre.z + facing.z * attack.reach };
    const type: DamageType = attack.damageType; // Chaos Drop weapons act on their own, not through punches
    const shape = new RAPIER.Ball(attack.radius);

    // Collect first, act second: Rapier swallows exceptions thrown inside query callbacks and
    // mutating the world from within one is not allowed.
    const hitBodies: number[] = [];
    this.physics.world.intersectionsWithShape(point, NO_ROTATION, shape, (collider) => {
      const body = collider.parent();
      if (body && body.handle !== attacker.body.handle) hitBodies.push(body.handle);
      return true;
    });

    for (const handle of hitBodies) {
      const ref = this.registry.lookup(handle);
      if (!ref) continue;
      if (ref.kind === 'player') {
        const victim = this.players.get(ref.id);
        if (victim) this.health.applyHit(victim, type, facing, attack.impulse, attacker.id);
      } else if (ref.kind === 'crate') {
        this.damage.damage(handle, type, attacker.id, point, facing, attack.impulse);
      } else if (ref.kind === 'pickup') {
        const body = this.physics.world.getRigidBody(handle);
        body?.applyImpulse({ x: facing.x * attack.impulse * 0.3, y: attack.impulse * 0.2, z: facing.z * attack.impulse * 0.3 }, true);
      }
    }
  }

  private track(playerId: number): AttackTrack {
    let track = this.tracks.get(playerId);
    if (!track) {
      track = { cooldown: 0, hitIn: -1, pending: null, pressed: { punch: false, kick: false }, buffered: { punch: 0, kick: 0 } };
      this.tracks.set(playerId, track);
    }
    return track;
  }
}
