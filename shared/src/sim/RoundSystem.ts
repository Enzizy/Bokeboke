import type { EventQueue } from './events';
import type { ScoreSystem } from './ScoreSystem';

/**
 * 'rounds': last player standing takes the round, first to roundsToWin takes the match.
 * 'timed': everyone respawns, the clock runs down, and the most kills wins.
 */
export type GameMode = 'rounds' | 'timed';
/** The match lengths a host can pick for a timed match, in seconds. */
export const MATCH_LENGTHS = [180, 300] as const;

export type RoundPhase = 'waiting' | 'countdown' | 'fighting' | 'round-over' | 'match-over';

export interface RoundConfig {
  /** Round wins needed to take the match. */
  roundsToWin: number;
  countdownSeconds: number;
  /** How long the "X wins the round" moment lasts before the next countdown. */
  roundOverSeconds: number;
  /** Start a match by itself as soon as enough players exist (local play). Servers call startMatch(). */
  autoStart: boolean;
  minPlayers: number;
  mode: GameMode;
  /** How long a timed match runs. */
  matchSeconds: number;
}

export const DEFAULT_ROUND_CONFIG: RoundConfig = {
  roundsToWin: 3,
  countdownSeconds: 3,
  roundOverSeconds: 3,
  autoStart: true,
  minPlayers: 2,
  mode: 'rounds',
  matchSeconds: MATCH_LENGTHS[0],
};

export function isGameMode(value: unknown): value is GameMode {
  return value === 'rounds' || value === 'timed';
}

export interface RoundState {
  mode: GameMode;
  phase: RoundPhase;
  round: number;
  /** Seconds left in the current phase where that means something (countdown, round-over, a timed fight). */
  timer: number;
  wins: Record<number, number>;
  alive: number[];
  /** Winner of the last round / the match, once decided. null = draw. */
  winnerId: number | null;
  /** This match so far, by player id. */
  kills: Record<number, number>;
  deaths: Record<number, number>;
}

/** What the round system needs from the rest of the sim, without owning it. */
export interface RoundHooks {
  playerIds(): number[];
  isEliminated(playerId: number): boolean;
  /** Put everyone back on their spawn points, upright, empty-handed; clear crates and pickups. */
  resetArena(): void;
}

/**
 * The shape of a match. In 'rounds', being eliminated means sitting out the rest of the round;
 * in 'timed', everyone keeps coming back until the clock runs out. Free play ("waiting") lets
 * everyone respawn either way. The sim asks `respawnsAllowed()` before bringing anyone back.
 */
export class RoundSystem {
  readonly config: RoundConfig;
  private phase: RoundPhase = 'waiting';
  private round = 0;
  private timer = 0;
  private readonly wins = new Map<number, number>();
  private winnerId: number | null = null;
  private readonly events: EventQueue;
  private readonly hooks: RoundHooks;
  private readonly score: ScoreSystem;

  constructor(events: EventQueue, hooks: RoundHooks, score: ScoreSystem, config: Partial<RoundConfig> = {}) {
    this.events = events;
    this.hooks = hooks;
    this.score = score;
    this.config = { ...DEFAULT_ROUND_CONFIG, ...config };
  }

  get mode(): GameMode {
    return this.config.mode;
  }

  /** Sets the kind of match to play. Takes effect when the next match starts. */
  configure(mode: GameMode, matchSeconds: number): void {
    this.config.mode = mode;
    this.config.matchSeconds = matchSeconds;
  }

  get currentPhase(): RoundPhase {
    return this.phase;
  }

  /** Players may only act while a round is live or in free play. */
  inputsAllowed(): boolean {
    return this.phase === 'fighting' || this.phase === 'waiting';
  }

  respawnsAllowed(): boolean {
    return this.phase === 'waiting' || (this.phase === 'fighting' && this.config.mode === 'timed');
  }

  /** Kills and deaths only count while a match is actually being fought. */
  scoring(): boolean {
    return this.phase === 'fighting';
  }

  /** Begins a fresh match: scores cleared, first round counts down. */
  startMatch(): void {
    this.wins.clear();
    this.score.clear();
    this.round = 0;
    this.winnerId = null;
    this.beginCountdown();
  }

  /** Alias that reads better from a "Rematch" button. */
  rematch(): void {
    this.startMatch();
  }

  update(dt: number): void {
    const players = this.hooks.playerIds();
    switch (this.phase) {
      case 'waiting':
        if (this.config.autoStart && players.length >= this.config.minPlayers) this.startMatch();
        return;
      case 'countdown':
        this.timer -= dt;
        if (this.timer <= 0) {
          this.phase = 'fighting';
          if (this.config.mode === 'timed') this.timer = this.config.matchSeconds;
          this.events.push({ type: 'round-start', round: this.round });
        }
        return;
      case 'fighting': {
        if (players.length < this.config.minPlayers) {
          this.phase = 'waiting';
          return;
        }
        if (this.config.mode === 'timed') {
          this.runClock(dt, players);
          return;
        }
        const alive = players.filter((id) => !this.hooks.isEliminated(id));
        if (alive.length > 1) return;
        this.winnerId = alive[0] ?? null;
        if (this.winnerId !== null) this.wins.set(this.winnerId, (this.wins.get(this.winnerId) ?? 0) + 1);
        this.phase = 'round-over';
        this.timer = this.config.roundOverSeconds;
        this.events.push({ type: 'round-over', round: this.round, winnerId: this.winnerId, wins: this.winsRecord() });
        return;
      }
      case 'round-over':
        this.timer -= dt;
        if (this.timer > 0) return;
        if (this.winnerId !== null && (this.wins.get(this.winnerId) ?? 0) >= this.config.roundsToWin) {
          this.phase = 'match-over';
          this.events.push({ type: 'match-over', winnerId: this.winnerId, wins: this.winsRecord() });
        } else {
          this.beginCountdown();
        }
        return;
      case 'match-over':
        return; // waits for rematch()
      default:
        return;
    }
  }

  state(): RoundState {
    const players = this.hooks.playerIds();
    return {
      mode: this.config.mode,
      phase: this.phase,
      round: this.round,
      timer: Math.max(0, this.timer),
      wins: this.winsRecord(),
      alive: players.filter((id) => !this.hooks.isEliminated(id)),
      winnerId: this.winnerId,
      kills: Object.fromEntries(players.map((id) => [id, this.score.killsOf(id)])),
      deaths: Object.fromEntries(players.map((id) => [id, this.score.deathsOf(id)])),
    };
  }

  /** A timed fight: nobody is out for good, so only the clock ends it. */
  private runClock(dt: number, players: number[]): void {
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = 0;
    this.winnerId = this.score.leader(players);
    if (this.winnerId !== null) this.wins.set(this.winnerId, 1);
    this.phase = 'match-over';
    this.events.push({ type: 'match-over', winnerId: this.winnerId, wins: this.winsRecord() });
  }

  private beginCountdown(): void {
    this.round++;
    this.phase = 'countdown';
    this.timer = this.config.countdownSeconds;
    this.hooks.resetArena();
    this.events.push({ type: 'round-countdown', round: this.round, seconds: this.config.countdownSeconds });
  }

  private winsRecord(): Record<number, number> {
    const out: Record<number, number> = {};
    for (const id of this.hooks.playerIds()) out[id] = this.wins.get(id) ?? 0;
    return out;
  }
}
