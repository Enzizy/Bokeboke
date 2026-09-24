/**
 * Headless smoke test of the shared simulation. Runs in Node with no renderer:
 *   npm run test:sim
 * It walks a player around Mini Arena and asserts the basics still hold.
 */
import { crossfire } from '@shared/maps/crossfire';
import { miniArena } from '@shared/maps/miniArena';
import { emptyInput, type PlayerInput } from '@shared/sim/PlayerInput';
import { listMaps } from '@shared/maps/MapRegistry';
import { RAPIER } from '@shared/sim/PhysicsWorld';
import { SPAWN_JITTER, Simulation } from '@shared/sim/Simulation';
import { EventQueue } from '@shared/sim/events';
import { KILL_CREDIT_WINDOW, ScoreSystem } from '@shared/sim/ScoreSystem';
import { HEALTH, PLAYER, RAGDOLL, THROW } from '@shared/sim/tuning';
import { PLAYER_DAMAGE } from '@shared/combat/damage';
import { ATTACKS } from '@shared/combat/attacks';
import { WEAPONS } from '@shared/weapons/weaponCatalog';
import { DEFAULT_CRATE_SPAWN } from '@shared/crates/crateDefinitions';

const DT = 1 / 60;
const sim = await Simulation.create(miniArena);
const id = sim.addPlayer();

const state = () => sim.playerState(id);
function run(seconds: number, input: Partial<PlayerInput> = {}): void {
  sim.setInput(id, { ...emptyInput(), ...input });
  for (let i = 0; i < seconds * 60; i++) sim.update(DT);
}
function check(condition: boolean, message: string): void {
  if (!condition) throw new Error(`FAILED: ${message}`);
  console.log(`ok   ${message}`);
}

/** Drops the player on a chosen spot: spawn points are random, some checks need a known one. */
function placeAt(x: number, z: number): void {
  const body = sim.player(id)?.body;
  if (!body) throw new Error('player has no body');
  body.setTranslation({ x, y: 0.4, z }, true);
  body.setLinvel({ x: 0, y: 0, z: 0 }, true);
  run(0.3);
}

check(sim.arena.missingShapes.length === 0, `every solid piece has a collider (${sim.physics.colliderCount} colliders)`);

run(0.5);
check(Math.abs(state().y) < 0.02 && state().grounded, 'player rests on the floor');

// Spawns are dealt at random, so put the player on a lane that is known to be clear before
// measuring how fast they cross it.
placeAt(-7.5, 1.5);
run(0.5, { moveZ: 1 });
placeAt(-7.5, 1.5);
run(1, { moveX: 1 });
check(state().vx > PLAYER.walkSpeed * 0.9, `walks at ~${PLAYER.walkSpeed} (got ${state().vx.toFixed(2)})`);
check(Math.abs(state().yaw - Math.atan2(1, 0)) < 0.05, 'faces the direction of travel');

placeAt(-7.5, 1.5);
run(1, { moveX: 1, run: true });
check(state().vx > PLAYER.runSpeed * 0.9, `runs at ~${PLAYER.runSpeed} (got ${state().vx.toFixed(2)})`);

run(0.5);
check(Math.hypot(state().vx, state().vz) < 0.01, 'stops when input is released');

sim.setInput(id, { ...emptyInput(), jump: true });
sim.update(DT);
sim.update(DT);
check(!state().grounded && state().vy > 3, 'jump launches the player');
let peak = 0;
for (let i = 0; i < 90; i++) {
  sim.update(DT);
  peak = Math.max(peak, state().y);
}
check(peak > 0.6 && peak < 1.0, `jump peaks at a sensible height (${peak.toFixed(2)})`);
check(state().grounded && Math.abs(state().y) < 0.02, 'lands back on the floor');

const from = state();
run(3, { moveX: from.x > 0 ? -1 : 1, moveZ: from.z > 0 ? -1 : 1 });
check(Math.hypot(state().x, state().z) > 0.6, 'is blocked by the centre plinth');

// Straight north at x = 1.8: clear of the plinth and inside the opening in the north border.
placeAt(1.8, 5);
let fell = false;
let respawned = false;
for (let i = 0; i < 60 * 14 && !respawned; i++) {
  const s = state();
  sim.setInput(id, { ...emptyInput(), moveX: Math.max(-1, Math.min(1, (1.8 - s.x) * 2)), moveZ: -1, run: true });
  sim.update(DT);
  if (state().y < -1) fell = true;
  if (fell && state().y > -0.5) respawned = true;
}
check(fell, 'falls through the northern opening');
check(respawned, 'respawns after falling below the kill plane');


// ---- Chaos Crate loop ---------------------------------------------------------------------
{
  const sim2 = await Simulation.create(miniArena, { seed: 7, crateSpawn: { firstDelay: 0.5, interval: 5, cooldownAfterDestroy: 2 } });
  const p = sim2.addPlayer();
  const evts: string[] = [];
  const step = (input: Partial<PlayerInput> = {}) => {
    sim2.setInput(p, { ...emptyInput(), ...input });
    sim2.update(DT);
    for (const e of sim2.drainEvents()) evts.push(e.type);
  };
  for (let i = 0; i < 60 * 2; i++) step();
  check(sim2.crateStates().length === 1 && evts.includes('crate-spawned'), 'a crate spawns after the first delay');
  const crate0 = sim2.crateStates()[0]!;
  check(crate0.y < 0.5 && crate0.y > 0.2, `crate lands on the floor (y=${crate0.y.toFixed(2)})`);

  // Start next to the crate: spawns are random and the walker has no way round the scenery.
  const pBody = sim2.player(p)?.body;
  if (!pBody) throw new Error('player has no body');
  pBody.setTranslation({ x: crate0.x - 0.8, y: 0.4, z: crate0.z }, true);
  for (let i = 0; i < 20; i++) step();

  // Walk to the crate, then punch until it breaks.
  for (let i = 0; i < 60 * 6; i++) {
    const c = sim2.crateStates()[0];
    if (!c) break;
    const s = sim2.playerState(p);
    const dx = c.x - s.x;
    const dz = c.z - s.z;
    const dist = Math.hypot(dx, dz);
    if (dist > 0.7) step({ moveX: dx / dist, moveZ: dz / dist, run: true });
    else {
      step({ moveX: dx / dist * 0.2, moveZ: dz / dist * 0.2 }); // face it
      step({ punch: true });
      for (let k = 0; k < 20; k++) step();
    }
  }
  const hits = evts.filter((e) => e === 'crate-hit').length;
  check(hits === 5, `crate takes exactly 5 punches to break (got ${hits} hits)`);
  check(evts.includes('crate-broken') && sim2.crateStates().length === 0, 'crate breaks and is removed');
  check(evts.includes('weapon-ejected') && sim2.pickupStates().length === 1, 'a weapon pickup is ejected');
  const pk = sim2.pickupStates()[0]!;
  const crateHitIndex = evts.lastIndexOf('crate-broken');
  check(crateHitIndex >= 0 && WEAPONS[pk.weaponId] !== undefined, `pickup is a weapon from the catalogue (${pk.weaponId})`);

  // Let it land, then walk over it.
  for (let i = 0; i < 60 * 2; i++) step();
  for (let i = 0; i < 60 * 6 && sim2.pickupStates().length > 0; i++) {
    const t = sim2.pickupStates()[0]!;
    const s = sim2.playerState(p);
    const dx = t.x - s.x;
    const dz = t.z - s.z;
    const d = Math.hypot(dx, dz) || 1;
    step({ moveX: dx / d, moveZ: dz / d, run: true });
  }
  check(evts.includes('weapon-picked-up') && sim2.playerState(p).heldWeapon === pk.weaponId, `player collects the ${pk.weaponId}`);

  const spawnsSoFar = evts.filter((e) => e === 'crate-spawned').length;
  for (let i = 0; i < 60 * 14; i++) step();
  const more = evts.filter((e) => e === 'crate-spawned').length - spawnsSoFar;
  check(more >= 2, `crates keep arriving (${more} more over 14s)`);
  check(sim2.crateStates().length <= DEFAULT_CRATE_SPAWN.maxActive, `never more than ${DEFAULT_CRATE_SPAWN.maxActive} crates out at once`);
}

