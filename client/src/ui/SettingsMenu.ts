import { keyLabel, REBINDABLE, type RebindableAction, type Settings, type SoundVolumes } from '../settings/Settings';

const VOLUMES: readonly { channel: keyof SoundVolumes; label: string }[] = [
  { channel: 'master', label: 'Master' },
  { channel: 'music', label: 'Music' },
  { channel: 'effects', label: 'Effects' },
];

/** A chunky eight-toothed gear: a disc, teeth around it, and a hole punched in the middle. */
const GEAR_SVG = `<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><g fill="currentColor">${
  Array.from({ length: 8 }, (_, i) => `<rect x="10" y="1.5" width="4" height="5" rx="1" transform="rotate(${i * 45} 12 12)"/>`).join('')
}<circle cx="12" cy="12" r="7"/></g><circle cx="12" cy="12" r="3" fill="var(--gear-hole)"/></svg>`;

/**
 * The settings panel: volumes and keys. A gear sits at the top of the screen and Esc opens or
 * closes it from anywhere, lobby included. Online the match cannot pause, so the game keeps
 * running underneath - your character just stands still while the panel is open.
 */
export class SettingsMenu {
  private readonly settings: Settings;
  private readonly overlay: HTMLElement;
  private readonly keyButtons = new Map<RebindableAction, HTMLButtonElement>();
  private readonly message: HTMLElement;
  /** The action waiting for its new key, if the player has clicked one. */
  private capturing: RebindableAction | null = null;

  constructor(parent: HTMLElement, settings: Settings) {
    this.settings = settings;

    const gear = document.createElement('button');
    gear.id = 'settings-button';
    gear.title = 'Settings (Esc)';
    gear.setAttribute('aria-label', 'Settings');
    gear.innerHTML = GEAR_SVG;
    gear.addEventListener('click', () => {
      this.toggle();
      gear.blur(); // or Space would click it again instead of jumping
    });

    this.overlay = document.createElement('div');
    this.overlay.id = 'settings';
    this.overlay.hidden = true;
    this.overlay.addEventListener('click', (e) => {
      if (e.target === this.overlay) this.close(); // a click outside the panel
    });
    const panel = document.createElement('div');
    panel.className = 'panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Settings');

    const header = document.createElement('div');
    header.className = 'header';
    const title = document.createElement('h2');
    title.textContent = 'Settings';
    const closeButton = document.createElement('button');
    closeButton.className = 'close';
    closeButton.textContent = '×';
    closeButton.setAttribute('aria-label', 'Close settings');
    closeButton.addEventListener('click', () => this.close());
    header.append(title, closeButton);

    this.message = document.createElement('p');
    this.message.className = 'message';
    panel.append(header, this.soundSection(), this.controlsSection(), this.message);
    this.overlay.append(panel);
    parent.append(gear, this.overlay);

    // Capture phase, so a key meant for the panel never reaches the game as well.
    window.addEventListener('keydown', (e) => this.onKey(e), { capture: true });
    settings.onChange(() => this.refreshKeys());
  }

  get isOpen(): boolean {
    return !this.overlay.hidden;
  }

  toggle(): void {
    if (this.isOpen) this.close();
    else this.open();
  }

  open(): void {
    this.overlay.hidden = false;
    this.say('');
  }

  close(): void {
    this.stopCapture();
    this.overlay.hidden = true;
  }

  private soundSection(): HTMLElement {
    const section = this.section('Sound');
    for (const { channel, label } of VOLUMES) {
      const row = document.createElement('label');
      row.className = 'row';
      const name = document.createElement('span');
      name.textContent = label;
      const slider = document.createElement('input');
      slider.type = 'range';
      slider.min = '0';
      slider.max = '100';
      slider.value = String(Math.round(this.settings.volume[channel] * 100));
      const value = document.createElement('output');
      value.textContent = `${slider.value}%`;
      slider.addEventListener('input', () => {
        value.textContent = `${slider.value}%`;
        this.settings.setVolume(channel, Number(slider.value) / 100);
      });
      row.append(name, slider, value);
      section.append(row);
    }
    const note = document.createElement('p');
    note.className = 'note';
    note.textContent = 'The game has no sound yet - these are saved for when it does.';
    section.append(note);
    return section;
  }

  private controlsSection(): HTMLElement {
    const section = this.section('Controls');
    for (const { action, label } of REBINDABLE) {
      const row = document.createElement('div');
      row.className = 'row';
      const name = document.createElement('span');
      name.textContent = label;
      const key = document.createElement('button');
      key.className = 'key';
      key.addEventListener('click', () => {
        if (this.capturing === action) this.stopCapture();
        else this.startCapture(action);
      });
      this.keyButtons.set(action, key);
      row.append(name, key);
      section.append(row);
    }
    const fixed = document.createElement('p');
    fixed.className = 'note';
    fixed.textContent = 'Move: WASD or arrows · Sprint: Shift · Scoreboard: hold Tab';
    const reset = document.createElement('button');
    reset.className = 'reset';
    reset.textContent = 'Reset controls';
    reset.addEventListener('click', () => {
      this.stopCapture();
      this.settings.resetKeys();
      this.say('Controls reset.');
    });
    section.append(fixed, reset);
    this.refreshKeys();
    return section;
  }

  private section(title: string): HTMLElement {
    const section = document.createElement('section');
    const heading = document.createElement('h3');
    heading.textContent = title;
    section.append(heading);
    return section;
  }

  private onKey(e: KeyboardEvent): void {
    if (this.capturing) {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.code === 'Escape') {
        this.stopCapture();
        return;
      }
      const action = this.capturing;
      const refused = this.settings.rebind(action, e.code);
      this.stopCapture();
      this.say(refused ?? '');
      return;
    }
    if (e.code !== 'Escape' || e.repeat) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    this.toggle();
  }

  private startCapture(action: RebindableAction): void {
    this.stopCapture();
    this.capturing = action;
    const button = this.keyButtons.get(action);
    if (button) {
      button.textContent = 'Press a key…';
      button.classList.add('waiting');
    }
    this.say('Press the new key, or Esc to cancel.');
  }

  private stopCapture(): void {
    this.capturing = null;
    this.refreshKeys();
    this.say('');
  }

  private refreshKeys(): void {
    for (const [action, button] of this.keyButtons) {
      if (action === this.capturing) continue;
      button.textContent = keyLabel(this.settings.keyFor(action));
      button.classList.remove('waiting');
      button.blur();
    }
  }

  private say(text: string): void {
    this.message.textContent = text;
  }
}
