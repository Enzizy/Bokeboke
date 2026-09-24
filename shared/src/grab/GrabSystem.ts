import type RAPIER_T from '@dimforge/rapier3d-compat';
import type { ChaosCrateSpawner } from '../crates/ChaosCrateSpawner';
import type { EntityRef, EntityRegistry } from '../sim/EntityRegistry';
import type { EventQueue } from '../sim/events';
import { PhysicsWorld, RAPIER } from '../sim/PhysicsWorld';
import type { PlayerInput } from '../sim/PlayerInput';
import type { PlayerPhysics } from '../sim/PlayerPhysics';
import { GRAB, PLAYER } from '../sim/tuning';
import { DYNAMIC_GROUPS, heldByGroups, playerGroups } from '../sim/collisionGroups';

/** One active hold: who holds what. */
export interface Hold {
  grabberId: number;
  target: EntityRef;
  time: number;
  escape: number;
}

export type ReleaseReason = 'release' | 'throw' | 'escape' | 'timeout';

const NO_ROTATION = { x: 0, y: 0, z: 0, w: 1 };

/**
 * Grabbing, holding, dragging and releasing. A held body is pulled towards the grabber's
 * hands every step with a velocity spring, so it stays fully physical (it collides, it can be
 * yanked around corners) while feeling floppy. Throwing is the ThrowSystem's job; it asks this
 * system to let go first.
 */
export class GrabSystem {
  private readonly holds = new Map<number, Hold>();
  private readonly pressed = new Map<number, boolean>();
  private readonly cooldown = new Map<number, number>();
  private readonly physics: PhysicsWorld;
  private readonly events: EventQueue;
  private readonly registry: EntityRegistry;
  private readonly players: Map<number, PlayerPhysics>;
  private readonly crates: ChaosCrateSpawner;
  /** Players who may not be picked up right now (spawn protection). */
  private readonly grabbable: (playerId: number) => boolean;
  private readonly probe = new RAPIER.Ball(GRAB.radius);

  constructor(
    physics: PhysicsWorld,
    events: EventQueue,
    registry: EntityRegistry,
    players: Map<number, PlayerPhysics>,
    crates: ChaosCrateSpawner,
    grabbable: (playerId: number) => boolean = () => true,
  ) {
    this.grabbable = grabbable;
    this.physics = physics;
    this.events = events;
    this.registry = registry;
    this.players = players;
    this.crates = crates;
  }

  holdOf(grabberId: number): Hold | undefined {
    return this.holds.get(grabberId);
  }

  /** Per player, before the world steps: start or end holds from input, then pull held things along. */
  applyInput(player: PlayerPhysics, input: PlayerInput, dt: number): void {
    const cd = Math.max(0, (this.cooldown.get(player.id) ?? 0) - dt);
    this.cooldown.set(player.id, cd);
    const wasPressed = this.pressed.get(player.id) ?? false;
    this.pressed.set(player.id, input.grab);
    const justPressed = input.grab && !wasPressed;

    const hold = this.holds.get(player.id);
    if (hold && player.posture !== 'upright') {
      this.release(player.id, 'release');
      return;
    }
    if (hold) {
      this.tickHold(player, hold, dt);
      if (justPressed) this.release(player.id, 'release');
      return;
    }
    if (justPressed && cd <= 0 && player.staggerTimer <= 0 && player.attackTimer <= 0 && player.posture === 'upright') this.tryGrab(player);
  }

  /** Ends a hold and reports why, so the client can pick a sound/animation. */
  release(grabberId: number, reason: ReleaseReason): Hold | undefined {
    const hold = this.holds.get(grabberId);
    if (!hold) return undefined;
    this.holds.delete(grabberId);
    this.cooldown.set(grabberId, GRAB.cooldownAfterRelease);
    this.setHeldCollision(hold.target, null);
    const grabber = this.players.get(grabberId);
    if (grabber) grabber.grabbing = null;
    if (hold.target.kind === 'player') {
      const victim = this.players.get(hold.target.id);
      if (victim) victim.grabbedBy = null;
    }
    this.events.push({ type: 'release', playerId: grabberId, target: hold.target, reason });
    return hold;
  }

  /** Drops whatever is holding this entity (it broke, fell off the map, ...). */
  releaseTarget(target: EntityRef): void {
    for (const [grabberId, hold] of this.holds) {
      if (hold.target.kind === target.kind && hold.target.id === target.id) this.release(grabberId, 'release');
    }
  }

  targetBody(target: EntityRef): RAPIER_T.RigidBody | undefined {
    if (target.kind === 'player') return this.players.get(target.id)?.body;
    if (target.kind === 'crate') return this.crates.get(target.id)?.body;
    return undefined;
  }

