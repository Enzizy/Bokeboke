import type { RoundState } from '@shared/sim/RoundSystem';
import type { SimEvent } from '@shared/sim/events';

export interface HudPlayer {
  id: number;
  name: string;
  color: string;
}

const FLASH_SECONDS = 0.9;

/**
 * Round presentation: score pips along the top, a big centre banner for countdowns and
 * results. Plain DOM on top of the canvas; it only reads round state and events.
 */
export class RoundHud {
  private readonly score: HTMLElement;
  private readonly banner: HTMLElement;
  private readonly players: HudPlayer[] = [];
  private roundsToWin = 3;
  private flash = 0;
  private flashText = '';
  private notice: string | null = null;
  private lastCountdown = -1;

  constructor(root: HTMLElement) {
    this.score = document.createElement('div');
    this.score.id = 'score';
    this.banner = document.createElement('div');
    this.banner.id = 'banner';
    root.append(this.score, this.banner);
  }

  setPlayers(players: HudPlayer[], roundsToWin: number): void {
    this.players.splice(0, this.players.length, ...players);
    this.roundsToWin = roundsToWin;
  }

  handle(event: SimEvent): void {
    switch (event.type) {
      case 'round-start':
        this.showFlash('FIGHT!');
        break;
      case 'round-over':
        this.flash = 0; // the banner shows the result from state instead
        break;
      default:
        break;
    }
  }

  /** An overriding message, such as a lost connection. Null puts the round banner back. */
  setNotice(notice: string | null): void {
    this.notice = notice;
  }

  update(dt: number, state: RoundState): void {
    this.renderScore(state);
    if (this.notice !== null) {
      this.setBanner(this.notice, 'result');
      return;
    }
    if (this.flash > 0) {
      this.flash -= dt;
      this.setBanner(this.flashText, 'flash');
      return;
    }
    switch (state.phase) {
      case 'countdown': {
        const n = Math.ceil(state.timer);
        if (n !== this.lastCountdown) this.lastCountdown = n;
        this.setBanner(`Round ${state.round}\n${n}`, 'countdown');
        break;
      }
      case 'round-over':
        this.setBanner(state.winnerId === null ? 'Draw!' : `${this.nameOf(state.winnerId)} wins the round!`, 'result');
        break;
      case 'match-over':
        this.setBanner(`${this.nameOf(state.winnerId)} wins the match!\nPress R for a rematch`, 'result');
        break;
      default:
        this.setBanner('', '');
    }
  }

  private showFlash(text: string): void {
    this.flash = FLASH_SECONDS;
    this.flashText = text;
  }

  private setBanner(text: string, kind: string): void {
    if (this.banner.textContent !== text) this.banner.textContent = text;
    this.banner.dataset['kind'] = kind;
    this.banner.hidden = text === '';
  }

  private renderScore(state: RoundState): void {
    if (state.phase === 'waiting') {
      this.score.hidden = true;
      return;
    }
    this.score.hidden = false;
    const html = this.players
      .map((p) => {
        const wins = state.wins[p.id] ?? 0;
        const pips = Array.from({ length: this.roundsToWin }, (_, i) => `<i class="${i < wins ? 'won' : ''}"></i>`).join('');
        const out = state.alive.includes(p.id) ? '' : ' out';
        return `<span class="player${out}" style="--c:${p.color}">${p.name}${pips}</span>`;
      })
      .join('<em>vs</em>');
    if (this.score.innerHTML !== html) this.score.innerHTML = html;
  }

  private nameOf(id: number | null): string {
    return this.players.find((p) => p.id === id)?.name ?? `Player ${id ?? '?'}`;
  }
}
