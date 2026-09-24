import type { CrateDamageSystem } from '../combat/CrateDamageSystem';
import type { Vec3 } from '../types';
import type { EntityRegistry } from '../sim/EntityRegistry';
import type { EventQueue } from '../sim/events';
import type { PhysicsWorld } from '../sim/PhysicsWorld';
import type { Random } from '../sim/Random';
import { ChaosCrate, type CrateState } from './ChaosCrate';
import { crateDefinition, type CrateSpawnConfig } from './crateDefinitions';

/**
 * Decides when and where crates appear, owns the live ones, and retires broken ones.
 * Crates are meant to be events: one at a time, with a breather after each is destroyed.
 */
export class ChaosCrateSpawner {
  readonly config: CrateSpawnConfig;
  private readonly spawnPoints: readonly Vec3[];
  private readonly crates = new Map<number, ChaosCrate>();
  private readonly physics: PhysicsWorld;
  private readonly events: EventQueue;
  private readonly damage: CrateDamageSystem;
  private readonly registry: EntityRegistry;
  private readonly random: Random;
  private nextId = 1;
  private timer: number;
  private lastPointIndex = -1;

  constructor(
    physics: PhysicsWorld,
    events: EventQueue,
    damage: CrateDamageSystem,
    registry: EntityRegistry,
    random: Random,
    spawnPoints: readonly Vec3[],
    config: CrateSpawnConfig,
  ) {
    this.physics = physics;
    this.events = events;
    this.damage = damage;
    this.registry = registry;
    this.random = random;
    this.spawnPoints = spawnPoints;
    this.config = config;
    this.timer = config.firstDelay;
  }

  /** Advances timers, spawns when due, and returns crates that broke this step (already removed). */
  update(dt: number): ChaosCrate[] {
    const broken: ChaosCrate[] = [];
    for (const crate of this.crates.values()) {
      if (crate.broken) broken.push(crate);
    }
    for (const crate of broken) {
      this.retire(crate);
      this.events.push({ type: 'crate-broken', crateId: crate.id, position: crate.position() });
      this.timer = Math.max(this.timer, this.config.cooldownAfterDestroy);
    }

    if (this.spawnPoints.length > 0 && this.crates.size < this.config.maxActive) {
      this.timer -= dt;
      if (this.timer <= 0) {
        this.spawn();
        this.timer = this.config.interval;
      }
    }
    return broken;
  }

  /** Removes every live crate and restarts the first-spawn delay (new round). */
  reset(): void {
    for (const crate of [...this.crates.values()]) this.retire(crate);
    this.timer = this.config.firstDelay;
  }

  /** Spawns immediately at a random point (also used by debug tooling). */
  spawn(): ChaosCrate {
    const point = this.pickSpawnPoint();
    const position = { x: point.x, y: point.y + this.config.dropHeight, z: point.z };
    const crate = new ChaosCrate(this.physics, this.events, this.nextId++, crateDefinition(this.config.crateType), position);
    this.crates.set(crate.id, crate);
    this.damage.register(crate.body.handle, crate);
    this.registry.register(crate.body.handle, { kind: 'crate', id: crate.id });
    this.events.push({ type: 'crate-spawned', crateId: crate.id, position });
    return crate;
  }

  get(id: number): ChaosCrate | undefined {
    return this.crates.get(id);
  }

  get activeCount(): number {
    return this.crates.size;
  }

  states(): CrateState[] {
    return [...this.crates.values()].map((c) => c.state());
  }

  private retire(crate: ChaosCrate): void {
    this.damage.unregister(crate.body.handle);
    this.registry.unregister(crate.body.handle);
    this.crates.delete(crate.id);
    crate.destroy(this.physics);
  }

  /** Random point, avoiding the same one twice in a row when there is a choice. */
  private pickSpawnPoint(): Vec3 {
    let index = this.random.int(this.spawnPoints.length);
    if (this.spawnPoints.length > 1 && index === this.lastPointIndex) index = (index + 1) % this.spawnPoints.length;
    this.lastPointIndex = index;
    const point = this.spawnPoints[index];
    if (!point) throw new Error('No crate spawn points');
    return point;
  }
}