// ---- Grab / drag / throw / escape --------------------------------------------------------
{
  const sim3 = await Simulation.create(miniArena, { seed: 3, crateSpawn: { firstDelay: 999 }, rounds: { autoStart: false } });
  const a = sim3.addPlayer();
  const b = sim3.addPlayer();
  const evts: string[] = [];
  const inputs: Record<number, Partial<PlayerInput>> = { [a]: {}, [b]: {} };
  const step = (): void => {
    sim3.setInput(a, { ...emptyInput(), ...inputs[a] });
    sim3.setInput(b, { ...emptyInput(), ...inputs[b] });
    sim3.update(DT);
    for (const e of sim3.drainEvents()) evts.push(e.type + ('reason' in e ? ':' + e.reason : ''));
  };
  const walkTo = (who: number, x: number, z: number, stopAt: number, maxSteps = 360): void => {
    for (let i = 0; i < maxSteps; i++) {
      const s = sim3.playerState(who);
      const dx = x - s.x;
      const dz = z - s.z;
      const d = Math.hypot(dx, dz);
      if (d < stopAt) break;
      inputs[who] = { moveX: dx / d, moveZ: dz / d, run: true };
      step();
    }
    // Turn to face the target without really moving (tiny input still steers the yaw).
    for (let i = 0; i < 20; i++) {
      const s = sim3.playerState(who);
      const d = Math.hypot(x - s.x, z - s.z) || 1;
      inputs[who] = { moveX: ((x - s.x) / d) * 0.12, moveZ: ((z - s.z) / d) * 0.12 };
      step();
    }
    inputs[who] = {};
  };
  const press = (who: number, key: keyof PlayerInput): void => {
    inputs[who] = { [key]: true };
    step();
    inputs[who] = {};
    step();
  };
  for (let i = 0; i < 30; i++) step();

  // Spawn points are dealt at random, and this scenario needs a clear lane to drag someone
  // down in a straight line, so both players are put somewhere known first.
  const place = (who: number, x: number, z: number): void => {
    const body = sim3.player(who)?.body;
    if (!body) throw new Error('player has no body');
    body.setTranslation({ x, y: 0.4, z }, true);
    body.setLinvel({ x: 0, y: 0, z: 0 }, true);
  };
  place(a, -2, 2.5);
  place(b, -0.8, 2.5);
  for (let i = 0; i < 20; i++) step();

  // A walks up to B and grabs.
  const bPos = sim3.playerState(b);
  walkTo(a, bPos.x, bPos.z, 0.55);
  for (let i = 0; i < 6; i++) step();
  press(a, 'grab');
  check(sim3.playerState(b).grabbedBy === a && sim3.playerState(a).grabbing?.kind === 'player', 'A grabs B');

  // Drag: A walks away; B comes along.
  const before = sim3.playerState(b);
  inputs[a] = { moveX: before.x > 0 ? -1 : 1, run: true };
  for (let i = 0; i < 60; i++) step();
  inputs[a] = {};
  const dragged = sim3.playerState(b);
  const moved = Math.hypot(dragged.x - before.x, dragged.z - before.z);
  const gap = Math.hypot(dragged.x - sim3.playerState(a).x, dragged.z - sim3.playerState(a).z);
  check(moved > 0.8 && gap < 0.9, `B is dragged along (moved ${moved.toFixed(2)}, gap ${gap.toFixed(2)})`);
  check(sim3.playerState(b).grabbedBy === a, 'hold survives the drag');

  // Throw: punch while holding.
  press(a, 'punch');
  const flying = sim3.playerState(b);
  const flySpeed = Math.hypot(flying.vx, flying.vz);
  check(evts.includes('throw') && flying.grabbedBy === null && flySpeed > 4, `B is thrown (speed ${flySpeed.toFixed(1)})`);
  check(evts.includes('knockdown') && flying.posture === 'ragdoll', 'a thrown player is knocked down');
  let tumbled = false;
  let upAt = -1;
  for (let i = 0; i < 60 * 6; i++) {
    step();
    const s = sim3.playerState(b);
    if (s.posture === 'ragdoll' && Math.abs(s.qw) < 0.95) tumbled = true; // rotated well away from upright
    if (s.posture === 'upright') {
      upAt = i;
      break;
    }
  }
  check(tumbled, 'the downed body actually tumbles');
  check(upAt > 0 && evts.includes('recover'), `B gets back up after ${(upAt / 60).toFixed(1)}s`);
  check(Math.abs(sim3.playerState(b).qw) > 0.999 && Math.abs(sim3.playerState(b).y) < 0.05, 'B stands upright on the floor again');

  // Escape: A grabs again, B mashes jump and pushes until free.
  const b2 = sim3.playerState(b);
  walkTo(a, b2.x, b2.z, 0.55);
  for (let i = 0; i < 6; i++) step();
  press(a, 'grab');
  check(sim3.playerState(b).grabbedBy === a, 'A grabs B again');
  let freedAt = -1;
  for (let i = 0; i < 240; i++) {
    inputs[b] = { jump: i % 2 === 0, moveX: 1 };
    step();
    if (sim3.playerState(b).grabbedBy === null) {
      freedAt = i;
      break;
    }
  }
  inputs[b] = {};
  check(freedAt > 0 && evts.includes('release:escape'), `B struggles free after ${(freedAt / 60).toFixed(2)}s`);

  // Crate: grab it and throw it.
  sim3.crates.spawn();
  for (let i = 0; i < 60; i++) step();
  const crate = sim3.crateStates()[0]!;
  walkTo(a, crate.x, crate.z, 0.75, 600);
  for (let i = 0; i < 6; i++) step();
  press(a, 'grab');
  check(sim3.playerState(a).grabbing?.kind === 'crate', 'A grabs the crate');
  press(a, 'punch');
  const thrownCrate = sim3.crates.get(crate.id)!.body.linvel();
  const crateSpeed = Math.hypot(thrownCrate.x, thrownCrate.z);
  check(crateSpeed > 3, `crate is thrown (speed ${crateSpeed.toFixed(1)})`);

  // Kicks: two quick kicks knock a player over; a single one only shoves.
  for (let i = 0; i < 120; i++) step();
  const target = sim3.playerState(b);
  walkTo(a, target.x, target.z, 0.6, 600);
  for (let i = 0; i < 6; i++) step();
  const kicksBefore = evts.filter((e) => e === 'knockdown').length;
  press(a, 'kick');
  for (let i = 0; i < 12; i++) step();
  check(sim3.playerState(b).posture === 'upright', 'one kick only shoves');
  for (let i = 0; i < 30; i++) step();
  const t2 = sim3.playerState(b);
  walkTo(a, t2.x, t2.z, 0.6, 600);
  for (let i = 0; i < 6; i++) step();
  press(a, 'kick');
  for (let i = 0; i < 12; i++) step();
  check(evts.filter((e) => e === 'knockdown').length === kicksBefore + 1 && sim3.playerState(b).posture === 'ragdoll', 'a second kick knocks B down');

  // Elimination: a downed body pushed off the edge is eliminated, then respawns.
  const simE = await Simulation.create(miniArena, { seed: 5, crateSpawn: { firstDelay: 999 } });
  const e1 = simE.addPlayer();
  const eEvents: string[] = [];
  const stepE = (input: Partial<PlayerInput> = {}): void => {
    simE.setInput(e1, { ...emptyInput(), ...input });
    simE.update(DT);
    for (const ev of simE.drainEvents()) eEvents.push(ev.type);
  };
  for (let i = 0; i < 30; i++) stepE();
  const eBody = simE.player(e1)?.body;
  if (!eBody) throw new Error('player has no body');
  eBody.setTranslation({ x: 1.8, y: 0.4, z: 5 }, true); // the lane that leads out of the arena
  for (let i = 0; i < 20; i++) stepE();
  for (let i = 0; i < 60 * 14 && !eEvents.includes('eliminated'); i++) {
    const s = simE.playerState(e1);
    stepE({ moveX: Math.max(-1, Math.min(1, (1.8 - s.x) * 2)), moveZ: -1, run: true });
  }
  check(eEvents.includes('eliminated') && simE.playerState(e1).posture === 'eliminated', 'falling off the arena eliminates the player');
  let respawnAt = -1;
  for (let i = 0; i < 60 * 5; i++) {
    stepE();
    if (eEvents.includes('respawn')) {
      respawnAt = i;
      break;
    }
  }
  const back = simE.playerState(e1);
  check(respawnAt > 60 && back.posture === 'upright' && Math.abs(back.y) < 0.1, `eliminated player respawns after ${(respawnAt / 60).toFixed(1)}s`);
}

