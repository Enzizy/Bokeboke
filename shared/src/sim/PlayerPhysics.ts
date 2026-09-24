import type RAPIER_T from '@dimforge/rapier3d-compat';
import type { SpawnPoint } from '../maps/MapDefinition';
import type { EntityRef } from './EntityRegistry';
import { PhysicsWorld, RAPIER } from './PhysicsWorld';
import type { PlayerInput } from './PlayerInput';
import type { PostureState } from './RagdollSystem';
import type { HeldWeaponState } from '../weapons/WeaponActivationSystem';
import { GRAB, PLAYER, RAGDOLL } from './tuning';
import { playerGroups } from './collisionGroups';

/** What the renderer and the network need to know about a player each tick. */
export interface PlayerState {
  id: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  vx: number;
  vy: number;
  vz: number;
  grounded: boolean;
  running: boolean;
  /** Sprint fuel, 0..staminaMax. Shown under the health bar once it is no longer full. */
  stamina: number;
  staminaMax: number;
  /** True while the bar is too low to sprint again, however hard you hold the key. */
  winded: boolean;
  /** Attack currently animating, or null. */
  attack: string | null;
  heldWeapon: string | null;
  /** What this player is holding, if anything. */
  grabbing: EntityRef | null;
  /** Who is holding this player, if anyone. */
  grabbedBy: number | null;
  /** upright | ragdoll | recovering | eliminated. */
  posture: PostureState;
  /** Activation of the held Chaos Drop weapon, filled in by the Simulation. */
  weapon: HeldWeaponState | null;
  /** Health, also filled in by the Simulation - the HealthSystem owns the numbers. */
  hp: number;
  maxHp: number;
  /** Fresh off a respawn and untouchable for a moment; drawn flickering. Also Simulation's. */
  shielded: boolean;
  /** Body orientation; identity while upright, anything while tumbling. */
  qx: number;
  qy: number;
  qz: number;
  qw: number;
}

const DOWN = { x: 0, y: -1, z: 0 };
const NO_ROTATION = { x: 0, y: 0, z: 0, w: 1 };

/**
 * One player's physical presence: an upright capsule driven by velocity.
 * Milestone 2 keeps it rigid; limb bodies and wobble arrive with the ragdoll milestone,
 * hanging off this same class so the rest of the sim never changes.
 */
export class PlayerPhysics {
  readonly id: number;
  readonly body: RAPIER_T.RigidBody;
  private readonly physics: PhysicsWorld;
  private readonly probe = new RAPIER.Ball(PLAYER.groundProbeRadius);
  /** A smaller ball for looking at the floor just ahead, when something is in the way. */
  private readonly stepProbe = new RAPIER.Ball(0.08);
  /** Set by the CombatSystem while a swing is playing. */
  attack: string | null = null;
  attackTimer = 0;
  heldWeapon: string | null = null;
  /** While > 0 the player has no control: physics carries them (just been hit). */
  staggerTimer = 0;
  /** Maintained by the GrabSystem. */
  grabbing: EntityRef | null = null;
  grabbedBy: number | null = null;
  /** How hard a held player is wriggling this step (0..1+), read by the GrabSystem. */
  struggle = 0;
  /** Maintained by the RagdollSystem; only upright players steer. */
  posture: PostureState = 'upright';
  /** Set by weapons that forbid moving / turning while they activate. */
  frozen = false;
  turnLocked = false;
  private yaw: number;
  private grounded = false;
  private running = false;
  private stamina: number = PLAYER.staminaMax; // PLAYER is `as const`, so this needs the wider type
  private winded = false;
  /** Seconds since the last sprint, so stamina does not start refilling the instant you stop. */
  private restedFor = 0;
  private jumpHeld = false;
  /** Counts down after a jump; nothing can launch again until it reaches zero. */
  private jumpCooldown = 0;

  constructor(physics: PhysicsWorld, id: number, spawn: SpawnPoint) {
    this.physics = physics;
    this.id = id;
    this.yaw = spawn.yaw;

    const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(spawn.x, spawn.y + this.centreHeight, spawn.z)
      .lockRotations()
      .setCcdEnabled(true);
    this.body = physics.world.createRigidBody(bodyDesc);

    const colliderDesc = RAPIER.ColliderDesc.capsule(PLAYER.capsuleHalfHeight, PLAYER.capsuleRadius)
      .setMass(PLAYER.mass)
      .setFriction(0.2)
      .setRestitution(0)
      .setCollisionGroups(playerGroups(id));
    physics.world.createCollider(colliderDesc, this.body);
  }

  /** Distance from the feet (model origin) up to the capsule centre. */
  get centreHeight(): number {
    return PLAYER.capsuleHalfHeight + PLAYER.capsuleRadius;
  }

