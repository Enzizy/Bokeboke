import type { PlayerState } from '@shared/sim/PlayerPhysics';
import { PLAYER } from '@shared/sim/tuning';
import type { AssetLoader } from '../assets/AssetLoader';
import type { PlayerBindings } from '../input/PlayerBindings';
import type { CharacterAnimation, CharacterView } from '../render/CharacterView';
import { WeaponView } from '../render/WeaponView';
import { WeaponTimerSprite } from '../render/WeaponTimerSprite';
import { PlayerTagSprite } from '../render/PlayerTagSprite';

/**
 * One player on screen, whether this keyboard drives them or a server does. It keeps the
 * character view in step with the player state it is given; `bindings` is null for someone
 * playing on another machine. Animation is presentation only - it is chosen from what the
 * body is doing, never the other way round.
 */
export class PlayerAvatar {
  readonly id: number;
  readonly bindings: PlayerBindings | null;
  readonly view: CharacterView;
  private readonly loader: AssetLoader;
  private held: WeaponView | null = null;
  private heldId: string | null = null;
  private readonly timer = new WeaponTimerSprite();
  private readonly tag: PlayerTagSprite;

  constructor(id: number, bindings: PlayerBindings | null, view: CharacterView, loader: AssetLoader, color: string) {
    this.id = id;
    this.bindings = bindings;
    this.view = view;
    this.loader = loader;
    this.tag = new PlayerTagSprite(color);
    view.root.add(this.timer.sprite, this.tag.sprite);
  }

  /** The name shown over their head. Set whenever the session's idea of it changes. */
  setName(name: string): void {
    this.tag.setName(name);
  }

  sync(state: PlayerState, dt = 0): void {
    const tumbling = state.posture === 'ragdoll';
    const q = tumbling ? { x: state.qx, y: state.qy, z: state.qz, w: state.qw } : undefined;
    this.view.setPose(state.x, state.y, state.z, state.yaw, q, tumbling);
    this.view.setVelocity(state.vx, state.vy, state.vz);
    this.view.root.visible = state.posture !== 'eliminated';
    // The tag rides on the character, so an eliminated player takes their name with them.
    const once = Boolean(state.attack) || tumbling || state.posture === 'recovering';
    this.view.play(chooseAnimation(state), once ? { once: true } : {});
    if (state.heldWeapon !== this.heldId) this.setHeldWeapon(state.heldWeapon);
    this.timer.update(state.weapon);
    this.tag.setStamina(state.staminaMax > 0 ? state.stamina / state.staminaMax : 1, state.winded);
    this.tag.update(state.hp, state.maxHp, state.posture !== 'eliminated', dt);
    const holding = state.heldWeapon !== null && state.posture === 'upright' && !state.attack;
    this.view.setArmPose(state.grabbing ? 'overhead' : holding ? 'holding' : 'none');
  }

  /** Restarts the swing clip so rapid repeated attacks each show a swing. */
  onAttack(attack: string): void {
    // A heavy swing is dragged out so the wind-up is readable from across the arena.
    this.view.play(attackClip(attack), { once: true, restart: true, fade: 0.05, timeScale: attack === 'heavy' ? 0.6 : 1 });
  }

  private setHeldWeapon(weaponId: string | null): void {
    this.heldId = weaponId;
    if (this.held) {
      this.held.root.removeFromParent();
      this.held = null;
    }
    if (!weaponId) return;
    void WeaponView.create(this.loader, weaponId).then((weapon) => {
      if (this.heldId !== weaponId) return; // changed again while loading
      weapon.poseInHand();
      this.view.handAnchor.add(weapon.root);
      this.held = weapon;
    });
  }
}

function attackClip(attack: string): CharacterAnimation {
  if (attack === 'kick') return 'attack-kick-right';
  if (attack === 'shoot') return 'holding-both-shoot'; // bows and staffs, not a swing
  return 'attack-melee-right';
}

function chooseAnimation(s: PlayerState): CharacterAnimation {
  if (s.posture === 'ragdoll') return 'die'; // limp pose; the limb springs do the rest
  if (s.posture === 'recovering') return 'crouch';
  if (s.grabbedBy !== null) return 'fall'; // dangling and flailing
  if (s.attack) return attackClip(s.attack);
  if (!s.grounded) return s.vy > 0.5 ? 'jump' : 'fall';
  const speed = Math.hypot(s.vx, s.vz);
  if (speed < 0.3) return 'idle'; // arms are posed separately while holding things
  return speed > (PLAYER.walkSpeed + PLAYER.runSpeed) / 2 ? 'sprint' : 'walk';
}

/** One-line summary for the debug overlay. */
export function describeGrab(s: PlayerState): string {
  if (s.grabbing) return `holding ${s.grabbing.kind} ${s.grabbing.id}`;
  if (s.grabbedBy !== null) return `held by player ${s.grabbedBy}`;
  return 'free';
}

export function describeState(s: PlayerState): string {
  const speed = Math.hypot(s.vx, s.vz).toFixed(1);
  const extras = [s.posture !== 'upright' ? s.posture : null, s.attack, s.heldWeapon].filter(Boolean).join(' ');
  return `${s.grounded ? 'ground' : 'air'} v=${speed} y=${s.y.toFixed(2)} ${extras}`.trim();
}
