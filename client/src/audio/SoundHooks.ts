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
  private effects = 1;
  /** What music should play at (master x music), for whenever there is music to play. */
  musicVolume = 1;

  /** The player's volume settings. Every effect is scaled by master x effects on its way out. */
  setVolumes(volumes: { master: number; music: number; effects: number }): void {
    this.effects = volumes.master * volumes.effects;
    this.musicVolume = volumes.master * volumes.music;
  }

  play(name: SoundName, volume = 1): void {
    if (this.effects <= 0) return;
    this.listener?.(name, volume * this.effects);
  }

  onPlay(listener: SoundListener | null): void {
    this.listener = listener;
  }
}

export const sounds = new SoundHooks();
