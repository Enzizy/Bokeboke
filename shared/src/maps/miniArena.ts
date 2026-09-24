import type { MapDefinition, MapPiece, SpawnPoint } from './MapDefinition';
import { buildPlatform, spawnRing } from './platform';

/**
 * Mini Arena - the introductory map.
 * A raised 20x20 tile platform floating in the sky, with a 6-tile gap in the middle of every
 * side so players can be thrown off. A statue on a plinth sits in the centre; columns, low
 * walls and rubble give things to slam people into and a reason to move around a floor this
 * size. The camera follows players rather than framing the whole arena, so the floor can be
 * bigger than one screenful.
 *
 * Tile centres sit on half-integers (-9.5 .. 9.5), so the platform is centred on the origin.
 * `stairs` rise towards -Z at rotY 0 (measured from the GLB; see assets/ASSET_INVENTORY.md).
 */

const HALF = 10;
const { pieces, colliders, edge: EDGE } = buildPlatform({ half: HALF, gap: 3 });

function add(model: string, x: number, y: number, z: number, rotY = 0, kind?: MapPiece['kind']): void {
  const piece: MapPiece = { model, x, y, z, rotY };
  if (kind) piece.kind = kind;
  pieces.push(piece);
}

// Centre plinth + statue ---------------------------------------------------------------
add('block', -0.5, 0, -0.5);
add('block', 0.5, 0, -0.5);
add('block', -0.5, 0, 0.5);
add('block', 0.5, 0, 0.5);
add('statue', 0, 0.5, 0);
add('stairs', -0.5, 0, 1.5); // rise north onto the plinth
add('stairs', 0.5, 0, 1.5);

// Columns: an inner four around the plinth and an outer four towards the corners, so a
// bigger floor still has cover wherever you are standing.
for (const [cx, cz] of [[-3.5, -3.5], [3.5, -3.5], [-3.5, 3.5], [3.5, 3.5]] as const) {
  add(cx < 0 && cz > 0 ? 'column-damaged' : 'column', cx, 0, cz);
}
const OUTER = EDGE - 2;
for (const [cx, cz] of [[-OUTER, -OUTER], [OUTER, -OUTER], [-OUTER, OUTER], [OUTER, OUTER]] as const) {
  add(cx > 0 && cz > 0 ? 'column-damaged' : 'column', cx, 0, cz);
}

// Low walls to fight around away from the middle. They flank the openings rather than stand
// in them: the middle of every side has to stay clear, because that is where people go over.
for (const [wx, wz, turns] of [[-OUTER, -3.5, 1], [OUTER, 3.5, 1], [-3.5, OUTER, 0], [3.5, -OUTER, 0]] as const) {
  add('wall', wx, 0, wz, turns);
}

const RIM = EDGE - 1; // one tile in from the border, so nothing overlaps it
add('weapon-rack', -RIM, 0, -3.5, 1);
add('weapon-rack', RIM, 0, 3.5, 3);
add('banner', RIM, 0, -RIM, 0, 'decor');
add('banner', -RIM, 0, RIM, 0, 'decor');
add('banner', -RIM, 0, -RIM, 0, 'decor');

// Props (rendered now, become throwable bodies once the prop system exists) --------------
add('bricks', 3.5, 0, 0.5, 0, 'prop');
add('bricks', -3.5, 0, -0.5, 2, 'prop');
add('bricks', 4.5, 0, -4.5, 1, 'prop');
add('trophy', 0, 0, -3.5, 0, 'prop');
add('trophy', -4.5, 0, 4.5, 0, 'prop');

/**
 * Spawns: two rings around the plinth. The simulation shuffles which player gets which one
 * each round, so a match never opens the same way twice.
 */
const spawns: SpawnPoint[] = [...spawnRing(8, 4, Math.PI / 8), ...spawnRing(8, EDGE - 2.5, Math.PI / 8)];

// Crates drop onto open floor, never onto the plinth, a column or the props.
const crateSpawns = [
  { x: 2.5, y: 0, z: -2 },
  { x: -2.5, y: 0, z: -2 },
  { x: 2.5, y: 0, z: 2.5 },
  { x: -2.5, y: 0, z: 2.5 },
  { x: 0, y: 0, z: 4.5 },
  { x: 0, y: 0, z: -5.5 },
  { x: 5.5, y: 0, z: 0.5 },
  { x: -5.5, y: 0, z: 0.5 },
  { x: 4.5, y: 0, z: 5.5 },
  { x: -4.5, y: 0, z: -5.5 },
  { x: 7.5, y: 0, z: -3.5 },
  { x: -7.5, y: 0, z: 3.5 },
  { x: 3.5, y: 0, z: 7.5 },
  { x: -3.5, y: 0, z: -7.5 },
];

export const miniArena: MapDefinition = {
  id: 'mini-arena',
  name: 'Mini Arena',
  pack: 'arena',
  pieces,
  colliders,
  spawns,
  crateSpawns,
  killY: -6,
  // position is the widest shot: the camera only backs off this far when players are far apart.
  camera: { position: { x: 0, y: 26, z: 24 }, target: { x: 0, y: 0, z: 0.5 }, followDistance: 12 },
  skyColor: 0x8ec9e8,
};
