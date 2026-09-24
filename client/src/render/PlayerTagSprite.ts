import * as THREE from 'three';

const W = 192;
const H = 76;
/** Where the bars sit inside the canvas; the name goes above them. */
const BAR_TOP = 38;
const BAR_HEIGHT = 22;
/** The stamina strip lives under the health bar, and only when there is something to say. */
const STAMINA_TOP = BAR_TOP + BAR_HEIGHT + 4;
const STAMINA_HEIGHT = 8;
const STAMINA_COLOR = '#ffe066';
const WINDED_COLOR = '#e8834a';
/** Seconds the bar stays white after taking a hit. */
const FLASH_TIME = 0.14;

/**
 * The tag floating over a player: their name, and a chunky health bar in their score-strip
 * colour. With a room full of near-identical characters the name is the only way to know who
 * you are chasing. Redrawn only when something actually changes.
 */
export class PlayerTagSprite {
  readonly sprite: THREE.Sprite;
  private readonly canvas = document.createElement('canvas');
  private readonly texture: THREE.CanvasTexture;
  private readonly color: string;
  private name = '';
  private drawnName = '\u0000'; // nothing drawn yet
  private drawnRatio = -1;
  private drawnFlash = false;
  private drawnStamina = -1;
  private drawnWinded = false;
  private stamina = 1;
  private winded = false;
  private flash = 0;

  constructor(color: string) {
    this.color = color;
    this.canvas.width = W;
    this.canvas.height = H;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    const material = new THREE.SpriteMaterial({ map: this.texture, transparent: true, depthTest: false });
    this.sprite = new THREE.Sprite(material);
    this.sprite.scale.set(1.08, 0.43, 1);
    this.sprite.position.set(0, 1.09, 0); // above the head, below the weapon counter
    this.sprite.renderOrder = 9;
  }

  setName(name: string): void {
    this.name = name;
  }

  /** Sprint fuel, 0..1, and whether they have run themselves out of breath. */
  setStamina(stamina: number, winded: boolean): void {
    this.stamina = stamina;
    this.winded = winded;
  }

  /** `alive` hides the tag for players who are out of the round. */
  update(hp: number, maxHp: number, alive: boolean, dt: number): void {
    this.sprite.visible = alive;
    if (!alive) return;
    const ratio = maxHp > 0 ? THREE.MathUtils.clamp(hp / maxHp, 0, 1) : 1;
    if (ratio < this.drawnRatio) this.flash = FLASH_TIME; // took a hit just now
    this.flash = Math.max(0, this.flash - dt);
    const flashing = this.flash > 0;
    const changed = Math.abs(ratio - this.drawnRatio) > 0.001
      || Math.abs(this.stamina - this.drawnStamina) > 0.01
      || this.winded !== this.drawnWinded
      || flashing !== this.drawnFlash
      || this.name !== this.drawnName;
    if (changed) this.draw(ratio, flashing);
  }

  private draw(ratio: number, flashing: boolean): void {
    this.drawnRatio = ratio;
    this.drawnFlash = flashing;
    this.drawnName = this.name;
    this.drawnStamina = this.stamina;
    this.drawnWinded = this.winded;
    const ctx = this.canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, W, H);

    if (this.name) {
      ctx.font = '800 30px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = 6;
      ctx.strokeStyle = 'rgba(26, 16, 11, 0.9)'; // outline, so it reads against any scenery
      ctx.strokeText(this.name, W / 2, 19);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(this.name, W / 2, 19);
    }

    const left = 24;
    const width = W - left * 2;
    ctx.beginPath();
    ctx.roundRect(left, BAR_TOP, width, BAR_HEIGHT, 9);
    ctx.fillStyle = 'rgba(38, 24, 18, 0.85)';
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(26, 16, 11, 0.95)';
    ctx.stroke();

    const fill = (width - 10) * ratio; // empty is a real state: out cold, mid-tumble
    if (fill > 0) {
      ctx.beginPath();
      ctx.roundRect(left + 5, BAR_TOP + 5, fill, BAR_HEIGHT - 10, 5);
      ctx.fillStyle = flashing ? '#ffffff' : this.color;
      ctx.fill();
    }

    // Stamina only appears once it is spent: a full bar would just be clutter over every head,
    // but a short one tells everybody that this player cannot run away right now.
    if (this.stamina < 0.995) {
      ctx.beginPath();
      ctx.roundRect(left + 4, STAMINA_TOP, width - 8, STAMINA_HEIGHT, 4);
      ctx.fillStyle = 'rgba(38, 24, 18, 0.8)';
      ctx.fill();
      const spent = (width - 12) * THREE.MathUtils.clamp(this.stamina, 0, 1);
      if (spent > 0) {
        ctx.beginPath();
        ctx.roundRect(left + 6, STAMINA_TOP + 2, spent, STAMINA_HEIGHT - 4, 2);
        ctx.fillStyle = this.winded ? WINDED_COLOR : STAMINA_COLOR;
        ctx.fill();
      }
    }
    this.texture.needsUpdate = true;
  }
}
