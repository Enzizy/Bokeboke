import type { CrateState } from '@shared/crates/ChaosCrate';
import { getMap } from '@shared/maps/MapRegistry';
import type { SimEvent } from '@shared/sim/events';
import { ArenaSystem } from '@shared/sim/ArenaSystem';
import { PhysicsWorld } from '@shared/sim/PhysicsWorld';
import type { PlayerInput } from '@shared/sim/PlayerInput';
import type { PlayerState } from '@shared/sim/PlayerPhysics';
import { DEFAULT_ROUND_CONFIG, type RoundState } from '@shared/sim/RoundSystem';
import type { RoomInfo, Snapshot } from '@shared/net/Snapshot';
import type { MineState } from '@shared/weapons/MineSystem';
import type { PickupState } from '@shared/weapons/WeaponPickup';
import type { ProjectileState } from '@shared/weapons/ProjectileSystem';
import { groundHeight, type Session } from '../app/Session';
import { NetClient, type Connected } from './NetClient';
import { SnapshotBuffer } from './SnapshotBuffer';

const EMPTY_ROUND: RoundState = { phase: 'waiting', round: 0, timer: 0, wins: {}, alive: [], winnerId: null };

/**
 * Online play: the server owns the world and this only draws it. Input goes out every frame,
 * snapshots come back, and everything the renderer asks for is served from a point slightly in
 * the past so it can be interpolated. Nothing here simulates, which is why this client can
 * never disagree with the server about who won.
 */
export class NetworkSession implements Session {
  readonly local = null;
  readonly roomCode: string;
  /** Round wins needed, for the score strip; the server uses the shared default. */
  readonly roundsToWin = DEFAULT_ROUND_CONFIG.roundsToWin;
  private readonly client: NetClient;
  private readonly buffer: SnapshotBuffer;
  private ids: number[];
  /** The map's static collision, kept purely so debris knows where the floor is. */
  private arena: PhysicsWorld;
  private readonly startingMapId: string;
  /** Which map that collision was built for, so it is rebuilt when the room moves on. */
  private arenaMapId: string;
  /** This frame's interpolated world: sampled once in update(), then read by every getter. */
  private frame: Snapshot | null = null;

  private constructor(client: NetClient, connected: Connected, arena: PhysicsWorld) {
    this.client = client;
    this.startingMapId = connected.mapId;
    this.roomCode = connected.room;
    this.ids = connected.playerIds;
    this.buffer = new SnapshotBuffer(connected.snapshotHz);
    this.arena = arena;
    this.arenaMapId = connected.mapId;
  }

  /** Whatever the room says it is on now; before the first snapshot, what we joined on. */
  get mapId(): string {
    return this.buffer.latest?.room.mapId ?? this.startingMapId;
  }

  roomInfo(): RoomInfo | null {
    return this.buffer.latest?.room ?? null;
  }

  isHost(): boolean {
    const host = this.roomInfo()?.hostId;
    return host !== null && host !== undefined && this.ids.includes(host);
  }

  setMap(mapId: string, randomize: boolean): void {
    this.client.setMap(mapId, randomize);
  }

  /** Connects, takes a seat, and builds the map's collision for local ground queries. */
  static async join(url: string, room: string, name: string, create = false, onWaking?: (seconds: number) => void): Promise<NetworkSession> {
    const client = new NetClient(url);
    void client.wake(); // free hosting sleeps; knock before waiting on the socket
    const connected = await client.connect(room, name, create, onWaking);
    const arena = await PhysicsWorld.create();
    new ArenaSystem(arena, getMap(connected.mapId));
    const session = new NetworkSession(client, connected, arena);
    // A reconnect may come back with a different player id; the game re-attaches the keyboard.
    client.onReconnect = (again) => {
      session.ids = again.playerIds;
    };
    return session;
  }

  get localPlayerIds(): readonly number[] {
    return this.ids;
  }

  /** True once the server is gone for good and retrying has been given up on. */
  get isLost(): boolean {
    return this.client.isLost;
  }

  playerIds(): number[] {
    return (this.buffer.latest?.players ?? []).map((p) => p.id);
  }

  playerName(id: number): string {
    return this.buffer.latest?.names[id] ?? `Player ${id}`;
  }

  playerState(id: number): PlayerState | undefined {
    return this.frame?.players.find((p) => p.id === id);
  }

  roundState(): RoundState {
    return this.buffer.latest?.round ?? EMPTY_ROUND;
  }

  crateStates(): CrateState[] {
    return this.frame?.crates ?? [];
  }

  pickupStates(): PickupState[] {
    return this.frame?.pickups ?? [];
  }

  projectileStates(): ProjectileState[] {
    return this.frame?.projectiles ?? [];
  }

  mineStates(): MineState[] {
    return this.frame?.mines ?? [];
  }

  groundAt(x: number, z: number): number {
    return groundHeight(this.arena, x, z);
  }

  /**
   * Rebuilds the local copy of the map's collision after the room changes arena. Only debris
   * uses it, so it can lag a frame or two behind without anyone noticing.
   */
  async syncArena(): Promise<void> {
    const wanted = this.mapId;
    if (wanted === this.arenaMapId) return;
    this.arenaMapId = wanted;
    const physics = await PhysicsWorld.create();
    new ArenaSystem(physics, getMap(wanted));
    this.arena = physics;
  }

  update(dt: number, inputs: ReadonlyMap<number, PlayerInput>): void {
    this.client.update(dt); // drives reconnect attempts
    this.client.send(inputs);
    for (const snapshot of this.client.takeSnapshots()) this.buffer.push(snapshot);
    this.buffer.advance(dt);
    this.frame = this.buffer.sample();
  }

  drainEvents(): SimEvent[] {
    return this.client.takeEvents();
  }

  rematch(): void {
    this.client.rematch();
  }

  canRematch(): boolean {
    return !this.client.isLost && this.roundState().phase === 'match-over';
  }

  statusMessage(): string | null {
    return this.client.statusMessage();
  }

  disconnect(): void {
    this.client.disconnect();
  }
}
