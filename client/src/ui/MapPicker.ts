import { listMaps } from '@shared/maps/MapRegistry';
import type { MatchSetup } from '@shared/net/messages';
import type { RoomInfo } from '@shared/net/Snapshot';
import { MATCH_LENGTHS, type GameMode } from '@shared/sim/RoundSystem';

const MODES: readonly { mode: GameMode; label: string }[] = [
  { mode: 'rounds', label: 'Rounds' },
  { mode: 'timed', label: 'Timed' },
];

/**
 * The host's match controls, tucked into a corner of the screen: which arena, which mode, and
 * how long a timed match runs. Only the host sees it; everyone else finds out from the
 * countdown over the arena. A pick does not apply there and then - the room announces it and
 * switches a few seconds later - so changing your mind is free.
 */
export class MapPicker {
  private readonly root: HTMLElement;
  private readonly mapButtons = new Map<string, HTMLButtonElement>();
  private readonly modeButtons = new Map<GameMode, HTMLButtonElement>();
  private readonly lengthButtons = new Map<number, HTMLButtonElement>();
  private readonly lengthRow: HTMLElement;
  private readonly randomize: HTMLInputElement;
  private readonly onPick: (setup: MatchSetup, randomize: boolean) => void;
  private shown = false;
  /** What is selected: the pending setup if there is one, else what is in play. */
  private selected: MatchSetup = { mapId: '', mode: 'rounds', matchSeconds: MATCH_LENGTHS[0] };

  constructor(parent: HTMLElement, onPick: (setup: MatchSetup, randomize: boolean) => void) {
    this.onPick = onPick;
    this.root = document.createElement('div');
    this.root.id = 'maps';
    this.root.hidden = true;

    this.root.append(heading('Arena'));
    for (const map of listMaps()) {
      this.mapButtons.set(map.id, this.button(map.name, () => ({ ...this.selected, mapId: map.id }), this.root));
    }
    const label = document.createElement('label');
    label.className = 'randomize';
    this.randomize = document.createElement('input');
    this.randomize.type = 'checkbox';
    this.randomize.addEventListener('change', () => {
      this.onPick(this.selected, this.randomize.checked);
      this.randomize.blur();
    });
    label.append(this.randomize, document.createTextNode(' Random each match'));
    this.root.append(label);

    this.root.append(heading('Mode'));
    const modeRow = row(this.root);
    for (const { mode, label: text } of MODES) {
      this.modeButtons.set(mode, this.button(text, () => ({ ...this.selected, mode }), modeRow));
    }
    this.lengthRow = row(this.root);
    for (const seconds of MATCH_LENGTHS) {
      this.lengthButtons.set(seconds, this.button(`${seconds / 60} min`, () => ({ ...this.selected, matchSeconds: seconds }), this.lengthRow));
    }

    parent.append(this.root);
  }

  /** Called every frame; cheap, and only touches the DOM when something actually changed. */
  update(info: RoomInfo | null, isHost: boolean): void {
    const show = isHost && info !== null;
    if (show !== this.shown) {
      this.shown = show;
      this.root.hidden = !show;
    }
    if (!show || !info) return;
    // The pending setup is the one to highlight: it is what the room is about to become.
    const { mapId, mode, matchSeconds } = info.pending ?? info;
    this.selected = { mapId, mode, matchSeconds };
    if (this.randomize.checked !== info.randomize) this.randomize.checked = info.randomize;
    for (const [id, button] of this.mapButtons) mark(button, id === mapId);
    for (const [id, button] of this.modeButtons) mark(button, id === mode);
    for (const [seconds, button] of this.lengthButtons) mark(button, seconds === matchSeconds);
    const timed = mode === 'timed';
    if (this.lengthRow.hidden === timed) this.lengthRow.hidden = !timed;
  }

  private button(text: string, next: () => MatchSetup, parent: HTMLElement): HTMLButtonElement {
    const button = document.createElement('button');
    button.textContent = text;
    button.addEventListener('click', () => {
      this.onPick(next(), this.randomize.checked);
      button.blur(); // or the next press of Space would click it again instead of jumping
    });
    parent.append(button);
    return button;
  }
}

function heading(text: string): HTMLElement {
  const h = document.createElement('h2');
  h.textContent = text;
  return h;
}

function row(parent: HTMLElement): HTMLElement {
  const div = document.createElement('div');
  div.className = 'choices';
  parent.append(div);
  return div;
}

function mark(button: HTMLButtonElement, on: boolean): void {
  if (button.classList.contains('on') !== on) button.classList.toggle('on', on);
}
