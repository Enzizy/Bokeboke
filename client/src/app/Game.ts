import * as THREE from 'three';
import { getMap } from '@shared/maps/MapRegistry';
import type { MapDefinition } from '@shared/maps/MapDefinition';
import { emptyInput, type PlayerInput } from '@shared/sim/PlayerInput';
import { AssetLoader } from '../assets/AssetLoader';
import { characterRef } from '../assets/assetPaths';
import { DebugOverlay } from '../debug/DebugOverlay';
import { PhysicsDebugView } from '../debug/PhysicsDebugView';
import { KeyboardInput } from '../input/KeyboardInput';
import { readPlayerInput, type PlayerBindings } from '../input/PlayerBindings';
import { describeGrab, describeState, PlayerAvatar } from '../players/PlayerAvatar';
import { CharacterView } from '../render/CharacterView';
import { MapView } from '../render/MapView';
import { MapPicker } from '../ui/MapPicker';
import { RoundHud } from '../ui/RoundHud';
import { FollowCamera } from './FollowCamera';
import { EntityViews } from './EntityViews';
import type { Session } from './Session';
import { createScene, fitShadowToArea, type SceneParts } from './SceneSetup';

/** Score-strip colours per player: warm orange, sky blue, leaf green, sunflower. */
const PLAYER_COLORS = ['#e8834a', '#5aa9e6', '#6cbf5f', '#e6c04a'];
/** Character models, picked by player id so everyone in a room sees the same faces. */
export const SKINS = ['character-male-a', 'character-female-a', 'character-male-c', 'character-female-d'];

/**
 * Owns the frame loop and the top-level objects. Each frame: sample keyboards -> hand the input
 * to the session (a simulation in this tab, or a server) -> copy the resulting player states
 * onto their character views -> render. The session is the only thing that knows which it is.
 */
export class Game {
  readonly loader = new AssetLoader();
  readonly debug: DebugOverlay;
  readonly hud: RoundHud;
  private readonly maps: MapPicker;
  /** The map the scenery is currently built from, and whether a rebuild is in flight. */
  private loadedMapId = '';
  private loadingMap = false;
  /** Every player on screen, local or remote, by player id. */
  readonly avatars = new Map<number, PlayerAvatar>();
  private readonly parts: SceneParts;
  private readonly camera: FollowCamera;
  private readonly mapView: MapView;
  private readonly entities: EntityViews;
  private readonly keyboard = new KeyboardInput();
  private readonly clock = new THREE.Clock();
  private session: Session | null = null;
  private physicsDebug: PhysicsDebugView | null = null;
  private lastDt = 0;
  /** Which keyboard, if any, drives each player id. */
  private readonly bindings = new Map<number, PlayerBindings>();
  private keys: PlayerBindings | null = null;
  /** Avatars whose model is still loading, so a slow frame doesn't ask for the same one twice. */
  private readonly loadingAvatars = new Set<number>();
  private hudPlayerIds = '';
  private readonly inputs = new Map<number, PlayerInput>();
  /** Debug: `zoom=1` parks the camera close to the first local player. */
  private readonly zoomOnPlayer1 = new URLSearchParams(location.search).has('zoom');
  /** Debug scenario inputs that override the keyboard for a player while set. */
  private readonly scripted = new Map<number, PlayerInput>();

  constructor(canvas: HTMLCanvasElement, debugEl: HTMLElement, hudEl: HTMLElement, skyColor: number) {
    this.parts = createScene(canvas, skyColor);
    this.camera = new FollowCamera(window.innerWidth / window.innerHeight);
    this.mapView = new MapView(this.loader);
    this.entities = new EntityViews(this.loader, (x, z) => this.session?.groundAt(x, z) ?? -Infinity);
    this.debug = new DebugOverlay(debugEl);
    this.hud = new RoundHud(hudEl);
    this.maps = new MapPicker(hudEl, (mapId, randomize) => this.session?.setMap(mapId, randomize));
    this.parts.scene.add(this.mapView.root);
    this.parts.scene.add(this.entities.root);
    window.addEventListener('resize', () => this.resize());
    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyR' && this.session?.canRematch()) this.session.rematch();
      if (!this.debug.enabled) return;
      if (e.code === 'KeyF') this.physicsDebug?.toggle();
      if (e.code === 'KeyC') this.session?.local?.crates.spawn(); // drop a crate right now
    });
    this.resize();
  }

  /** Builds the scenery. Which map that is comes from the session, so attach that first. */
  async loadMap(map: MapDefinition): Promise<void> {
    this.parts.scene.background = new THREE.Color(map.skyColor);
    // Shadows have to cover the whole floor, and the camera has to stay over it.
    const extent = Math.max(6, ...map.colliders.map((c) => Math.max(c.hx, c.hz)));
    this.camera.apply(map.camera, extent);
    fitShadowToArea(this.parts.sun, extent + 2);
    await this.mapView.build(map);
    this.loadedMapId = map.id;
    this.debug.stats.map = map.id;
  }

  /** Attaches the running match. Collider wireframes only exist when we own the simulation. */
  setSession(session: Session): void {
    this.session = session;
    const sim = session.local;
    if (!sim) return;
    for (const model of sim.arena.missingShapes) {
      console.warn(`No collision shape for "${model}" - players will walk through it`);
    }
    this.physicsDebug = new PhysicsDebugView(sim.physics);
    if (new URLSearchParams(location.search).has('colliders')) this.physicsDebug.toggle();
    this.parts.scene.add(this.physicsDebug.lines);
  }