// ---- Chaos Drop weapons fire themselves ---------------------------------------------------
{
  const simW = await Simulation.create(miniArena, { seed: 21, crateSpawn: { firstDelay: 999 }, rounds: { autoStart: false } });
  const a = simW.addPlayer();
  const b = simW.addPlayer();
  const evts: { type: string; [k: string]: unknown }[] = [];
  const inputs: Record<number, Partial<PlayerInput>> = { [a]: {}, [b]: {} };
  const step = (): void => {
    simW.setInput(a, { ...emptyInput(), ...inputs[a] });
    simW.setInput(b, { ...emptyInput(), ...inputs[b] });
    simW.update(DT);
    for (const e of simW.drainEvents()) evts.push(e as { type: string });
  };
  const count = (type: string): number => evts.filter((e) => e.type === type).length;
  const faceB = (): void => {
    for (let i = 0; i < 25; i++) {
      const A = simW.playerState(a);
      const B = simW.playerState(b);
      const d = Math.hypot(B.x - A.x, B.z - A.z) || 1;
      inputs[a] = { moveX: ((B.x - A.x) / d) * 0.12, moveZ: ((B.z - A.z) / d) * 0.12 };
      step();
    }
    inputs[a] = {};
  };
  const giveWeapon = (id: string): void => {
    const A = simW.playerState(a);
    simW.pickups.spawn(id, { x: A.x, y: 0.4, z: A.z }, { x: 0, y: 0, z: 0 });
    for (let i = 0; i < 60 && simW.playerState(a).heldWeapon !== id; i++) step();
  };
  for (let i = 0; i < 30; i++) step();

  /** One press of the attack key, then long enough for the wind-up and the recovery. */
  const attack = (): void => {
    // You cannot fire while you are on the floor - including from your own fireball.
    for (let i = 0; i < 300 && simW.playerState(a).posture !== 'upright'; i++) step();
    inputs[a] = { punch: true };
    for (let i = 0; i < 6; i++) step();
    inputs[a] = {};
    for (let i = 0; i < 120; i++) step();
  };

  // Fireball staff: nothing happens until the holder fires it.
  giveWeapon('magic-staff');
  const held = simW.playerState(a);
  check(held.heldWeapon === 'magic-staff' && held.weapon?.shotsLeft === 2, 'the staff is picked up with two fireballs in it');
  check(count('weapon-armed') === 1, 'everyone is warned that a weapon is in play');
  faceB();
  for (let i = 0; i < 60 * 3; i++) step();
  check(count('weapon-fired') === 0, 'a ranged weapon never fires on its own');
  attack();
  check(count('weapon-fired') === 1, 'pressing attack fires it');
  for (let i = 0; i < 60 * 2 && count('explosion') === 0; i++) step();
  check(count('explosion') === 1, 'the fireball explodes on impact');
  check(simW.playerState(b).posture === 'ragdoll', 'the explosion knocks B down');
  attack();
  check(count('weapon-fired') === 2 && simW.playerState(a).heldWeapon === null, 'the second fireball spends the staff');

  // Magic bow: five arrows, one press each.
  for (let i = 0; i < 60 * 2; i++) step();
  const firedBefore = count('weapon-fired');
  giveWeapon('magic-bow');
  check(simW.playerState(a).weapon?.shotsLeft === 5, 'the bow starts with 5 arrows');
  faceB();
  for (let i = 0; i < 60 * 2; i++) step();
  check(count('weapon-fired') === firedBefore, 'and it holds them until you shoot');
  for (let i = 0; i < 5; i++) attack();
  check(count('weapon-fired') - firedBefore === 5 && simW.playerState(a).heldWeapon === null, 'five presses empty the bow and it is gone');

  // Mega hammer: the one weapon the holder aims and times themselves.
  for (let i = 0; i < 60 * 2; i++) step();
  const swingsBefore = count('weapon-fired');
  const swings = (): number => count('weapon-fired') - swingsBefore;
  giveWeapon('mega-hammer');
  for (let i = 0; i < 60 * 2; i++) step();
  check(swings() === 0 && simW.playerState(a).weapon?.shotsLeft === 3, 'the mace waits to be swung and carries 3 swings');

  // Close the distance, then swing once: a press, a wind-up, and then a very large dent.
  for (let i = 0; i < 400; i++) {
    const A = simW.playerState(a);
    const B = simW.playerState(b);
    const d = Math.hypot(B.x - A.x, B.z - A.z);
    if (d < 0.75) break;
    inputs[a] = { moveX: (B.x - A.x) / d, moveZ: (B.z - A.z) / d };
    step();
  }
  inputs[a] = {};
  for (let i = 0; i < 10; i++) step();
  const bHpBefore = simW.playerState(b).hp;
  inputs[a] = { punch: true };
  for (let i = 0; i < 6; i++) step();
  check(swings() === 0, 'the swing lands after a wind-up, not on the press');
  inputs[a] = {};
  for (let i = 0; i < 30; i++) step();
  check(swings() === 1 && simW.playerState(a).weapon?.shotsLeft === 2, 'one press buys exactly one swing');
  check(simW.playerState(b).hp === bHpBefore - PLAYER_DAMAGE.hammer, `a connected swing takes ${PLAYER_DAMAGE.hammer} health off B (${bHpBefore} -> ${simW.playerState(b).hp})`);

  // Leaning on the key is not a machine gun: each swing needs its own press.
  inputs[a] = { punch: true };
  for (let i = 0; i < 120; i++) step();
  check(swings() === 1, 'holding the key down does not swing again');
  inputs[a] = {};
  for (let i = 0; i < 2; i++) step();
  for (let s = 0; s < 2; s++) {
    inputs[a] = { punch: true };
    for (let i = 0; i < 6; i++) step();
    inputs[a] = {};
    for (let i = 0; i < 100; i++) step();
  }
  check(swings() === 3 && simW.playerState(a).heldWeapon === null, 'the mace is spent and gone after its third swing');
}

