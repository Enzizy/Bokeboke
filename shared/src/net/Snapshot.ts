import type { CrateState } from '../crates/ChaosCrate';
import type { PlayerState } from '../sim/PlayerPhysics';
import type { RoundState } from '../sim/RoundSystem';
import type { Simulation } from '../sim/Simulation';
import type { PickupState } from '../weapons/WeaponPickup';
import type { MineState } from '../weapons/MineSystem';
import type { MatchSetup } from './messages';
import type { ProjectileState } from '../weapons/ProjectileSystem';

/**
 * Everything a client needs to draw one moment of the match. It is exactly the states the
 * local game already reads off the Simulation, so an online client renders from the same
 * shapes as an offline one and nothing in the render layer has to know the difference.
 */
/** Everything about the room itself, as opposed to the fight going on inside it: the setup in play. */
export interface RoomInfo extends MatchSetup {
  /** A new map after every match, rather than whatever the host last picked. */
  randomize: boolean;
  /** A change that has been called but not applied yet, and the seconds left on it. */
  pending: MatchSetup | null;
  pendingIn: number;
  /** The player who gets to choose; the rest just get told. Null in practice. */
  hostId: number | null;
}

export interface Snapshot {
  /** Server tick this was taken on; snapshots arrive in order but may be dropped. */
  tick: number;
  /** Server clock in seconds, used to pace interpolation between snapshots. */
  time: number;
  players: PlayerState[];
  /** What to call each player, by id. Names live here rather than in the simulation. */
  names: Record<number, string>;
  room: RoomInfo;
  crates: CrateState[];
  pickups: PickupState[];
  projectiles: ProjectileState[];
  mines: MineState[];
  round: RoundState;
}

export interface SnapshotContext {
  tick: number;
  time: number;
  names: Record<number, string>;
  room: RoomInfo;
}

export function captureSnapshot(sim: Simulation, { tick, time, names, room }: SnapshotContext): Snapshot {
  return {
    tick,
    time,
    players: sim.playerIds().map((id) => sim.playerState(id)),
    names,
    room,
    crates: sim.crateStates(),
    pickups: sim.pickupStates(),
    projectiles: sim.projectileStates(),
    mines: sim.mineStates(),
    round: sim.roundState(),
  };
}