/** Hands this keyboard to whichever player the session seated for it. */
  bindLocalPlayer(keys: PlayerBindings): void {
    this.keys = keys;
    this.bindings.clear();
    const id = this.requireSession().localPlayerIds[0];
    if (id !== undefined) this.bindings.set(id, keys);
  }

  start(): void {
    this.runDebugScenario(new URLSearchParams(location.search));
    this.clock.start();
    this.parts.renderer.setAnimationLoop(() => this.frame());
  }

  /**
   * Debug only, and only when this tab owns the simulation: `ff=<s>` fast-forwards, `hits=<n>`
   * punches the first crate n times, `grab=1` has player 1 walk to player 2, grab and drag them
   * (`throw=1` then throws), `fall=1` sends player 2 off the edge, `weapon=<id>` hands player 1
   * that weapon, `walk=<s>` marches player 1 east and then stops (`sprint=1` makes them run it), `hurt=<n>` takes n kicks' worth
   * of health off player 2, `swing=1` presses attack once a manual weapon is in hand,
   * `mine=<n>` scatters n booby traps around player 1, `after=<s>` runs on.
   */
  private runDebugScenario(params: URLSearchParams): void {
    const sim = this.session?.local;
    if (!this.debug.enabled || !sim) return;
    const ff = Number(params.get('ff') ?? 0);
    const hits = Number(params.get('hits') ?? 0);
    const after = Number(params.get('after') ?? 0);
    const walk = Number(params.get('walk') ?? 0);
    const hurt = Number(params.get('hurt') ?? 0);
    const grab = params.has('grab');
    const fall = params.has('fall');
    const weapon = params.get('weapon');
    if (ff <= 0 && hits <= 0 && !grab && !fall && !weapon && walk <= 0 && hurt <= 0 && !params.has('mine')) return;
    const step = 1 / 60;
    const [first, second] = sim.playerIds();
    for (let t = 0; t < ff; t += step) this.tick(step);
    const crate = sim.crateStates()[0];
    const body = crate ? sim.crates.get(crate.id)?.body : undefined;
    for (let i = 0; crate && body && i < hits; i++) {
      sim.damage.damage(body.handle, 'punch', null, { x: crate.x - 0.3, y: crate.y, z: crate.z }, { x: 1, y: 0, z: 0 }, 2.5);
      for (let t = 0; t < 0.25; t += step) this.tick(step);
    }
    if (walk > 0 && first !== undefined) {
      for (let t = 0; t < walk; t += step) {
        this.scripted.set(first, { ...emptyInput(), moveX: 1, run: params.has('sprint') });
        this.tick(step);
      }
      this.scripted.delete(first);
    }
    const mines = Number(params.get('mine') ?? 0);
    for (let i = 0; i < mines && first !== undefined; i++) {
      const at = sim.playerState(first);
      const angle = (i / Math.max(1, mines)) * Math.PI * 2;
      sim.mines.place({ x: at.x + Math.cos(angle) * 1.8, y: 0.05, z: at.z + Math.sin(angle) * 1.8 });
    }
    if (hurt > 0 && second !== undefined) {
      const victim = sim.player(second);
      for (let i = 0; victim && i < hurt; i++) sim.health.applyHit(victim, 'kick', { x: 0, z: 1 }, 0, null);
    }
    if (grab) this.scriptGrab(step);
    if (fall) this.scriptFall(step);
    if (weapon && first !== undefined) {
      const s = sim.playerState(first);
      sim.pickups.spawn(weapon, { x: s.x, y: 0.4, z: s.z }, { x: 0, y: 0, z: 0 }); // drops it at player 1's feet
    }
    if (params.has('swing') && first !== undefined) {
      for (let i = 0; i < 60 && !sim.playerState(first).heldWeapon; i++) this.tick(step);
      for (let i = 0; i < 30; i++) this.tick(step); // let the weapon settle into the hands
      this.scripted.set(first, { ...emptyInput(), punch: true });
      this.tick(step);
      this.scripted.set(first, emptyInput());
      this.tick(step);
      this.scripted.delete(first);
    }
    for (let t = 0; t < after; t += step) this.tick(step);
  }

  /** The sparring dummy runs off the northern opening. */
  private scriptFall(step: number): void {
    const sim = this.requireSession().local;
    const p2 = sim?.playerIds()[1];
    if (!sim || p2 === undefined) return;
    for (let i = 0; i < 600 && sim.playerState(p2).posture !== 'eliminated'; i++) {
      const s = sim.playerState(p2);
      this.scripted.set(p2, { ...emptyInput(), moveX: Math.max(-1, Math.min(1, (1.6 - s.x) * 2)), moveZ: -1, run: true });
      this.tick(step);
    }
    this.scripted.delete(p2);
  }

  private scriptGrab(step: number): void {
    const sim = this.requireSession().local;
    const [p1, p2] = sim?.playerIds() ?? [];
    if (!sim || p1 === undefined || p2 === undefined) return;
    for (let i = 0; i < 360; i++) {
      const a = sim.playerState(p1);
      const b = sim.playerState(p2);
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.55) break;
      this.scripted.set(p1, { ...emptyInput(), moveX: dx / d, moveZ: dz / d, run: true });
      this.tick(step);
    }
    this.scripted.set(p1, emptyInput());
    for (let i = 0; i < 6; i++) this.tick(step);
    this.scripted.set(p1, { ...emptyInput(), grab: true });
    this.tick(step);
    this.scripted.set(p1, { ...emptyInput(), moveX: -1 }); // drag them west
    for (let i = 0; i < 40; i++) this.tick(step);
    if (new URLSearchParams(location.search).has('throw')) {
      this.scripted.set(p1, { ...emptyInput(), punch: true });
      this.tick(step);
    }
    this.scripted.delete(p1);
  }

  private frame(): void {
    const dt = Math.min(this.clock.getDelta(), 0.1);
    this.tick(dt);
    if (this.debug.enabled && this.zoomOnPlayer1) this.zoomCamera();
    else this.camera.update(dt, this.cameraTargets());
    this.physicsDebug?.update();
    this.parts.renderer.render(this.parts.scene, this.camera.camera);
    this.updateDebugStats();
    this.debug.update(this.lastDt, this.parts.renderer);
  }

  /** One session + presentation update. The render loop and the debug fast-forward both use it. */
  private tick(dt: number): void {
    this.lastDt = dt;
    const session = this.requireSession();

    // A reconnect can hand us a different player id, so the keyboard is re-attached on change.
    const local = session.localPlayerIds[0];
    if (this.keys && local !== undefined && !this.bindings.has(local)) this.bindLocalPlayer(this.keys);

    this.inputs.clear();
    for (const [id, keys] of this.bindings) this.inputs.set(id, readPlayerInput(this.keyboard, keys));
    for (const [id, input] of this.scripted) this.inputs.set(id, input); // debug scenarios, incl. dummies
    session.update(dt, this.inputs);

    for (const event of session.drainEvents()) {
      // Weapons animate from the 'attack' event when the holder presses; by the time one
      // fires, the swing or the shot is already playing.
      if (event.type === 'attack') this.avatars.get(event.playerId)?.onAttack(event.attack);
      else this.entities.handle(event);
      this.hud.handle(event);
    }

    void this.syncMap(session);
    this.syncAvatars(session, dt);
    this.entities.sync(session, dt);
    this.hud.setNotice(session.statusMessage() ?? this.mapNotice(session) ?? this.waitingNotice(session));
    this.hud.update(dt, session.roundState());
    this.maps.update(session.roomInfo(), session.isHost());
  }

  /** Rebuilds the scenery when the room moves to another arena. */
  private async syncMap(session: Session): Promise<void> {
    if (session.mapId === this.loadedMapId || this.loadingMap) return;
    this.loadingMap = true;
    try {
      await Promise.all([this.loadMap(getMap(session.mapId)), session.syncArena()]);
    } finally {
      this.loadingMap = false;
    }
  }

  /** Everyone gets told what the arena is about to become, host or not. */
  private mapNotice(session: Session): string | null {
    const info = session.roomInfo();
    if (!info?.pendingMapId) return null;
    return `${getMap(info.pendingMapId).name}\nin ${Math.max(1, Math.ceil(info.pendingIn))}...`;
  }

  /**
   * Before anyone else turns up, the screen has one job: tell you the code to read out. It is
   * the only place a player can get it once the menu has gone.
   */
  private waitingNotice(session: Session): string | null {
    if (session.roomCode === null || session.roundState().phase !== 'waiting') return null;
    return `Room ${session.roomCode}\nWaiting for another player...`;
  }

  /** Brings the cast on screen in line with the match: new players appear, departed ones leave. */
  private syncAvatars(session: Session, dt: number): void {
    const ids = session.playerIds();
    for (const id of ids) {
      const avatar = this.avatars.get(id);
      if (!avatar) {
        this.addAvatar(id);
        continue;
      }
      const state = session.playerState(id);
      avatar.setName(session.playerName(id));
      if (state) avatar.sync(state, dt);
      avatar.view.update(dt);
    }
    for (const [id, avatar] of this.avatars) {
      if (ids.includes(id)) continue;
      avatar.view.root.removeFromParent(); // left the match
      this.avatars.delete(id);
    }
    // Rebuild the score strip when the cast changes, or when someone's name arrives late.
    const key = ids.map((id) => `${id}:${session.playerName(id)}`).join(',');
    if (key === this.hudPlayerIds) return;
    this.hudPlayerIds = key;
    this.debug.stats.players = ids.length;
    this.hud.setPlayers(ids.map((id) => ({ id, name: session.playerName(id), color: colorFor(id) })), session.roundsToWin);
  }

  /** Loads a character for a player id that has just appeared. */
  private addAvatar(id: number): void {
    if (this.loadingAvatars.has(id)) return;
    this.loadingAvatars.add(id);
    const skin = SKINS[(id - 1) % SKINS.length] as string;
    void CharacterView.create(this.loader, characterRef(skin)).then((view) => {
      this.loadingAvatars.delete(id);
      const session = this.session;
      if (!session?.playerIds().includes(id)) return; // gone again while the model loaded
      const avatar = new PlayerAvatar(id, this.bindings.get(id) ?? null, view, this.loader, colorFor(id));
      avatar.setName(session.playerName(id));
      const state = session.playerState(id);
      if (state) avatar.sync(state);
      this.parts.scene.add(view.root);
      this.avatars.set(id, avatar);
    });
  }

  private updateDebugStats(): void {
    if (!this.debug.enabled) return;
    const session = this.requireSession();
    const sim = session.local;
    this.debug.stats.physicsBodies = sim ? sim.physics.bodyCount : 0;
    this.debug.stats.crates = `${this.entities.crateCount} active, ${session.pickupStates().length} pickups, ${this.entities.debris.count} debris`;
    const round = session.roundState();
    this.debug.stats.round = `${round.phase} r${round.round} t=${round.timer.toFixed(1)} alive=[${round.alive.join(',')}]`;
    const first = session.localPlayerIds[0];
    const state = first === undefined ? undefined : session.playerState(first);
    if (!state) return;
    this.debug.stats.playerState = describeState(state);
    this.debug.stats.grabState = describeGrab(state);
  }

  /**
   * Who the camera is for: the players on this keyboard. With nobody local - a spectator, or
   * the moment before the first avatar has loaded - it watches the whole cast instead.
   */
  private cameraTargets(): THREE.Vector3[] {
    const mine: THREE.Vector3[] = [];
    for (const id of this.session?.localPlayerIds ?? []) {
      const avatar = this.avatars.get(id);
      if (avatar?.view.root.visible) mine.push(avatar.view.root.position);
    }
    if (mine.length > 0) return mine;
    return [...this.avatars.values()].filter((a) => a.view.root.visible).map((a) => a.view.root.position);
  }

  /** Debug only: parks the camera right behind the first local player to inspect poses. */
  private zoomCamera(): void {
    const first = this.session?.localPlayerIds[0];
    const avatar = first === undefined ? undefined : this.avatars.get(first);
    if (!avatar) return;
    const t = avatar.view.root.position;
    this.camera.camera.position.set(t.x + 1.6, t.y + 1.4, t.z + 2.2);
    this.camera.camera.lookAt(t.x, t.y + 0.5, t.z);
  }

  private requireSession(): Session {
    if (!this.session) throw new Error('Attach a session first');
    return this.session;
  }

  private resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.parts.renderer.setSize(w, h, false);
    this.camera.resize(w, h);
  }
}

/** Colour by player id, so the same player wears the same colour on every machine. */
function colorFor(id: number): string {
  return PLAYER_COLORS[(id - 1) % PLAYER_COLORS.length] as string;
}
