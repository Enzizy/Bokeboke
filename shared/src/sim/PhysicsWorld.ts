import RAPIER from '@dimforge/rapier3d-compat';
import { PHYSICS } from './tuning';

/**
 * Thin wrapper over the Rapier world with a fixed timestep accumulator.
 * Everything else in the sim receives this instead of touching RAPIER globals.
 */
export class PhysicsWorld {
  readonly world: RAPIER.World;
  readonly stepDt = 1 / PHYSICS.stepHz;
  private accumulator = 0;

  private constructor() {
    this.world = new RAPIER.World({ x: 0, y: PHYSICS.gravity, z: 0 });
    this.world.timestep = this.stepDt;
  }

  /** Rapier's WASM must be initialised once before any world exists. */
  static async create(): Promise<PhysicsWorld> {
    await RAPIER.init();
    return new PhysicsWorld();
  }

  /**
   * Advances the world by as many fixed steps as `dt` seconds contain, calling `onStep`
   * before each one so systems can apply input at exactly the sim rate.
   * Returns the number of steps taken.
   */
  advance(dt: number, onStep: (stepDt: number) => void): number {
    this.accumulator = Math.min(this.accumulator + dt, this.stepDt * PHYSICS.maxStepsPerFrame);
    let steps = 0;
    while (this.accumulator >= this.stepDt) {
      onStep(this.stepDt);
      this.world.step();
      this.accumulator -= this.stepDt;
      steps++;
    }
    return steps;
  }

  get bodyCount(): number {
    return this.world.bodies.len();
  }

  get colliderCount(): number {
    return this.world.colliders.len();
  }
}

export { RAPIER };