// ---- Health: hits wear a player down, zero knocks them out of the round --------------------
{
  const simH = await Simulation.create(miniArena, { seed: 9, crateSpawn: { firstDelay: 999 }, rounds: { autoStart: false } });
  const a = simH.addPlayer();
  const b = simH.addPlayer();
  const evts: string[] = [];
  const inputs: Record<number, Partial<PlayerInput>> = { [a]: {}, [b]: {} };
  const step = (): void => {
    simH.setInput(a, { ...emptyInput(), ...inputs[a] });
    simH.setInput(b, { ...emptyInput(), ...inputs[b] });
    simH.update(DT);
    for (const e of simH.drainEvents()) evts.push(e.type);
  };
  for (let i = 0; i < 30; i++) step();
  check(simH.playerState(a).hp === 100 && simH.playerState(a).maxHp === 100, 'players start on full health');

  // A real punch, through the real combat path.
  for (let i = 0; i < 400; i++) {
    const A = simH.playerState(a);
    const B = simH.playerState(b);
    const d = Math.hypot(B.x - A.x, B.z - A.z);
    if (d < 0.6) break;
    inputs[a] = { moveX: (B.x - A.x) / d, moveZ: (B.z - A.z) / d };
    step();
  }
  inputs[a] = { punch: true };
  for (let i = 0; i < 20; i++) step();
  inputs[a] = {};
  const afterPunch = HEALTH.max - PLAYER_DAMAGE.punch;
  check(simH.playerState(b).hp === afterPunch && evts.includes('player-damaged'), `a punch takes ${PLAYER_DAMAGE.punch} health off (B on ${simH.playerState(b).hp})`);

  // Wear the rest down and check the knockout, the flight, and being counted out.
  const body = simH.player(b);
  if (!body) throw new Error('player b has no body');
  for (let i = 0; i < 2; i++) simH.health.applyHit(body, 'explosive', { x: 1, z: 0 }, 1, a);
  step(); // events only reach the log when the sim is drained
  check(simH.playerState(b).hp === afterPunch - PLAYER_DAMAGE.explosive * 2, `explosions take ${PLAYER_DAMAGE.explosive} each (B on ${simH.playerState(b).hp})`);
  check(!evts.includes('player-ko') && simH.playerState(b).posture !== 'eliminated', 'B is still in it while any health remains');
  simH.health.applyHit(body, 'explosive', { x: 1, z: 0 }, 1, a);
  step();
  check(simH.playerState(b).hp === 0 && evts.includes('player-ko'), 'the hit that empties the bar knocks B out');
  check(simH.playerState(b).posture === 'ragdoll', 'a knocked-out player tumbles rather than vanishing');
  for (let i = 0; i < 60 * 2; i++) step();
  check(simH.playerState(b).posture === 'eliminated' && evts.includes('eliminated'), 'B is counted out shortly after the knockout');

  // A new round puts everyone back on full health.
  simH.rounds.startMatch();
  for (let i = 0; i < 5; i++) step();
  check(simH.playerState(b).hp === 100 && simH.playerState(b).posture === 'upright', 'the next round starts everyone on full health');
}

