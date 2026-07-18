import * as THREE from 'three';
import type { GraphicsQuality } from '../core/settings';
import type { PropPlacement } from '../game/stage';

const TIER_RANK: Record<GraphicsQuality, number> = { low: 0, medium: 1, high: 2 };

export interface AaaAssetInstance {
  readonly position: readonly [number, number, number];
  readonly rotation?: readonly [number, number, number];
  readonly scale?: number | readonly [number, number, number];
}

export interface AaaAssetLod {
  readonly url: string;
  readonly distance: number;
}

export interface AaaAssetEntry {
  readonly id: string;
  readonly url: string;
  readonly stages?: readonly string[];
  readonly propKind?: string;
  readonly instances?: readonly AaaAssetInstance[];
  readonly minTier?: GraphicsQuality;
  readonly yOffset?: number;
  readonly scale?: number;
  readonly rotationOffset?: number;
  readonly maxInstances?: number;
  readonly castShadow?: boolean;
  readonly receiveShadow?: boolean;
  readonly replacesDistantMatte?: boolean;
  readonly replacesProceduralProps?: boolean;
  readonly lods?: readonly AaaAssetLod[];
}

export interface AaaAssetManifest {
  readonly version: 1;
  readonly ktx2TranscoderPath?: string;
  readonly dracoDecoderPath?: string;
  readonly assets: readonly AaaAssetEntry[];
}

export interface AaaAssetLoadOptions {
  readonly stageId: string;
  readonly tier: GraphicsQuality;
  readonly propPlacements: readonly PropPlacement[];
  readonly manifestUrl?: string;
}

export interface AaaAssetLoadReport {
  readonly requested: number;
  readonly loaded: number;
  readonly failed: number;
  readonly errors: readonly string[];
}

function isFiniteTuple(value: unknown, length: number): value is readonly number[] {
  return (
    Array.isArray(value) &&
    value.length === length &&
    value.every((part) => typeof part === 'number' && Number.isFinite(part))
  );
}

function isSafeLocalPath(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    !value.startsWith('/') &&
    !value.includes('..') &&
    !/^[a-z][a-z\d+.-]*:/i.test(value)
  );
}

function readTier(value: unknown): GraphicsQuality | undefined {
  return value === 'low' || value === 'medium' || value === 'high' ? value : undefined;
}

