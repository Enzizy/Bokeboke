/**
 * Everything the simulation is allowed to know about what a player wants this tick.
 * Movement is a world-space direction (the camera is fixed, so the client maps keys straight
 * to world axes). The server will receive exactly this structure over the network.
 */
export interface PlayerInput {
  /** -1..1, +X is screen-right. */
  moveX: number;
  /** -1..1, +Z is towards the camera (screen-down). */
  moveZ: number;
  run: boolean;
  jump: boolean;
  punch: boolean;
  kick: boolean;
  grab: boolean;
}

export function emptyInput(): PlayerInput {
  return { moveX: 0, moveZ: 0, run: false, jump: false, punch: false, kick: false, grab: false };
}
