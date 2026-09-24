import { CombatSystem } from '../combat/CombatSystem';
import { CrateDamageSystem } from '../combat/CrateDamageSystem';
import { HealthSystem } from '../combat/HealthSystem';
import { ChaosCrateSpawner } from '../crates/ChaosCrateSpawner';
import { ChaosDropSystem } from '../crates/ChaosDropSystem';
import { DEFAULT_CRATE_SPAWN, type CrateSpawnConfig } from '../crates/crateDefinitions';
import type { CrateState } from '../crates/ChaosCrate';
import { GrabSystem } from '../grab/GrabSystem';
import { ThrowSystem } from '../grab/ThrowSystem';
import type { MapDefinition, SpawnPoint } from '../maps/MapDefinition';
import type { PickupState } from '../weapons/WeaponPickup';
import { WeaponPickupSystem } from '../weapons/WeaponPickupSystem';
import { MineSystem, type MineState } from '../weapons/MineSystem';
import { ProjectileSystem, type ProjectileState } from '../weapons/ProjectileSystem';
import { WeaponActivationSystem } from '../weapons/WeaponActivationSystem';
import { ArenaSystem } from './ArenaSystem';
import { EntityRegistry } from './EntityRegistry';
import { EventQueue, type SimEvent } from './events';
import { PhysicsWorld } from './PhysicsWorld';
import { emptyInput, type PlayerInput } from './PlayerInput';
import { PlayerPhysics, type PlayerState } from './PlayerPhysics';
import { Random } from './Random';
import { RagdollSystem } from './RagdollSystem';
import { RoundSystem, type RoundConfig, type RoundState } from './RoundSystem';

/** How far a player may be nudged off their spawn point, so a round never opens identically. */
const SPAWN_JITTER = 0.35;

export interface SimulationOptions {
  seed?: number;
  crateSpawn?: Partial<CrateSpawnConfig>;
  rounds?: Partial<RoundConfig>;
}

/**
 * The authoritative game simulation. Runs in the browser for local play and, unchanged,
 * on the server for online play. Inputs go in, states and events come out; it never renders.
 */
export class Simulation {
  readonly physics: PhysicsWorld;
  readonly arena: ArenaSystem;
  readonly events = new EventQueue();
  readonly registry = new EntityRegistry();
  readonly random: Random;
  readonly damage = new CrateDamageSystem();
  readonly pickups: WeaponPickupSystem;
  readonly crates: ChaosCrateSpawner;
  readonly drops: ChaosDropSystem;
  readonly combat: CombatSystem;
  readonly health: HealthSystem;
  readonly grab: GrabSystem;
  readonly throws: ThrowSystem;
  readonly ragdoll: RagdollSystem;
  readonly rounds: RoundSystem;
  readonly projectiles: ProjectileSystem;
  readonly mines: MineSystem;
  readonly weapons: WeaponActivationSystem;
  private readonly players = new Map<number, PlayerPhysics>();
  private readonly inputs = new Map<number, PlayerInput>();
  /** Which of the map's spawn points each player has this round, and the exact spot on it. */
  private readonly spawnSlot = new Map<number, number>();
  private readonly spawnPoint = new Map<number, SpawnPoint>();
  private nextPlayerId = 1;

  private constructor(physics: PhysicsWorld, map: MapDefinition, options: SimulationOptions) {
    this.physics = physics;
    this.random = new Random(options.seed ?? 1);
    this.arena = new ArenaSystem(physics, map);
    this.pickups = new WeaponPickupSystem(physics, this.events, this.registry, this.random);
    this.crates = new ChaosCrateSpawner(
      physics, this.events, this.damage, this.registry, this.random, map.crateSpawns,
      { ...DEFAULT_CRATE_SPAWN, ...options.crateSpawn },
    );
    this.ragdoll = new RagdollSystem(this.events);
    this.health = new HealthSystem(this.events, this.ragdoll);
    this.combat = new CombatSystem(physics, this.events, this.registry, this.damage, this.players, this.health);
    this.grab = new GrabSystem(physics, this.events, this.registry, this.players, this.crates);
    this.throws = new ThrowSystem(this.grab, this.events, this.players, this.ragdoll);
    this.projectiles = new ProjectileSystem(physics, this.events, this.registry, this.players, this.health, this.damage);
    this.mines = new MineSystem(this.events, this.projectiles);
    this.drops = new ChaosDropSystem(this.pickups, this.mines, this.random);
    this.weapons = new WeaponActivationSystem(this.events, this.projectiles);
    this.rounds = new RoundSystem(
      this.events,
      {
        playerIds: () => this.playerIds(),
        isEliminated: (id) => this.players.get(id)?.posture === 'eliminated',
        resetArena: () => this.resetArena(),
      },
      options.rounds ?? {},
    );
  }

  static async create(map: MapDefinition, options: SimulationOptions = {}): Promise<Simulation> {
    const physics = await PhysicsWorld.create();
    return new Simulation(physics, map, options);
  }

  addPlayer(): number {
    const id = this.nextPlayerId++;
    const player = new PlayerPhysics(this.physics, id, this.spawnFor(id));
    this.players.set(id, player);
    this.inputs.set(id, emptyInput());
    this.health.reset(id);
    this.registry.register(player.body.handle, { kind: 'player', id });
    return id;
  }

  /**
   * Takes a player out of the match - a disconnect, online. Anything holding them or held by
   * them is let go first, so no system is left pointing at a body that no longer exists.
   */
  removePlayer(id: number): void {
    const player = this.players.get(id);
    if (!player) return;
    this.grab.release(id, 'release');
    this.grab.releaseTarget({ kind: 'player', id });
    this.registry.unregister(player.body.handle);
    this.physics.world.removeRigidBody(player.body);
    this.players.delete(id);
    this.inputs.delete(id);
    this.spawnSlot.delete(id);
    this.spawnPoint.delete(id);
  }

