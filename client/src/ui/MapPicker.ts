import { listMaps } from '@shared/maps/MapRegistry';
import type { RoomInfo } from '@shared/net/Snapshot';

/**
 * The host's map controls, tucked into a corner of the screen. Only the host sees it; everyone
 * else finds out from the countdown over the arena. Picking a map does not change it there and
 * then - the room announces it and swaps a few seconds later - so changing your mind is free.
 */
export class MapPicker {
  private readonly root: HTMLElement;
  private readonly buttons = new Map<string, HTMLButtonElement>();
  private readonly randomize: HTMLInputElement;
  private readonly onPick: (mapId: string, randomize: boolean) => void;
  private shown = false;

  constructor(parent: HTMLElement, onPick: (mapId: string, randomize: boolean) => void) {
    this.onPick = onPick;
    this.root = document.createElement('div');
    this.root.id = 'maps';
    this.root.hidden = true;

    const title = document.createElement('h2');
    title.textContent = 'Arena';
    this.root.append(title);

    for (const map of listMaps()) {
      const button = document.createElement('button');
      button.textContent = map.name;
      button.addEventListener('click', () => {
        this.onPick(map.id, this.randomize.checked);
        button.blur(); // or the next press of Space would click it again instead of jumping
      });
      this.buttons.set(map.id, button);
      this.root.append(button);
    }

    const label = document.createElement('label');
    label.className = 'randomize';
    this.randomize = document.createElement('input');
    this.randomize.type = 'checkbox';
    this.randomize.addEventListener('change', () => {
      this.onPick(this.currentId, this.randomize.checked);
      this.randomize.blur();
    });
    label.append(this.randomize, document.createTextNode(' Random each match'));
    this.root.append(label);

    parent.append(this.root);
  }

  private currentId = '';

  /** Called every frame; cheap, and only touches the DOM when something actually changed. */
  update(info: RoomInfo | null, isHost: boolean): void {
    const show = isHost && info !== null;
    if (show !== this.shown) {
      this.shown = show;
      this.root.hidden = !show;
    }
    if (!show || !info) return;
    this.currentId = info.mapId;
    if (this.randomize.checked !== info.randomize) this.randomize.checked = info.randomize;
    for (const [id, button] of this.buttons) {
      // The pending map is the one to highlight: it is what the room is about to become.
      const selected = id === (info.pendingMapId ?? info.mapId);
      if (button.classList.contains('on') !== selected) button.classList.toggle('on', selected);
    }
  }
}