  /** Called once per fixed step, before the world advances. */
  applyInput(input: PlayerInput, dt: number): void {
    this.grounded = this.probeGround();
    this.jumpCooldown = Math.max(0, this.jumpCooldown - dt);
    if (this.posture !== 'upright') {
      this.slowLooseBody(dt, RAGDOLL.drag);
      this.recoverStamina(dt, false); // you get your breath back while you are down
      this.tickAttack(dt);
      return;
    }
    if (this.staggerTimer > 0) {
      this.staggerTimer -= dt;
      this.slowLooseBody(dt, PLAYER.staggerDrag);
      this.recoverStamina(dt, input.run);
      this.tickAttack(dt);
      return;
    }
    const vel = this.body.linvel();

    let mx = input.moveX;
    let mz = input.moveZ;
    const len = Math.hypot(mx, mz);
    if (len > 1) {
      mx /= len;
      mz /= len;
    }

    if (this.grabbedBy !== null) {
      // The grabber's spring moves us; mashing counts as struggling. Keep facing away from them.
      this.struggle = Math.min(len, 1) + (input.jump && !this.jumpHeld ? 1.5 : 0);
      this.jumpHeld = input.jump;
      this.running = false;
      this.recoverStamina(dt, input.run);
      this.tickAttack(dt);
      return;
    }
    this.struggle = 0;
    if (this.frozen) {
      mx = 0;
      mz = 0;
    }

    // Horizontal: steer current velocity towards the wanted velocity. Sprinting costs stamina,
    // and running the bar dry leaves you walking until you have got your breath back.
    const wantsToRun = input.run && len > 0 && !this.grabbing && !this.frozen;
    this.running = wantsToRun && !this.winded && this.stamina > 0;
    if (this.running) this.burnStamina(dt);
    else this.recoverStamina(dt, input.run);
    const carry = this.grabbing ? GRAB.carrySpeedFactor : 1;
    const speed = (this.running ? PLAYER.runSpeed : PLAYER.walkSpeed) * carry;
    const accel = (this.grounded ? PLAYER.groundAccel : PLAYER.airAccel) * dt;
    const vx = approach(vel.x, mx * speed, accel);
    const vz = approach(vel.z, mz * speed, accel);

    // Vertical: a fresh press while grounded and settled launches; holding doesn't bounce,
    // and neither does mashing - the cooldown and the rise check keep jumps one at a time.
    let vy = vel.y;
    const ready = this.grounded && this.jumpCooldown <= 0 && vel.y <= PLAYER.jumpRiseTolerance;
    if (input.jump && !this.jumpHeld && ready) {
      vy = PLAYER.jumpSpeed;
      this.jumpCooldown = PLAYER.jumpCooldown;
    }
    this.jumpHeld = input.jump;

    this.body.setLinvel({ x: vx, y: vy, z: vz }, true);

    this.stepUp(mx, mz);

    const turnX = this.frozen ? input.moveX : mx;
    const turnZ = this.frozen ? input.moveZ : mz;
    if (!this.turnLocked && Math.hypot(turnX, turnZ) > 0.01) this.yaw = turnTowards(this.yaw, Math.atan2(turnX, turnZ), PLAYER.turnSpeed * dt);

    this.tickAttack(dt);
  }

  /**
   * Carries the player up a step they are walking into. Without it a capsule driven by velocity
   * simply stops against a 12 cm stair tread, which would make Crossfire's raised cross - and
   * every staircase in the game - unreachable on foot.
   */
  private stepUp(moveX: number, moveZ: number): void {
    if (!this.grounded) return;
    const length = Math.hypot(moveX, moveZ);
    if (length < 0.1) return;
    const p = this.body.translation();
    const feet = p.y - this.centreHeight;
    // Look down at the floor just ahead, starting above the tallest step worth climbing. If
    // there is something to stand on up there, the way onto it is clear by construction.
    const reach = PLAYER.capsuleRadius + 0.12;
    const from = {
      x: p.x + (moveX / length) * reach,
      y: feet + PLAYER.stepHeight + 0.1,
      z: p.z + (moveZ / length) * reach,
    };
    const hit = this.physics.world.castShape(
      from, NO_ROTATION, DOWN, this.stepProbe, 0, PLAYER.stepHeight + 0.1, true,
      undefined, undefined, undefined, this.body,
    );
    if (!hit) return;
    const surface = from.y - hit.time_of_impact - 0.08; // the ball stops its radius above it
    const rise = surface - feet;
    if (rise < 0.03 || rise > PLAYER.stepHeight) return;
    this.body.setTranslation({ x: p.x, y: p.y + rise + 0.02, z: p.z }, true);
  }

  private burnStamina(dt: number): void {
    this.restedFor = 0;
    this.stamina = Math.max(0, this.stamina - PLAYER.staminaDrain * dt);
    if (this.stamina <= 0) this.winded = true;
  }

