import { MAX_NAME_LENGTH, MAX_ROOM_PLAYERS, normalizeRoomCode, randomRoomCode, sanitizeName } from '@shared/net/messages';

/** What the player chose on the front screen. Every mode carries the name they go by. */
export type LobbyChoice =
  | { mode: 'practice'; name: string }
  | { mode: 'create'; room: string; name: string }
  | { mode: 'join'; room: string; name: string };

/** Remembered between visits, so you only type your name once. */
const NAME_KEY = 'wobble-player-name';

function rememberedName(): string {
  try {
    return sanitizeName(localStorage.getItem(NAME_KEY));
  } catch {
    return ''; // storage blocked: just ask again
  }
}

function rememberName(name: string): void {
  try {
    localStorage.setItem(NAME_KEY, name);
  } catch {
    // Not being able to remember a name is not worth interrupting anyone over.
  }
}

/**
 * The front screen: practise alone, open a room for friends, or type in the code they read
 * out to you. It hands back one choice and gets out of the way; everything it knows about the
 * network is a room code.
 */
export class LobbyMenu {
  private readonly root: HTMLElement;
  private readonly status: HTMLElement;
  private readonly panel: HTMLElement;
  private name = rememberedName();

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.id = 'lobby';
    this.panel = document.createElement('div');
    this.panel.className = 'panel';
    this.status = document.createElement('p');
    this.status.className = 'status';
    this.root.append(this.panel);
    parent.append(this.root);
  }

  /** Shows the menu and resolves once the player has picked something. */
  choose(): Promise<LobbyChoice> {
    return new Promise<LobbyChoice>((resolve) => {
      this.render(resolve);
      this.root.hidden = false;
    });
  }

  /** Leaves the menu up with a message - a room that was full, a server that was not there. */
  showError(message: string): void {
    this.status.textContent = message;
    this.status.dataset['kind'] = 'error';
    this.setBusy(false);
  }

  /** Swaps the menu for a message while a connection is being made. */
  showBusy(message: string): void {
    this.status.textContent = message;
    this.status.dataset['kind'] = 'busy';
    this.setBusy(true);
  }

  hide(): void {
    this.root.hidden = true;
  }

  private render(resolve: (choice: LobbyChoice) => void): void {
    this.panel.replaceChildren();

    const title = document.createElement('h1');
    title.textContent = 'Wobble Wars';
    const tagline = document.createElement('p');
    tagline.className = 'tagline';
    tagline.textContent = `Punch, grab and throw your friends off the edge. Up to ${MAX_ROOM_PLAYERS} in a room.`;

    // Your name goes over your head in the arena, which is how anyone tells you from the rest.
    const nameRow = document.createElement('label');
    nameRow.className = 'name-row';
    nameRow.textContent = 'Your name';
    const nameInput = document.createElement('input');
    nameInput.className = 'name';
    nameInput.placeholder = 'Wobbler';
    nameInput.maxLength = MAX_NAME_LENGTH;
    nameInput.value = this.name;
    nameInput.spellcheck = false;
    // The browser's own autofill repaints the field grey and drops a suggestion list over the
    // buttons underneath. We remember the name ourselves, so nothing is lost by turning it off.
    nameInput.autocomplete = 'off';
    nameInput.name = 'wobble-name';
    nameInput.addEventListener('input', () => {
      this.name = sanitizeName(nameInput.value);
    });
    nameRow.append(nameInput);

    const chosenName = (): string => {
      const name = sanitizeName(nameInput.value);
      this.name = name;
      rememberName(name);
      return name;
    };

    const practice = button('Practice alone', 'primary', () => {
      const name = chosenName();
      this.showBusy('Starting...');
      resolve({ mode: 'practice', name });
    });

    const create = button('Create a room', 'primary', () => {
      const name = chosenName();
      const room = randomRoomCode();
      this.showBusy(`Opening room ${room}...`);
      resolve({ mode: 'create', room, name });
    });

    const codeRow = document.createElement('form');
    codeRow.className = 'code-row';
    const input = document.createElement('input');
    input.placeholder = 'CODE';
    input.maxLength = 8;
    input.autocapitalize = 'characters';
    input.spellcheck = false;
    input.autocomplete = 'off';
    input.setAttribute('aria-label', 'Room code');
    input.addEventListener('input', () => {
      input.value = normalizeRoomCode(input.value);
    });
    const join = document.createElement('button');
    join.type = 'submit';
    join.textContent = 'Join';
    codeRow.append(input, join);
    codeRow.addEventListener('submit', (e) => {
      e.preventDefault();
      const room = normalizeRoomCode(input.value);
      if (room.length < 3) {
        this.showError('Room codes are four letters.');
        return;
      }
      const name = chosenName();
      this.showBusy(`Joining room ${room}...`);
      resolve({ mode: 'join', room, name });
    });

    const hint = document.createElement('p');
    hint.className = 'hint';
    hint.textContent = 'Move: WASD or arrows · Run: Shift · Jump: Space · Punch/Kick/Grab: J K L';

    // The status line is deliberately left as it is: coming back here after a failed connection
    // re-renders the menu, and wiping it would throw away the explanation the player needs.
    this.panel.append(title, tagline, nameRow, practice, create, codeRow, this.status, hint);
    setTimeout(() => (this.name ? input : nameInput).focus(), 0);
  }

  private setBusy(busy: boolean): void {
    for (const el of this.panel.querySelectorAll('button, input')) {
      (el as HTMLButtonElement).disabled = busy;
    }
  }
}

function button(label: string, className: string, onClick: () => void): HTMLButtonElement {
  const el = document.createElement('button');
  el.className = className;
  el.textContent = label;
  el.addEventListener('click', onClick);
  return el;
}
