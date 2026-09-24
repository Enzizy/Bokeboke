import * as THREE from 'three';
import type { HeldWeaponState } from '@shared/weapons/WeaponActivationSystem';
import { weaponDefinition } from '@shared/weapons/weaponCatalog';

const SIZE = 128;

/**
 * A billboard above a player's head that tells everyone what their Chaos Drop weapon is about
 * to do: the countdown to a cast, the arrows left in a bow, the seconds left on a hammer.
 * Drawn on a small canvas; only redrawn when the text changes.
 */
export class WeaponTimerSprite {
  readonly sprite: THREE.Sprite;
  private readonly canvas = document.createElement('canvas');
  private readonly texture: THREE.CanvasTexture;
  private lastText = '';
  private lastColor = '';

  constructor() {
    this.canvas.width = SIZE;
    this.canvas.height = SIZE;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    const material = new THREE.SpriteMaterial({ map: this.texture, transparent: true, depthTest: false });
    this.sprite = new THREE.Sprite(material);
    this.sprite.scale.setScalar(0.8);
    this.sprite.position.set(0, 1.3, 0);
    this.sprite.renderOrder = 10;
    this.sprite.visible = false;
  }

  update(state: HeldWeaponState | null): void {
    if (!state) {
      this.sprite.visible = false;
      return;
    }
    const def = weaponDefinition(state.weaponId);
    const color = `#${def.color.toString(16).padStart(6, '0')}`;
    // What everyone wants to know is how many are left in there.
    const text = `${state.shotsLeft}▸`;
    this.sprite.visible = true;
    // Pulse a little on each new value so the tick is noticeable from across the arena.
    if (text !== this.lastText || color !== this.lastColor) {
      this.draw(text, color);
      this.sprite.scale.setScalar(1.0);
    }
    this.sprite.scale.lerp(new THREE.Vector3(0.8, 0.8, 0.8), 0.15);
  }

  private draw(text: string, color: string): void {
    this.lastText = text;
    this.lastColor = color;
    const ctx = this.canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, SIZE, SIZE);
    ctx.font = '900 84px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 12;
    ctx.strokeStyle = 'rgba(40, 20, 10, 0.8)';
    ctx.strokeText(text, SIZE / 2, SIZE / 2 + 4);
    ctx.fillStyle = color;
    ctx.fillText(text, SIZE / 2, SIZE / 2 + 4);
    this.texture.needsUpdate = true;
  }
}