  private tryGrab(player: PlayerPhysics): void {
    const facing = player.facing();
    const centre = player.body.translation();
    const point = { x: centre.x + facing.x * GRAB.reach, y: centre.y, z: centre.z + facing.z * GRAB.reach };
    // Collect first, act second: Rapier query callbacks must not mutate the world.
    const candidates: { handle: number; dist: number }[] = [];
    this.physics.world.intersectionsWithShape(point, NO_ROTATION, this.probe, (collider) => {
      const body = collider.parent();
      if (body && body.handle !== player.body.handle) {
        const t = body.translation();
        candidates.push({ handle: body.handle, dist: Math.hypot(t.x - point.x, t.y - point.y, t.z - point.z) });
      }
      return true;
    });
    candidates.sort((a, b) => a.dist - b.dist); // closest thing to the hands wins
    for (const { handle } of candidates) {
      const ref = this.registry.lookup(handle);
      if (!ref || ref.kind === 'pickup') continue;
      if (ref.kind === 'player' && (this.isHeld(ref.id) || !this.grabbable(ref.id))) continue;
      // Grabbing someone who is holding you (or anything) makes them let go first.
      if (ref.kind === 'player' && this.players.get(ref.id)?.grabbing) this.release(ref.id, 'release');
      this.holds.set(player.id, { grabberId: player.id, target: ref, time: 0, escape: 0 });
      player.grabbing = ref;
      this.setHeldCollision(ref, player.id);
      if (ref.kind === 'player') {
        const victim = this.players.get(ref.id);
        if (victim) victim.grabbedBy = player.id;
      }
      this.events.push({ type: 'grab', playerId: player.id, target: ref });
      return;
    }
  }

  private isHeld(playerId: number): boolean {
    for (const hold of this.holds.values()) {
      if (hold.target.kind === 'player' && hold.target.id === playerId) return true;
    }
    return false;
  }

  private tickHold(grabber: PlayerPhysics, hold: Hold, dt: number): void {
    hold.time += dt;
    const body = this.targetBody(hold.target);
    if (!body) {
      this.release(grabber.id, 'release');
      return;
    }
    if (hold.target.kind === 'player') {
      hold.escape += (this.players.get(hold.target.id)?.struggle ?? 0) * GRAB.escapeRate * dt;
      if (hold.escape >= 1) {
        this.release(grabber.id, 'escape');
        grabber.staggerTimer = 0.2;
        return;
      }
    }
    if (hold.time >= GRAB.maxHoldTime) {
      this.release(grabber.id, 'timeout');
      return;
    }
    this.pullTowardsHands(grabber, body, this.halfHeightOf(hold.target));
  }

  /** Half the vertical size of a held thing, so it sits just above the grabber's head. */
  private halfHeightOf(target: EntityRef): number {
    if (target.kind === 'crate') return this.crates.get(target.id)?.def.halfSize ?? 0.35;
    return PLAYER.capsuleHalfHeight + PLAYER.capsuleRadius;
  }

  /** While held, the thing passes through its grabber (and only its grabber). */
  private setHeldCollision(target: EntityRef, grabberId: number | null): void {
    const body = this.targetBody(target);
    if (!body) return;
    let groups: number;
    if (grabberId !== null) groups = heldByGroups(grabberId);
    else groups = target.kind === 'player' ? playerGroups(target.id) : DYNAMIC_GROUPS;
    for (let i = 0; i < body.numColliders(); i++) body.collider(i).setCollisionGroups(groups);
  }

  /** Velocity spring towards a point above the grabber's head. Gravity still acts between steps, so it bobs. */
  private pullTowardsHands(grabber: PlayerPhysics, body: RAPIER_T.RigidBody, targetHalfHeight: number): void {
    const facing = grabber.facing();
    const g = grabber.body.translation();
    const gv = grabber.body.linvel();
    const p = body.translation();
    const headTop = PLAYER.capsuleHalfHeight + PLAYER.capsuleRadius;
    const target = {
      x: g.x + facing.x * GRAB.holdForward,
      y: g.y + headTop + GRAB.holdGap + targetHalfHeight,
      z: g.z + facing.z * GRAB.holdForward,
    };
    let vx = gv.x + (target.x - p.x) * GRAB.spring;
    let vy = gv.y + (target.y - p.y) * GRAB.spring;
    let vz = gv.z + (target.z - p.z) * GRAB.spring;
    const speed = Math.hypot(vx, vy, vz);
    if (speed > GRAB.maxPullSpeed) {
      const k = GRAB.maxPullSpeed / speed;
      vx *= k;
      vy *= k;
      vz *= k;
    }
    body.setLinvel({ x: vx, y: vy, z: vz }, true);
  }
}