/** ネットワーク入力を信用せず、ロード前にmanifestを狭いスキーマへ正規化する。 */
export function parseAaaAssetManifest(value: unknown): AaaAssetManifest {
  if (!value || typeof value !== 'object') throw new Error('AAA asset manifest must be an object');
  const raw = value as Record<string, unknown>;
  if (raw.version !== 1) throw new Error('unsupported AAA asset manifest version');
  if (!Array.isArray(raw.assets)) throw new Error('AAA asset manifest.assets must be an array');
  const assets: AaaAssetEntry[] = raw.assets.map((candidate, index) => {
    if (!candidate || typeof candidate !== 'object') throw new Error(`asset[${index}] must be an object`);
    const item = candidate as Record<string, unknown>;
    if (typeof item.id !== 'string' || item.id.length === 0) throw new Error(`asset[${index}].id is invalid`);
    if (!isSafeLocalPath(item.url)) throw new Error(`asset[${index}].url must be a safe relative path`);
    const minTier = item.minTier === undefined ? undefined : readTier(item.minTier);
    if (item.minTier !== undefined && !minTier) throw new Error(`asset[${index}].minTier is invalid`);
    const stages = item.stages === undefined
      ? undefined
      : Array.isArray(item.stages) && item.stages.every((part) => typeof part === 'string')
        ? item.stages as string[]
        : null;
    if (stages === null) throw new Error(`asset[${index}].stages is invalid`);
    const instances = item.instances === undefined
      ? undefined
      : Array.isArray(item.instances)
        ? item.instances.map((entry, instanceIndex): AaaAssetInstance => {
            if (!entry || typeof entry !== 'object') {
              throw new Error(`asset[${index}].instances[${instanceIndex}] is invalid`);
            }
            const instance = entry as Record<string, unknown>;
            if (!isFiniteTuple(instance.position, 3)) {
              throw new Error(`asset[${index}].instances[${instanceIndex}].position is invalid`);
            }
            if (instance.rotation !== undefined && !isFiniteTuple(instance.rotation, 3)) {
              throw new Error(`asset[${index}].instances[${instanceIndex}].rotation is invalid`);
            }
            const scale = instance.scale;
            if (
              scale !== undefined &&
              !(typeof scale === 'number' && Number.isFinite(scale) && scale > 0) &&
              !isFiniteTuple(scale, 3)
            ) {
              throw new Error(`asset[${index}].instances[${instanceIndex}].scale is invalid`);
            }
            return {
              position: instance.position as unknown as readonly [number, number, number],
              rotation: instance.rotation as readonly [number, number, number] | undefined,
              scale: scale as number | readonly [number, number, number] | undefined,
            };
          })
        : null;
    if (instances === null) throw new Error(`asset[${index}].instances is invalid`);
    const lods = item.lods === undefined
      ? undefined
      : Array.isArray(item.lods)
        ? item.lods.map((entry, lodIndex): AaaAssetLod => {
            if (!entry || typeof entry !== 'object') throw new Error(`asset[${index}].lods[${lodIndex}] is invalid`);
            const lod = entry as Record<string, unknown>;
            if (!isSafeLocalPath(lod.url) || typeof lod.distance !== 'number' || !Number.isFinite(lod.distance) || lod.distance <= 0) {
              throw new Error(`asset[${index}].lods[${lodIndex}] is invalid`);
            }
            return { url: lod.url, distance: lod.distance };
          })
        : null;
    if (lods === null) throw new Error(`asset[${index}].lods is invalid`);
    if (item.replacesDistantMatte !== undefined && typeof item.replacesDistantMatte !== 'boolean') {
      throw new Error(`asset[${index}].replacesDistantMatte is invalid`);
    }
    if (item.replacesProceduralProps !== undefined && typeof item.replacesProceduralProps !== 'boolean') {
      throw new Error(`asset[${index}].replacesProceduralProps is invalid`);
    }
    const positiveNumber = (field: string): number | undefined => {
      const fieldValue = item[field];
      if (fieldValue === undefined) return undefined;
      if (typeof fieldValue !== 'number' || !Number.isFinite(fieldValue) || fieldValue <= 0) {
        throw new Error(`asset[${index}].${field} is invalid`);
      }
      return fieldValue;
    };
    const finiteNumber = (field: string): number | undefined => {
      const fieldValue = item[field];
      if (fieldValue === undefined) return undefined;
      if (typeof fieldValue !== 'number' || !Number.isFinite(fieldValue)) {
        throw new Error(`asset[${index}].${field} is invalid`);
      }
      return fieldValue;
    };
    return {
      id: item.id,
      url: item.url,
      stages,
      propKind: typeof item.propKind === 'string' ? item.propKind : undefined,
      instances,
      minTier,
      yOffset: finiteNumber('yOffset'),
      scale: positiveNumber('scale'),
      rotationOffset: finiteNumber('rotationOffset'),
      maxInstances: positiveNumber('maxInstances'),
      castShadow: typeof item.castShadow === 'boolean' ? item.castShadow : undefined,
      receiveShadow: typeof item.receiveShadow === 'boolean' ? item.receiveShadow : undefined,
      replacesDistantMatte: item.replacesDistantMatte as boolean | undefined,
      replacesProceduralProps: item.replacesProceduralProps as boolean | undefined,
      lods,
    };
  });
  const optionalPath = (field: string): string | undefined => {
    const path = raw[field];
    if (path === undefined) return undefined;
    if (!isSafeLocalPath(path)) throw new Error(`${field} must be a safe relative path`);
    return path.endsWith('/') ? path : `${path}/`;
  };
  return {
    version: 1,
    ktx2TranscoderPath: optionalPath('ktx2TranscoderPath'),
    dracoDecoderPath: optionalPath('dracoDecoderPath'),
    assets,
  };
}

