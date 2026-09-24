import { createServer } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import { DEFAULT_MAP_ID } from '@shared/maps/MapRegistry';
import { decodeClient, encode, normalizeRoomCode, PROTOCOL_VERSION, type JoinMessage, type ServerMessage } from '@shared/net/messages';
import { Room, SNAPSHOT_HZ, type Peer } from './Room';

const port = Number(process.env['PORT'] ?? 8787);
const rooms = new Map<string, Room>();
/** Rooms are created on demand, so two people typing the same code meet in the same match. */
const opening = new Map<string, Promise<Room>>();

/**
 * A plain HTTP server sits in front of the socket for two reasons: hosts health-check with an
 * ordinary GET (a bare WebSocket server answers 426 and fails the check), and a sleeping free
 * instance is woken by exactly such a request - so this is also the door the client knocks on.
 */
const http = createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/plain', 'access-control-allow-origin': '*' });
  res.end(`wobble-wars: awake, ${rooms.size} room(s)\n`);
});
const wss = new WebSocketServer({ server: http });
http.listen(port, () => console.log(`Wobble Wars server listening on port ${port}`));

wss.on('connection', (socket: WebSocket) => {
  const peer = peerFor(socket);
  let room: Room | null = null;

  socket.on('message', (raw: Buffer | string) => {
    const message = decodeClient(raw.toString());
    if (!message) return; // not ours; ignore rather than drop the connection
    if (message.t === 'join') {
      if (room) return; // already seated
      if (message.protocol !== PROTOCOL_VERSION) {
        send(socket, { t: 'error', message: `Server speaks protocol ${PROTOCOL_VERSION}, you speak ${message.protocol}. Reload the page.` });
        socket.close();
        return;
      }
      void seat(peer, message).then((seated) => {
        if (typeof seated === 'string') {
          send(socket, { t: 'error', message: seated });
          socket.close();
          return;
        }
        room = seated.room;
        send(socket, { t: 'welcome', room: seated.room.code, mapId: seated.room.currentMapId, playerIds: seated.playerIds, snapshotHz: SNAPSHOT_HZ });
        console.log(`${seated.room.code}: +${seated.playerIds.length} player(s), ${seated.room.playerCount} in room`);
      });
      return;
    }
    if (!room) return; // everything else needs a seat first
    if (message.t === 'input') room.applyInput(peer, message.inputs);
    else if (message.t === 'rematch') room.rematch(peer);
    else if (message.t === 'setMap') room.setMap(peer, message.mapId, message.randomize);
  });

  socket.on('close', () => {
    if (!room) return;
    room.leave(peer); // their player waits a while in case they come straight back
    console.log(`${room.code}: a connection dropped, ${room.playerCount} player(s) still in`);
  });

  socket.on('error', () => socket.close());
});

/**
 * Finds or opens the room, then seats the peer. Concurrent joins on a new code share one room;
 * a `create` join refuses an existing one, so "create a room" cannot drop you into a stranger's
 * match. Returns a message instead of a seat when it cannot be done.
 */
async function seat(peer: Peer, join: JoinMessage): Promise<{ room: Room; playerIds: number[] } | string> {
  const key = normalizeRoomCode(join.room) || 'ARENA';
  let room = rooms.get(key);
  if (room && join.create) return `Room ${key} is already in use - try another code.`;
  if (!room) {
    let pending = opening.get(key);
    if (!pending) {
      pending = Room.create(key, DEFAULT_MAP_ID, (closed) => {
        rooms.delete(closed.code);
        console.log(`${closed.code}: empty, closed`);
      });
      opening.set(key, pending);
      pending.finally(() => opening.delete(key)).catch(() => undefined);
    }
    room = await pending;
    rooms.set(key, room);
  }
  const playerIds = room.join(peer, join.clientId, join.name);
  return playerIds ? { room, playerIds } : 'That room is full.';
}

function peerFor(socket: WebSocket): Peer {
  return {
    send: (data) => {
      if (socket.readyState === socket.OPEN) socket.send(data);
    },
    close: (reason) => {
      send(socket, { t: 'error', message: reason });
      socket.close();
    },
  };
}

function send(socket: WebSocket, message: ServerMessage): void {
  if (socket.readyState === socket.OPEN) socket.send(encode(message));
}
