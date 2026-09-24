import type { CrateDamageSystem } from '../combat/CrateDamageSystem';
import type { HealthSystem } from '../combat/HealthSystem';
import type { Vec3 } from '../types';
import type { EntityRegistry } from '../sim/EntityRegistry';
import type { EventQueue } from '../sim/events';
import { PhysicsWorld, RAPIER } from '../sim/PhysicsWorld';
import type { PlayerPhysics } from '../sim/PlayerPhysics';
import type { ProjectileDefinition, ProjectileType } from './WeaponDefinition';

export interface ProjectileState {
  id: number;
  type: ProjectileType;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
}

interface Projectile {
  id: number;
  ownerId: number;
  def: ProjectileDefinition;
  pos: Vec3;
  vel: Vec3;
  life: number;
}

const NO_ROTATION = { x: 0, y: 0, z: 0, w: 1 };

/**
 * Flying things fired by weapons. Projectiles are not rigid bodies: each step they move
 * ballistically and sweep their sphere along the path, so nothing tunnels and the world
 * has no extra bodies to solve. Melee "projectiles" are an instant sphere check.
 */
export class ProjectileSystem {
  private readonly projectiles = new Map<number, Projectile>();
  private readonly physics: PhysicsWorld;
  private readonly events: EventQueue;
  private readonly registry: EntityRegistry;
  private readonly players: Map<number, PlayerPhysics>;
  private readonly health: HealthSystem;
  private readonly damage: CrateDamageSystem;
  private nextId = 1;

  constructor(
    physics: PhysicsWorld,
    events: EventQueue,
    registry: EntityRegistry,
    players: Map<number, PlayerPhysics>,
    health: HealthSystem,
    damage: CrateDamageSystem,
  ) {
    this.physics = physics;
    this.events = events;
    this.registry = registry;
    this.players = players;
    this.health = health;
    this.damage = damage;
  }

  /** Fires `def` from the shooter along their facing. Returns the projectile id (melee: 0). */
  fire(shooter: PlayerPhysics, def: ProjectileDefinition): number {
    const facing = shooter.facing();
    const c = shooter.body.translation();
    if (def.type === 'melee') {
      const centre = { x: c.x + facing.x * def.reach, y: c.y, z: c.z + facing.z * def.reach };
      this.hitSphere(centre, def.radius, shooter.id, facing, def);
      return 0;
    }
    const start = { x: c.x + facing.x * 0.35, y: c.y + 0.1, z: c.z + facing.z * 0.35 };
    const id = this.nextId++;
    this.projectiles.set(id, {
      id,
      ownerId: shooter.id,
      def,
      pos: start,
      vel: { x: facing.x * def.speed, y: 0, z: facing.z * def.speed },
      life: def.lifetime,
    });
    return id;
  }

  update(dt: number, killY: number): void {
    for (const p of [...this.projectiles.values()]) {
      p.life -= dt;
      p.vel.y += p.def.gravity * dt;
      const move = { x: p.vel.x * dt, y: p.vel.y * dt, z: p.vel.z * dt };
      const hit = this.sweep(p, move);
      if (hit) {
        const point = { x: p.pos.x + move.x * hit.toi, y: p.pos.y + move.y * hit.toi, z: p.pos.z + move.z * hit.toi };
        this.impact(p, point, hit.bodyHandle);
        this.projectiles.delete(p.id);
        continue;
      }
      p.pos.x += move.x;
      p.pos.y += move.y;
      p.pos.z += move.z;
      if (p.life <= 0 || p.pos.y < killY) {
        this.events.push({ type: 'projectile-gone', projectileId: p.id });
        this.projectiles.delete(p.id);
      }
    }
  }

  states(): ProjectileState[] {
    return [...this.projectiles.values()].map((p) => ({ id: p.id, type: p.def.type, x: p.pos.x, y: p.pos.y, z: p.pos.z, vx: p.vel.x, vy: p.vel.y, vz: p.vel.z }));
  }

  clear(): void {
    this.projectiles.clear();
  }

