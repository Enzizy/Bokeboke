import type { RoundState } from '@shared/sim/RoundSystem';
import { describeMode, formatClock } from './matchText';

export interface ScoreboardPlayer {
  id: number;
  name: string;
  color: string;
  /** The player on this screen, highlighted so you can find yourself. */
  mine: boolean;
}

export interface ScoreboardView {
  /** The code friends join with; null in practice. */
  roomCode: string | null;
  mapName: string;
  matchSeconds: number;
  round: RoundState;
  players: ScoreboardPlayer[];
}

/**
 * Hold Tab: the room code on top, then everyone's kills and deaths (and round wins, in a
 * rounds match), best first. It only draws while Tab is held, and only when something changed.
 */
export class Scoreboard {
  private readonly root: HTMLElement;
  private held = false;
  private lastHtml = '';

  constructor(parent: HTMLElement, blocked: () => boolean) {
    this.root = document.createElement('div');
    this.root.id = 'scoreboard';
    this.root.hidden = true;
    parent.append(this.root);
    window.addEventListener('keydown', (e) => {
      if (e.code !== 'Tab') return;
      e.preventDefault(); // Tab would otherwise walk focus around the page
      if (!blocked()) this.setHeld(true);
    });
    window.addEventListener('keyup', (e) => {
      if (e.code === 'Tab') this.setHeld(false);
    });
    window.addEventListener('blur', () => this.setHeld(false));
  }

  update(view: ScoreboardView): void {
    if (!this.held) return;
    const html = render(view);
    if (html === this.lastHtml) return;
    this.lastHtml = html;
    this.root.innerHTML = html;
  }

  private setHeld(held: boolean): void {
    this.held = held;
    this.root.hidden = !held;
  }
}

function render({ roomCode, mapName, matchSeconds, round, players }: ScoreboardView): string {
  const timed = round.mode === 'timed';
  const kills = (id: number): number => round.kills[id] ?? 0;
  const deaths = (id: number): number => round.deaths[id] ?? 0;
  const wins = (id: number): number => round.wins[id] ?? 0;
  const ranked = [...players].sort((a, b) =>
    (timed ? 0 : wins(b.id) - wins(a.id)) || kills(b.id) - kills(a.id) || deaths(a.id) - deaths(b.id));

  const title = roomCode ? `Room <b>${escapeHtml(roomCode)}</b>` : 'Practice';
  const facts = [escapeHtml(mapName), describeMode(round.mode, matchSeconds)];
  if (timed && round.phase === 'fighting') facts.push(`${formatClock(round.timer)} left`);
  if (!timed && round.round > 0) facts.push(`Round ${round.round}`);

  const head = `<tr><th></th><th class="name">Player</th><th>Kills</th><th>Deaths</th>${timed ? '' : '<th>Wins</th>'}</tr>`;
  const rows = ranked.map((p, i) => {
    const cells = [kills(p.id), deaths(p.id), ...(timed ? [] : [wins(p.id)])].map((n) => `<td>${n}</td>`).join('');
    return `<tr class="${p.mine ? 'mine' : ''}"><td class="rank">${i + 1}</td>`
      + `<td class="name"><i style="background:${p.color}"></i>${escapeHtml(p.name)}</td>${cells}</tr>`;
  }).join('');
  return `<h2>${title}</h2><p class="facts">${facts.join(' · ')}</p><table>${head}${rows}</table>`;
}

/** Names come from other players, so nothing in them is ever treated as markup. */
export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
