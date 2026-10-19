import { LoadingManager, Mesh, MeshLambertMaterial, MeshPhongMaterial, MeshStandardMaterial, Texture } from 'three';
import type { BufferGeometry, Group, Material } from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';

/** Adapt FBX to the shared viewer without storing a second file or changing the saved path. */
export async function prepareFbxModel(src: string, signal: AbortSignal, onProgress: (value: number) => void): Promise<Blob> {
  const response = await fetch(src, { signal, cache: 'no-cache' });
  if (!response.ok) throw new Error('The FBX file could not be downloaded. Try again.');
  const data = await response.arrayBuffer();
  signal.throwIfAborted();
  onProgress(25);

  let object: Group | undefined;
  const textures = new Set<Texture>();
  const geometries = new Set<BufferGeometry>();
  const materials = new Set<Material>();
  const embeddedUrls = new Set<string>();
  const missingTextures: string[] = [];
  const manager = new LoadingManager();
  manager.setURLModifier(url => {
    if (url.startsWith('blob:')) embeddedUrls.add(url);
    return url;
  });
  manager.onError = url => { missingTextures.push(url); };
  let finished: () => void = () => {};
  const textureLoad = new Promise<void>((resolve, reject) => {
    const abort = () => reject(signal.reason);
    finished = () => { signal.removeEventListener('abort', abort); resolve(); };
    manager.onLoad = finished;
    signal.addEventListener('abort', abort, { once: true });
  });
  // Prevent an unhandled abort rejection while the synchronous FBX parser is running.
  void textureLoad.catch(() => {});
  manager.itemStart('fbx-parse');
  try {
    const directory = new URL('.', new URL(src, window.location.href)).href;
    object = new FBXLoader(manager).parse(data, directory);
    object.traverse(node => {
      if (!(node instanceof Mesh)) return;
      geometries.add(node.geometry);
      for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
        materials.add(material);
        for (const value of Object.values(material)) if (value instanceof Texture) textures.add(value);
      }
    });
    manager.itemEnd('fbx-parse');
    await textureLoad;
    signal.throwIfAborted();
    if (missingTextures.length) throw new Error('FBX textures could not be loaded. Place the referenced texture files beside the FBX file, or embed them when exporting.');
    onProgress(55);

    // FBX's Phong/Lambert materials need PBR equivalents for consistent studio lighting.
    const converted = new Map<Material, Material>();
    const convertMaterial = (source: Material): Material => {
      if (converted.has(source)) return converted.get(source)!;
      if (!(source instanceof MeshPhongMaterial || source instanceof MeshLambertMaterial)) return source;
      const material = new MeshStandardMaterial({
        name: source.name, color: source.color, map: source.map,
        emissive: source.emissive, emissiveMap: source.emissiveMap, emissiveIntensity: source.emissiveIntensity,
        alphaMap: source.alphaMap, aoMap: source.aoMap, aoMapIntensity: source.aoMapIntensity,
        opacity: source.opacity, transparent: source.transparent, alphaTest: source.alphaTest,
        side: source.side, metalness: 0,
        roughness: source instanceof MeshPhongMaterial ? Math.max(0.15, Math.sqrt(2 / (source.shininess + 2))) : 1,
      });
      if (source instanceof MeshPhongMaterial) {
        material.normalMap = source.normalMap;
        material.normalScale.copy(source.normalScale);
        material.bumpMap = source.bumpMap;
        material.bumpScale = source.bumpScale;
      }
      converted.set(source, material);
      materials.add(material);
      return material;
    };
    object.traverse(node => {
      if (node instanceof Mesh) node.material = Array.isArray(node.material) ? node.material.map(convertMaterial) : convertMaterial(node.material);
    });
    object.updateMatrixWorld(true);
    const binary = await new GLTFExporter().parseAsync(object, { binary: true, animations: object.animations, trs: true });
    signal.throwIfAborted();
    if (!(binary instanceof ArrayBuffer)) throw new Error('The FBX model could not be prepared.');
    onProgress(75);
    return new Blob([binary], { type: 'model/gltf-binary' });
  } finally {
    finished();
    geometries.forEach(geometry => geometry.dispose());
    materials.forEach(material => material.dispose());
    textures.forEach(texture => texture.dispose());
    embeddedUrls.forEach(url => URL.revokeObjectURL(url));
  }
}
