import type { MapDefinition, MapPiece, SpawnPoint } from './MapDefinition';
import { buildPlatform, spawnRing } from './platform';

/**
 * Crossfire - the open map.
 * No plinth in the middle: instead a raised cross of blocks runs the width of the arena, with
 * stairs up at all four ends. The high ground is the whole point - it is where the crates land
 * and where you can see people coming - but it is two tiles wide with nothing to hold onto, so
 * anyone up there is one good shove from the floor, and the floor is one good shove from the
 * openings. Wider gaps than Mini Arena, and far less cover.
 */

const HALF = 10;
const { pieces, colliders, edge: EDGE } = buildPlatform({ half: HALF, gap: 4 });

function add(model: string, x: number, y: number, z: number, rotY = 0, kind?: MapPiece['kind']): void {
  const piece: MapPiece = { model, x, y, z, rotY };
  if (kind) piece.kind = kind;
  pieces.push(piece);
}

/** The cross: two walkways of blocks, half a unit up, crossing at the centre. */
const ARM = 5.5; // how far each arm reaches from the middle
for (let i = -ARM; i <= ARM; i++) {
  for (const offset of [-0.5, 0.5]) {
    add('block', i, 0, offset); // the arm running along X
    add('block', offset, 0, i); // the arm running along Z
  }
}

// Stairs up at the four ends. They rise towards -Z at rotY 0, so each one faces outwards.
for (const offset of [-0.5, 0.5]) {
  add('stairs', offset, 0, ARM + 1, 0); // south end, climbing north
  add('stairs', offset, 0, -ARM - 1, 2); // north end, climbing south
  add('stairs', ARM + 1, 0, offset, 1); // east end
  add('stairs', -ARM - 1, 0, offset, 3); // west end
}

// Columns mark the four quadrants, set back so the cross stays walkable.
for (const [cx, cz] of [[-4.5, -4.5], [4.5, -4.5], [-4.5, 4.5], [4.5, 4.5]] as const) {
  add(cx > 0 && cz < 0 ? 'column-damaged' : 'column', cx, 0, cz);
}

const RIM = EDGE - 1;
for (const [bx, bz] of [[-RIM, -RIM], [RIM, -RIM], [-RIM, RIM], [RIM, RIM]] as const) {
  add('banner', bx, 0, bz, 0, 'decor');
}
add('weapon-rack', -RIM, 0, 0.5, 1);
add('weapon-rack', RIM, 0, -0.5, 3);

// Rubble in the quadrants: the only cover down on the floor.
add('bricks', -6.5, 0, 2.5, 0, 'prop');
add('bricks', 6.5, 0, -2.5, 2, 'prop');
add('bricks', 2.5, 0, 6.5, 1, 'prop');
add('bricks', -2.5, 0, -6.5, 3, 'prop');
add('trophy', 0, 0.5, 0, 0, 'prop'); // sitting on the middle of the cross, asking to be taken

/**
 * Spawns: all in the open quadrants between the arms, facing the middle. Nothing may sit on an
 * arm or its stairs, or under a column - a player dealt such a spot starts wedged in the level.
 * The sim test checks every spot, including how far the random nudge can push it.
 */
const spawns: SpawnPoint[] = [...spawnRing(4, 7.5, Math.PI / 4), ...spawnRing(4, 4.2, Math.PI / 4), ...spawnRing(8, 5.8, Math.PI / 8)];

// Crates land on the cross itself and out in the quadrants - the high ground is worth holding.
const crateSpawns = [
  { x: 0, y: 0.5, z: 3.5 },
  { x: 0, y: 0.5, z: -3.5 },
  { x: 3.5, y: 0.5, z: 0 },
  { x: -3.5, y: 0.5, z: 0 },
  { x: 4.5, y: 0, z: 4.5 },
  { x: -4.5, y: 0, z: -4.5 },
  { x: 4.5, y: 0, z: -4.5 },
  { x: -4.5, y: 0, z: 4.5 },
  { x: 7.5, y: 0, z: 2.5 },
  { x: -7.5, y: 0, z: -2.5 },
];

export const crossfire: MapDefinition = {
  id: 'crossfire',
  name: 'Crossfire',
  pack: 'arena',
  pieces,
  colliders,
  spawns,
  crateSpawns,
  killY: -6,
  camera: { position: { x: 0, y: 26, z: 24 }, target: { x: 0, y: 0, z: 0 }, followDistance: 12 },
  skyColor: 0xf0b07a, // low sun: a warmer, dustier sky than Mini Arena
};
