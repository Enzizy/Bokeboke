import * as THREE from 'three';

interface Debris {
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
  spin: THREE.Vector3;
  floorY: number;
  life: number;
  maxLife: number;
}

const GRAVITY = -14;
const BOUNCE = 0.35;
const GROUND_DRAG = 0.85;

/** Height of the ground under (x, z), or -Infinity where there is nothing to land on. */
export type GroundQuery = (x: number, z: number) => number;

/**
 * Purely cosmetic flying bits (crate pieces, hit puffs). They get a toy-physics treatment on
 * the client - gravity, a bounce on the floor they broke on, spin, then shrink away - so the
 * server never has to know they exist.
 */
export class DebrisSystem {
  readonly root = new THREE.Group();
  private readonly items: Debris[] = [];
  private readonly groundAt: GroundQuery;

  constructor(groundAt: GroundQuery) {
    this.root.name = 'debris';
    this.groundAt = groundAt;
  }

  /** Takes ownership of `mesh` (already in world space) and launches it. */
  launch(mesh: THREE.Mesh, velocity: THREE.Vector3, spin: THREE.Vector3, floorY: number, life = 2.5): void {
    this.root.add(mesh);
    this.items.push({ mesh, velocity, spin, floorY, life, maxLife: life });
  }

  /** A handful of small cubes bursting from a point - the generic "something got hit" puff. */
  puff(at: THREE.Vector3, color: number, count = 6, speed = 2.2, floorY = at.y - 0.3): void {
    const geometry = new THREE.BoxGeometry(0.06, 0.06, 0.06);
    const material = new THREE.MeshStandardMaterial({ color, roughness: 1 });
    for (let i = 0; i < count; i++) {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.castShadow = true;
      mesh.position.copy(at);
      const dir = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.8 + 0.3, Math.random() - 0.5).normalize();
      this.launch(mesh, dir.multiplyScalar(speed * (0.6 + Math.random() * 0.6)), randomSpin(10), floorY, 0.9);
    }
  }

  update(dt: number): void {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const d = this.items[i] as Debris;
      d.life -= dt;
      if (d.life <= 0) {
        this.root.remove(d.mesh);
        this.items.splice(i, 1);
        continue;
      }
      d.velocity.y += GRAVITY * dt;
      d.mesh.position.addScaledVector(d.velocity, dt);
      d.mesh.rotation.x += d.spin.x * dt;
      d.mesh.rotation.y += d.spin.y * dt;
      d.mesh.rotation.z += d.spin.z * dt;
      // Re-check the ground only when close to it, so pieces fall off edges and land on props.
      if (d.velocity.y < 0 && d.mesh.position.y < d.floorY + 0.15) d.floorY = this.groundAt(d.mesh.position.x, d.mesh.position.z);
      if (d.mesh.position.y < d.floorY) {
        d.mesh.position.y = d.floorY;
        d.velocity.y = Math.abs(d.velocity.y) * BOUNCE;
        d.velocity.x *= GROUND_DRAG;
        d.velocity.z *= GROUND_DRAG;
        d.spin.multiplyScalar(0.6);
      }
      // Shrink away over the last part of its life instead of popping out of existence.
      const fade = Math.min(1, d.life / (d.maxLife * 0.3));
      d.mesh.scale.setScalar(fade);
    }
  }

  get count(): number {
    return this.items.length;
  }
}

export function randomSpin(strength: number): THREE.Vector3 {
  return new THREE.Vector3((Math.random() - 0.5) * strength, (Math.random() - 0.5) * strength, (Math.random() - 0.5) * strength);
}
