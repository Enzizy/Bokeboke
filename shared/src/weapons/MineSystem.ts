import type { EventQueue } from '../sim/events';
import type { PlayerPhysics } from '../sim/PlayerPhysics';
import type { Vec3 } from '../types';
import type { ProjectileSystem } from './ProjectileSystem';
import type { ProjectileDefinition } from './WeaponDefinition';

/** The blast a mine makes. Bigger than a fireball, and it has no friends: everyone nearby goes. */
export const MINE_BLAST: ProjectileDefinition = {
  type: 'fireball',
  speed: 0,
  gravity: 0,
  radius: 0.2,
  reach: 0,
  lifetime: 0,
  damageType: 'explosive',
  knockback: 5,
  explosionRadius: 2.2,
  explosionImpulse: 9,
};

export const MINE = {
  /** Seconds after landing before it can go off, so whoever opened the crate can back away. */
  armDelay: 1.5,
  /** How close someone has to get once it is armed. */
  triggerRadius: 1.1,
  /** The beat between being tripped and going off - just long enough to see it coming. */
  fuse: 0.45,
  /** Mines are part of the furniture, but not forever. */
  lifetime: 30,
} as const;

export interface MineState {
  id: number;
  x: number;
  y: number;
  z: number;
  /** Live and waiting for someone to walk into it. */
  armed: boolean;
  /** Counting down to the blast once tripped; 0 when it has not been. */
  fuse: number;
}

/**
 * Booby traps. A crate that was rigged spits one of these out instead of a weapon: it settles,
 * arms itself, and then goes off when anybody walks too close - including whoever opened the
 * crate. Nobody owns a mine, so nobody is safe from it.
 */
export class MineSystem {
  private readonly mines = new Map<number, { state: MineState; life: number; armIn: number }>();
  private readonly events: EventQueue;
  private readonly projectiles: ProjectileSystem;
  private nextId = 1;

  constructor(events: EventQueue, projectiles: ProjectileSystem) {
    this.events = events;
    this.projectiles = projectiles;
  }

  /** Drops a mine at a point. It is harmless until it arms. */
  place(at: Vec3): number {
    const id = this.nextId++;
    this.mines.set(id, {
      state: { id, x: at.x, y: at.y, z: at.z, armed: false, fuse: 0 },
      life: MINE.lifetime,
      armIn: MINE.armDelay,
    });
    this.events.push({ type: 'mine-placed', mineId: id, position: { x: at.x, y: at.y, z: at.z } });
    return id;
  }

  /** Per fixed step, after the players have moved. */
  update(dt: number, players: Iterable<PlayerPhysics>): void {
    for (const [id, mine] of [...this.mines]) {
      mine.life -= dt;
      if (mine.life <= 0) {
        this.mines.delete(id); // rusted away unfound
        this.events.push({ type: 'mine-gone', mineId: id });
        continue;
      }
      if (!mine.state.armed) {
        mine.armIn -= dt;
        if (mine.armIn > 0) continue;
        mine.state.armed = true;
        this.events.push({ type: 'mine-armed', mineId: id });
        continue;
      }
      if (mine.state.fuse > 0) {
        mine.state.fuse -= dt;
        if (mine.state.fuse > 0) continue;
        this.detonate(id, mine.state);
        continue;
      }
      if (this.someoneIsClose(mine.state, players)) {
        mine.state.fuse = MINE.fuse;
        this.events.push({ type: 'mine-triggered', mineId: id });
      }
    }
  }

  states(): MineState[] {
    return [...this.mines.values()].map((m) => ({ ...m.state }));
  }

  clear(): void {
    this.mines.clear();
  }

  private someoneIsClose(mine: MineState, players: Iterable<PlayerPhysics>): boolean {
    for (const player of players) {
      if (player.posture === 'eliminated') continue;
      const p = player.body.translation();
      if (Math.hypot(p.x - mine.x, p.z - mine.z) > MINE.triggerRadius) continue;
      if (Math.abs(p.y - mine.y) > 1.2) continue; // someone on a ledge overhead is not close
      return true;
    }
    return false;
  }

  private detonate(id: number, mine: MineState): void {
    this.mines.delete(id);
    this.events.push({ type: 'mine-gone', mineId: id });
    this.projectiles.detonate({ x: mine.x, y: mine.y + 0.2, z: mine.z }, MINE_BLAST);
  }
}
