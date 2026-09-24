/**
 * End-to-end smoke test of the authoritative server. Starts the real built server, talks to it
 * over real WebSockets, and asserts that input goes in one end and an agreed world comes out:
 *   npm run test:net
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { emptyInput, type PlayerInput } from '@shared/sim/PlayerInput';
import { decodeServer, encode, MAX_NAME_LENGTH, PROTOCOL_VERSION, type ServerMessage } from '@shared/net/messages';
import type { Snapshot } from '@shared/net/Snapshot';
import type { GameMode } from '@shared/sim/RoundSystem';
import { NetClient } from '../../client/src/net/NetClient';

const PORT = 8899;
const SERVER_URL = `ws://127.0.0.1:${PORT}`;

function check(condition: boolean, message: string): void {
  if (!condition) throw new Error(`FAILED: ${message}`);
  console.log(`ok   ${message}`);
}

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Waits for something the server has to do, rather than guessing how long it takes this machine. */
async function waitFor(condition: () => boolean, ms = 8000): Promise<void> {
  for (let waited = 0; waited < ms && !condition(); waited += 50) await wait(50);
}

/** A test client: connects, remembers what the server said, and can hold keys down. */
class TestClient {
  readonly socket: WebSocket;
  /** Stable per client, which is what lets a reconnect reclaim its player. */
  readonly clientId = Math.random().toString(36).slice(2, 10);
  playerIds: number[] = [];
  latest: Snapshot | null = null;
  snapshots = 0;
  error: string | null = null;
  private input: Partial<PlayerInput> = {};
  private sender: NodeJS.Timeout | null = null;

  constructor() {
    this.socket = new WebSocket(SERVER_URL);
    this.socket.addEventListener('message', (e: MessageEvent) => {
      const message: ServerMessage | null = decodeServer(String(e.data));
      if (!message) return;
      if (message.t === 'welcome') this.playerIds = message.playerIds;
      else if (message.t === 'snapshot') {
        this.latest = message.snapshot;
        this.snapshots++;
      } else if (message.t === 'error') this.error = message.message;
    });
  }

  async open(): Promise<void> {
    if (this.socket.readyState === WebSocket.OPEN) return;
    await new Promise<void>((resolve, reject) => {
      this.socket.addEventListener('open', () => resolve(), { once: true });
      this.socket.addEventListener('error', () => reject(new Error('socket failed to open')), { once: true });
    });
  }

  join(room: string, options: { protocol?: number; create?: boolean; clientId?: string; name?: string } = {}): void {
    this.socket.send(encode({
      t: 'join',
      protocol: options.protocol ?? PROTOCOL_VERSION,
      room,
      clientId: options.clientId ?? this.clientId,
      name: options.name ?? '',
      ...(options.create ? { create: true } : {}),
    }));
  }

  /** Starts sending this input every frame, the way the real client does. */
  hold(input: Partial<PlayerInput>, forPlayerId?: number): void {
    this.input = input;
    if (this.sender) return;
    this.sender = setInterval(() => {
      const id = forPlayerId ?? this.playerIds[0];
      if (id === undefined) return;
      this.socket.send(encode({ t: 'input', inputs: [[id, { ...emptyInput(), ...this.input }]] }));
    }, 16);
  }

  setup(mapId: string, randomize = false, mode: GameMode = 'rounds', matchSeconds = 180): void {
    this.socket.send(encode({ t: 'setup', setup: { mapId, mode, matchSeconds }, randomize }));
  }

  stop(): void {
    if (this.sender) clearInterval(this.sender);
    this.sender = null;
  }

  playerById(id: number) {
    return this.latest?.players.find((p) => p.id === id);
  }

  close(): void {
    this.stop();
    this.socket.close();
  }
}