function disposeObject(root: THREE.Object3D): void {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  root.traverse((node) => {
    if (node instanceof THREE.SkinnedMesh) node.skeleton.dispose();
    if (!(node instanceof THREE.Mesh)) return;
    geometries.add(node.geometry);
    const source = Array.isArray(node.material) ? node.material : [node.material];
    for (const material of source) materials.add(material);
  });
  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) material.dispose();
}

export function tuneImportedStageMaterial(node: THREE.Mesh): void {
  const kind = typeof node.userData.hibanaMaterial === 'string'
    ? node.userData.hibanaMaterial
    : undefined;
  if (!kind) return;
  const materials = Array.isArray(node.material) ? node.material : [node.material];
  for (const material of materials) {
    if (!(material instanceof THREE.MeshStandardMaterial)) continue;
    if (kind === 'water') {
      // 軽量な実時間水面: scene.environment のIBLを強く拾う。画面全体を
      // 再レンダーする平面反射を使わないため、大面積でも追加パスは発生しない。
      material.roughness = 0.072;
      material.metalness = 0.34;
      material.envMapIntensity = 1.9;
      material.transparent = true;
      material.opacity = 0.72;
      material.dithering = true;
      material.depthWrite = false;
      material.side = THREE.DoubleSide;
      if (material.normalMap) {
        material.normalScale.set(0.52, 0.52);
        material.normalMap.wrapS = THREE.RepeatWrapping;
        material.normalMap.wrapT = THREE.RepeatWrapping;
        material.normalMap.repeat.set(1.7, 1.7);
        material.normalMap.anisotropy = 4;
        material.normalMap.needsUpdate = true;
      }
      if (material.roughnessMap) {
        material.roughnessMap.wrapS = THREE.RepeatWrapping;
        material.roughnessMap.wrapT = THREE.RepeatWrapping;
        material.roughnessMap.repeat.set(1.7, 1.7);
        material.roughnessMap.needsUpdate = true;
      }
      material.needsUpdate = true;
      node.castShadow = false;
      node.receiveShadow = true;
      node.renderOrder = 1;
    } else if (kind === 'glass') {
      material.roughness = Math.min(material.roughness, 0.18);
      material.metalness = Math.max(material.metalness, 0.24);
      material.envMapIntensity = Math.max(material.envMapIntensity, 0.92);
      material.needsUpdate = true;
    }
  }
}

/**
 * 高密度glTFを非同期で追加する本番パイプライン。
 * - manifest/個別asset失敗は既存プロシージャル景観へfail-open
 * - Meshopt、任意KTX2/Draco、SkinnedMesh clone、LODをサポート
 * - 表示前compileAsyncで初見シェーダヒッチを防止
 */
export class AaaStageAssetPipeline {
  readonly root = new THREE.Group();
  private readonly controller = new AbortController();
  private disposed = false;
  private distantWorldReplacementLoaded = false;
  private proceduralPropReplacementLoaded = false;

  get hasDistantWorldReplacement(): boolean {
    return this.distantWorldReplacementLoaded;
  }

  get hasProceduralPropReplacement(): boolean {
    return this.proceduralPropReplacementLoaded;
  }

  constructor(
    private readonly scene: THREE.Scene,
    private readonly renderer: THREE.WebGLRenderer,
    private readonly camera: THREE.Camera,
  ) {
    this.root.name = 'aaa:external-stage-assets';
    this.root.visible = false;
    this.scene.add(this.root);
  }

