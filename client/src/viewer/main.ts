import * as THREE from 'three';
import { AssetLoader } from '../assets/AssetLoader';
import { characterRef, weaponRef } from '../assets/assetPaths';
import { createScene, fitShadowToArea } from '../app/SceneSetup';

/**
 * Dev tool: /viewer.html lays every weapon model out in a grid beside a character for scale
 * and prints which ones loaded. Not part of the game. ?scale=0.35 previews a different size.
 */
const WEAPONS = [
  'arrow_A', 'arrow_B', 'axe_A', 'axe_B', 'axe_C', 'bow_A', 'bow_A_withString', 'bow_B',
  'bow_B_withString', 'dagger_A', 'dagger_B', 'fistweapon_A', 'fistweapon_A_stacked',
  'fistweapon_B', 'fistweapon_B_stacked', 'halberd', 'hammer_A', 'hammer_B', 'hammer_C',
  'shield_A', 'shield_B', 'shield_C', 'spear_A', 'staff_A', 'staff_B', 'sword_A', 'sword_B',
  'sword_C', 'sword_D', 'sword_E', 'wand_A',
];

const params = new URLSearchParams(location.search);
const scale = Number(params.get('scale') ?? '1');
const canvas = document.getElementById('game') as HTMLCanvasElement;
const report = document.getElementById('debug') as HTMLElement;

const lines: string[] = [`weapons @ scale ${scale}`];
function show(): void {
  report.textContent = lines.join('\n');
}
addEventListener('error', (e) => {
  lines.push(`PAGE ERROR ${e.message}`);
  show();
});
addEventListener('unhandledrejection', (e) => {
  lines.push(`REJECTION ${String(e.reason)}`);
  show();
});

const { renderer, scene, sun } = createScene(canvas, 0x8ec9e8);
fitShadowToArea(sun, 12);
const camera = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.1, 100);
camera.position.set(0, 9, 12);
camera.lookAt(0, 0.5, 0);

const floor = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), new THREE.MeshStandardMaterial({ color: 0xd9b48c }));
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);

const loader = new AssetLoader();
const COLS = 8;
const SPACING = 1.6;

async function place(name: string, index: number, ref = weaponRef(name), s = scale): Promise<void> {
  const col = index % COLS;
  const row = Math.floor(index / COLS);
  const x = (col - (COLS - 1) / 2) * SPACING;
  const z = (row - 1.5) * SPACING;
  try {
    const model = await loader.load(ref);
    const obj = loader.instantiate(model);
    obj.scale.setScalar(s);
    // Stand each model on the floor: weapons have their grip at the origin, not their base.
    const box = new THREE.Box3().setFromObject(obj);
    obj.position.set(x, -box.min.y, z);
    scene.add(obj);
    const size = box.getSize(new THREE.Vector3());
    lines.push(`ok    ${name.padEnd(22)} ${size.x.toFixed(2)} x ${size.y.toFixed(2)} x ${size.z.toFixed(2)}`);
  } catch (err) {
    lines.push(`FAIL  ${name}: ${String(err)}`);
  }
  show();
}

async function main(): Promise<void> {
  const only = params.get('only')?.split(',');
  const list = only ?? WEAPONS.slice(Number(params.get('from') ?? 0), Number(params.get('to') ?? WEAPONS.length));
  await Promise.all([
    place('character-male-a', 0, characterRef('character-male-a'), 1),
    ...list.map((name, i) => place(name, i + 1)),
  ]);
  lines.push('done');
  show();
}

function resize(): void {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();
renderer.setAnimationLoop(() => renderer.render(scene, camera));
void main();
