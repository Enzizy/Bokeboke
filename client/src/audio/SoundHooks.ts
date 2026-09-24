/** Every sound the game will eventually play. Names are the contract; the audio is not built yet. */
export type SoundName =
  | 'punch'
  | 'kick'
  | 'grab'
  | 'release'
  | 'throw'
  | 'knockdown'
  | 'recover'
  | 'eliminated'
  | 'respawn'
  | 'weapon-armed'
  | 'weapon-fired'
  | 'weapon-consumed'
  | 'hammer-swing'
  | 'arrow-hit'
  | 'explosion'
  | 'countdown'
  | 'round-start'
  | 'round-over'
  | 'match-over'
  | 'crate-land'
  | 'crate-hit'
  | 'crate-break'
  | 'weapon-eject'
  | 'weapon-pickup';

type SoundListener = (name: SoundName, volume: number) => void;

/**
 * Where gameplay asks for a sound. Nothing is wired to it yet, so it is a silent hook:
 * plug an audio implementation in with `onPlay` later without touching gameplay code.
 */
class SoundHooks {
  private listener: SoundListener | null = null;

  play(name: SoundName, volume = 1): void {
    this.listener?.(name, volume);
  }

  onPlay(listener: SoundListener | null): void {
    this.listener = listener;
  }
}

export const sounds = new SoundHooks();
