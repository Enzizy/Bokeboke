import * as THREE from 'three';
import type { CameraSetup } from '@shared/maps/MapDefinition';

/** How much of the gap between players is added to the camera distance as they spread out. */
const SPREAD_GAIN = 0.9;
/** Seconds-ish of smoothing: higher follows more tightly, lower drifts more lazily. */
const FOLLOW_EASE = 4;
const ZOOM_EASE = 2.5;

/**
 * A camera that follows the players on this screen. It keeps the angle the map defines, sits
 * close while everyone is together, and pulls back as they spread - out to the map's own wide
 * shot when they are at opposite ends. It also stays over the arena, so walking towards an
 * edge shows the floor you are about to be thrown off rather than empty sky.
 */
export class FollowCamera {
  readonly camera: THREE.PerspectiveCamera;
  private readonly direction = new THREE.Vector3(0, 1, 1).normalize();
  private readonly focus = new THREE.Vector3();
  private readonly wanted = new THREE.Vector3();
  private readonly box = new THREE.Box3();
  private readonly size = new THREE.Vector3();
  private wideDistance = 25;
  private closeDistance = 11;
  private distance = 11;
  private bounds = 8;
  private placed = false;

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(40, aspect, 0.1, 200);
  }

  /**
   * Takes the framing from the map: the direction to look from, and how far away the camera
   * goes when it has to show the whole place. `arenaExtent` keeps the view over the floor.
   */
  apply(setup: CameraSetup, arenaExtent: number): void {
    this.direction
      .set(setup.position.x - setup.target.x, setup.position.y - setup.target.y, setup.position.z - setup.target.z);
    this.wideDistance = this.direction.length();
    this.direction.normalize();
    this.closeDistance = Math.min(setup.followDistance ?? 12, this.wideDistance);
    this.distance = this.closeDistance;
    this.bounds = Math.max(2, arenaExtent - 2);
    this.focus.set(setup.target.x, setup.target.y, setup.target.z);
    this.placed = false;
  }

  /** Frames these world positions - whoever this screen belongs to. Call once a frame. */
  update(dt: number, targets: readonly THREE.Vector3[]): void {
    if (targets.length === 0) return;
    this.box.makeEmpty();
    for (const target of targets) this.box.expandByPoint(target);
    this.box.getCenter(this.wanted);
    this.box.getSize(this.size);

    // Stay over the floor: the arena is what players need to see, not the sky around it.
    this.wanted.x = THREE.MathUtils.clamp(this.wanted.x, -this.bounds, this.bounds);
    this.wanted.z = THREE.MathUtils.clamp(this.wanted.z, -this.bounds, this.bounds);

    const spread = Math.max(this.size.x, this.size.z);
    const wantedDistance = THREE.MathUtils.clamp(this.closeDistance + spread * SPREAD_GAIN, this.closeDistance, this.wideDistance);
    if (this.placed) {
      this.focus.lerp(this.wanted, 1 - Math.exp(-dt * FOLLOW_EASE));
      this.distance += (wantedDistance - this.distance) * (1 - Math.exp(-dt * ZOOM_EASE));
    } else {
      this.focus.copy(this.wanted); // first frame: start where the players are, don't fly in
      this.distance = wantedDistance;
      this.placed = true;
    }

    this.camera.position.copy(this.direction).multiplyScalar(this.distance).add(this.focus);
    this.camera.lookAt(this.focus.x, this.focus.y + 0.4, this.focus.z);
  }

  resize(width: number, height: number): void {
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }
}