// ---- Rounds: last player standing, first to 2 ------------------------------------------
{
  const simR = await Simulation.create(miniArena, {
    seed: 11,
    crateSpawn: { firstDelay: 999 },
    rounds: { roundsToWin: 2, countdownSeconds: 1, roundOverSeconds: 1 },
  });
  const a = simR.addPlayer();
  const b = simR.addPlayer();
  const evts: string[] = [];
  const inputs: Record<number, Partial<PlayerInput>> = { [a]: {}, [b]: {} };
  const step = (): void => {
    simR.setInput(a, { ...emptyInput(), ...inputs[a] });
    simR.setInput(b, { ...emptyInput(), ...inputs[b] });
    simR.update(DT);
    for (const e of simR.drainEvents()) evts.push(e.type);
  };
  step();
  check(simR.roundState().phase === 'countdown' && simR.roundState().round === 1, 'match auto-starts with a countdown when two players are in');

  const frozenFrom = simR.playerState(a);
  inputs[a] = { moveX: 1, run: true };
  for (let i = 0; i < 30; i++) step();
  inputs[a] = {};
  check(Math.abs(simR.playerState(a).x - frozenFrom.x) < 0.01, 'players are frozen during the countdown');
  for (let i = 0; i < 40; i++) step();
  check(simR.roundState().phase === 'fighting' && evts.includes('round-start'), 'the round starts after the countdown');

  const walkOff = (who: number): void => {
    for (let i = 0; i < 60 * 8 && simR.playerState(who).posture !== 'eliminated'; i++) {
      const s = simR.playerState(who);
      inputs[who] = { moveX: Math.max(-1, Math.min(1, (1.6 - s.x) * 2)), moveZ: -1, run: true };
      step();
    }
    inputs[who] = {};
  };
  walkOff(b);
  step();
  const r1 = simR.roundState();
  check(r1.phase === 'round-over' && r1.winnerId === a && r1.wins[a] === 1, 'B falls off, A wins round 1');
  for (let i = 0; i < 40; i++) step();
  check(simR.playerState(b).posture === 'eliminated', 'the eliminated player stays out while the round is over');
  for (let i = 0; i < 40; i++) step();
  const r2 = simR.roundState();
  check(r2.phase === 'countdown' && r2.round === 2 && simR.playerState(b).posture === 'upright' && Math.abs(simR.playerState(b).y) < 0.1, 'round 2 counts down with everyone back on their feet');
  for (let i = 0; i < 70; i++) step();
  walkOff(b);
  for (let i = 0; i < 80; i++) step();
  const r3 = simR.roundState();
  check(r3.phase === 'match-over' && r3.winnerId === a && r3.wins[a] === 2 && evts.includes('match-over'), 'A takes the match 2-0');

  simR.rounds.rematch();
  step();
  const r4 = simR.roundState();
  check(r4.phase === 'countdown' && r4.round === 1 && r4.wins[a] === 0 && r4.alive.length === 2, 'rematch resets the score and starts over');
}

// ---- Scoring: who gets the kill, and who is winning ------------------------------------------
{
  const queue = new EventQueue();
  const score = new ScoreSystem(queue, () => true);
  const at = { x: 0, y: 0, z: 0 };
  queue.push({ type: 'player-damaged', playerId: 2, byPlayerId: 1, damageType: 'punch', hp: 91, maxHp: 100 });
  queue.push({ type: 'eliminated', playerId: 2, position: at });
  check(score.killsOf(1) === 1 && score.deathsOf(2) === 1, 'going out soon after a hit is the hitter\'s kill');
  queue.push({ type: 'knockdown', playerId: 1, byPlayerId: 3 });
  queue.push({ type: 'eliminated', playerId: 1, position: at });
  check(score.leader([1, 2, 3]) === 3, 'level on kills, the one with fewer deaths leads');
  queue.push({ type: 'grab', playerId: 2, target: { kind: 'player', id: 3 } });
  queue.push({ type: 'eliminated', playerId: 3, position: at });
  check(score.killsOf(2) === 1, 'carrying someone to their doom counts as a kill');
  check(score.leader([1, 2, 3]) === null, 'dead level at the top is a draw');
  queue.push({ type: 'player-damaged', playerId: 1, byPlayerId: 2, damageType: 'kick', hp: 85, maxHp: 100 });
  score.update(KILL_CREDIT_WINDOW + 1);
  queue.push({ type: 'eliminated', playerId: 1, position: at });
  check(score.killsOf(2) === 1 && score.deathsOf(1) === 2, 'a hit from long ago earns nothing; the fall still counts as a death');
}

// ---- Timed mode: everyone respawns, the clock ends it, most kills wins ----------------------
{
  const simT = await Simulation.create(miniArena, {
    seed: 19,
    crateSpawn: { firstDelay: 999 },
    rounds: { countdownSeconds: 1, mode: 'timed', matchSeconds: 40 },
  });
  const a = simT.addPlayer();
  const b = simT.addPlayer();
  const evts: string[] = [];
  const inputs: Record<number, Partial<PlayerInput>> = { [a]: {}, [b]: {} };
  const step = (): void => {
    simT.setInput(a, { ...emptyInput(), ...inputs[a] });
    simT.setInput(b, { ...emptyInput(), ...inputs[b] });
    simT.update(DT);
    for (const e of simT.drainEvents()) evts.push(e.type);
  };
  const body = (id: number) => {
    const player = simT.player(id);
    if (!player) throw new Error(`no player ${id}`);
    return player;
  };
  // Respawns land anywhere, so start the walk from open floor in front of the north opening.
  const walkOff = (who: number): void => {
    body(who).body.setTranslation({ x: 0.5, y: 0.4, z: -6.5 }, true);
    for (let i = 0; i < 60 * 8 && simT.playerState(who).posture !== 'eliminated'; i++) {
      inputs[who] = { moveZ: -1, run: true };
      step();
    }
    inputs[who] = {};
  };
  for (let i = 0; i < 70; i++) step();
  const start = simT.roundState();
  check(start.mode === 'timed' && start.phase === 'fighting' && start.timer > 38 && start.timer <= 40, `a timed match starts its clock (${start.timer.toFixed(1)}s)`);

  simT.health.applyHit(body(b), 'punch', { x: 0, z: 1 }, 0, a);
  walkOff(b);
  step();
  const afterKill = simT.roundState();
  check(afterKill.kills[a] === 1 && afterKill.deaths[b] === 1, 'B goes off the edge after A\'s punch: A\'s kill, B\'s death');
  check(afterKill.phase === 'fighting', 'the match carries on after an elimination');

  for (let i = 0; i < 60 * 4 && simT.playerState(b).posture === 'eliminated'; i++) step();
  const back = simT.playerState(b);
  check(back.posture === 'upright' && back.shielded && back.hp === 100, 'B respawns mid-match, on full health and protected');
  simT.health.applyHit(body(b), 'kick', { x: 0, z: 1 }, 3, a);
  check(simT.playerState(b).hp === 100, 'a fresh respawn cannot be hurt');
  for (let i = 0; i < 100; i++) step();
  check(!simT.playerState(b).shielded, 'the protection wears off by itself');
  simT.health.shield(b, 1.5);
  inputs[b] = { punch: true };
  step();
  inputs[b] = {};
  check(!simT.playerState(b).shielded, 'throwing a punch gives the protection up early');

  for (let i = 0; i < 60 * (KILL_CREDIT_WINDOW + 1); i++) step();
  walkOff(a);
  step();
  const selfOut = simT.roundState();
  check(selfOut.deaths[a] === 1 && (selfOut.kills[b] ?? 0) === 0,
    `walking off the edge alone is nobody's kill (A deaths ${selfOut.deaths[a]}, B kills ${selfOut.kills[b]})`);

  for (let i = 0; i < 60 * 45 && simT.roundState().phase === 'fighting'; i++) step();
  const end = simT.roundState();
  check(end.phase === 'match-over' && end.winnerId === a && evts.includes('match-over'), 'when the clock runs out, most kills wins');
  simT.rounds.rematch();
  step();
  check(simT.roundState().kills[a] === 0 && simT.roundState().deaths[b] === 0, 'a rematch clears the kills');
}


