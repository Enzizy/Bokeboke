import type { EventQueue, SimEvent } from './events';

/**
 * Seconds a hit keeps its claim on a player. Knock someone down, grab them or throw them, and
 * if they go out within this long - off the edge, or out cold - the kill is yours. Walking off
 * the edge on your own gives nobody a kill.
 */
export const KILL_CREDIT_WINDOW = 6;

/**
 * Kills and deaths for the scoreboard, and the whole score in a timed match. It never touches
 * a body: it listens to the event stream every other system already writes to.
 */
export class ScoreSystem {
  private readonly kills = new Map<number, number>();
  private readonly deaths = new Map<number, number>();
  /** The last player to lay a hand on each player, and when. */
  private readonly lastHit = new Map<number, { by: number; at: number }>();
  private clock = 0;
  /** Only a live fight counts; free play and the gap between rounds do not. */
  private readonly counting: () => boolean;

  constructor(events: EventQueue, counting: () => boolean) {
    this.counting = counting;
    events.listen((event) => this.observe(event));
  }

  update(dt: number): void {
    this.clock += dt;
  }

  /** A fresh match: everyone back to zero. */
  clear(): void {
    this.kills.clear();
    this.deaths.clear();
    this.lastHit.clear();
  }

  /** Someone left the room: their line goes, and any claim they had on others with it. */
  forget(playerId: number): void {
    this.kills.delete(playerId);
    this.deaths.delete(playerId);
    this.lastHit.delete(playerId);
    for (const [victim, hit] of this.lastHit) if (hit.by === playerId) this.lastHit.delete(victim);
  }

  killsOf(playerId: number): number {
    return this.kills.get(playerId) ?? 0;
  }

  deathsOf(playerId: number): number {
    return this.deaths.get(playerId) ?? 0;
  }

  /**
   * Who is winning a timed match: most kills, then fewest deaths. Still level at the top is a
   * draw (null) - nobody is handed a win on join order.
   */
  leader(playerIds: number[]): number | null {
    const ranked = [...playerIds].sort((a, b) => this.killsOf(b) - this.killsOf(a) || this.deathsOf(a) - this.deathsOf(b));
    const [first, second] = ranked;
    if (first === undefined) return null;
    if (second !== undefined && this.killsOf(first) === this.killsOf(second) && this.deathsOf(first) === this.deathsOf(second)) return null;
    return first;
  }

  private observe(event: SimEvent): void {
    switch (event.type) {
      case 'player-damaged':
      case 'knockdown':
      case 'player-ko':
        this.blame(event.playerId, event.byPlayerId);
        break;
      case 'grab':
        if (event.target.kind === 'player') this.blame(event.target.id, event.playerId);
        break;
      case 'eliminated':
        this.eliminated(event.playerId);
        break;
      default:
        break;
    }
  }

  private blame(victim: number, by: number | null): void {
    if (by === null || by === victim) return;
    this.lastHit.set(victim, { by, at: this.clock });
  }

  private eliminated(victim: number): void {
    const hit = this.lastHit.get(victim);
    this.lastHit.delete(victim);
    if (!this.counting()) return;
    this.deaths.set(victim, this.deathsOf(victim) + 1);
    if (hit && this.clock - hit.at <= KILL_CREDIT_WINDOW) this.kills.set(hit.by, this.killsOf(hit.by) + 1);
  }
}
