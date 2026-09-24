import type { Vec3 } from '../types';
import type { EntityRegistry } from '../sim/EntityRegistry';
import type { EventQueue } from '../sim/events';
import type { PhysicsWorld } from '../sim/PhysicsWorld';
import type { PlayerPhysics } from '../sim/PlayerPhysics';
import type { Random } from '../sim/Random';
import { weaponDefinition } from './weaponCatalog';
import { WeaponPickup, type PickupState } from './WeaponPickup';

/** Distance from a player's centre within which a pickup is collected by walking over it. */
const COLLECT_RADIUS = 0.55;

/**
 * Owns loose weapons in the arena. Crates hand it a weapon id and a launch velocity; it makes
 * the physical pickup, and gives it to the first player who walks over it.
 */
export class WeaponPickupSystem {
  private readonly pickups = new Map<number, WeaponPickup>();
  private readonly physics: PhysicsWorld;
  private readonly events: EventQueue;
  private readonly registry: EntityRegistry;
  private readonly random: Random;
  private nextId = 1;

  constructor(physics: PhysicsWorld, events: EventQueue, registry: EntityRegistry, random: Random) {
    this.physics = physics;
    this.events = events;
    this.registry = registry;
    this.random = random;
  }

  spawn(weaponId: string, position: Vec3, velocity: Vec3): WeaponPickup {
    const spin = { x: this.random.range(-6, 6), y: this.random.range(-6, 6), z: this.random.range(-6, 6) };
    const pickup = new WeaponPickup(this.physics, this.nextId++, weaponDefinition(weaponId), position, velocity, spin);
    this.pickups.set(pickup.id, pickup);
    this.registry.register(pickup.body.handle, { kind: 'pickup', id: pickup.id });
    this.events.push({ type: 'weapon-ejected', pickupId: pickup.id, weaponId, position });
    return pickup;
  }

  /** Collects pickups that empty-handed players are standing on; drops ones that fell off the map. */
  update(dt: number, players: Iterable<PlayerPhysics>, killY: number, canPickUp: (playerId: number) => boolean = () => true): void {
    const playerList = [...players];
    for (const pickup of [...this.pickups.values()]) {
      pickup.armTimer -= dt;
      const p = pickup.position();
      if (p.y < killY) {
        this.remove(pickup);
        continue;
      }
      if (pickup.armTimer > 0) continue;
      for (const player of playerList) {
        if (player.heldWeapon || player.posture !== 'upright' || !canPickUp(player.id)) continue;
        const c = player.body.translation();
        if (Math.hypot(c.x - p.x, c.y - p.y, c.z - p.z) > COLLECT_RADIUS) continue;
        player.heldWeapon = pickup.def.id;
        this.events.push({ type: 'weapon-picked-up', pickupId: pickup.id, weaponId: pickup.def.id, playerId: player.id });
        this.remove(pickup);
        break;
      }
    }
  }

  /** Removes every loose weapon (new round). */
  clear(): void {
    for (const pickup of [...this.pickups.values()]) this.remove(pickup);
  }

  get count(): number {
    return this.pickups.size;
  }

  states(): PickupState[] {
    return [...this.pickups.values()].map((p) => p.state());
  }

  private remove(pickup: WeaponPickup): void {
    this.registry.unregister(pickup.body.handle);
    this.pickups.delete(pickup.id);
    pickup.destroy(this.physics);
  }
}