  setInput(id: number, input: PlayerInput): void {
    this.inputs.set(id, input);
  }

  /** Advances by `dt` seconds of real time using fixed internal steps. */
  update(dt: number): void {
    this.physics.advance(dt, (stepDt) => {
      this.rounds.update(stepDt);
      // Pickups first, so a weapon collected this step starts activating this same step.
      this.pickups.update(stepDt, this.players.values(), this.arena.map.killY, (id) => this.weapons.canPickUp(id));
      const live = this.rounds.inputsAllowed();
      for (const [id, player] of this.players) {
        const input = live ? this.inputs.get(id) ?? emptyInput() : emptyInput();
        if (this.ragdoll.update(player, stepDt, this.spawnFor(id), this.rounds.respawnsAllowed())) this.health.reset(id);
        this.health.update(player, stepDt);
        player.applyInput(input, stepDt);
        this.weapons.update(player, input, stepDt);
        this.grab.applyInput(player, input, stepDt);
        this.throws.applyInput(player, input);
        this.combat.applyInput(player, input, stepDt);
      }
      for (const crate of this.crates.update(stepDt)) {
        this.grab.releaseTarget({ kind: 'crate', id: crate.id });
        this.drops.release(crate);
      }
      this.projectiles.update(stepDt, this.arena.map.killY);
      this.mines.update(stepDt, this.players.values());
    });
    for (const [id, player] of this.players) {
      if (player.posture !== 'eliminated' && this.arena.isBelowKillPlane(player.body.translation().y)) {
        this.grab.release(id, 'release');
        this.grab.releaseTarget({ kind: 'player', id });
        this.ragdoll.eliminate(player); // the round system decides if and when they come back
      }
    }
  }

  /** Events since the last call; the caller owns them. */
  drainEvents(): SimEvent[] {
    return this.events.drain();
  }

  playerState(id: number): PlayerState {
    const player = this.players.get(id);
    if (!player) throw new Error(`No player ${id}`);
    return { ...player.state(), weapon: this.weapons.stateOf(id), hp: this.health.hpOf(id), maxHp: this.health.max };
  }

  /** Every player in the match, in join order. */
  playerIds(): number[] {
    return [...this.players.keys()];
  }

  /** The physics body behind a player id, for tools and tests that act on a player directly. */
  player(id: number): PlayerPhysics | undefined {
    return this.players.get(id);
  }

  projectileStates(): ProjectileState[] {
    return this.projectiles.states();
  }

  mineStates(): MineState[] {
    return this.mines.states();
  }

  roundState(): RoundState {
    return this.rounds.state();
  }

  crateStates(): CrateState[] {
    return this.crates.states();
  }

  pickupStates(): PickupState[] {
    return this.pickups.states();
  }

  get playerCount(): number {
    return this.players.size;
  }

  /**
   * Swaps the arena for another map, keeping everyone in the room: the old colliders come out,
   * the new ones go in, loose things are cleared and everybody is put down on a fresh spawn
   * point. Player ids survive, so nothing above the simulation has to be rebuilt.
   */
  changeMap(map: MapDefinition): void {
    this.arena.rebuild(map);
    this.crates.reset();
    this.pickups.clear();
    this.projectiles.clear();
    this.mines.clear();
    this.resetArena();
    this.rounds.startMatch();
    this.events.push({ type: 'map-changed', mapId: map.id });
  }

  /** Everyone upright on a fresh spawn point, empty-handed; no crates or loose weapons. */
  private resetArena(): void {
    this.dealSpawns();
    for (const [id, player] of this.players) {
      this.grab.release(id, 'release');
      player.heldWeapon = null;
      this.health.reset(id);
      this.ragdoll.reset(player, this.spawnFor(id));
    }
    this.crates.reset();
    this.pickups.clear();
    this.projectiles.clear();
    this.mines.clear();
  }

  /**
   * Deals the map's spawn points out at random. Rounds open somewhere new every time, which is
   * half the fun of a big arena: you never know who you are starting next to.
   */
  private dealSpawns(): void {
    this.spawnSlot.clear();
    this.spawnPoint.clear();
    const order = shuffled(this.arena.map.spawns.map((_, i) => i), this.random);
    let next = 0;
    for (const id of this.players.keys()) this.takeSpawn(id, order[next++ % order.length] ?? 0);
  }

  /** Puts a player on a spawn slot, nudged a little so two rounds are never pixel-identical. */
  private takeSpawn(id: number, slot: number): SpawnPoint {
    const base = this.arena.map.spawns[slot];
    if (!base) throw new Error('Map has no spawn points');
    const point: SpawnPoint = {
      x: base.x + this.random.range(-SPAWN_JITTER, SPAWN_JITTER),
      y: base.y,
      z: base.z + this.random.range(-SPAWN_JITTER, SPAWN_JITTER),
      yaw: base.yaw + this.random.range(-0.3, 0.3),
    };
    this.spawnSlot.set(id, slot);
    this.spawnPoint.set(id, point);
    return point;
  }

  /** A slot nobody has, at random; with more players than spawns, any slot will do. */
  private freeSlot(): number {
    const used = new Set(this.spawnSlot.values());
    const all = this.arena.map.spawns.map((_, i) => i);
    const free = all.filter((i) => !used.has(i));
    return this.random.pick(free.length > 0 ? free : all);
  }

  private spawnFor(id: number): SpawnPoint {
    return this.spawnPoint.get(id) ?? this.takeSpawn(id, this.freeSlot());
  }
}

/** Fisher-Yates through the sim's own RNG, so every machine deals the same hand. */
function shuffled<T>(items: T[], random: Random): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = random.int(i + 1);
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}
