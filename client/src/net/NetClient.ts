import { decodeServer, encode, PROTOCOL_VERSION, type JoinMessage, type MatchSetup, type ServerMessage } from '@shared/net/messages';
import type { Snapshot } from '@shared/net/Snapshot';
import type { SimEvent } from '@shared/sim/events';
import type { PlayerInput } from '@shared/sim/PlayerInput';

export interface Connected {
  room: string;
  mapId: string;
  /** The ids this client drives. */
  playerIds: number[];
  snapshotHz: number;
}

/** Seconds between reconnect attempts, and how long to keep trying before giving up. */
const RETRY_EVERY = 1.5;
const RETRY_FOR = 18;
/**
 * How long to wait for a server to answer before giving up on it. A wrong address, or a
 * firewall quietly dropping the packets, leaves the socket hanging for the best part of a
 * minute - long enough that the menu looks frozen rather than unable to connect.
 *
 * Free hosting sleeps when nobody is playing and takes the better part of a minute to wake,
 * so a first attempt is given a long window and retried; the caller is told it is waking
 * rather than left staring at a spinner.
 */
const CONNECT_TIMEOUT_MS = 8000;
const WAKE_TIMEOUT_MS = 75000;
const WAKE_RETRY_MS = 3000;

/**
 * The socket to the game server: sends this keyboard's intent, collects snapshots and events.
 * It holds no game state of its own - it is a pipe with a mailbox - but it does keep trying to
 * get back in when a connection drops, presenting the same client id so the server hands back
 * the player that was already out there.
 */
export class NetClient {
  readonly url: string;
  /** Stable across reconnects (and page reloads in this tab), so the server knows us again. */
  readonly clientId: string;
  private socket: WebSocket | null = null;
  private readonly inbox: Snapshot[] = [];
  private readonly events: SimEvent[] = [];
  private room = '';
  private name = '';
  private status: 'connecting' | 'live' | 'retrying' | 'lost' = 'connecting';
  private retryIn = 0;
  private givingUpIn = 0;
  private lastError = '';
  /** Set when the server refuses us outright: retrying would only be refused again. */
  private fatal = false;
  private onWelcome: ((connected: Connected) => void) | null = null;

  constructor(url: string, clientId = sessionId()) {
    this.url = url;
    this.clientId = clientId;
  }

/**
   * Opens the socket, asks for a seat, and resolves once the server has welcomed us. A server
   * that is merely asleep refuses the first attempts, so those are retried for a while and
   * `onWaking` is called to say so; a server that is not there at all still fails quickly.
   */
  connect(room: string, name: string, create = false, onWaking?: (secondsWaited: number) => void): Promise<Connected> {
    this.room = room;
    this.name = name;
    return new Promise<Connected>((resolve, reject) => {
      const startedAt = Date.now();
      let settled = false;
      let retry: ReturnType<typeof setTimeout> | null = null;
      const waited = (): number => Math.round((Date.now() - startedAt) / 1000);
      const finish = (): boolean => {
        if (settled) return false;
        settled = true;
        if (retry) clearTimeout(retry);
        return true;
      };

      const attempt = (): void => {
        this.open(create, (connected) => {
          if (!finish()) return;
          this.status = 'live';
          resolve(connected);
        }, (reason) => {
          if (settled) return;
          if (this.fatal || Date.now() - startedAt > WAKE_TIMEOUT_MS) {
            if (!finish()) return;
            this.status = 'lost';
            reject(new Error(waited() > 10 ? `Gave up waiting for ${this.url}.` : reason));
            return;
          }
          // Not there *yet*: most likely a free host still getting out of bed.
          onWaking?.(waited());
          retry = setTimeout(attempt, WAKE_RETRY_MS);
        });
      };

      // A first attempt that simply hangs (a firewall swallowing packets) gets cut short, so
      // the retry loop can report progress instead of the menu sitting there silently.
      setTimeout(() => {
        if (!settled && this.status === 'connecting') this.socket?.close();
      }, CONNECT_TIMEOUT_MS);
      attempt();
    });
  }

  /** Nudges a sleeping host awake over plain HTTP; the socket attempt follows. */
  async wake(): Promise<void> {
    const http = this.url.replace(/^ws/, 'http');
    try {
      await fetch(http, { mode: 'no-cors' });
    } catch {
      // It is a best-effort knock on the door; the socket attempts are what actually matter.
    }
  }

  /** What to do when a reconnect succeeds: the session re-reads the ids it was given. */
  set onReconnect(handler: (connected: Connected) => void) {
    this.onWelcome = handler;
  }

