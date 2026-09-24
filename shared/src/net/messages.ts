import type { PlayerInput } from '../sim/PlayerInput';
import type { SimEvent } from '../sim/events';
import type { Snapshot } from './Snapshot';

/** Bumped whenever these shapes change; a mismatched client is turned away with a clear reason. */
export const PROTOCOL_VERSION = 4;
export const DEFAULT_PORT = 8787;
/** One player per connection - everyone plays on their own screen. */
export const MAX_LOCAL_PLAYERS = 1;
/** Players in one room. The arena and the score strip are built for this many. */
export const MAX_ROOM_PLAYERS = 8;
/** Long enough for a name worth having, short enough to fit over a character's head. */
export const MAX_NAME_LENGTH = 12;
/**
 * Seconds between calling a map and the arena actually changing. Everyone sees it counting
 * down, and the host can change their mind - picking again simply restarts it.
 */
export const MAP_CHANGE_DELAY = 3;

export interface JoinMessage {
  t: 'join';
  protocol: number;
  /** Room code; the server creates the room if nobody is in it yet. */
  room: string;
  /**
   * Who this client is, across connections. A reconnect inside the grace period presents the
   * same id and gets its own player back, rather than arriving as a stranger.
   */
  clientId: string;
  /** What to call this player in the score strip and over their head. */
  name: string;
  /** Insist the room is new: how "create a room" avoids walking into someone else's match. */
  create?: boolean;
}

/** The host choosing the next arena. Anyone else asking is ignored. */
export interface SetMapMessage {
  t: 'setMap';
  mapId: string;
  randomize: boolean;
}

/** One frame of intent per player this connection owns. Sent every client frame. */
export interface InputMessage {
  t: 'input';
  inputs: [number, PlayerInput][];
}

export interface RematchMessage {
  t: 'rematch';
}

export type ClientMessage = JoinMessage | InputMessage | RematchMessage | SetMapMessage;

export interface WelcomeMessage {
  t: 'welcome';
  room: string;
  mapId: string;
  /** The ids this connection drives, in the order it asked for them. */
  playerIds: number[];
  /** How many snapshots per second to expect, so the client can size its buffer. */
  snapshotHz: number;
}

/** The server's heartbeat: the world, plus whatever happened since the last one. */
export interface SnapshotMessage {
  t: 'snapshot';
  snapshot: Snapshot;
  events: SimEvent[];
}

export interface ErrorMessage {
  t: 'error';
  message: string;
}

export type ServerMessage = WelcomeMessage | SnapshotMessage | ErrorMessage;

export function encode(message: ClientMessage | ServerMessage): string {
  return JSON.stringify(message);
}

/**
 * Parses a message off the wire. Anything that is not a known message type comes back as null
 * rather than throwing, because a socket is untrusted input and one bad frame must not take a
 * room down with it.
 */
export function decodeClient(raw: string): ClientMessage | null {
  const value = parse(raw);
  if (!value) return null;
  const known = value.t === 'join' || value.t === 'input' || value.t === 'rematch' || value.t === 'setMap';
  return known ? (value as ClientMessage) : null;
}

export function decodeServer(raw: string): ServerMessage | null {
  const value = parse(raw);
  if (!value) return null;
  return value.t === 'welcome' || value.t === 'snapshot' || value.t === 'error' ? (value as ServerMessage) : null;
}

function parse(raw: string): { t?: string } | null {
  try {
    const value: unknown = JSON.parse(raw);
    return typeof value === 'object' && value !== null ? (value as { t?: string }) : null;
  } catch {
    return null;
  }
}

/**
 * Names arrive from the network, so they are cut to size and stripped of anything that is not
 * printable before they reach a canvas or a score strip. An empty result means "no name given"
 * and the caller falls back to the player number.
 */
export function sanitizeName(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  return raw.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, MAX_NAME_LENGTH);
}

/** Room codes are four letters, easy to read out loud and to type in the wrong case. */
export function normalizeRoomCode(code: string): string {
  return code.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
}

/** No I, O or 0: nobody should lose a match to a misread room code. */
const CODE_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

export function randomRoomCode(): string {
  let code = '';
  for (let i = 0; i < 4; i++) code += CODE_LETTERS[Math.floor(Math.random() * CODE_LETTERS.length)] ?? 'A';
  return code;
}
