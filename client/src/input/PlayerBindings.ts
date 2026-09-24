import type { PlayerInput } from '@shared/sim/PlayerInput';
import type { KeyboardInput } from './KeyboardInput';

/**
 * KeyboardEvent.code values for one player's controls. Each action takes a list, so the same
 * player can use WASD or the arrow keys - whichever their hands reach for.
 */
export interface PlayerBindings {
  up: string[];
  down: string[];
  left: string[];
  right: string[];
  run: string[];
  jump: string[];
  punch: string[];
  kick: string[];
  grab: string[];
}

/** One player per keyboard: WASD or arrows, Shift to run, Space to jump, J/K/L to fight. */
export const DEFAULT_BINDINGS: PlayerBindings = {
  up: ['KeyW', 'ArrowUp'],
  down: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  run: ['ShiftLeft', 'ShiftRight'],
  jump: ['Space'],
  punch: ['KeyJ', 'Comma'],
  kick: ['KeyK', 'Period'],
  grab: ['KeyL', 'Slash'],
};

/** Samples the keyboard into a sim input. The camera looks north, so up on screen is world -Z. */
export function readPlayerInput(keys: KeyboardInput, b: PlayerBindings): PlayerInput {
  const down = (codes: string[]): boolean => codes.some((code) => keys.isDown(code));
  return {
    moveX: (down(b.right) ? 1 : 0) - (down(b.left) ? 1 : 0),
    moveZ: (down(b.down) ? 1 : 0) - (down(b.up) ? 1 : 0),
    run: down(b.run),
    jump: down(b.jump),
    punch: down(b.punch),
    kick: down(b.kick),
    grab: down(b.grab),
  };
}
