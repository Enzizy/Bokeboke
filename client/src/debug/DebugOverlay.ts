import type * as THREE from 'three';

/** Values other systems report into the overlay. Unset fields show as "-". */
export interface DebugStats {
  map?: string;
  players?: number;
  physicsBodies?: number;
  pingMs?: number;
  playerState?: string;
  grabState?: string;
  crates?: string;
  round?: string;
}

/**
 * Development-only HUD. Hidden unless the page is opened with ?debug=1 or the ` key is pressed.
 * Costs nothing while hidden: update() returns before touching the DOM.
 */
export class DebugOverlay {
  readonly stats: DebugStats = {};
  private readonly el: HTMLElement;
  private visible = false;
  private frames = 0;
  private accum = 0.25; // draw on the first frame
  private fps = 0;

  constructor(el: HTMLElement) {
    this.el = el;
    if (new URLSearchParams(location.search).get('debug') === '1') this.setVisible(true);
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Backquote') this.setVisible(!this.visible);
    });
  }

  get enabled(): boolean {
    return this.visible;
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    this.el.hidden = !visible;
  }

  update(dt: number, renderer: THREE.WebGLRenderer): void {
    if (!this.visible) return;
    this.frames++;
    this.accum += dt;
    if (this.accum < 0.25) return;
    this.fps = this.frames / this.accum;
    this.frames = 0;
    this.accum = 0;

    const r = renderer.info.render;
    const s = this.stats;
    this.el.textContent = [
      `fps      ${this.fps.toFixed(0)}`,
      `draws    ${r.calls}   tris ${r.triangles}`,
      `map      ${s.map ?? '-'}`,
      `players  ${s.players ?? '-'}`,
      `bodies   ${s.physicsBodies ?? '-'}`,
      `ping     ${s.pingMs !== undefined ? `${s.pingMs} ms` : '-'}`,
      `state    ${s.playerState ?? '-'}`,
      `grab     ${s.grabState ?? '-'}`,
      `crates   ${s.crates ?? '-'}`,
      `round    ${s.round ?? '-'}`,
    ].join('\n');
  }
}
