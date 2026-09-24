import * as THREE from 'three';

export interface CratePiece {
  mesh: THREE.Mesh;
  baseColor: THREE.Color;
}

/** Warm wood tones picked to sit next to the Kenney arena palette. */
const PLANK = 0xd9a066;
const FRAME = 0x8f5a2c;
const BRACE = 0xa8703a;
const METAL = 0x8c96a0;
const CRACK = 0x4a2d16;

const roughWood = (color: number): THREE.MeshStandardMaterial =>
  new THREE.MeshStandardMaterial({ color, roughness: 1, metalness: 0, flatShading: true });

/**
 * Builds a low-poly wooden crate out of separate meshes so it can be broken apart:
 * six face panels, a twelve-beam frame, an X-brace on every side and four metal corner caps.
 * Cracks are thin dark slivers on the side panels, hidden until damage reveals them.
 */
export function buildCratePieces(half: number): { pieces: CratePiece[]; cracks: THREE.Mesh[] } {
  const pieces: CratePiece[] = [];
  const beam = 0.11 * (half / 0.35);
  const inset = half - beam / 2;
  const panelThickness = 0.05;
  const panelSize = half * 2 - beam;

  const add = (geometry: THREE.BufferGeometry, color: number, position: THREE.Vector3, rotation?: THREE.Euler): THREE.Mesh => {
    const mesh = new THREE.Mesh(geometry, roughWood(color));
    mesh.position.copy(position);
    if (rotation) mesh.rotation.copy(rotation);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    pieces.push({ mesh, baseColor: new THREE.Color(color) });
    return mesh;
  };

  // Face panels, slightly inside the frame.
  const panel = new THREE.BoxGeometry(panelSize, panelSize, panelThickness);
  const p = half - panelThickness / 2 - 0.01;
  add(panel, PLANK, new THREE.Vector3(0, 0, p));
  add(panel, PLANK, new THREE.Vector3(0, 0, -p));
  add(panel, PLANK, new THREE.Vector3(p, 0, 0), new THREE.Euler(0, Math.PI / 2, 0));
  add(panel, PLANK, new THREE.Vector3(-p, 0, 0), new THREE.Euler(0, Math.PI / 2, 0));
  add(panel, PLANK, new THREE.Vector3(0, p, 0), new THREE.Euler(Math.PI / 2, 0, 0));
  add(panel, PLANK, new THREE.Vector3(0, -p, 0), new THREE.Euler(Math.PI / 2, 0, 0));

  // Frame: 4 posts + 8 horizontal beams.
  const post = new THREE.BoxGeometry(beam, half * 2, beam);
  const beamX = new THREE.BoxGeometry(half * 2, beam, beam);
  const beamZ = new THREE.BoxGeometry(beam, beam, half * 2);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) add(post, FRAME, new THREE.Vector3(sx * inset, 0, sz * inset));
    for (const sy of [-1, 1]) {
      add(beamX, FRAME, new THREE.Vector3(0, sy * inset, sx * inset));
      add(beamZ, FRAME, new THREE.Vector3(sx * inset, sy * inset, 0));
    }
  }

  // X braces on the four sides.
  const brace = new THREE.BoxGeometry(half * 2.2, beam * 0.6, 0.03);
  const b = half + 0.005;
  for (const sign of [-1, 1]) {
    for (const tilt of [Math.PI / 4, -Math.PI / 4]) {
      add(brace, BRACE, new THREE.Vector3(0, 0, sign * b), new THREE.Euler(0, 0, tilt));
      add(brace, BRACE, new THREE.Vector3(sign * b, 0, 0), new THREE.Euler(0, Math.PI / 2, tilt));
    }
  }

  // Metal caps on the top corners: the "fantasy chest" touch.
  const cap = new THREE.BoxGeometry(beam * 1.4, beam * 0.5, beam * 1.4);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) add(cap, METAL, new THREE.Vector3(sx * inset, half + beam * 0.2, sz * inset));

  // Cracks: dark slivers lying on the side panels, revealed with damage.
  const cracks: THREE.Mesh[] = [];
  const crackGeometry = new THREE.BoxGeometry(half * 0.9, 0.025, 0.02);
  const crackMaterial = roughWood(CRACK);
  const sides: [THREE.Vector3, THREE.Euler][] = [
    [new THREE.Vector3(0, 0, half + 0.012), new THREE.Euler(0, 0, 0)],
    [new THREE.Vector3(0, 0, -half - 0.012), new THREE.Euler(0, 0, 0)],
    [new THREE.Vector3(half + 0.012, 0, 0), new THREE.Euler(0, Math.PI / 2, 0)],
    [new THREE.Vector3(-half - 0.012, 0, 0), new THREE.Euler(0, Math.PI / 2, 0)],
  ];
  sides.forEach(([position, rotation], i) => {
    for (let k = 0; k < 2; k++) {
      const crack = new THREE.Mesh(crackGeometry, crackMaterial);
      crack.position.copy(position).add(new THREE.Vector3(0, (k === 0 ? 0.22 : -0.18) * half, 0));
      crack.rotation.copy(rotation);
      crack.rotation.z += (k === 0 ? 0.5 : -0.7) + i * 0.15;
      crack.visible = false;
      cracks.push(crack);
    }
  });

  return { pieces, cracks };
}
