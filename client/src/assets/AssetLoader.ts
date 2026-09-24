import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import type { ModelRef } from '@shared/types';
import { modelUrl } from './assetPaths';

/** A loaded GLB ready to be instanced. */
export interface LoadedModel {
  scene: THREE.Group;
  animations: THREE.AnimationClip[];
}

/**
 * Loads GLB files once and hands out clones. Kenney's models are tiny, so keeping the source
 * scene in memory and cloning per instance is the simplest thing that works.
 */
export class AssetLoader {
  private readonly loader = new GLTFLoader();
  private readonly cache = new Map<string, Promise<LoadedModel>>();

  load(ref: ModelRef): Promise<LoadedModel> {
    const url = modelUrl(ref);
    let pending = this.cache.get(url);
    if (!pending) {
      pending = this.loader.loadAsync(url).then((gltf) => prepare(gltf));
      this.cache.set(url, pending);
    }
    return pending;
  }

  async loadAll(refs: ModelRef[]): Promise<void> {
    await Promise.all(refs.map((r) => this.load(r)));
  }

  /** Returns a fresh instance. Skinned meshes need SkeletonUtils so bones are duplicated too. */
  instantiate(model: LoadedModel): THREE.Group {
    return cloneSkeleton(model.scene) as THREE.Group;
  }
}

function prepare(gltf: GLTF): LoadedModel {
  gltf.scene.traverse((obj) => {
    if (!(obj as THREE.Mesh).isMesh) return;
    const mesh = obj as THREE.Mesh;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    // Kenney colormaps are small palettes: force nearest filtering so edges stay crisp (the
    // dungeon pack asks for trilinear, which smears them). Larger atlases (KayKit, 1024px)
    // are painted for linear filtering and keep whatever the file requests.
    const material = mesh.material as THREE.MeshStandardMaterial;
    const map = material.map;
    if (map && map.image && (map.image as { width: number }).width <= 512) {
      map.magFilter = THREE.NearestFilter;
      map.minFilter = THREE.NearestMipmapNearestFilter;
      map.needsUpdate = true;
    }
  });
  return { scene: gltf.scene, animations: gltf.animations };
}