  async load(options: AaaAssetLoadOptions): Promise<AaaAssetLoadReport> {
    const errors: string[] = [];
    const empty = (): AaaAssetLoadReport => ({ requested: 0, loaded: 0, failed: 0, errors });
    if (this.disposed || options.tier === 'low') return empty();
    const base = import.meta.env.BASE_URL;
    const manifestUrl = options.manifestUrl ?? `${base}assets/aaa/manifest.json`;
    let manifest: AaaAssetManifest;
    try {
      const response = await fetch(manifestUrl, { signal: this.controller.signal, cache: 'force-cache' });
      if (!response.ok) throw new Error(`manifest HTTP ${response.status}`);
      manifest = parseAaaAssetManifest(await response.json());
    } catch (error) {
      if (!this.disposed) errors.push(error instanceof Error ? error.message : String(error));
      return { requested: 0, loaded: 0, failed: errors.length, errors };
    }
    const entries = manifest.assets.filter((entry) => {
      if (entry.stages && !entry.stages.includes(options.stageId)) return false;
      return TIER_RANK[options.tier] >= TIER_RANK[entry.minTier ?? 'medium'];
    });
    if (entries.length === 0 || this.disposed) return empty();

    // glTF/Draco/KTX2/Meshoptはassetが実在する時だけ別chunkから読む。小さな型facadeを
    // 挟む理由は gltf-runtime.js 冒頭参照(実体はすべてThree公式addon)。
    const { createGltfRuntime } = await import('./gltf-runtime.js');
    const runtime = createGltfRuntime(this.renderer, base, manifest);
    const cache = new Map<string, Promise<THREE.Object3D>>();
    const loadModel = (url: string): Promise<THREE.Object3D> => {
      let pending = cache.get(url);
      if (!pending) {
        pending = runtime.loadScene(`${base}assets/aaa/${url}`);
        cache.set(url, pending);
      }
      return pending;
    };
    let requested = 0;
    let loaded = 0;
    let failed = 0;
    for (const entry of entries) {
      const generated = entry.propKind
        ? options.propPlacements
            .filter((placement) => placement.kind === entry.propKind)
            .slice(0, entry.maxInstances ?? Number.POSITIVE_INFINITY)
            .map((placement): AaaAssetInstance => ({
              position: [placement.cx, entry.yOffset ?? 0, placement.cz],
              rotation: [0, placement.rotRad + (entry.rotationOffset ?? 0), 0],
              scale: placement.scaleJitter * (entry.scale ?? 1),
            }))
        : [...(entry.instances ?? [])];
      requested += generated.length;
      try {
        const source = await loadModel(entry.url);
        const lodSources = entry.lods
          ? await Promise.all(entry.lods.map(async (lod) => ({ source: await loadModel(lod.url), distance: lod.distance })))
          : [];
        for (const instance of generated) {
          if (this.disposed) break;
          const holder: THREE.Object3D = lodSources.length > 0 ? new THREE.LOD() : new THREE.Group();
          const primary = runtime.clone(source);
          if (holder instanceof THREE.LOD) {
            holder.addLevel(primary, 0);
            for (const lod of lodSources) holder.addLevel(runtime.clone(lod.source), lod.distance);
          } else {
            holder.add(primary);
          }
          holder.name = `aaa:${entry.id}`;
          holder.position.fromArray(instance.position);
          if (instance.rotation) {
            holder.rotation.set(instance.rotation[0], instance.rotation[1], instance.rotation[2]);
          }
          const scale = instance.scale ?? entry.scale ?? 1;
          if (typeof scale === 'number') holder.scale.setScalar(scale);
          else holder.scale.fromArray(scale);
          holder.traverse((node) => {
            if (!(node instanceof THREE.Mesh)) return;
            node.castShadow = entry.castShadow ?? true;
            node.receiveShadow = entry.receiveShadow ?? true;
            tuneImportedStageMaterial(node);
          });
          this.root.add(holder);
          loaded += 1;
          if (entry.replacesDistantMatte) this.distantWorldReplacementLoaded = true;
          if (entry.replacesProceduralProps) this.proceduralPropReplacementLoaded = true;
        }
      } catch (error) {
        failed += generated.length;
        errors.push(`${entry.id}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    if (!this.disposed && loaded > 0) {
      try {
        await this.renderer.compileAsync(this.scene, this.camera);
      } catch {
        this.renderer.compile(this.scene, this.camera);
      }
      if (!this.disposed) this.root.visible = true;
    }
    runtime.dispose();
    return { requested, loaded, failed, errors };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.distantWorldReplacementLoaded = false;
    this.proceduralPropReplacementLoaded = false;
    this.controller.abort();
    this.scene.remove(this.root);
    disposeObject(this.root);
    this.root.clear();
  }
}
