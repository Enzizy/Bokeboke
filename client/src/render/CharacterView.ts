import * as THREE from 'three';
import type { ModelRef } from '@shared/types';
import { PLAYER } from '@shared/sim/tuning';
import type { AssetLoader } from '../assets/AssetLoader';
import { LimbWobble } from './LimbWobble';
import { ArmPoser, type ArmPose } from './ArmPose';

/** The seven bones every Kenney Mini character has. Physics bodies will map onto these. */
export const CHARACTER_BONES = ['root', 'leg-left', 'leg-right', 'torso', 'arm-left', 'arm-right', 'head'] as const;
export type CharacterBone = (typeof CHARACTER_BONES)[number];

/** Animation clips shipped with every Mini character that the game uses. */
export type CharacterAnimation =
  | 'idle'
  | 'walk'
  | 'sprint'
  | 'jump'
  | 'fall'
  | 'crouch'
  | 'die'
  | 'pick-up'
  | 'holding-both'
  | 'holding-both-shoot'
  | 'attack-melee-left'
  | 'attack-melee-right'
  | 'attack-kick-left'
  | 'attack-kick-right'
  | 'emote-yes'
  | 'emote-no';

/**
 * The visual half of a player: a skinned Kenney character with its animation mixer.
 * It knows nothing about physics; something else moves `root` and (later) drives the bones.
 */
export class CharacterView {
  readonly root = new THREE.Group();
  readonly bones: Readonly<Record<CharacterBone, THREE.Bone>>;
  private readonly mixer: THREE.AnimationMixer;
  private readonly clips = new Map<string, THREE.AnimationClip>();
  private current: THREE.AnimationAction | null = null;
  private readonly wobble: LimbWobble;
  private readonly arms: ArmPoser;
  private armPose: ArmPose = 'none';
  /** Follows the midpoint of the hands; held objects are parented here (root-space rotation). */
  readonly handAnchor = new THREE.Group();
  private readonly targetQuaternion = new THREE.Quaternion();
  private readonly velocity = new THREE.Vector3();
  private readonly yawQuaternion = new THREE.Quaternion();
  private readonly bodyQuaternion = new THREE.Quaternion();
  private readonly offset = new THREE.Vector3();
  private tumbling = false;

  private constructor(model: THREE.Group, animations: THREE.AnimationClip[]) {
    this.root.add(model);
    this.mixer = new THREE.AnimationMixer(model);
    for (const clip of animations) this.clips.set(clip.name, clip);
    this.bones = findBones(model);
    this.wobble = new LimbWobble(this.bones);
    this.arms = new ArmPoser(this.bones, this.clips);
    this.handAnchor.name = 'hands';
    this.root.add(this.handAnchor);
  }

  static async create(loader: AssetLoader, ref: ModelRef): Promise<CharacterView> {
    const loaded = await loader.load(ref);
    const instance = loader.instantiate(loaded);
    instance.name = ref.model;
    return new CharacterView(instance, loaded.animations);
  }

  /**
   * Cross-fades to a clip. Repeats by default; one-shot clips (attacks, jump) clamp at the end.
   * `restart` replays a clip that is already current (a second punch); `timeScale` below 1 drags
   * a clip out, which is how a heavy weapon swing reads as heavy.
   */
  play(name: CharacterAnimation, options: { fade?: number; once?: boolean; restart?: boolean; timeScale?: number } = {}): void {
    const clip = this.clips.get(name);
    if (!clip) {
      console.warn(`CharacterView: no animation "${name}"`);
      return;
    }
    const fade = options.fade ?? 0.12;
    const next = this.mixer.clipAction(clip);
    if (this.current === next && !options.restart) return;
    next.reset();
    next.setEffectiveTimeScale(options.timeScale ?? 1);
    next.setLoop(options.once ? THREE.LoopOnce : THREE.LoopRepeat, Infinity);
    next.clampWhenFinished = options.once ?? false;
    if (this.current && this.current !== next) next.crossFadeFrom(this.current, fade, false);
    next.play();
    this.current = next;
  }

  /**
   * Places the character from sim state. `y` is the feet height while upright; when the body
   * quaternion isn't identity (tumbling) the model pivots about the capsule centre instead.
   */
  setPose(x: number, y: number, z: number, yaw: number, q?: { x: number; y: number; z: number; w: number }, tumbling = false): void {
    this.tumbling = tumbling;
    this.yawQuaternion.setFromAxisAngle(UP, yaw);
    if (q) this.bodyQuaternion.set(q.x, q.y, q.z, q.w);
    else this.bodyQuaternion.identity();
    this.targetQuaternion.copy(this.bodyQuaternion).multiply(this.yawQuaternion);
    // Model origin is at the feet; the physics body pivots at its centre.
    const h = PLAYER.capsuleHalfHeight + PLAYER.capsuleRadius;
    this.offset.set(0, -h, 0).applyQuaternion(this.bodyQuaternion);
    this.root.position.set(x + this.offset.x, y + h + this.offset.y, z + this.offset.z);
  }

  setVelocity(vx: number, vy: number, vz: number): void {
    this.velocity.set(vx, vy, vz);
  }

  setArmPose(pose: ArmPose): void {
    this.armPose = pose;
  }

  update(dt: number): void {
    // Smooth orientation so standing back up doesn't snap.
    this.root.quaternion.slerp(this.targetQuaternion, 1 - Math.exp(-dt * 14));
    this.wobble.restore(); // hand the mixer a clean pose: the swing is relative and would compound
    this.mixer.update(dt);
    this.arms.apply(this.armPose);
    this.wobble.update(dt, this.root, this.velocity, this.tumbling);
    this.root.updateWorldMatrix(true, true);
    this.arms.handsMidpoint(this.root, this.handAnchor.position);
  }
}

const UP = new THREE.Vector3(0, 1, 0);

function findBones(model: THREE.Object3D): Record<CharacterBone, THREE.Bone> {
  const found: Partial<Record<CharacterBone, THREE.Bone>> = {};
  model.traverse((obj) => {
    if ((obj as THREE.Bone).isBone && CHARACTER_BONES.includes(obj.name as CharacterBone)) {
      found[obj.name as CharacterBone] = obj as THREE.Bone;
    }
  });
  for (const name of CHARACTER_BONES) {
    if (!found[name]) throw new Error(`Character is missing bone "${name}"`);
  }
  return found as Record<CharacterBone, THREE.Bone>;
}