// This file is bundled to server/test/.out/, so the server package root is two levels up.
const serverRoot = fileURLToPath(new URL('../..', import.meta.url));
const server = spawn(process.execPath, ['.out/index.mjs'], {
  cwd: serverRoot,
  env: { ...process.env, PORT: String(PORT) },
  stdio: ['ignore', 'pipe', 'inherit'],
});
server.stdout.on('data', () => undefined); // drained so the pipe never fills

/** Polls the health endpoint until the server answers - startup time varies a lot by machine. */
async function untilListening(port: number): Promise<void> {
  for (let i = 0; i < 100; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/`);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await wait(100);
  }
  throw new Error(`server on port ${port} never started`);
}

try {
  await untilListening(PORT); // a fixed pause was flaky: startup takes anywhere from 0.5 to 1.5 s
  const a = new TestClient();
  await a.open();
  a.join('TEST', { create: true, name: 'Ada' });
  await waitFor(() => a.latest !== null); // the first room in a process also warms up the physics
  check(a.playerIds.length === 1, `a connection gets one player (id ${a.playerIds.join(',')})`);
  check(a.snapshots > 0 && a.latest !== null, 'the server starts broadcasting snapshots as soon as someone is in');
  check(a.latest?.players.length === 1, 'the snapshot carries every player in the room');
  check(a.latest?.round.phase === 'waiting', 'one player alone is free play, not a match');

  // Creating a room that already exists is refused rather than dropping you into it.
  const clash = new TestClient();
  await clash.open();
  clash.join('TEST', { create: true });
  await wait(400);
  check(clash.error !== null && clash.error.includes('already in use'), 'creating a room that exists is refused');
  clash.close();

  // A second connection makes it a match, and it counts itself down.
  const b = new TestClient();
  await b.open();
  b.join('test', { name: 'Bo  ' }); // lower case: room codes are normalised
  await waitFor(() => (b.latest?.players.length ?? 0) === 2);
  check(b.playerIds.length === 1 && !b.playerIds.some((id) => a.playerIds.includes(id)), 'the second connection gets its own player id');
  check(b.latest?.players.length === 2, 'both connections see both players');
  check(a.latest?.names[a.playerIds[0] as number] === 'Ada', 'players are known by the name they gave');
  check(b.latest?.names[b.playerIds[0] as number] === 'Bo', 'and it is trimmed on the way in');
  await waitFor(() => a.latest?.round.phase === 'countdown'); // A may still be holding a snapshot from before B arrived
  check(a.latest?.round.phase === 'countdown', 'two players in the room start a match by themselves');
  const frozenAt = a.playerById(a.playerIds[0] as number)?.x ?? 0;
  a.hold({ moveX: 1 });
  await wait(700);
  check(Math.abs((a.playerById(a.playerIds[0] as number)?.x ?? 0) - frozenAt) < 0.05, 'nobody moves during the countdown');

  for (let i = 0; i < 40 && a.latest?.round.phase !== 'fighting'; i++) await wait(100);
  check(a.latest?.round.phase === 'fighting', 'the round starts once the countdown runs out');
  const before = a.playerById(a.playerIds[0] as number);
  check(before !== undefined, 'the snapshot keeps carrying the players it started with');
  // The server picks spawn points at random and the arena is full of things to walk into, so
  // this tries both directions and takes the best: nobody is boxed in on both sides.
  let topSpeed = 0;
  for (const moveX of [1, -1]) {
    a.hold({ moveX });
    for (let i = 0; i < 14; i++) {
      await wait(50);
      const now = a.playerById(a.playerIds[0] as number);
      if (now) topSpeed = Math.max(topSpeed, Math.hypot(now.vx, now.vz));
    }
  }
  check(topSpeed > 1.5, `held input actually moves the player on the server (reached ${topSpeed.toFixed(2)} m/s)`);

  // Jumping needs the server's ground check to work. It once did not: the server resolved a
  // different Rapier build to the one the game is written against, whose shape-cast arguments
  // mean something else, so nobody was ever standing on anything.
  a.hold({ jump: true });
  let highest = 0;
  for (let i = 0; i < 16; i++) {
    await wait(50);
    highest = Math.max(highest, a.playerById(a.playerIds[0] as number)?.y ?? 0);
  }
  a.hold({});
  check(highest > 0.3, `players can jump on the server (reached y=${highest.toFixed(2)})`);
  a.hold({}); // keys released: a real client keeps sending, it just sends nothing
  await wait(400); // let A coast to a stop before measuring whether anything moves them

  // Ownership: B may not drive A's player, however nicely it asks.
  const victim = a.playerIds[0] as number;
  const posBefore = b.playerById(victim)?.x ?? 0;
  b.hold({ moveX: -1 }, victim);
  await wait(800);
  b.stop();
  const posAfter = b.playerById(victim)?.x ?? 0;
  check(Math.abs(posAfter - posBefore) < 0.1, 'a connection cannot move a player it does not own');

  // Snapshot rate is roughly what the welcome promised.
  const countBefore = b.snapshots;
  await wait(1000);
  const rate = b.snapshots - countBefore;
  check(rate >= 12 && rate <= 28, `snapshots arrive at about 20 Hz (saw ${rate} in a second)`);

  // The host picks the arena, and it takes a few seconds so a change of mind is free.
  check(a.latest?.room.mapId === 'mini-arena', 'a room opens on the default map');
  check(a.latest?.room.hostId === a.playerIds[0], 'whoever opened the room is the host');
  a.setup('crossfire');
  await wait(500);
  check(a.latest?.room.pending?.mapId === 'crossfire' && (a.latest?.room.pendingIn ?? 0) > 0, 'picking a map announces it first');
  check(a.latest?.room.mapId === 'mini-arena', 'and nothing has changed yet');

  // Changing your mind inside the window is free: picking what is in play calls the change off.
  a.setup('mini-arena');
  await wait(400);
  check(a.latest?.room.pending === null && a.latest?.room.mapId === 'mini-arena', 'picking the current map again calls the change off');
  a.setup('crossfire');
  for (let i = 0; i < 40 && a.latest?.room.mapId !== 'crossfire'; i++) await wait(100);
  check(a.latest?.room.mapId === 'crossfire' && a.latest?.room.pending === null, 'the arena changes when the countdown runs out');
  check(b.latest?.room.mapId === 'crossfire', 'and everyone else is told about it too');

  // Only the host chooses. Anyone else asking is quietly ignored.
  b.setup('mini-arena');
  await wait(900);
  check(a.latest?.room.mapId === 'crossfire' && a.latest?.room.pending === null, 'a player who is not the host cannot change the map');

  a.setup('crossfire', true);
  await wait(400);
  check(a.latest?.room.randomize === true, 'the host can ask for a random map each match');
  a.setup('crossfire', false);
  await wait(300);

  // Timed mode: the host switches the match type the same way, and the server runs the clock.
  a.setup('crossfire', false, 'timed', 999);
  await wait(400);
  check(a.latest?.room.pending === null && a.latest?.room.mode === 'rounds', 'a match length the game does not offer is ignored');
  a.setup('crossfire', false, 'timed', 300);
  await wait(400);
  check(a.latest?.room.pending?.mode === 'timed' && a.latest?.room.mapId === 'crossfire', 'switching to a timed match is announced like a map change');
  await waitFor(() => a.latest?.round.mode === 'timed' && a.latest?.round.phase === 'fighting', 8000);
  const clock = a.latest?.round.timer ?? 0;
  check(a.latest?.room.mode === 'timed' && a.latest?.room.matchSeconds === 300 && clock > 290 && clock <= 300,
    `a timed match starts with its clock running (${clock.toFixed(1)}s left)`);
  check(b.latest?.round.kills !== undefined && Object.keys(b.latest.round.kills).length === 2, 'every player has a kill count in the snapshot');
  a.setup('crossfire', false, 'rounds', 180);
  await waitFor(() => a.latest?.round.mode === 'rounds', 8000);
  check(a.latest?.round.mode === 'rounds', 'and the host can switch back to rounds');

  // A drop is not the end: the player stays on the floor waiting for its client to return.
  const bPlayer = b.playerIds[0] as number;
  b.close();
  await wait(900);
  check(a.latest?.players.length === 2, 'a dropped player is kept while their client might come back');

  const bAgain = new TestClient();
  await bAgain.open();
  bAgain.join('TEST', { clientId: b.clientId, name: 'Bo' });
  await wait(600);
  check(bAgain.playerIds[0] === bPlayer, `reconnecting gets the same player back (id ${bAgain.playerIds.join(',')})`);
  check(bAgain.latest?.names[bPlayer] === 'Bo', 'and comes back under the same name');
  check(bAgain.latest?.players.length === 2, 'and the room still holds exactly two players');

  // Someone else entirely is a new player, not a returning one. This one arrives calling
  // itself Bo as well, with some rubbish attached, and gets told apart anyway.
  const stranger = new TestClient();
  await stranger.open();
  stranger.join('TEST', { name: 'Bo\u0007\u0000 the second, at great length' });
  await wait(600);
  const strangerId = stranger.playerIds[0] as number;
  const strangerName = stranger.latest?.names[strangerId] ?? '';
  check(strangerId !== bPlayer && stranger.latest?.players.length === 3, 'a different client is seated as a new player');
  check(strangerName.length <= MAX_NAME_LENGTH && !/[\u0000-\u001f]/.test(strangerName), `a silly name is cut down to size ("${strangerName}")`);
  check(strangerName !== 'Bo', 'and two players never share a name');
  stranger.close();

  // An out-of-date client is told why rather than silently misbehaving.
  const old = new TestClient();
  await old.open();
  old.join('TEST', { protocol: PROTOCOL_VERSION + 1 });
  await wait(400);
  check(old.error !== null && old.error.includes('protocol'), 'a protocol mismatch is refused with a readable reason');
  old.close();
  bAgain.close();
  a.close();
  await wait(200);

  // A free host sleeps when nobody is playing. The real client has to wait for it, and when
  // it wakes, take exactly one seat. Retries used to double every round while it slept - a
  // refused socket fires error and close, and each one scheduled a retry - so several sockets
  // connected at once, and the stale refusal they got back killed the live connection.
  {
    const LATE_PORT = 8898;
    const late = new NetClient(`ws://127.0.0.1:${LATE_PORT}`, 'late-riser');
    let retries = 0;
    const joining = late.connect('LATE', 'Sleepy', true, () => {
      retries++;
    });
    await wait(6000); // nothing listening yet: this is where the attempts used to multiply
    const sleeper = spawn(process.execPath, ['.out/index.mjs'], {
      cwd: serverRoot,
      env: { ...process.env, PORT: String(LATE_PORT) },
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    sleeper.stdout.on('data', () => undefined);
    try {
      const retriesWhileAsleep = retries;
      const seated = await joining;
      check(retriesWhileAsleep > 0 && retriesWhileAsleep <= 4, `the client waits for a sleeping server, one attempt at a time (${retriesWhileAsleep} retries in 6s)`);
      check(seated.playerIds.length === 1, 'and is seated once it wakes');
      await wait(1500);
      const health = await fetch(`http://127.0.0.1:${LATE_PORT}/`).then((r) => r.text());
      check(health.includes('1 room(s)'), `exactly one room was opened (${health.trim()})`);
      const seen = late.takeSnapshots();
      const newest = seen[seen.length - 1];
      check(newest?.players.length === 1, `with exactly one player in it (${newest?.players.length ?? 0})`);
      check(late.statusMessage() === null, `and the connection is healthy (${late.statusMessage() ?? 'ok'})`);
    } finally {
      late.disconnect();
      sleeper.kill();
    }
  }

  console.log('\nAll network checks passed.');
} finally {
  server.kill();
}
