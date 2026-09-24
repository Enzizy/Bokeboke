import { DEFAULT_MAP_ID, getMap, isMapId, listMaps } from '@shared/maps/MapRegistry';
import { emptyInput, type PlayerInput } from '@shared/sim/PlayerInput';
import { Simulation } from '@shared/sim/Simulation';
import { PHYSICS } from '@shared/sim/tuning';
import { captureSnapshot } from '@shared/net/Snapshot';
import {
  encode, MAP_CHANGE_DELAY, MAX_LOCAL_PLAYERS, MAX_ROOM_PLAYERS, readSetup, sameSetup, sanitizeName,
  type MatchSetup, type ServerMessage,
} from '@shared/net/messages';
import type { RoomInfo } from '@shared/net/Snapshot';
import type { SimEvent } from '@shared/sim/events';

/** Snapshots per second. The sim still runs at 60 Hz; clients interpolate between these. */
export const SNAPSHOT_HZ = 20;
/**
 * How long a connection may go quiet before its players are treated as having let go of
 * everything. Short on purpose: a client that stalls mid-sprint should stop, not keep running
 * off the edge while nobody is driving it.
 */
const INPUT_TIMEOUT = 0.4;
/**
 * How long a dropped player is kept alive waiting for their client to come back. Long enough
 * to survive a flaky connection or a browser hiccup, short enough that a room full of ghosts
 * does not outlast the people still playing.
 */
const RECONNECT_GRACE = 20;

/** Anything that can be sent to: the room only needs to push text at it. */
export interface Peer {
  send(data: string): void;
  close(reason: string): void;
}

interface Member {
  peer: Peer;
  /** Stable across reconnects; how a returning client is recognised. */
  clientId: string;
  /** What this connection calls itself. */
  name: string;
  /** Player ids this connection drives. */
  playerIds: number[];
  /** Seconds since the last input message, so a silent client goes limp instead of stuck. */
  silentFor: number;
}

/** Someone who dropped and may yet come back; their players stay on the floor meanwhile. */
interface Vacancy {
  playerIds: number[];
  name: string;
  graceLeft: number;
}

/**
 * One match: the authoritative Simulation, the connections watching it, and a fixed tick.
 * The room is the only thing that advances the sim, so every client sees the same world -
 * the same code the browser runs for couch play, with sockets in front of it.
 */
export class Room {
  readonly code: string;
  private mapId: string;
  /** Roll a new map after every match instead of staying on the host's pick. */
  private randomize = false;
  /** A called-but-not-yet-applied change of setup; picking again just restarts the clock. */
  private pending: { setup: MatchSetup; secondsLeft: number } | null = null;
  private readonly sim: Simulation;
  private readonly members = new Map<Peer, Member>();
  private readonly vacancies = new Map<string, Vacancy>();
  private readonly inputs = new Map<number, PlayerInput>();
  /** Display name per player id, kept here so the simulation never has to care about them. */
  private readonly names: Record<number, string> = {};
  private readonly onEmpty: (room: Room) => void;
  /** Whoever opened the room, by client id, so the choice survives their reconnects. */
  private hostClientId: string | null = null;
  private readonly pendingEvents: SimEvent[] = [];
  private timer: NodeJS.Timeout | null = null;
  private tick = 0;
  private time = 0;
  private sinceSnapshot = 0;
  private lastStepAt = 0;

  /** The map the room is on right now, for the welcome message. */
  get currentMapId(): string {
    return this.mapId;
  }

  private constructor(code: string, mapId: string, sim: Simulation, onEmpty: (room: Room) => void) {
    this.code = code;
    this.mapId = mapId;
    this.sim = sim;
    this.onEmpty = onEmpty;
  }

  static async create(code: string, mapId: string, onEmpty: (room: Room) => void = () => undefined): Promise<Room> {
    const id = isMapId(mapId) ? mapId : DEFAULT_MAP_ID;
    const sim = await Simulation.create(getMap(id), { seed: Date.now() & 0xffff });
    return new Room(code, id, sim, onEmpty);
  }

