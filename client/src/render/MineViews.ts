import * as THREE from 'three';
import type { MineState } from '@shared/weapons/MineSystem';

const BODY_COLOR = 0x3c4450;
const ARMING_COLOR = 0xffe066;
const ARMED_COLOR = 0xff4d4d;

/**
 * Booby traps on the floor: a squat drum with a light on top. It blinks slowly while it settles,
 * steadily once it is live, and frantically in the half second after somebody trips it - which is
 * the only warning anyone gets.
 */
export class MineViews {
  readonly root = new THREE.Group();
  private readonly views = new Map<number, { group: THREE.Group; light: THREE.Mesh }>();
  private readonly drum = new THREE.CylinderGeometry(0.19, 0.22, 0.1, 12);
  private readonly dome = new THREE.SphereGeometry(0.07, 10, 8);
  private readonly bodyMaterial = new THREE.MeshStandardMaterial({ color: BODY_COLOR, roughness: 0.8 });
  private clock = 0;

  constructor() {
    this.root.name = 'mines';
  }

  sync(states: MineState[], dt: number): void {
    this.clock += dt;
    const seen = new Set<number>();
    for (const state of states) {
      seen.add(state.id);
      const view = this.views.get(state.id) ?? this.create(state.id);
      view.group.position.set(state.x, state.y + 0.05, state.z);
      // Slow pulse while arming, a steady heartbeat when live, a panic when tripped.
      const rate = state.fuse > 0 ? 22 : state.armed ? 6 : 2.5;
      const glow = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(this.clock * rate));
      const material = view.light.material as THREE.MeshStandardMaterial;
      material.emissiveIntensity = glow * (state.armed ? 2.2 : 1);
      material.color.setHex(state.armed ? ARMED_COLOR : ARMING_COLOR);
      material.emissive.setHex(state.armed ? ARMED_COLOR : ARMING_COLOR);
    }
    for (const [id, view] of this.views) {
      if (seen.has(id)) continue;
      this.root.remove(view.group);
      (view.light.material as THREE.Material).dispose();
      this.views.delete(id);
    }
  }

  clear(): void {
    for (const view of this.views.values()) this.root.remove(view.group);
    this.views.clear();
  }

  private create(id: number): { group: THREE.Group; light: THREE.Mesh } {
    const group = new THREE.Group();
    const body = new THREE.Mesh(this.drum, this.bodyMaterial);
    body.castShadow = true;
    body.receiveShadow = true;
    // Each mine owns its light material, because they blink out of step with each other.
    const light = new THREE.Mesh(this.dome, new THREE.MeshStandardMaterial({
      color: ARMING_COLOR,
      emissive: ARMING_COLOR,
      emissiveIntensity: 1,
      roughness: 1,
    }));
    light.position.y = 0.06;
    group.add(body, light);
    this.root.add(group);
    const view = { group, light };
    this.views.set(id, view);
    return view;
  }
}
