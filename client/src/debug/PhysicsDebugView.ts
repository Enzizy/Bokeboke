import * as THREE from 'three';
import type { PhysicsWorld } from '@shared/sim/PhysicsWorld';

/**
 * Draws Rapier's collider wireframes. Only rebuilt while visible (toggle with F when the
 * debug overlay is open), so it costs nothing in normal play.
 */
export class PhysicsDebugView {
  readonly lines: THREE.LineSegments;
  private readonly physics: PhysicsWorld;

  constructor(physics: PhysicsWorld) {
    this.physics = physics;
    const geometry = new THREE.BufferGeometry();
    const material = new THREE.LineBasicMaterial({ vertexColors: true, depthTest: false });
    this.lines = new THREE.LineSegments(geometry, material);
    this.lines.renderOrder = 999;
    this.lines.visible = false;
    this.lines.frustumCulled = false;
  }

  toggle(): void {
    this.lines.visible = !this.lines.visible;
  }

  update(): void {
    if (!this.lines.visible) return;
    const buffers = this.physics.world.debugRender();
    const geometry = this.lines.geometry;
    geometry.setAttribute('position', new THREE.BufferAttribute(buffers.vertices, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(buffers.colors, 4));
  }
}
