import type { GameMode } from '@shared/sim/RoundSystem';

/** How a match reads in the setup panel, the scoreboard and announcements: "Rounds", "Timed · 3 min". */
export function describeMode(mode: GameMode, matchSeconds: number): string {
  return mode === 'timed' ? `Timed · ${Math.round(matchSeconds / 60)} min` : 'Rounds';
}

/** 154.2 -> "2:35". Rounded up, so the clock never shows 0:00 while there is still time. */
export function formatClock(seconds: number): string {
  const whole = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}
