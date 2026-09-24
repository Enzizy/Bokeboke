import * as THREE from 'three';
import type { CrateState } from '@shared/crates/ChaosCrate';
import type { PickupState } from '@shared/weapons/WeaponPickup';
import type { MineState } from '@shared/weapons/MineSystem';
import type { ProjectileState } from '@shared/weapons/ProjectileSystem';

/** The parts of a session these views read: the loose things lying around the arena. */
export interface WorldStates {
  crateStates(): CrateState[];
  pickupStates(): PickupState[];
  projectileStates(): ProjectileState[];
  mineStates(): MineState[];
}
import type { SimEvent } from '@shared/sim/events';
import type { AssetLoader } from '../assets/AssetLoader';
import { sounds } from '../audio/SoundHooks';
import { DebrisSystem, randomSpin, type GroundQuery } from '../effects/DebrisSystem';
import { ChaosCrateView } from '../render/ChaosCrateView';
import { WeaponView } from '../render/WeaponView';
import { MineViews } from '../render/MineViews';
import { ProjectileViews } from '../render/ProjectileViews';

const PUFF_COLOR = 0xe8c48a;

/**
 * Keeps scene objects for crates and pickups in step with the simulation, creating and
 * removing views as entities come and go, and turning sim events into effects.
 */
export class EntityViews {
  readonly root = new THREE.Group();
  readonly debris: DebrisSystem;
  readonly projectiles: ProjectileViews;
  private readonly crates = new Map<number, ChaosCrateView>();
  private readonly pickups = new Map<number, WeaponView>();
  private readonly pending = new Set<number>();
  private readonly mines = new MineViews();
  private readonly loader: AssetLoader;

  constructor(loader: AssetLoader, groundAt: GroundQuery) {
    this.loader = loader;
    this.debris = new DebrisSystem(groundAt);
    this.projectiles = new ProjectileViews(loader, this.debris);
    this.root.name = 'entities';
    this.root.add(this.debris.root);
    this.root.add(this.projectiles.root);
    this.root.add(this.mines.root);
  }

  sync(world: WorldStates, dt: number): void {
    this.syncCrates(world);
    this.syncPickups(world);
    for (const crate of this.crates.values()) crate.update(dt);
    this.projectiles.sync(world.projectileStates(), dt);
    this.mines.sync(world.mineStates(), dt);
    this.debris.update(dt);
  }

  handle(event: SimEvent): void {
    switch (event.type) {
      case 'crate-hit': {
        sounds.play('crate-hit');
        const at = new THREE.Vector3(event.point.x, event.point.y, event.point.z);
        const crate = this.crates.get(event.crateId);
        this.debris.puff(at, PUFF_COLOR, 5 + (event.maxHp - event.hp), 2, crate ? crate.root.position.y - crate.halfSize : at.y - 0.35);
        break;
      }
      case 'crate-broken':
        sounds.play('crate-break');
        this.breakCrate(event.crateId, new THREE.Vector3(event.position.x, event.position.y, event.position.z));
        break;
      case 'crate-spawned':
        sounds.play('crate-land');
        break;
      case 'weapon-ejected':
        sounds.play('weapon-eject');
        break;
      case 'weapon-picked-up':
        sounds.play('weapon-pickup');
        break;
      case 'grab':
        sounds.play('grab');
        break;
      case 'throw':
        sounds.play('throw');
        break;
      case 'release':
        if (event.reason !== 'throw') sounds.play('release');
        break;
      case 'knockdown':
        sounds.play('knockdown');
        break;
      case 'recover':
        sounds.play('recover');
        break;
      case 'eliminated': {
        sounds.play('eliminated');
        const at = new THREE.Vector3(event.position.x, event.position.y, event.position.z);
        this.debris.puff(at, 0xffffff, 10, 3, -Infinity);
        break;
      }
      case 'respawn':
        sounds.play('respawn');
        break;
      case 'round-countdown':
        sounds.play('countdown');
        break;
      case 'round-start':
        sounds.play('round-start');
        break;
      case 'round-over':
        sounds.play('round-over');
        break;
      case 'match-over':
        sounds.play('match-over');
        break;
      case 'weapon-armed':
        sounds.play('weapon-armed');
        break;
      case 'weapon-fired':
        sounds.play(event.projectile === 'melee' ? 'hammer-swing' : 'weapon-fired');
        break;
      case 'weapon-consumed':
        sounds.play('weapon-consumed');
        break;
      case 'projectile-hit': {
        if (event.projectile === 'arrow') {
          sounds.play('arrow-hit');
          this.debris.puff(new THREE.Vector3(event.point.x, event.point.y, event.point.z), 0x5ad0ff, 4, 1.5, -Infinity);
        }
        break;
      }
      case 'explosion':
        sounds.play('explosion');
        this.projectiles.explosion(new THREE.Vector3(event.position.x, event.position.y, event.position.z), event.radius);
        break;
      default:
        break;
    }
  }

  get crateCount(): number {
    return this.crates.size;
  }

  private syncCrates(world: WorldStates): void {
    const seen = new Set<number>();
    for (const state of world.crateStates()) {
      seen.add(state.id);
      let view = this.crates.get(state.id);
      if (!view) {
        view = new ChaosCrateView(state);
        this.crates.set(state.id, view);
        this.root.add(view.root);
      }
      view.sync(state);
    }
    // Crates that vanished without a break event (shouldn't happen) are dropped quietly.
    for (const [id, view] of this.crates) {
      if (!seen.has(id)) {
        this.root.remove(view.root);
        this.crates.delete(id);
      }
    }
  }

  private syncPickups(world: WorldStates): void {
    const seen = new Set<number>();
    for (const state of world.pickupStates()) {
      seen.add(state.id);
      const view = this.pickups.get(state.id);
      if (view) view.syncPickup(state);
      else if (!this.pending.has(state.id)) this.createPickup(state.id, state.weaponId);
    }
    for (const [id, view] of this.pickups) {
      if (!seen.has(id)) {
        this.root.remove(view.root);
        this.pickups.delete(id);
      }
    }
  }

  private createPickup(id: number, weaponId: string): void {
    this.pending.add(id);
    void WeaponView.create(this.loader, weaponId).then((view) => {
      this.pending.delete(id);
      this.pickups.set(id, view);
      this.root.add(view.root);
    });
  }

  /** Throws the crate's pieces outward from its centre and forgets the crate. */
  private breakCrate(id: number, centre: THREE.Vector3): void {
    const view = this.crates.get(id);
    if (!view) return;
    const floorY = centre.y - view.halfSize;
    for (const { mesh, localOffset } of view.explode()) {
      const dir = localOffset.clone().normalize();
      const velocity = dir.multiplyScalar(2.5 + Math.random() * 2).add(new THREE.Vector3(0, 3 + Math.random() * 2, 0));
      this.debris.launch(mesh, velocity, randomSpin(14), floorY, 2.2 + Math.random());
    }
    this.debris.puff(centre, PUFF_COLOR, 12, 3.5, floorY);
    this.root.remove(view.root);
    this.crates.delete(id);
  }
}