// ---- Jumping: one press, one jump, no climbing the scenery ---------------------------------
{
  const simJ = await Simulation.create(miniArena, { seed: 3, crateSpawn: { firstDelay: 999 }, rounds: { autoStart: false } });
  const j = simJ.addPlayer();
  const body = simJ.player(j)?.body;
  if (!body) throw new Error('player has no body');
  const put = (x: number, z: number): void => {
    body.setTranslation({ x, y: 0.4, z }, true);
    body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    for (let i = 0; i < 30; i++) {
      simJ.setInput(j, emptyInput());
      simJ.update(DT);
    }
  };
  /** Holds the input for 8 seconds while hammering the jump key, and reports how high it got. */
  const mash = (move: Partial<PlayerInput>): { peak: number; end: number } => {
    let peak = -9;
    for (let i = 0; i < 60 * 8; i++) {
      simJ.setInput(j, { ...emptyInput(), ...move, jump: i % 2 === 0 });
      simJ.update(DT);
      peak = Math.max(peak, simJ.playerState(j).y);
    }
    return { peak, end: simJ.playerState(j).y };
  };

  put(0, 5);
  const flat = mash({});
  check(flat.peak < 0.9, `mashing jump on flat ground gets you no higher than one jump (${flat.peak.toFixed(2)})`);

  put(0, 8.0);
  const wall = mash({ moveZ: 1, run: true });
  check(wall.end > -1, `mashing jump against the border does not throw you out of the arena (ended at y=${wall.end.toFixed(2)})`);
}

// ---- Health comes back when you are left alone ---------------------------------------------
{
  const simR = await Simulation.create(miniArena, { seed: 11, crateSpawn: { firstDelay: 999 }, rounds: { autoStart: false } });
  const r = simR.addPlayer();
  const hurt = simR.player(r);
  if (!hurt) throw new Error('player has no body');
  const run = (seconds: number): void => {
    for (let i = 0; i < seconds * 60; i++) {
      simR.setInput(r, emptyInput());
      simR.update(DT);
    }
  };
  run(0.5);
  simR.health.applyHit(hurt, 'kick', { x: 1, z: 0 }, 0, null);
  simR.health.applyHit(hurt, 'kick', { x: 1, z: 0 }, 0, null);
  const wounded = simR.playerState(r).hp;
  check(wounded === HEALTH.max - PLAYER_DAMAGE.kick * 2, `two kicks leave you on ${wounded}`);

  run(HEALTH.regenDelay - 1.5); // still inside the quiet period
  check(simR.playerState(r).hp === wounded, 'health stays down while the fight is still on you');

  run(2);
  const healing = simR.playerState(r).hp;
  check(healing > wounded, `health comes back after ${HEALTH.regenDelay}s of quiet (${wounded} -> ${healing.toFixed(0)})`);
  run(HEALTH.max / HEALTH.regenRate);
  check(simR.playerState(r).hp === HEALTH.max, 'and it tops out at full again');
}

// ---- Being floored is a moment, not a sentence ----------------------------------------------
{
  const simD = await Simulation.create(miniArena, { seed: 13, crateSpawn: { firstDelay: 999 }, rounds: { autoStart: false } });
  const d = simD.addPlayer();
  const down = simD.player(d);
  if (!down) throw new Error('player has no body');
  simD.ragdoll.knockdown(down, null);
  let upAt = -1;
  for (let i = 0; i < 60 * 6 && upAt < 0; i++) {
    simD.setInput(d, emptyInput());
    simD.update(DT);
    if (simD.playerState(d).posture === 'upright') upAt = i;
  }
  const seconds = upAt / 60;
  check(upAt > 0 && seconds < RAGDOLL.minDownTime + RAGDOLL.recoverTime + 0.6, `a knocked-down player is up again in ${seconds.toFixed(1)}s`);
}


// ---- Changing map keeps the room, swaps the world ------------------------------------------
{
  const simM = await Simulation.create(miniArena, { seed: 17, crateSpawn: { firstDelay: 0.3 }, rounds: { autoStart: false } });
  const one = simM.addPlayer();
  const two = simM.addPlayer();
  const run = (seconds: number): void => {
    for (let i = 0; i < seconds * 60; i++) {
      simM.setInput(one, emptyInput());
      simM.setInput(two, emptyInput());
      simM.update(DT);
    }
  };
  run(2);
  check(simM.crateStates().length > 0, 'a crate is out on the first map');
  const before = simM.physics.colliderCount;

  simM.changeMap(crossfire);
  const events = simM.drainEvents().map((e) => e.type);
  check(simM.arena.map.id === 'crossfire' && events.includes('map-changed'), 'the arena becomes the new map');
  check(simM.physics.colliderCount !== before, `the old map's colliders are gone (${before} -> ${simM.physics.colliderCount})`);
  check(simM.crateStates().length === 0 && simM.pickupStates().length === 0, 'loose things are cleared out');
  check(simM.playerIds().join(',') === `${one},${two}`, 'everyone keeps their player');

  run(1);
  for (const id of [one, two]) {
    const s = simM.playerState(id);
    check(Math.abs(s.y) < 0.6 && s.posture === 'upright', `player ${id} is standing on the new map (y=${s.y.toFixed(2)})`);
  }
  run(2);
  check(simM.crateStates().length > 0, 'and crates start dropping on it');

  // Crossfire's whole shape is the raised cross, so the stairs up it have to work from
  // every side - they are rotated quarter turns, which is easy to get backwards.
  const climber = simM.player(one);
  if (!climber) throw new Error('player has no body');
  const climb = (from: { x: number; z: number }, towards: Partial<PlayerInput>, side: string): void => {
    climber.body.setTranslation({ x: from.x, y: 0.4, z: from.z }, true);
    climber.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    for (let i = 0; i < 20; i++) {
      simM.setInput(one, emptyInput());
      simM.update(DT);
    }
    for (let i = 0; i < 150; i++) {
      simM.setInput(one, { ...emptyInput(), ...towards });
      simM.update(DT);
    }
    check(simM.playerState(one).y > 0.4, `the ${side} stairs climb onto the cross (y=${simM.playerState(one).y.toFixed(2)})`);
  };
  climb({ x: 0.5, z: 8 }, { moveZ: -1 }, 'south');
  climb({ x: 0.5, z: -8 }, { moveZ: 1 }, 'north');
  climb({ x: 8, z: 0.5 }, { moveX: -1 }, 'east');
  climb({ x: -8, z: 0.5 }, { moveX: 1 }, 'west');

  // Back again: the swap has to work in both directions, not just away from the first map.
  simM.changeMap(miniArena);
  run(1);
  check(simM.arena.map.id === 'mini-arena' && simM.playerState(one).posture === 'upright', 'and it swaps back');
}