  /**
   * The host sets up the match: arena, mode and length. It does not change under everyone's
   * feet immediately: the choice is announced and applied a few seconds later, so a change of
   * mind is free and nobody is teleported mid-punch. Picking what is already in play calls a
   * pending change off.
   */
  setup(peer: Peer, raw: unknown, randomize: unknown): void {
    if (this.members.get(peer)?.clientId !== this.hostClientId) return; // not the host: ignored
    this.randomize = randomize === true;
    const setup = readSetup(raw);
    if (!setup || !isMapId(setup.mapId)) return;
    if (this.pending && sameSetup(setup, this.pending.setup)) return; // already on its way
    this.pending = sameSetup(setup, this.current()) ? null : { setup, secondsLeft: MAP_CHANGE_DELAY };
  }

  private current(): MatchSetup {
    const { mode, matchSeconds } = this.sim.rounds.config;
    return { mapId: this.mapId, mode, matchSeconds };
  }

  /** What the clients need to draw the setup panel and the countdown. */
  private roomInfo(): RoomInfo {
    const host = this.hostClientId === null ? null : [...this.members.values()].find((m) => m.clientId === this.hostClientId);
    return {
      ...this.current(),
      randomize: this.randomize,
      pending: this.pending?.setup ?? null,
      pendingIn: this.pending?.secondsLeft ?? 0,
      hostId: host?.playerIds[0] ?? null,
    };
  }

  /** Counts a called change down and applies it when it lands: a fresh match either way. */
  private advanceSetupChange(dt: number): void {
    if (!this.pending) return;
    this.pending.secondsLeft -= dt;
    if (this.pending.secondsLeft > 0) return;
    const { setup } = this.pending;
    this.pending = null;
    this.sim.rounds.configure(setup.mode, setup.matchSeconds);
    if (setup.mapId === this.mapId) {
      this.sim.rounds.startMatch();
      return;
    }
    this.mapId = setup.mapId;
    this.sim.changeMap(getMap(setup.mapId));
  }

  /** With randomize on, every finished match moves the room somewhere new. */
  private rollNextMap(): void {
    if (!this.randomize) return;
    const options = listMaps().filter((m) => m.id !== this.mapId);
    const next = options[Math.floor(Math.random() * options.length)];
    if (next) this.pending = { setup: { ...this.current(), mapId: next.id }, secondsLeft: MAP_CHANGE_DELAY };
  }

  get playerCount(): number {
    return this.sim.playerCount;
  }

  /** Empty means nobody here and nobody expected back; only then is the room thrown away. */
  get isEmpty(): boolean {
    return this.members.size === 0 && this.vacancies.size === 0;
  }

  /**
   * Seats a connection. A client returning inside the grace period takes back the player it
   * had, so a dropped connection costs you a moment rather than your match.
   */
  join(peer: Peer, clientId: string, rawName: string): number[] | null {
    const returning = this.vacancies.get(clientId);
    const name = sanitizeName(rawName);
    if (returning) {
      this.vacancies.delete(clientId);
      this.members.set(peer, { peer, clientId, name: name || returning.name, playerIds: returning.playerIds, silentFor: 0 });
      for (const id of returning.playerIds) this.names[id] = this.displayName(name || returning.name, id);
      this.start();
      return returning.playerIds;
    }
    if (this.sim.playerCount + MAX_LOCAL_PLAYERS > MAX_ROOM_PLAYERS) return null;
    const playerIds: number[] = [];
    for (let i = 0; i < MAX_LOCAL_PLAYERS; i++) {
      const id = this.sim.addPlayer();
      playerIds.push(id);
      this.inputs.set(id, emptyInput());
      this.names[id] = this.displayName(name, id);
    }
    this.members.set(peer, { peer, clientId, name, playerIds, silentFor: 0 });
    this.hostClientId ??= clientId; // first one in runs the room
    this.start();
    return playerIds;
  }

  /** Falls back to the player number, and keeps names unique so two Bobs stay tellable apart. */
  private displayName(name: string, id: number): string {
    const wanted = name || `Player ${id}`;
    const clash = Object.entries(this.names).some(([other, taken]) => Number(other) !== id && taken === wanted);
    return clash ? `${wanted} (${id})` : wanted;
  }

