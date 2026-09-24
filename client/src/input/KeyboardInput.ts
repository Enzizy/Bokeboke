/** Tracks which physical keys (KeyboardEvent.code) are currently held. */
export class KeyboardInput {
  private readonly down = new Set<string>();

  constructor() {
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.down.add(e.code);
      if (GAME_KEYS.has(e.code)) e.preventDefault(); // stop arrows/space scrolling the page
    });
    window.addEventListener('keyup', (e) => this.down.delete(e.code));
    window.addEventListener('blur', () => this.down.clear());
  }

  isDown(code: string): boolean {
    return this.down.has(code);
  }
}

const GAME_KEYS = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);