  /** Null while all is well, otherwise something to put on screen. */
  statusMessage(): string | null {
    if (this.status === 'retrying') return 'Connection lost - reconnecting...';
    if (this.status === 'lost') return this.lastError || 'Disconnected from the server.';
    return null;
  }

  get isLost(): boolean {
    return this.status === 'lost';
  }

  send(inputs: ReadonlyMap<number, PlayerInput>): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN || inputs.size === 0) return;
    this.socket.send(encode({ t: 'input', inputs: [...inputs] }));
  }

  rematch(): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(encode({ t: 'rematch' }));
  }

  setup(setup: MatchSetup, randomize: boolean): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(encode({ t: 'setup', setup, randomize }));
  }

  /** Call once a frame: drives the retry timer. */
  update(dt: number): void {
    if (this.status !== 'retrying') return;
    this.givingUpIn -= dt;
    if (this.givingUpIn <= 0) {
      this.status = 'lost';
      this.lastError = 'Could not get back to the server.';
      return;
    }
    this.retryIn -= dt;
    if (this.retryIn > 0) return;
    this.retryIn = RETRY_EVERY;
    this.open(false, (connected) => {
      this.status = 'live';
      this.onWelcome?.(connected);
    }, () => undefined); // a failed attempt just waits for the next tick
  }

  takeSnapshots(): Snapshot[] {
    return this.inbox.splice(0, this.inbox.length);
  }

  takeEvents(): SimEvent[] {
    return this.events.splice(0, this.events.length);
  }

  disconnect(): void {
    this.status = 'lost';
    this.socket?.close();
    this.socket = null;
  }

  /**
   * One connection attempt. Only the newest attempt is allowed to matter: a refused socket fires
   * both \`error\` and \`close\`, and an attempt can still be in flight when a retry replaces it.
   * Left unguarded, each failure scheduled two retries - they doubled every round while a free
   * host slept - and when it woke, several connected at once: one opened the room, the rest were
   * told it was already in use, and that stale refusal marked the live connection as dead.
   */
  private open(create: boolean, welcome: (connected: Connected) => void, fail: (reason: string) => void): void {
    const socket = new WebSocket(this.url);
    this.socket = socket;
    const superseded = (): boolean => this.socket !== socket;
    let failed = false;
    const failOnce = (reason: string): void => {
      if (failed || superseded()) return;
      failed = true;
      fail(reason);
    };

    socket.addEventListener('open', () => {
      if (superseded()) {
        socket.close(); // a later attempt has taken over; do not take a second seat
        return;
      }
      const join: JoinMessage = { t: 'join', protocol: PROTOCOL_VERSION, room: this.room, clientId: this.clientId, name: this.name };
      socket.send(encode(create ? { ...join, create: true } : join));
    });
    socket.addEventListener('message', (e: MessageEvent) => {
      if (superseded()) return;
      const message = decodeServer(String(e.data));
      if (!message) return;
      if (message.t === 'welcome') {
        welcome({ room: message.room, mapId: message.mapId, playerIds: message.playerIds, snapshotHz: message.snapshotHz });
        return;
      }
      if (message.t === 'snapshot') {
        this.inbox.push(message.snapshot);
        this.events.push(...message.events);
        return;
      }
      this.fatal = true; // the server told us why, and it will say the same next time
      this.lastError = message.message;
      failOnce(message.message);
    });
    socket.addEventListener('error', () => failOnce(`Could not reach ${this.url}. Is the game server running?`));
    socket.addEventListener('close', () => {
      if (superseded()) return; // an older socket finishing after we moved on
      if (this.status === 'live' && !this.fatal) {
        this.status = 'retrying';
        this.retryIn = RETRY_EVERY;
        this.givingUpIn = RETRY_FOR;
        return;
      }
      if (this.status === 'connecting') failOnce(this.lastError || `Could not reach ${this.url}. Is the game server running?`);
      if (this.fatal) this.status = 'lost';
    });
  }
}

/** One id per tab, kept across reloads so refreshing mid-match does not cost you your player. */
function sessionId(): string {
  const key = 'wobble-client-id';
  try {
    const existing = sessionStorage.getItem(key);
    if (existing) return existing;
    const fresh = Math.random().toString(36).slice(2, 10);
    sessionStorage.setItem(key, fresh);
    return fresh;
  } catch {
    return Math.random().toString(36).slice(2, 10); // private mode: a fresh id is fine
  }
}