  /** A connection dropped: hold its player still and wait a while before writing them off. */
  leave(peer: Peer): void {
    const member = this.members.get(peer);
    if (!member) return;
    this.members.delete(peer);
    // The host keeps the room while they might still come back; once they are written off,
    // whoever is still here takes over rather than leaving nobody able to change the map.
    for (const id of member.playerIds) this.inputs.set(id, emptyInput());
    this.vacancies.set(member.clientId, { playerIds: member.playerIds, name: member.name, graceLeft: RECONNECT_GRACE });
  }

  /** Inputs from one connection. Ids it does not own are ignored rather than trusted. */
  applyInput(peer: Peer, inputs: [number, PlayerInput][]): void {
    const member = this.members.get(peer);
    if (!member) return;
    member.silentFor = 0;
    for (const [id, input] of inputs) {
      if (member.playerIds.includes(id)) this.inputs.set(id, sanitize(input));
    }
  }

  rematch(peer: Peer): void {
    if (this.members.has(peer) && this.sim.rounds.currentPhase === 'match-over') this.sim.rounds.rematch();
  }

  private start(): void {
    if (this.timer) return;
    this.lastStepAt = Date.now();
    this.timer = setInterval(() => this.step(), 1000 / PHYSICS.stepHz);
  }

  private stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  /** One server tick: feed inputs, advance the world, and broadcast on the snapshot beat. */
  private step(): void {
    const now = Date.now();
    const dt = Math.min((now - this.lastStepAt) / 1000, 0.1);
    this.lastStepAt = now;
    this.time += dt;
    this.tick++;

    for (const member of this.members.values()) {
      member.silentFor += dt;
      if (member.silentFor < INPUT_TIMEOUT) continue;
      for (const id of member.playerIds) this.inputs.set(id, emptyInput()); // gone quiet: stop moving
    }
    this.expireVacancies(dt);
    this.advanceSetupChange(dt);
    for (const [id, input] of this.inputs) this.sim.setInput(id, input);
    this.sim.update(dt);
    const events = this.sim.drainEvents();
    if (events.some((e) => e.type === 'match-over')) this.rollNextMap();
    this.pendingEvents.push(...events);

    this.sinceSnapshot += dt;
    if (this.sinceSnapshot < 1 / SNAPSHOT_HZ) return;
    // Subtract rather than zero, or a coarse OS timer quietly costs us snapshots every second.
    this.sinceSnapshot = Math.min(this.sinceSnapshot - 1 / SNAPSHOT_HZ, 1 / SNAPSHOT_HZ);
    this.broadcast({
      t: 'snapshot',
      snapshot: captureSnapshot(this.sim, { tick: this.tick, time: this.time, names: this.names, room: this.roomInfo() }),
      events: this.pendingEvents.splice(0, this.pendingEvents.length),
    });
  }

  /** Gives up on connections that never came back, and closes the room once nobody is left. */
  private expireVacancies(dt: number): void {
    for (const [clientId, vacancy] of this.vacancies) {
      vacancy.graceLeft -= dt;
      if (vacancy.graceLeft > 0) continue;
      for (const id of vacancy.playerIds) {
        this.sim.removePlayer(id);
        this.inputs.delete(id);
        delete this.names[id];
      }
      this.vacancies.delete(clientId);
      if (clientId === this.hostClientId) this.hostClientId = [...this.members.values()][0]?.clientId ?? null;
    }
    if (!this.isEmpty) return;
    this.stop();
    this.onEmpty(this);
  }

  private broadcast(message: ServerMessage): void {
    const data = encode(message);
    for (const member of this.members.values()) member.peer.send(data);
  }
}

/** Input arrives from the network, so every field is clamped before the sim ever sees it. */
function sanitize(input: PlayerInput): PlayerInput {
  return {
    moveX: clamp(input.moveX),
    moveZ: clamp(input.moveZ),
    run: input.run === true,
    jump: input.jump === true,
    punch: input.punch === true,
    kick: input.kick === true,
    grab: input.grab === true,
  };
}

function clamp(value: number): number {
  return Number.isFinite(value) ? Math.max(-1, Math.min(1, value)) : 0;
}