// ---- Every weapon in the catalog picks up, fires what it carries, and is spent -------------
{
  const simA = await Simulation.create(miniArena, { seed: 23, crateSpawn: { firstDelay: 999 }, rounds: { autoStart: false } });
  const a = simA.addPlayer();
  const evts: string[] = [];
  const step = (input: Partial<PlayerInput> = {}): void => {
    simA.setInput(a, { ...emptyInput(), ...input });
    simA.update(DT);
    for (const e of simA.drainEvents()) evts.push(e.type);
  };
  const fired = (): number => evts.filter((e) => e === 'weapon-fired').length;
  const body = simA.player(a)?.body;
  if (!body) throw new Error('player has no body');
  for (let i = 0; i < 30; i++) step();

  for (const def of Object.values(WEAPONS)) {
    // Somewhere open, so nothing is fired into a column and no crate is in the way.
    body.setTranslation({ x: 0, y: 0.4, z: 6.5 }, true);
    body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    for (let i = 0; i < 20; i++) step();

    const at = simA.playerState(a);
    simA.pickups.spawn(def.id, { x: at.x, y: 0.4, z: at.z }, { x: 0, y: 0, z: 0 });
    for (let i = 0; i < 120 && simA.playerState(a).heldWeapon !== def.id; i++) step();
    check(simA.playerState(a).heldWeapon === def.id, `${def.name} can be picked up`);
    check(simA.playerState(a).weapon?.shotsLeft === def.activation.shots, `${def.name} carries ${def.activation.shots} use(s)`);
    for (let i = 0; i < 20; i++) step(); // nobody presses attack in the same frame they collect it

    const before = fired();
    const recover = Math.ceil((def.activation.windup + def.activation.recovery + 0.35) * 60);
    for (let n = 0; n < def.activation.shots; n++) {
      // A staff can knock itself over with its own blast; you cannot fire while on the floor.
      for (let i = 0; i < 240 && simA.playerState(a).posture !== 'upright'; i++) step();
      for (let i = 0; i < 4; i++) step({ punch: true });
      for (let i = 0; i < recover; i++) step();
    }
    const shots = fired() - before;
    check(shots === def.activation.shots, `${def.name} fires ${def.activation.shots} time(s) (fired ${shots})`);
    check(simA.playerState(a).heldWeapon === null, `${def.name} is gone once it is spent`);
    for (let i = 0; i < 90; i++) step(); // let the pick-up cooldown clear before the next one
  }
}

// ---- Reach is what separates the polearms from the knives ----------------------------------
{
  const simP = await Simulation.create(miniArena, { seed: 29, crateSpawn: { firstDelay: 999 }, rounds: { autoStart: false } });
  const a = simP.addPlayer();
  const b = simP.addPlayer();
  const inputs: Record<number, Partial<PlayerInput>> = { [a]: {}, [b]: {} };
  const step = (): void => {
    simP.setInput(a, { ...emptyInput(), ...inputs[a] });
    simP.setInput(b, { ...emptyInput(), ...inputs[b] });
    simP.update(DT);
    simP.drainEvents();
  };
  const bodyA = simP.player(a)?.body;
  const bodyB = simP.player(b)?.body;
  if (!bodyA || !bodyB) throw new Error('players have no bodies');

  /** Stands A a set distance behind B, facing them, hands A the weapon and swings once. */
  const swingFrom = (weaponId: string, gap: number): number => {
    const holder = simP.player(a);
    if (holder) holder.heldWeapon = null; // drop whatever is left from the last swing
    bodyA.setTranslation({ x: 0, y: 0.4, z: 0 }, true);
    bodyB.setTranslation({ x: 0, y: 0.4, z: gap }, true);
    bodyA.setLinvel({ x: 0, y: 0, z: 0 }, true);
    bodyB.setLinvel({ x: 0, y: 0, z: 0 }, true);
    for (let i = 0; i < 30; i++) step();
    inputs[a] = { moveZ: 0.1 }; // tiny nudge: turns A to face B without really moving
    for (let i = 0; i < 25; i++) step();
    inputs[a] = {};
    simP.pickups.spawn(weaponId, { x: 0, y: 0.4, z: 0 }, { x: 0, y: 0, z: 0 });
    for (let i = 0; i < 120 && simP.playerState(a).heldWeapon !== weaponId; i++) step();
    for (let i = 0; i < 30; i++) step();
    const before = simP.playerState(b).hp;
    inputs[a] = { punch: true };
    for (let i = 0; i < 4; i++) step();
    inputs[a] = {};
    for (let i = 0; i < 60; i++) step();
    return before - simP.playerState(b).hp;
  };

  const daggerFar = swingFrom('quick-dagger', 1.5);
  check(daggerFar === 0, `the dagger cannot reach someone 1.5 away (took ${daggerFar})`);
  const spearFar = swingFrom('war-spear', 1.5);
  check(spearFar >= PLAYER_DAMAGE.pierce, `the spear can (took ${spearFar})`);
}

// ---- A shove is a shove, not a skate -------------------------------------------------------
{
  const simS = await Simulation.create(miniArena, { seed: 33, crateSpawn: { firstDelay: 999 }, rounds: { autoStart: false } });
  const s1 = simS.addPlayer();
  const shoved = simS.player(s1);
  if (!shoved) throw new Error('player has no body');
  const step = (): void => {
    simS.setInput(s1, emptyInput());
    simS.update(DT);
    simS.drainEvents();
  };
  /** Open floor, away from the plinth: inside it the solver pins the body and the numbers lie. */
  const slide = (apply: () => void): number => {
    simS.ragdoll.reset(shoved, { x: 0, y: 0, z: 6.5, yaw: 0 });
    shoved.body.setTranslation({ x: 0, y: 0.4, z: 6.5 }, true);
    shoved.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    for (let i = 0; i < 20; i++) step();
    const from = simS.playerState(s1);
    apply();
    for (let i = 0; i < 60 * 5; i++) {
      step();
      const now = simS.playerState(s1);
      if (i > 30 && now.posture === 'upright' && Math.hypot(now.vx, now.vz) < 0.05) break;
    }
    const to = simS.playerState(s1);
    return Math.hypot(to.x - from.x, to.z - from.z);
  };

  const kicked = slide(() => shoved.shove({ x: 1, z: 0 }, ATTACKS.kick.impulse));
  check(kicked < 1, `a kick shoves you about a step, not across the arena (${kicked.toFixed(2)} units)`);

  const thrown = slide(() => {
    shoved.body.setLinvel({ x: THROW.playerSpeed, y: THROW.playerSpeed * THROW.playerUp, z: 0 }, true);
    simS.ragdoll.knockdown(shoved, null);
  });
  check(thrown < 2.5, `a thrown player lands and stops rather than rolling on (${thrown.toFixed(2)} units)`);
  check(thrown > 0.6, `but a throw still carries you somewhere (${thrown.toFixed(2)} units)`);
}

