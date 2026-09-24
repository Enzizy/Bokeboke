import { DEFAULT_BINDINGS, type PlayerBindings } from '../input/PlayerBindings';

/** The actions a player can move to another key. Movement stays on WASD / the arrows. */
export type RebindableAction = 'punch' | 'kick' | 'grab' | 'jump';

export const REBINDABLE: readonly { action: RebindableAction; label: string }[] = [
  { action: 'punch', label: 'Punch / attack' },
  { action: 'kick', label: 'Kick' },
  { action: 'grab', label: 'Pick up / grab' },
  { action: 'jump', label: 'Jump' },
];

export interface SoundVolumes {
  master: number;
  music: number;
  effects: number;
}

interface Stored {
  volume: SoundVolumes;
  keys: Record<RebindableAction, string>;
}

const STORAGE_KEY = 'wobble-settings';

/** Keys that already mean something, and what - the reason a rebind to them is refused. */
const RESERVED = new Map<string, string>([
  ...[...DEFAULT_BINDINGS.up, ...DEFAULT_BINDINGS.down, ...DEFAULT_BINDINGS.left, ...DEFAULT_BINDINGS.right]
    .map((code): [string, string] => [code, 'That key moves you.']),
  ...DEFAULT_BINDINGS.run.map((code): [string, string] => [code, 'Shift is sprint.']),
  ['Escape', 'Esc opens settings.'],
  ['Tab', 'Tab shows the scoreboard.'],
  ['KeyR', 'R is rematch.'],
]);

function defaults(): Stored {
  return {
    volume: { master: 0.8, music: 0.7, effects: 1 },
    keys: {
      punch: DEFAULT_BINDINGS.punch[0] ?? 'KeyJ',
      kick: DEFAULT_BINDINGS.kick[0] ?? 'KeyK',
      grab: DEFAULT_BINDINGS.grab[0] ?? 'KeyL',
      jump: DEFAULT_BINDINGS.jump[0] ?? 'Space',
    },
  };
}

/**
 * The player's own preferences - volumes and keys - kept in this browser. Everything else in
 * the client reads them from here and hears about changes through `onChange`.
 */
export class Settings {
  private data: Stored;
  private readonly listeners: (() => void)[] = [];

  constructor() {
    this.data = load();
  }

  get volume(): Readonly<SoundVolumes> {
    return this.data.volume;
  }

  keyFor(action: RebindableAction): string {
    return this.data.keys[action];
  }

  setVolume(channel: keyof SoundVolumes, value: number): void {
    this.data.volume[channel] = clamp01(value);
    this.changed();
  }

  /**
   * Moves an action to a key. A key another action had is swapped over rather than shared, so
   * nothing is ever left doing two things. Returns why not, if the key is spoken for.
   */
  rebind(action: RebindableAction, code: string): string | null {
    const reason = RESERVED.get(code);
    if (reason) return reason;
    const keys = this.data.keys;
    const other = REBINDABLE.find((r) => r.action !== action && keys[r.action] === code);
    if (other) keys[other.action] = keys[action];
    keys[action] = code;
    this.changed();
    return null;
  }

  resetKeys(): void {
    this.data.keys = defaults().keys;
    this.changed();
  }

  /**
   * The full key map for the game. Each rebindable action gets its chosen key, plus its
   * arrow-hand alternate (, . /) unless another action has since taken that key.
   */
  bindings(): PlayerBindings {
    const keys = this.data.keys;
    const taken = new Set(Object.values(keys));
    const pick = (action: RebindableAction): string[] => [
      keys[action],
      ...DEFAULT_BINDINGS[action].slice(1).filter((code) => !taken.has(code)),
    ];
    return { ...DEFAULT_BINDINGS, punch: pick('punch'), kick: pick('kick'), grab: pick('grab'), jump: pick('jump') };
  }

  onChange(listener: () => void): void {
    this.listeners.push(listener);
  }

  private changed(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.data));
    } catch {
      // Private mode or storage blocked: the settings still apply, they just won't be remembered.
    }
    for (const listener of this.listeners) listener();
  }
}

/** Whatever was saved, checked field by field; anything missing or odd falls back to defaults. */
function load(): Stored {
  const out = defaults();
  let saved: unknown = null;
  try {
    saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
  } catch {
    return out;
  }
  if (typeof saved !== 'object' || saved === null) return out;
  const { volume, keys } = saved as Partial<Record<keyof Stored, Record<string, unknown>>>;
  for (const channel of ['master', 'music', 'effects'] as const) {
    const value = volume?.[channel];
    if (typeof value === 'number' && Number.isFinite(value)) out.volume[channel] = clamp01(value);
  }
  const used = new Set<string>();
  for (const { action } of REBINDABLE) {
    const code = keys?.[action];
    if (typeof code === 'string' && code && !RESERVED.has(code) && !used.has(code)) out.keys[action] = code;
    used.add(out.keys[action]);
  }
  // A hand-edited or half-old save can still collide; if it does, the defaults are the safe answer.
  if (new Set(Object.values(out.keys)).size !== REBINDABLE.length) out.keys = defaults().keys;
  return out;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/** How a KeyboardEvent.code reads on a key cap: KeyJ -> J, Digit4 -> 4, Comma -> , */
export function keyLabel(code: string): string {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return `Num ${code.slice(6)}`;
  const named: Record<string, string> = {
    Space: 'Space', Comma: ',', Period: '.', Slash: '/', Semicolon: ';', Quote: "'", BracketLeft: '[',
    BracketRight: ']', Backslash: '\\', Minus: '-', Equal: '=', Backquote: '`', Enter: 'Enter',
    ControlLeft: 'Ctrl', ControlRight: 'R Ctrl', AltLeft: 'Alt', AltRight: 'R Alt', CapsLock: 'Caps',
  };
  return named[code] ?? code;
}
