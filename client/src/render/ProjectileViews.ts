import * as THREE from 'three';
import type { ProjectileState } from '@shared/weapons/ProjectileSystem';
import type { AssetLoader } from '../assets/AssetLoader';
import { weaponRef } from '../assets/assetPaths';
import type { DebrisSystem } from '../effects/DebrisSystem';

const ARROW_MODEL = 'arrow_A';
const ARROW_SCALE = 0.4;
const AXE_MODEL = 'axe_A';
const AXE_SCALE = 0.45;
/** Turns a second for a thrown axe: fast enough to read as tumbling, slow enough to follow. */
const AXE_SPIN = 14;
const FIREBALL_COLOR = 0xff7a2a;
const BOLT_COLOR = 0x7ae6c8;

/**
 * Visuals for things in flight. Arrows point along their velocity and thrown axes tumble;
 * fireballs and wand bolts are glowing spheres that shed sparks. A short-lived flash sphere
 * sells explosions.
 */
export class ProjectileViews {
  readonly root = new THREE.Group();
  private readonly views = new Map<number, THREE.Object3D>();
  private readonly pending = new Set<number>();
  private readonly flashes: { mesh: THREE.Mesh; life: number; radius: number }[] = [];
  private readonly loader: AssetLoader;
  private readonly debris: DebrisSystem;
  private readonly fireballGeometry = new THREE.IcosahedronGeometry(0.2, 1);
  private readonly fireballMaterial = new THREE.MeshStandardMaterial({ color: FIREBALL_COLOR, emissive: FIREBALL_COLOR, emissiveIntensity: 1.2, roughness: 1 });
  private readonly boltGeometry = new THREE.IcosahedronGeometry(0.11, 1);
  private readonly boltMaterial = new THREE.MeshStandardMaterial({ color: BOLT_COLOR, emissive: BOLT_COLOR, emissiveIntensity: 1.4, roughness: 1 });
  private readonly flashGeometry = new THREE.IcosahedronGeometry(1, 1);
  private emberClock = 0;

  constructor(loader: AssetLoader, debris: DebrisSystem) {
    this.loader = loader;
    this.debris = debris;
    this.root.name = 'projectiles';
  }

  sync(states: ProjectileState[], dt: number): void {
    const seen = new Set<number>();
    this.emberClock += dt;
    const shedEmbers = this.emberClock > 0.05;
    if (shedEmbers) this.emberClock = 0;
    for (const s of states) {
      seen.add(s.id);
      const view = this.views.get(s.id);
      if (!view) {
        if (!this.pending.has(s.id)) this.create(s);
        continue;
      }
      view.position.set(s.x, s.y, s.z);
      if (s.type === 'arrow') pointAlong(view, s);
      else if (s.type === 'axe') view.rotation.x -= AXE_SPIN * dt; // end over end as it flies
      else if (shedEmbers) {
        this.debris.puff(view.position, s.type === 'bolt' ? BOLT_COLOR : FIREBALL_COLOR, 1, 0.8, -Infinity);
      }
    }
    for (const [id, view] of this.views) {
      if (!seen.has(id)) {
        this.root.remove(view);
        this.views.delete(id);
      }
    }
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const f = this.flashes[i] as { mesh: THREE.Mesh; life: number; radius: number };
      f.life -= dt;
      const t = 1 - Math.max(0, f.life) / 0.3;
      f.mesh.scale.setScalar(f.radius * (0.3 + t * 0.7));
      (f.mesh.material as THREE.MeshBasicMaterial).opacity = 0.8 * (1 - t);
      if (f.life <= 0) {
        this.root.remove(f.mesh);
        this.flashes.splice(i, 1);
      }
    }
  }

  explosion(at: THREE.Vector3, radius: number): void {
    const material = new THREE.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.8 });
    const mesh = new THREE.Mesh(this.flashGeometry, material);
    mesh.position.copy(at);
    this.root.add(mesh);
    this.flashes.push({ mesh, life: 0.3, radius });
    this.debris.puff(at, FIREBALL_COLOR, 18, 4.5, at.y - 0.3);
    this.debris.puff(at, 0xffd23f, 12, 6, at.y - 0.3);
  }

  private create(s: ProjectileState): void {
    if (s.type === 'fireball' || s.type === 'bolt') {
      const bolt = s.type === 'bolt';
      const mesh = new THREE.Mesh(bolt ? this.boltGeometry : this.fireballGeometry, bolt ? this.boltMaterial : this.fireballMaterial);
      mesh.position.set(s.x, s.y, s.z);
      this.views.set(s.id, mesh);
      this.root.add(mesh);
      return;
    }
    if (s.type !== 'arrow' && s.type !== 'axe') return; // melee has nothing in flight to draw
    const arrow = s.type === 'arrow';
    this.pending.add(s.id);
    void this.loader.load(weaponRef(arrow ? ARROW_MODEL : AXE_MODEL)).then((model) => {
      this.pending.delete(s.id);
      const group = new THREE.Group();
      const piece = this.loader.instantiate(model);
      piece.scale.setScalar(arrow ? ARROW_SCALE : AXE_SCALE);
      group.add(piece);
      group.position.set(s.x, s.y, s.z);
      if (arrow) pointAlong(group, s);
      else group.rotation.y = Math.atan2(s.vx, s.vz); // tumble in the plane it was thrown along
      this.views.set(s.id, group);
      this.root.add(group);
    });
  }
}

const target = new THREE.Vector3();

/** The arrow model lies along +Z; aim it down its velocity. */
function pointAlong(view: THREE.Object3D, s: ProjectileState): void {
  target.set(s.x + s.vx, s.y + s.vy, s.z + s.vz);
  view.lookAt(target);
}