  private sweep(p: Projectile, move: Vec3): { toi: number; bodyHandle: number | null } | null {
    const owner = this.players.get(p.ownerId)?.body;
    const hit = this.physics.world.castShape(
      p.pos, NO_ROTATION, move, new RAPIER.Ball(p.def.radius), 0, 1, true,
      undefined, undefined, undefined, owner,
      (collider) => {
        const body = collider.parent();
        return !body || this.registry.lookup(body.handle)?.kind !== 'pickup';
      },
    );
    if (!hit) return null;
    return { toi: hit.time_of_impact, bodyHandle: hit.collider.parent()?.handle ?? null };
  }

  private impact(p: Projectile, point: Vec3, bodyHandle: number | null): void {
    const speed = Math.hypot(p.vel.x, p.vel.z) || 1;
    const dir = { x: p.vel.x / speed, y: 0, z: p.vel.z / speed };
    this.events.push({ type: 'projectile-hit', projectileId: p.id, projectile: p.def.type, point });
    if (p.def.explosionRadius > 0) {
      this.explode(point, p.def, p.ownerId);
      return;
    }
    if (bodyHandle !== null) this.strike(bodyHandle, p.ownerId, dir, point, p.def.knockback, p.def);
  }

  /**
   * Sets off an explosion where there is no projectile to speak of - a mine going up. Nobody
   * is excluded from a mine, which is the point of one.
   */
  detonate(centre: Vec3, def: ProjectileDefinition): void {
    this.explode(centre, def, -1); // -1 is nobody: there is no owner to spare
  }

  /** Everything within the radius gets shoved away from the centre - the caster included. */
  private explode(centre: Vec3, def: ProjectileDefinition, ownerId: number): void {
    this.events.push({ type: 'explosion', position: centre, radius: def.explosionRadius });
    this.hitSphere(centre, def.explosionRadius, null, null, def, ownerId);
  }

  /**
   * Applies a hit to every body in a sphere. With `pushDir` the shove is directional (melee);
   * without it the shove is radial from the centre (explosion). `skipOwnerId` excludes the
   * attacker; `sourceId` credits the hit.
   */
  private hitSphere(centre: Vec3, radius: number, skipOwnerId: number | null, pushDir: Vec3 | null, def: ProjectileDefinition, sourceId = skipOwnerId): void {
    const handles: number[] = [];
    this.physics.world.intersectionsWithShape(centre, NO_ROTATION, new RAPIER.Ball(radius), (collider) => {
      const body = collider.parent();
      if (body) handles.push(body.handle);
      return true;
    });
    for (const handle of handles) {
      const ref = this.registry.lookup(handle);
      if (!ref || ref.kind === 'pickup') continue;
      if (ref.kind === 'player' && ref.id === skipOwnerId) continue;
      const body = this.physics.world.getRigidBody(handle);
      if (!body) continue;
      let dir = pushDir;
      let impulse = def.knockback;
      if (!dir) {
        const t = body.translation();
        const dx = t.x - centre.x;
        const dz = t.z - centre.z;
        const d = Math.hypot(dx, dz);
        dir = d > 0.05 ? { x: dx / d, y: 0, z: dz / d } : { x: 1, y: 0, z: 0 };
        impulse = def.explosionImpulse * (1 - Math.min(1, d / radius) * 0.5); // stronger near the middle
      }
      this.strike(handle, sourceId, dir, centre, impulse, def);
    }
  }

  private strike(bodyHandle: number, sourceId: number | null, dir: Vec3, point: Vec3, impulse: number, def: ProjectileDefinition): void {
    const ref = this.registry.lookup(bodyHandle);
    if (!ref) return;
    if (ref.kind === 'player') {
      const victim = this.players.get(ref.id);
      if (victim) this.health.applyHit(victim, def.damageType, dir, impulse, sourceId);
    } else if (ref.kind === 'crate') {
      this.damage.damage(bodyHandle, def.damageType, sourceId, point, dir, impulse);
    }
  }
}
