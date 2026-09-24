import type { Snapshot } from '@shared/net/Snapshot';
import type { PlayerState } from '@shared/sim/PlayerPhysics';
import type { CrateState } from '@shared/crates/ChaosCrate';
import type { PickupState } from '@shared/weapons/WeaponPickup';

/** How many snapshots to keep. A second or so at 20 Hz is plenty to interpolate through. */
const KEEP = 24;
/**
 * How far behind the newest snapshot we render, in snapshot intervals. Rendering in the past
 * is what buys smoothness: there is always a snapshot ahead of us to interpolate towards, so a
 * late packet shows up as a slightly older world rather than a stutter.
 */
const DELAY_INTERVALS = 1.6;

/**
 * Keeps the last few server snapshots and produces the world as it looked a fraction of a
 * second ago, interpolated between the two that bracket that moment. Positions and angles are
 * blended; anything discrete (posture, held weapon, health, round phase) is taken from the
 * newer of the two, because half a knockdown is not a state the game has.
 */
export class SnapshotBuffer {
  private readonly snapshots: Snapshot[] = [];
  private interval: number;
  /** Our clock, in server time. Advanced by dt and nudged towards what the server reports. */
  private clock = 0;
  private started = false;

  constructor(snapshotHz: number) {
    this.interval = 1 / Math.max(1, snapshotHz);
  }

  get latest(): Snapshot | null {
    return this.snapshots[this.snapshots.length - 1] ?? null;
  }

  push(snapshot: Snapshot): void {
    const newest = this.latest;
    if (newest && snapshot.tick <= newest.tick) return; // out of order: the newer one already won
    if (newest) this.interval = Math.max(0.01, snapshot.time - newest.time);
    this.snapshots.push(snapshot);
    while (this.snapshots.length > KEEP) this.snapshots.shift();
    if (!this.started) {
      this.clock = snapshot.time;
      this.started = true;
    }
  }

  /**
   * Advances our view of server time. It drifts (two clocks, one network), so it is eased back
   * towards the target rather than snapped, and only jumped when it is hopelessly out.
   */
  advance(dt: number): void {
    const newest = this.latest;
    if (!newest) return;
    this.clock += dt;
    const target = newest.time - this.interval * DELAY_INTERVALS;
    const drift = target - this.clock;
    if (Math.abs(drift) > this.interval * 6) this.clock = target; // stalled or just connected
    else this.clock += drift * Math.min(1, dt * 2);
  }

  /** The world as it looked at the render clock, or null before the first snapshot arrives. */
  sample(): Snapshot | null {
    const newest = this.latest;
    if (!newest) return null;
    let older = this.snapshots[0] as Snapshot;
    let newer = newest;
    for (let i = 0; i < this.snapshots.length - 1; i++) {
      const a = this.snapshots[i] as Snapshot;
      const b = this.snapshots[i + 1] as Snapshot;
      if (a.time <= this.clock && this.clock <= b.time) {
        older = a;
        newer = b;
        break;
      }
    }
    if (older === newer || newer.time <= older.time) return newest;
    const t = clamp01((this.clock - older.time) / (newer.time - older.time));
    return {
      tick: newer.tick,
      time: this.clock,
      players: newer.players.map((p) => blendPlayer(older.players.find((q) => q.id === p.id), p, t)),
      names: newer.names,
      room: newer.room,
      crates: newer.crates.map((c) => blendCrate(older.crates.find((q) => q.id === c.id), c, t)),
      pickups: newer.pickups.map((p) => blendPickup(older.pickups.find((q) => q.id === p.id), p, t)),
      projectiles: newer.projectiles, // small, fast and short-lived: not worth blending
      mines: newer.mines, // they sit still; there is nothing to interpolate
      round: newer.round,
    };
  }
}

function blendPlayer(a: PlayerState | undefined, b: PlayerState, t: number): PlayerState {
  if (!a) return b; // only just appeared: nothing to come from
  return {
    ...b,
    x: lerp(a.x, b.x, t),
    y: lerp(a.y, b.y, t),
    z: lerp(a.z, b.z, t),
    vx: lerp(a.vx, b.vx, t),
    vy: lerp(a.vy, b.vy, t),
    vz: lerp(a.vz, b.vz, t),
    yaw: lerpAngle(a.yaw, b.yaw, t),
    ...blendQuaternion(a, b, t),
  };
}

function blendCrate(a: CrateState | undefined, b: CrateState, t: number): CrateState {
  if (!a) return b;
  return { ...b, x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), z: lerp(a.z, b.z, t), ...blendQuaternion(a, b, t) };
}

function blendPickup(a: PickupState | undefined, b: PickupState, t: number): PickupState {
  if (!a) return b;
  return { ...b, x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), z: lerp(a.z, b.z, t), ...blendQuaternion(a, b, t) };
}

interface Quat {
  qx: number;
  qy: number;
  qz: number;
  qw: number;
}

/** Normalised linear blend. Close enough between two snapshots 50 ms apart, and cheap. */
function blendQuaternion(a: Quat, b: Quat, t: number): Quat {
  const dot = a.qx * b.qx + a.qy * b.qy + a.qz * b.qz + a.qw * b.qw;
  const s = dot < 0 ? -1 : 1; // take the short way round
  const qx = lerp(a.qx, b.qx * s, t);
  const qy = lerp(a.qy, b.qy * s, t);
  const qz = lerp(a.qz, b.qz * s, t);
  const qw = lerp(a.qw, b.qw * s, t);
  const len = Math.hypot(qx, qy, qz, qw) || 1;
  return { qx: qx / len, qy: qy / len, qz: qz / len, qw: qw / len };
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpAngle(a: number, b: number, t: number): number {
  let diff = b - a;
  diff = Math.atan2(Math.sin(diff), Math.cos(diff)); // shortest way round
  return a + diff * t;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
