# Wobble Wars

A chaotic 2-8 player 3D physics brawler in the browser. Cute low-poly characters punch,
kick, grab and throw each other off floating arenas. The physics makes the comedy.

Built with TypeScript, Three.js, Vite, Rapier3D and a Node.js authoritative server.
Art: Kenney "Mini" packs and KayKit "Fantasy Weapons Bits" (both CC0) - see `assets/ASSET_INVENTORY.md`.

## Layout

```
assets/   Kenney packs exactly as downloaded (never modified). Served as the site root by Vite.
client/   Vite + Three.js: rendering, input, presentation.
server/   Node.js authoritative simulation behind a WebSocket: rooms, ticks, snapshots.
shared/   Renderer-independent code used by both: types, constants, map data, simulation.
```

`shared/` must never import Three.js or DOM APIs. Game rules and physics live there so a
practice match in the browser and a real one on the server run the exact same simulation.

## Running

```
npm install
npm run dev          # http://localhost:5173
npm run dev:server   # game server on ws://localhost:8787
npm run typecheck    # strict TypeScript across all workspaces
npm run test:sim     # headless physics smoke test (Node, no browser)
npm run test:net     # starts the real server and plays it over real sockets
npm run build        # client/dist, models included - a self-contained upload
```

Open with `?debug=1` (or press `` ` ``) for the debug overlay. With it open, `F` toggles the
physics collider wireframes (`&colliders=1`), `C` drops a Chaos Crate immediately (`&crate=1`
makes the first one arrive at once). `&ff=<s>&hits=<n>&grab=1&throw=1&fall=1&after=<s>`
fast-forwards a scripted crate/grab/throw/fall scenario for screenshots (in practice mode,
which `&ff` selects by itself); `&weapon=magic-staff`
hands player 1 a weapon; `&walk=<s>` marches player 1 east and then stops; `&swing=1` swings a
manual weapon once; `&hurt=<n>` takes n kicks' worth of health off player 2; `&mine=<n>`
scatters booby traps; `&sprint=1` makes `&walk` a run; `&zoom=1` parks the
camera close to player 1. `/viewer.html?only=hammer_B,staff_B&scale=0.4` lays out models.

## Playing

One player per screen. Type the name you want to go by - it is remembered between visits, and
it floats over your character's head as well as sitting in the score strip, which is how anyone
tells eight near-identical wobblers apart. Leave it blank and you are Player 1, 2, 3. The front
screen then offers three things:

- **Practice alone** - the match runs in this tab against a sparring dummy. No server needed.
- **Create a room** - picks a four-letter code and opens a room for it. Read the code out.
- **Join** - type the code your friend read out and you are in the same match.

For online play run `npm run dev:server` first. `?server=<host>` or `?server=ws://host:port`
points the client at a server elsewhere; `?room=CODE` skips the menu and joins directly, and
`?practice=1` goes straight into practice, and `?name=Ada` names you without the menu.

### Playing from another PC on the same network

On the machine that hosts the game:

```
npm run dev          # prints a "Network:" URL, e.g. http://10.0.0.5:5173/
npm run dev:server   # in a second terminal
```

Windows blocks the ports until you say otherwise. Once, in an **Administrator** terminal:

```
netsh advfirewall firewall add rule name="Wobble Wars" dir=in action=allow protocol=TCP localport=5173,8787
```

Then the host opens `http://localhost:5173/` and hits **Create a room**; the code is printed
over the arena while they wait. The other PC opens the **Network:** URL that `npm run dev`
printed (same network, not localhost), types that code and hits **Join**. The match starts by
itself once both are in.

If the second PC cannot load the page at all, it is the network or the firewall rule. If the
page loads but says it could not reach `ws://...:8787`, it is the game server: check it is
running and that port 8787 is allowed too.

A dropped connection is not the end of your match: the server holds your player still for
`RECONNECT_GRACE` seconds while the client retries, and a client that returns with the same id
gets that same player back, under the same name. Close the tab for good and the player is
cleared out.

Names are cut to `MAX_NAME_LENGTH` and stripped of anything unprintable on the way in
(`sanitizeName`), and two players in a room never end up sharing one - the second Bo becomes
"Bo (3)". They travel in the snapshot rather than in `PlayerState`, so the simulation stays a
simulation and never learns what anyone is called.

## How online play works

The server owns the world. Clients send `PlayerInput` every frame and receive a snapshot 20
times a second (players, crates, pickups, projectiles, round state) plus the events since the
last one; `client/src/net/SnapshotBuffer.ts` renders about 1.6 snapshots in the past and
interpolates, which is what makes 20 Hz look smooth. Nothing is simulated client-side, so a
client can never disagree with the server about who won - the cost is that your own character
answers a round trip late, which is the trade this stage deliberately takes.

Both sides of the seam live behind `Session` (`client/src/app/Session.ts`): `LocalSession` steps
a `Simulation` in the tab, `NetworkSession` draws what the server sends, and the renderer cannot
tell which it has. A room holds up to `MAX_ROOM_PLAYERS` (`shared/src/net/messages.ts`, which
is also where the wire format lives). Rooms are created by the first person to use a code and
disappear once the last player has gone and nobody is expected back.

## Controls

| | Keys |
|---|---|
| Move | W A S D, or the arrow keys |
| Run | Shift |
| Jump | Space |
| Punch / Kick / Grab | J / K / L |

Punch is also the attack key for every weapon you pick up - see Chaos Crates below. A press
made while you are still recovering is remembered for `ATTACK_BUFFER` seconds and comes out as
soon as you are ready, so hitting the key a little early is not punished.

Grab latches onto the nearest player or crate in front of you and hoists it above your head;
walk to carry it, press grab again to drop it, or punch while holding to throw. Held players
mash movement/jump to wriggle free. Numbers live in `GRAB` and `THROW` in
`shared/src/sim/tuning.ts`.

## Maps

Two arenas so far, both in `shared/src/maps/`:

- **Mini Arena** - a statue on a plinth in the middle, columns and low walls for cover.
- **Crossfire** - no plinth; a raised cross of blocks spans the arena with stairs up at all
  four ends. The high ground is where the crates land and where you can see people coming, but
  it is narrow and everyone up there is one shove from the floor. Wider openings, less cover.

Both are built on `buildPlatform()` (`shared/src/maps/platform.ts`), which lays the floor, the
skirt under its rim, the border with its openings and the invisible walls above it. A new map
supplies its own furniture, spawn rings and crate spots and nothing else.

**The host picks the arena**, from the panel in the corner of their screen - nobody else sees
it. Choosing does not change the world underfoot straight away: the room announces it and swaps
`MAP_CHANGE_DELAY` seconds later, counting down over the arena for everyone, so picking again
(or changing your mind back) costs nothing. **Random each match** rolls a different arena every
time a match finishes. Changing map starts a fresh match, so the score resets with the scenery.

In practice mode you are your own host and the change is immediate - there is nobody to warn.

## Jumping, steps and the arena rim

One press is one jump: `PLAYER.jumpCooldown` and a check that you are not already rising keep a
hammered key from chaining launches. Walking into something no taller than `PLAYER.stepHeight`
carries you up it (`PlayerPhysics.stepUp`); a capsule driven by velocity otherwise stops dead
against a 12 cm stair tread, which made every staircase in the game scenery. The limit sits
below the 0.4 arena border, so stairs are climbable and the border still is not. The arena also has invisible walls along its rim
(`RIM_HEIGHT` in the map), because the visible border is knee-high and a jump clears it - without
them you could hop onto the border and walk off the edge of the world. Leaving the arena is meant
to happen through the openings in the middle of each side.

## Camera

The camera follows the player on this screen and keeps them centred, easing back as players
spread out and staying over the floor rather than the void (`client/src/app/FollowCamera.ts`).
A map's `camera` setting is its widest shot - the angle to look from, and how far back the
camera is allowed to go - while `followDistance` is how close it sits when everyone is together.

## Stamina

Sprinting runs on a bar (`PLAYER.stamina*` in `shared/src/sim/tuning.ts`): about three seconds
of running, and roughly five standing still to get it back. Run it dry and you are **winded** -
you walk until you have recovered, and holding the sprint key does not hand it back early. You
have to let go and press again, or exhaustion just becomes a permanent half-run.

The bar sits under the health bar over each player's head, and only appears once it is spent:
a full one would be clutter over every head, but a short one tells the whole room that this
player cannot run away right now.

## Health

Everyone starts a round on 100 HP (`HEALTH` in `shared/src/sim/tuning.ts`) with a bar floating
over their head in their score-strip colour. Every hit that reaches a player goes through
`HealthSystem` (`shared/src/combat/HealthSystem.ts`), which takes the HP off (`PLAYER_DAMAGE` per
damage type in `shared/src/combat/damage.ts`) and hands the shove to the ragdoll system. At zero
the player is knocked out: they tumble for `HEALTH.koDelay` and are then out of the round, exactly
as if they had fallen off the edge.

Hits are heavy, and health comes back: go `HEALTH.regenDelay` seconds without being hit and you
heal at `HEALTH.regenRate` a second. Backing off and circling is a real option, which is what
keeps hard-hitting weapons from turning every round into a coin toss. Health also refills
completely on every round reset and respawn.

## Knockdown and ragdoll

Hits fill a wobble meter (`KNOCKDOWN_POWER` per damage type in `shared/src/combat/damage.ts`);
at 1.0 the player falls over. Being floored costs about a second in all (`RAGDOLL.minDownTime`
plus `recoverTime`) - long enough to be a moment of chaos, short enough that you are not sitting
out the fight.

Nothing steers a body while it is staggered or down, and Rapier's friction barely touches a
capsule sliding on its end, so such a body used to keep its full speed until control came back -
a mace hit sent people skating a fifth of the way across the arena. `PlayerPhysics.slowLooseBody`
scrubs horizontal speed off anything nobody is driving (`PLAYER.staggerDrag`, `RAGDOLL.drag`),
but only while it is touching the ground: a hit that launches you should still arc through the
air, it just should not skate when it lands. Throws knock down instantly. A downed player is the same capsule
with its rotations unlocked, so it topples, rolls and can be pushed off ledges; after it settles
(`RAGDOLL` in tuning.ts) it stands back up. Limb floppiness is client-side springs
(`client/src/render/LimbWobble.ts`). Falling below the map's `killY` eliminates the player, who
respawns after `RAGDOLL.respawnDelay` in free play.

## Rounds

With two players in the room, a match starts by itself: 3-2-1 countdown (everyone frozen),
then last player standing wins the round. Spawn points are dealt out at random each round
(`Simulation.dealSpawns`), so no two rounds open the same way. Eliminated players sit out the rest of the round; the arena,
crates and weapons reset between rounds. First to 3 rounds takes the match; `R` starts a
rematch. `RoundSystem` in `shared/src/sim/RoundSystem.ts` (config `DEFAULT_ROUND_CONFIG`);
the online lobby will call `startMatch()` instead of auto-starting.

## Chaos Crates

Crates land every few seconds and up to `maxActive` sit out at once (`DEFAULT_CRATE_SPAWN` in
`shared/src/crates/crateDefinitions.ts`), so there is almost always something worth fighting over. Five punches break it; it wobbles, cracks and darkens on
the way. On breaking it flies apart and ejects a random weapon from `shared/src/weapons/dropPools.ts`
(magic bow, fireball staff, mega hammer). Walk over the weapon to pick it up.

**You aim and fire every weapon yourself**, on the attack key. Each press starts a wind-up long
enough for a target to react, then the shot or the swing lands; the recovery afterwards makes a
miss cost something. What limits a drop is what it carries - a few shots and a lifetime that runs
out whether you use it or not - so picking one up is a commitment rather than a power-up to sit
on. The shots left float above the holder's head where everyone can see them.

Eight of them, picked so no two are played the same way:

| | Uses | Wind-up / recovery | What it is for |
|---|---|---|---|
| Quick Dagger | 8 | 0.12 / 0.3 s | Chip damage at arm's length. Never floors anyone; wins by never letting up. |
| Spark Wand | 6 | 0.1 / 0.28 s | Light bolts about as fast as you can press. Pressure from across the arena. |
| Magic Bow | 5 | 0.2 / 0.5 s | Arrows that drop slightly over distance. The reward for lining a shot up. |
| War Spear | 5 | 0.3 / 0.75 s | Thrusts from outside anyone's punching range. The reach is the weapon. |
| Throwing Axe | 3 | 0.25 / 0.8 s | Tumbles away on an arc and drops as it flies, so distance has to be read. |
| Fireball Staff | 2 | 0.5 / 1.6 s | A blast that shoves everyone in range, the caster included. |
| Great Halberd | 4 | 0.45 / 1.4 s | A slow, wide sweep - the one weapon that clears a crowd instead of a target. |
| Mega Hammer | 3 | 0.35 / 1.2 s | ~45 HP and a huge shove. Three connected swings end anyone. |

Crates lean towards the quick, forgiving ones (`dropPools.ts`): a match-ender should feel like a
moment, not the default.

Wind-ups, shot counts, recovery, lifetimes, projectiles and explosions are all data in
`shared/src/weapons/weaponCatalog.ts`; damage per type in `shared/src/combat/damage.ts`.

### Rigged crates

Not every crate is a present. Some are booby-trapped (a `mine` entry in the drop pool) and
leave a **mine** sitting in the splinters instead of a weapon: it settles for `MINE.armDelay`,
arms with a red light, and goes off when anybody walks within `MINE.triggerRadius` - including
whoever opened the crate. There is a short fuse between tripping it and the blast, which is all
the warning anyone gets, and nobody owns a mine, so nobody is spared by it
(`shared/src/weapons/MineSystem.ts`). Breaking a crate is a decision now, not free loot.

Held weapons hang from a `grip` point measured off the model (KayKit origins sit mid-shaft, so
a weapon held at its origin is clutched under its own head).

## Deploying

See **[DEPLOY.md](DEPLOY.md)**: the page on Cloudflare Pages, the match server on Render, both
free, both redeploying on every push. `npm run build` produces a self-contained `client/dist`
(it copies only the GLB/glTF model folders, via `scripts/copy-assets.mjs`) with relative paths,
so the same build also works as an itch.io upload. Set `VITE_SERVER_URL` at build time to point
the page at a server; `?server=` in the URL still overrides it.

## Credits

Characters and arena pieces by **Kenney** ([kenney.nl](https://www.kenney.nl)); weapons from
**KayKit Fantasy Weapons Bits** by Kay Lousberg ([kaylousberg.com](https://www.kaylousberg.com)).
All CC0.

## Milestones

1. Scene, camera, lighting, one map, one character  (done)
2. Rapier3D, player physics, movement, jump, collision  (done)
3. Second local player  (done)
4. Punch, kick, knockdown  (done)
   + Chaos Crate system: breakable crate, weapon drops, pickups  (done)
5. Grab, hold, drag, throw  (done)
6. Ragdoll, recovery, arena elimination  (done)
7. Round system, last player standing  (done)
   + Player health, HP bars, manual heavy melee  (done)
8. Multiplayer networking
   a. Authoritative server, rooms, snapshots, interpolation  (done)
   b. Lobby with room codes, reconnect after a drop  (done)
9. Map selection  (done)
   + Crossfire, the second arena  (done)
10. Additional maps
