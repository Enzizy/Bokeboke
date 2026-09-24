import { getMap, DEFAULT_MAP_ID } from '@shared/maps/MapRegistry';
import { DEFAULT_PORT, normalizeRoomCode, sanitizeName } from '@shared/net/messages';
import { Simulation } from '@shared/sim/Simulation';
import { WEAPONS } from '@shared/weapons/weaponCatalog';
import { Game, SKINS } from './app/Game';
import { LocalSession, type Session } from './app/Session';
import { NetworkSession } from './net/NetworkSession';
import { characterRef, weaponRef } from './assets/assetPaths';
import { DEFAULT_BINDINGS } from './input/PlayerBindings';
import { LobbyMenu, type LobbyChoice } from './ui/LobbyMenu';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const debugEl = document.getElementById('debug') as HTMLElement;
const hudEl = document.getElementById('hud') as HTMLElement;
const loadingEl = document.getElementById('loading') as HTMLElement;
const params = new URLSearchParams(location.search);
const lobby = new LobbyMenu(document.body);

/**
 * Practice runs the match in this tab against a sparring dummy; the online modes hand it to a
 * server and only draw what comes back. The rest of the client cannot tell the difference.
 */
async function openSession(choice: LobbyChoice): Promise<Session> {
  if (choice.mode === 'practice') {
    const crateSpawn = params.has('crate') ? { firstDelay: 0.2 } : {};
    const sim = await Simulation.create(getMap(DEFAULT_MAP_ID), { seed: Date.now() & 0xffff, crateSpawn });
    const session = new LocalSession(sim, choice.name);
    session.addLocalPlayer();
    session.addSparringDummy(); // someone to hit, and enough players for rounds to run
    return session;
  }
  return NetworkSession.join(serverUrl(params.get('server')), choice.room, choice.name, choice.mode === 'create', (seconds) => {
    // Free hosting naps between matches. Say so, rather than looking broken for a minute.
    lobby.showBusy(seconds < 8 ? 'Connecting...' : `Waking the server... (${seconds}s)`);
  });
}

/** Keeps asking until something connects, so a full room or a typo returns you to the menu. */
async function chooseSession(): Promise<Session> {
  // URL shortcuts skip the menu; `&name=` names the player the way the menu would have.
  const name = sanitizeName(params.get('name'));
  const direct = params.get('room');
  if (direct) return openSession({ mode: 'join', room: normalizeRoomCode(direct), name });
  if (params.has('server')) return openSession({ mode: 'join', room: 'ARENA', name });
  if (params.has('practice') || params.has('ff')) return openSession({ mode: 'practice', name });

  for (;;) {
    const choice = await lobby.choose();
    try {
      return await openSession(choice);
    } catch (err: unknown) {
      lobby.showError(err instanceof Error ? err.message : 'Could not connect.');
    }
  }
}

async function boot(): Promise<void> {
  loadingEl.hidden = true;
  const session = await chooseSession();
  lobby.showBusy('Loading the arena...');
  const map = getMap(session.mapId);
  const game = new Game(canvas, debugEl, hudEl, map.skyColor);
  game.setSession(session);
  // Map, physics, characters and drop weapons download together, so nothing pops in later.
  const weaponRefs = [...Object.values(WEAPONS).map((w) => weaponRef(w.model)), weaponRef('arrow_A')];
  await Promise.all([game.loadMap(map), game.loader.loadAll([...SKINS.map(characterRef), ...weaponRefs])]);
  game.bindLocalPlayer(DEFAULT_BINDINGS);
  lobby.hide();
  loadingEl.remove();
  game.start();
}

/**
 * Where the match server is. `?server=` wins, so you can always point a build somewhere else;
 * otherwise a URL baked in at build time (VITE_SERVER_URL) is used, and failing that the
 * machine serving the page - which is what you want while developing.
 */
function serverUrl(value: string | null): string {
  const baked = import.meta.env['VITE_SERVER_URL'];
  if (!value || value === '1' || value === 'true') {
    if (typeof baked === 'string' && baked.length > 0) return baked;
    // A page served over https cannot open a ws:// socket, so match the page's protocol.
    const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
    return `${scheme}://${location.hostname}:${DEFAULT_PORT}`;
  }
  if (value.startsWith('ws://') || value.startsWith('wss://')) return value;
  return `ws://${value}`;
}

addEventListener('error', (e) => { lobby.showError(`Error: ${e.message}`); });
addEventListener('unhandledrejection', (e) => { lobby.showError(`Error: ${String(e.reason)}`); });

boot().catch((err: unknown) => {
  console.error(err);
  lobby.showError(err instanceof Error ? err.message : 'Failed to load - see console');
});
