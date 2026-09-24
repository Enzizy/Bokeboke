import type { Random } from '../sim/Random';
import { dropPool } from '../weapons/dropPools';
import type { MineSystem } from '../weapons/MineSystem';
import type { WeaponPickupSystem } from '../weapons/WeaponPickupSystem';
import type { ChaosCrate } from './ChaosCrate';

/**
 * Turns a broken crate into whatever was inside it. Usually that is a weapon pickup, launched
 * upward with a random sideways kick so it pops out of the wreckage - but some crates are
 * rigged, and leave a mine sitting in the splinters instead.
 */
export class ChaosDropSystem {
  private readonly pickups: WeaponPickupSystem;
  private readonly mines: MineSystem;
  private readonly random: Random;

  constructor(pickups: WeaponPickupSystem, mines: MineSystem, random: Random) {
    this.pickups = pickups;
    this.mines = mines;
    this.random = random;
  }

  release(crate: ChaosCrate): void {
    const entry = this.random.weighted(dropPool(crate.def.dropPool));
    const origin = crate.position();
    if (entry.mine || !entry.weaponId) {
      this.mines.place({ x: origin.x, y: 0.05, z: origin.z });
      return;
    }
    const angle = this.random.range(0, Math.PI * 2);
    const side = this.random.range(0.4, 1) * crate.def.ejectSide;
    this.pickups.spawn(
      entry.weaponId,
      { x: origin.x, y: origin.y + crate.def.halfSize * 0.5, z: origin.z },
      { x: Math.cos(angle) * side, y: crate.def.ejectUp, z: Math.sin(angle) * side },
    );
  }
}