  /**
   * Stamina comes back once you have eased off for a moment. Being winded only ends when the
   * bar has recovered AND the sprint key is released: holding it through exhaustion used to
   * hand back a sprint the instant the bar crossed the floor, so players just stuttered along
   * at a permanent half-run instead of ever walking.
   */
  private recoverStamina(dt: number, sprintHeld: boolean): void {
    this.restedFor += dt;
    if (this.restedFor < PLAYER.staminaRegenDelay) return;
    this.stamina = Math.min(PLAYER.staminaMax, this.stamina + PLAYER.staminaRegen * dt);
    if (this.winded && !sprintHeld && this.stamina >= PLAYER.staminaSprintFloor) this.winded = false;
  }

  /**
   * Scrubs speed off a body nobody is steering - staggered or knocked down. Only horizontal,
   * and only while something is underfoot: a hit that launches you should still arc through
   * the air, it just should not skate once it lands.
   */
  private slowLooseBody(dt: number, drag: number): void {
    if (!this.grounded || this.grabbedBy !== null) return; // held players are the grabber's problem
    const v = this.body.linvel();
    const keep = Math.exp(-drag * dt);
    this.body.setLinvel({ x: v.x * keep, y: v.y, z: v.z * keep }, true);
  }

  private tickAttack(dt: number): void {
    if (this.attackTimer > 0) {
      this.attackTimer -= dt;
      if (this.attackTimer <= 0) this.attack = null;
    }
  }

  /** Unit vector the character is looking along (models face +Z at yaw 0). */
  facing(): { x: number; y: number; z: number } {
    return { x: Math.sin(this.yaw), y: 0, z: Math.cos(this.yaw) };
  }

  /** Knocks the player in a direction with a bit of lift. Grounded players resist a little. */
  shove(direction: { x: number; z: number }, impulse: number): void {
    this.body.applyImpulse({ x: direction.x * impulse, y: impulse * 0.3, z: direction.z * impulse }, true);
    this.staggerTimer = PLAYER.staggerTime;
    this.attack = null;
    this.attackTimer = 0;
  }

  respawn(spawn: SpawnPoint): void {
    this.standUp();
    this.jumpCooldown = 0;
    this.stamina = PLAYER.staminaMax;
    this.winded = false;
    this.restedFor = 0;
    this.body.setTranslation({ x: spawn.x, y: spawn.y + this.centreHeight, z: spawn.z }, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.yaw = spawn.yaw;
    this.staggerTimer = 0;
    this.attack = null;
    this.attackTimer = 0;
  }

  /** Locks the capsule upright again after tumbling and lifts it so it isn't in the floor. */
  standUp(): void {
    const body = this.body;
    body.setEnabledRotations(false, false, false, true);
    body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
    body.setAngularDamping(0);
    body.collider(0).setFriction(0.2);
    const p = body.translation();
    body.setTranslation({ x: p.x, y: p.y + (this.centreHeight - PLAYER.capsuleRadius), z: p.z }, true);
    body.setLinvel({ x: 0, y: 0, z: 0 }, true);
  }

  state(): PlayerState {
    const p = this.body.translation();
    const v = this.body.linvel();
    const q = this.body.rotation();
    return {
      id: this.id,
      x: p.x,
      y: p.y - this.centreHeight,
      z: p.z,
      yaw: this.yaw,
      vx: v.x,
      vy: v.y,
      vz: v.z,
      grounded: this.grounded,
      running: this.running,
      stamina: this.stamina,
      staminaMax: PLAYER.staminaMax,
      winded: this.winded,
      attack: this.attack,
      heldWeapon: this.heldWeapon,
      grabbing: this.grabbing,
      grabbedBy: this.grabbedBy,
      posture: this.posture,
      weapon: null,
      hp: 0,
      maxHp: 0,
      shielded: false,
      qx: q.x,
      qy: q.y,
      qz: q.z,
      qw: q.w,
    };
  }

  private probeGround(): boolean {
    const p = this.body.translation();
    const hit = this.physics.world.castShape(
      p, NO_ROTATION, DOWN, this.probe, 0, PLAYER.groundProbeDistance, true,
      undefined, undefined, undefined, this.body,
    );
    if (!hit) return false;
    const normal = hit.normal1;
    if (!normal) return true;
    const length = Math.hypot(normal.x, normal.y, normal.z);
    if (length < 0.001) return true; // started inside something: take the hit at face value
    return normal.y / length >= PLAYER.groundNormalMin; // a floor, not the side of a wall
  }
}

function approach(current: number, target: number, maxDelta: number): number {
  const diff = target - current;
  if (Math.abs(diff) <= maxDelta) return target;
  return current + Math.sign(diff) * maxDelta;
}

function turnTowards(current: number, target: number, maxDelta: number): number {
  let diff = target - current;
  diff = Math.atan2(Math.sin(diff), Math.cos(diff)); // shortest way round
  return current + Math.max(-maxDelta, Math.min(maxDelta, diff));
}