// ---- Sprinting costs stamina, and running out means walking -------------------------------
{
  const simE = await Simulation.create(miniArena, { seed: 41, crateSpawn: { firstDelay: 999 }, rounds: { autoStart: false } });
  const e = simE.addPlayer();
  const runner = simE.player(e);
  if (!runner) throw new Error('player has no body');
  const go = (seconds: number, input: Partial<PlayerInput> = {}): void => {
    for (let i = 0; i < seconds * 60; i++) {
      simE.setInput(e, { ...emptyInput(), ...input });
      simE.update(DT);
    }
  };
  const put = (): void => {
    // z = 5 is behind the border, not the opening: a long sprint here ends at a wall rather
    // than off the edge, where the respawn would hand back a full bar and hide the result.
    runner.body.setTranslation({ x: -7.5, y: 0.4, z: 5 }, true);
    runner.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    go(0.3);
  };

  put();
  check(simE.playerState(e).stamina === PLAYER.staminaMax, 'you start with a full bar');
  go(1, { moveX: 1, run: true });
  const spent = simE.playerState(e).stamina;
  check(spent < PLAYER.staminaMax && simE.playerState(e).running, `sprinting spends it (${spent.toFixed(0)} left)`);

  // Hold it down until the bar is gone: the sprint has to stop even with the key still held.
  put();
  go(5, { moveX: 1, run: true });
  const dry = simE.playerState(e);
  check(dry.winded && !dry.running, 'holding sprint runs the bar dry and drops you to a walk');

  // And keeping it held does not hand the sprint back the moment the bar creeps up again.
  go(2, { moveX: 1, run: true });
  const stillHeld = simE.playerState(e);
  check(stillHeld.winded && !stillHeld.running, `still winded while the key is held (${stillHeld.stamina.toFixed(0)} in the bar)`);

  // Let go, get your breath back, and you can go again.
  go(1.2);
  check(!simE.playerState(e).winded, 'letting go is what ends it');
  put();
  go(0.4, { moveX: 1, run: true });
  check(simE.playerState(e).running, 'and then you can sprint again');
  go(8);
  check(simE.playerState(e).stamina === PLAYER.staminaMax, 'a proper rest refills it completely');
}

// ---- Booby traps: rigged crates leave a mine, and a mine catches anyone -------------------
{
  const simM2 = await Simulation.create(miniArena, { seed: 47, crateSpawn: { firstDelay: 999 }, rounds: { autoStart: false } });
  const m1 = simM2.addPlayer();
  const walker = simM2.player(m1);
  if (!walker) throw new Error('player has no body');
  const evts: string[] = [];
  const step = (input: Partial<PlayerInput> = {}): void => {
    simM2.setInput(m1, { ...emptyInput(), ...input });
    simM2.update(DT);
    for (const e of simM2.drainEvents()) evts.push(e.type);
  };
  const stand = (x: number, z: number): void => {
    walker.body.setTranslation({ x, y: 0.4, z }, true);
    walker.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    for (let i = 0; i < 20; i++) step();
  };

  stand(-6, 5);
  simM2.mines.place({ x: 0, y: 0.05, z: 5 });
  step(); // events only reach the log once the sim is drained
  check(simM2.mineStates().length === 1 && evts.includes('mine-placed'), 'a mine can be left on the floor');
  check(simM2.mineStates()[0]?.armed === false, 'and it is harmless while it settles');

  // Nobody near it: it arms and then just sits there.
  for (let i = 0; i < 60 * 2; i++) step();
  check(simM2.mineStates()[0]?.armed === true && evts.includes('mine-armed'), 'it arms itself after a moment');
  check(simM2.playerState(m1).hp === HEALTH.max, 'and does nothing to someone stood well clear');

  // Walk into it. It should trip, pause, and take a serious bite out of the walker.
  const before = simM2.playerState(m1).hp;
  for (let i = 0; i < 60 * 5 && !evts.includes('explosion'); i++) step({ moveX: 1, run: false });
  check(evts.includes('mine-triggered'), 'walking up to it trips it');
  check(evts.includes('explosion') && simM2.mineStates().length === 0, 'it goes off and is gone');
  const hurt = simM2.playerState(m1);
  check(hurt.hp < before - 20, `and it hurts whoever set it off (${before} -> ${hurt.hp.toFixed(0)})`);
  check(hurt.posture === 'ragdoll', 'and puts them on the floor');
}

// Every spawn point, anywhere its random nudge can land, has to be clear of the level: a
// player dealt a spot inside the Crossfire stairs was wedged there and could not move.
{
  const capsule = new RAPIER.Capsule(PLAYER.capsuleHalfHeight, PLAYER.capsuleRadius);
  const noTurn = { x: 0, y: 0, z: 0, w: 1 };
  for (const map of listMaps()) {
    const simC = await Simulation.create(map, { seed: 1, crateSpawn: { firstDelay: 999 }, rounds: { autoStart: false } });
    simC.physics.world.step(); // queries only see colliders once the world has stepped
    const blocked: string[] = [];
    map.spawns.forEach((spawn, i) => {
      for (let dx = -1; dx <= 1; dx += 0.5) for (let dz = -1; dz <= 1; dz += 0.5) {
        const centre = {
          x: spawn.x + dx * SPAWN_JITTER,
          y: spawn.y + PLAYER.capsuleHalfHeight + PLAYER.capsuleRadius + 0.02,
          z: spawn.z + dz * SPAWN_JITTER,
        };
        let hit = false;
        simC.physics.world.intersectionsWithShape(centre, noTurn, capsule, (collider) => {
          hit = collider.parent() === null; // the level itself; players and crates have bodies
          return !hit;
        });
        if (hit) {
          blocked.push(`#${i} (${spawn.x.toFixed(2)}, ${spawn.z.toFixed(2)})`);
          return;
        }
      }
    });
    check(blocked.length === 0, `${map.name}: all ${map.spawns.length} spawn points are clear of the level${blocked.length ? ` - blocked: ${blocked.join(' ')}` : ''}`);
    check(map.spawns.length >= 8, `${map.name}: enough spawn points for a full room`);
  }
}

console.log('\nAll simulation checks passed.');
