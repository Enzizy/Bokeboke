import * as THREE from 'three';
import type { CharacterBone } from './CharacterView';

/**
 * - none     : arms come from the animation clip.
 * - holding  : both arms forward (the `holding-both` pose), for carried weapons.
 * - overhead : both arms straight up, for things carried above the head.
 */
export type ArmPose = 'none' | 'holding' | 'overhead';

const ARM_BONES: CharacterBone[] = ['arm-left', 'arm-right'];
/**
 * The Kenney rig binds in a T-pose: each arm bone extends sideways along its own X axis
 * (left arm +X, right arm -X, about 0.28 long) and the clips rotate them down. So the hand
 * sits along X, and "arms up" is a rotation about Z.
 */
const ARM_LENGTH = 0.26;
const Z_AXIS = new THREE.Vector3(0, 0, 1);

function armSign(bone: CharacterBone): number {
  return bone === 'arm-left' ? 1 : -1;
}

/**
 * Overrides the arm bones after the mixer has posed the body, so legs keep walking while the
 * arms hold something. Also reports where the hands are, for parenting held objects.
 */
export class ArmPoser {
  private readonly bones: Readonly<Record<CharacterBone, THREE.Bone>>;
  private readonly holding = new Map<CharacterBone, THREE.Quaternion>();
  private readonly overhead = new Map<CharacterBone, THREE.Quaternion>();
  private readonly tmp = new THREE.Vector3();
  private readonly tmp2 = new THREE.Vector3();

  constructor(bones: Readonly<Record<CharacterBone, THREE.Bone>>, clips: Map<string, THREE.AnimationClip>) {
    this.bones = bones;
    const clip = clips.get('holding-both');
    for (const bone of ARM_BONES) {
      const track = clip?.tracks.find((t) => t.name.split('.')[0] === bone && t.name.endsWith('.quaternion'));
      const q = new THREE.Quaternion();
      if (track && track.values.length >= 4) q.fromArray(track.values, 0);
      this.holding.set(bone, q);
      // Straight up in a slight V - no clip has this, so it is built by hand: swing the
      // sideways-pointing arm towards +Y about Z (opposite directions for the two arms).
      this.overhead.set(bone, new THREE.Quaternion().setFromAxisAngle(Z_AXIS, armSign(bone) * (Math.PI / 2 - 0.2)));
    }
  }

  /** Call after mixer.update(). */
  apply(pose: ArmPose): void {
    if (pose === 'none') return;
    const source = pose === 'holding' ? this.holding : this.overhead;
    for (const bone of ARM_BONES) {
      const q = source.get(bone);
      if (q) this.bones[bone].quaternion.copy(q);
    }
  }

  /** Midpoint of the two hands, in `space`'s local coordinates. Needs up-to-date world matrices. */
  handsMidpoint(space: THREE.Object3D, out: THREE.Vector3): THREE.Vector3 {
    this.bones['arm-left'].localToWorld(this.tmp.set(ARM_LENGTH * armSign('arm-left'), 0, 0));
    this.bones['arm-right'].localToWorld(this.tmp2.set(ARM_LENGTH * armSign('arm-right'), 0, 0));
    out.copy(this.tmp).add(this.tmp2).multiplyScalar(0.5);
    return space.worldToLocal(out);
  }
}
