import type { CrateState } from '@shared/crates/ChaosCrate';
import type { SimEvent } from '@shared/sim/events';
import type { PlayerInput } from '@shared/sim/PlayerInput';
import type { PlayerState } from '@shared/sim/PlayerPhysics';
import type { RoundState } from '@shared/sim/RoundSystem';
import type { Simulation } from '@shared/sim/Simulation';
import { getMap, isMapId } from '@shared/maps/MapRegistry';
import { PhysicsWorld, RAPIER } from '@shared/sim/PhysicsWorld';
import type { RoomInfo } from '@shared/net/Snapshot';
import type { PickupState } from '@shared/weapons/WeaponPickup';
import type { MineState } from '@shared/weapons/MineSystem';
import type { ProjectileState } from '@shared/weapons/ProjectileSystem';

/**
 * Where the match is actually running. The render loop reads states and pushes input through
 * this and never learns whether the world is being simulated in this tab (couch play) or on a
 * server somewhere (online) - which is what keeps one renderer serving both.
 */
export interface Session {
  /** Player ids this keyboard drives, in local-player order. */
  readonly localPlayerIds: readonly number[];
  /** The map being played right now. It changes when the room changes arena. */
  readonly mapId: string;
  /** The room's map settings, or null when nobody can change them (a direct URL join). */
  roomInfo(): RoomInfo | null;
  /** True when this client is the one allowed to choose the map. */
  isHost(): boolean;
  /** Asks for a map (and whether to keep rolling new ones). Ignored unless you are the host. */
  setMap(mapId: string, randomize: boolean): void;
  /** Brings anything the session keeps per-map back in line after the room changes arena. */
  syncArena(): Promise<void>;
  /** The room code others need to join this match, or null when it is not on a server. */
  readonly roomCode: string | null;
  /** Round wins needed to take the match, for the score strip. */
  readonly roundsToWin: number;
  /** The authoritative simulation when this client owns it; null online. Debug tools only. */
  readonly local: Simulation | null;
  playerIds(): number[];
  /** What to call this player on screen. */
  playerName(id: number): string;
  playerState(id: number): PlayerState | undefined;
  roundState(): RoundState;
  crateStates(): CrateState[];
  pickupStates(): PickupState[];
  projectileStates(): ProjectileState[];
  mineStates(): MineState[];
  /** Height of whatever is under (x, z); -Infinity over the void. Debris lands on it. */
  groundAt(x: number, z: number): number;
  /** Hands over this frame's input and moves the world on by `dt`. */
  update(dt: number, inputs: ReadonlyMap<number, PlayerInput>): void;
  /** Everything that happened since the last call; the caller owns the array. */
  drainEvents(): SimEvent[];
  rematch(): void;
  /** True when the match can be restarted from here (match-over, and we are allowed to ask). */
  canRematch(): boolean;
  /** Something the player has to be told about - a lost connection - or null when all is well. */
  statusMessage(): string | null;
}

/** Couch play: this tab owns the simulation and steps it every frame. */
export class LocalSession implements Session {
  readonly local: Simulation;
  private readonly ids: number[] = [];
  private readonly name: string;
  private randomize = false;

  constructor(sim: Simulation, name = '') {
    this.local = sim;
    this.name = name;
  }

  get localPlayerIds(): readonly number[] {
    return this.ids;
  }

  get mapId(): string {
    return this.local.arena.map.id;
  }

  /** Practice is your own room: you are the host, and there is nobody to announce it to. */
  roomInfo(): RoomInfo {
    return { mapId: this.mapId, randomize: this.randomize, pendingMapId: null, pendingIn: 0, hostId: this.ids[0] ?? null };
  }

  isHost(): boolean {
    return true;
  }

  setMap(mapId: string, randomize: boolean): void {
    this.randomize = randomize;
    if (!isMapId(mapId) || mapId === this.mapId) return;
    this.local.changeMap(getMap(mapId));
  }

  syncArena(): Promise<void> {
    return Promise.resolve(); // the simulation here is the arena; it changed itself
  }

  readonly roomCode = null; // practice is not somewhere anyone else can join

  get roundsToWin(): number {
    return this.local.rounds.config.roundsToWin;
  }

  /** Adds the player this keyboard drives. Returns its sim id. */
  addLocalPlayer(): number {
    const id = this.local.addPlayer();
    this.ids.push(id);
    return id;
  }

  /**
   * Adds a player nobody controls. Practice needs someone to hit, and the debug scenarios
   * need a second body to grab, throw and knock about.
   */
  addSparringDummy(): number {
    return this.local.addPlayer();
  }

  playerIds(): number[] {
    return this.local.playerIds();
  }

  /** You are whoever you said you were; the rest of the practice arena is scenery. */
  playerName(id: number): string {
    if (this.ids.includes(id)) return this.name || 'You';
    return 'Dummy';
  }

  playerState(id: number): PlayerState | undefined {
    return this.local.playerIds().includes(id) ? this.local.playerState(id) : undefined;
  }

  roundState(): RoundState {
    return this.local.roundState();
  }

  crateStates(): CrateState[] {
    return this.local.crateStates();
  }

  pickupStates(): PickupState[] {
    return this.local.pickupStates();
  }

  projectileStates(): ProjectileState[] {
    return this.local.projectileStates();
  }

  mineStates(): MineState[] {
    return this.local.mineStates();
  }

  groundAt(x: number, z: number): number {
    return groundHeight(this.local.physics, x, z);
  }

  update(dt: number, inputs: ReadonlyMap<number, PlayerInput>): void {
    for (const [id, input] of inputs) this.local.setInput(id, input);
    this.local.update(dt);
  }

  drainEvents(): SimEvent[] {
    return this.local.drainEvents();
  }

  rematch(): void {
    this.local.rounds.rematch();
  }

  canRematch(): boolean {
    return this.local.rounds.currentPhase === 'match-over';
  }

  statusMessage(): null {
    return null; // nothing can go wrong between a tab and itself
  }
}

/**
 * Shared by both sessions: a downward ray through a physics world. Online the world holds only
 * the map, since the one thing a spectating client still has to answer locally is where the
 * floor is - debris has to land on something.
 */
export function groundHeight(physics: PhysicsWorld, x: number, z: number): number {
  const from = 6;
  const hit = physics.world.castRay(new RAPIER.Ray({ x, y: from, z }, { x: 0, y: -1, z: 0 }), 30, true);
  return hit ? from - hit.timeOfImpact : -Infinity;
}
