import * as THREE from 'three';
import type { CharacterBone } from './CharacterView';

interface Spring {
  bone: THREE.Bone;
  /** The pose this bone had before the swing was added, so the swing never compounds. */
  base: THREE.Quaternion;
  /** Swing angles (radians) around the bone's local X and Z, and their velocities. */
  ax: number;
  az: number;
  vx: number;
  vz: number;
  gain: number;
}

const LIMBS: { name: CharacterBone; gain: number }[] = [
  { name: 'arm-left', gain: 1 },
  { name: 'arm-right', gain: 1 },
  { name: 'leg-left', gain: 0.6 },
  { name: 'leg-right', gain: 0.6 },
  { name: 'head', gain: 0.35 },
];

const STIFFNESS = 60;
const DAMPING = 7;
/** Radians of swing per unit of acceleration (m/s²), upright. */
const ACCEL_GAIN = 0.045;
const MAX_SWING_UPRIGHT = 0.5;
const MAX_SWING_RAGDOLL = 1.3;

/**
 * Presentation-only floppiness. Each limb is a damped spring on top of whatever the animation
 * mixer posed; it lags behind the body's acceleration (arms swing when you start, stop or get
 * hit) and, while knocked down, hangs towards gravity so the tumbling body reads as limp.
 * Nothing here touches the simulation.
 */
export class LimbWobble {
  private readonly springs: Spring[] = [];
  private readonly prevVelocity = new THREE.Vector3();
  private readonly tmp = new THREE.Vector3();
  private readonly inverseRoot = new THREE.Quaternion();

  constructor(bones: Readonly<Record<CharacterBone, THREE.Bone>>) {
    for (const { name, gain } of LIMBS) {
      const bone = bones[name];
      this.springs.push({ bone, base: bone.quaternion.clone(), ax: 0, az: 0, vx: 0, vz: 0, gain });
    }
  }

  /**
   * Call before mixer.update(). The swing below is a *relative* rotation, so a bone the current
   * clip leaves alone would keep it and add the next one on top: `idle` has no leg tracks, which
   * used to bend the legs further every frame until the character stood there paddling. Putting
   * the pre-swing pose back first means an untouched bone simply stays where the mixer left it.
   */
  restore(): void {
    for (const s of this.springs) s.bone.quaternion.copy(s.base);
  }

  /** Call after the mixer has updated the pose. `velocity` is the body's world velocity. */
  update(dt: number, root: THREE.Object3D, velocity: THREE.Vector3, ragdoll: boolean): void {
    if (dt <= 0) return;
    // Body acceleration in the character's local frame drives the swing.
    this.inverseRoot.copy(root.quaternion).invert();
    const accel = this.tmp.copy(velocity).sub(this.prevVelocity).divideScalar(dt).applyQuaternion(this.inverseRoot);
    this.prevVelocity.copy(velocity);
    const driveX = THREE.MathUtils.clamp(-accel.z * ACCEL_GAIN, -3, 3);
    const driveZ = THREE.MathUtils.clamp(accel.x * ACCEL_GAIN, -3, 3);

    // While tumbling, limbs also fall towards world "down" expressed in the local frame.
    let hangX = 0;
    let hangZ = 0;
    if (ragdoll) {
      const down = this.tmp.set(0, -1, 0).applyQuaternion(this.inverseRoot);
      hangX = down.z * 1.1;
      hangZ = -down.x * 1.1;
    }
    const maxSwing = ragdoll ? MAX_SWING_RAGDOLL : MAX_SWING_UPRIGHT;

    for (const s of this.springs) {
      const targetX = (driveX + hangX) * s.gain;
      const targetZ = (driveZ + hangZ) * s.gain;
      s.vx += (STIFFNESS * (targetX - s.ax) - DAMPING * s.vx) * dt;
      s.vz += (STIFFNESS * (targetZ - s.az) - DAMPING * s.vz) * dt;
      s.ax = THREE.MathUtils.clamp(s.ax + s.vx * dt, -maxSwing, maxSwing);
      s.az = THREE.MathUtils.clamp(s.az + s.vz * dt, -maxSwing, maxSwing);
      s.base.copy(s.bone.quaternion);
      s.bone.rotateX(s.ax);
      s.bone.rotateZ(s.az);
    }
  }
}
