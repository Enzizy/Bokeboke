import * as THREE from 'three';

export interface SceneParts {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  sun: THREE.DirectionalLight;
}

/**
 * Renderer + lighting tuned for the Kenney palette: no tone mapping (keeps colours exactly
 * as painted), one soft sun shadow, a sky/ground hemisphere fill. No post-processing.
 */
export function createScene(canvas: HTMLCanvasElement, skyColor: number): SceneParts {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(skyColor);

  const hemi = new THREE.HemisphereLight(0xdfefff, 0x9a7a5a, 1.1);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(0xfff4e0, 2.2);
  sun.position.set(6, 12, 4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.02;
  scene.add(sun);
  scene.add(sun.target);

  return { renderer, scene, sun };
}

/** Fits the sun's orthographic shadow frustum around a square play area centred on the origin. */
export function fitShadowToArea(sun: THREE.DirectionalLight, halfSize: number): void {
  const cam = sun.shadow.camera;
  cam.left = -halfSize;
  cam.right = halfSize;
  cam.top = halfSize;
  cam.bottom = -halfSize;
  cam.near = 1;
  cam.far = 40;
  cam.updateProjectionMatrix();
}
