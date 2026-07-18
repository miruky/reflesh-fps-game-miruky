import * as THREE from 'three';
import type { Sky } from 'three/addons/objects/Sky.js';
import type { GraphicsQuality } from '../core/settings';
import type { MoodId, StagePalette } from '../game/stage';

interface CloudProfile {
  readonly coverage: number;
  readonly opacity: number;
  readonly scale: number;
  readonly speed: number;
  readonly shadowMul: number;
  readonly lightMul: number;
}

const CLOUD_PROFILES: Readonly<Record<MoodId, CloudProfile>> = {
  day: { coverage: 0.38, opacity: 0.42, scale: 2.1, speed: 0.004, shadowMul: 0.12, lightMul: 0.44 },
  dusk: {
    coverage: 0.46,
    opacity: 0.48,
    scale: 1.9,
    speed: 0.005,
    shadowMul: 0.14,
    lightMul: 0.52,
  },
  night: {
    coverage: 0.36,
    opacity: 0.32,
    scale: 1.9,
    speed: 0.003,
    shadowMul: 0.1,
    lightMul: 0.28,
  },
  overcast: {
    coverage: 0.62,
    opacity: 0.54,
    scale: 1.75,
    speed: 0.004,
    shadowMul: 0.12,
    lightMul: 0.36,
  },
  snow: {
    coverage: 0.6,
    opacity: 0.46,
    scale: 1.45,
    speed: 0.003,
    shadowMul: 0.18,
    lightMul: 0.48,
  },
};

export interface CinematicSkyOptions {
  readonly palette: StagePalette;
  readonly mood: MoodId;
  readonly tier: GraphicsQuality;
  readonly reduceMotion: boolean;
  readonly skyScale: number;
  readonly skyClamp: number;
}

export interface CinematicSkyHandle {
  readonly uniforms: {
    readonly skyScale: { value: number };
    readonly skyClamp: { value: number };
    readonly cloudTime: { value: number };
    readonly cloudDetail: { value: number };
  };
  update(dt: number): void;
  setDetailScale(scale: number): void;
  dispose(): void;
}

function hash2(x: number, y: number, seed: number): number {
  let h = (Math.imul(x, 0x1f123bb5) ^ Math.imul(y, 0x5f356495) ^ seed) >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d) >>> 0;
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b) >>> 0;
  h ^= h >>> 16;
  return (h >>> 0) / 0xffffffff;
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

function periodicValueNoise(
  x: number,
  y: number,
  cellsX: number,
  cellsY: number,
  seed: number,
): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = smooth(x - ix);
  const fy = smooth(y - iy);
  const wrapX = (v: number) => ((v % cellsX) + cellsX) % cellsX;
  const wrapY = (v: number) => ((v % cellsY) + cellsY) % cellsY;
  const a = hash2(wrapX(ix), wrapY(iy), seed);
  const b = hash2(wrapX(ix + 1), wrapY(iy), seed);
  const c = hash2(wrapX(ix), wrapY(iy + 1), seed);
  const d = hash2(wrapX(ix + 1), wrapY(iy + 1), seed);
  const ab = THREE.MathUtils.lerp(a, b, fx);
  const cd = THREE.MathUtils.lerp(c, d, fx);
  return THREE.MathUtils.lerp(ab, cd, fy);
}

/** RGBA8の小さな周期雲マップ。外部アセットを持たず、同じseedなら常に同じ配列を返す。 */
export function createCinematicCloudData(
  width = 256,
  height = 128,
  seed = 0x6a09e667,
): Uint8Array<ArrayBuffer> {
  const data = new Uint8Array(new ArrayBuffer(width * height * 4));
  for (let py = 0; py < height; py += 1) {
    for (let px = 0; px < width; px += 1) {
      const u = px / width;
      const v = py / height;
      let sum = 0;
      let total = 0;
      const octaves = [
        [4, 3, 0.48],
        [8, 6, 0.28],
        [16, 12, 0.16],
        [32, 24, 0.08],
      ] as const;
      for (let octave = 0; octave < octaves.length; octave += 1) {
        const [cx, cy, weight] = octaves[octave]!;
        sum += periodicValueNoise(u * cx, v * cy, cx, cy, seed + octave * 0x9e3779b9) * weight;
        total += weight;
      }
      // 中周波を少し削って綿状の穴と薄い筋を作る。値域は0..1へ固定。
      const erosion = periodicValueNoise(u * 20, v * 14, 20, 14, seed ^ 0x85ebca6b);
      const density = THREE.MathUtils.clamp(sum / total * 1.08 - (1 - erosion) * 0.14, 0, 1);
      const value = Math.round(density * 255);
      const offset = (py * width + px) * 4;
      data[offset] = value;
      data[offset + 1] = value;
      data[offset + 2] = value;
      data[offset + 3] = 255;
    }
  }
  return data;
}

/**
 * 既存Sky.jsの大気散乱へ雲だけを同一パス内で合成する。
 * 追加ドローコール・外部fetchはゼロ。128KiBの決定論DataTextureを2回だけ参照する。
 */
export function installCinematicSky(
  sky: Sky,
  options: CinematicSkyOptions,
): CinematicSkyHandle {
  const profile = CLOUD_PROFILES[options.mood];
  const skyScale = { value: options.skyScale };
  const skyClamp = { value: options.skyClamp };
  const cloudTime = { value: 0 };
  const cloudDetail = { value: options.tier === 'low' ? 0 : 1 };
  const cloudShadow = new THREE.Color(options.palette.fog).multiplyScalar(profile.shadowMul);
  const cloudLight = new THREE.Color(options.palette.lightColor).multiplyScalar(profile.lightMul);
  const cloudMap = new THREE.DataTexture(
    createCinematicCloudData(),
    256,
    128,
    THREE.RGBAFormat,
    THREE.UnsignedByteType,
  );
  cloudMap.name = 'hibana:procedural-cloud-map';
  cloudMap.wrapS = THREE.RepeatWrapping;
  cloudMap.wrapT = THREE.ClampToEdgeWrapping;
  cloudMap.minFilter = THREE.LinearFilter;
  cloudMap.magFilter = THREE.LinearFilter;
  cloudMap.generateMipmaps = false;
  cloudMap.needsUpdate = true;
  const material = sky.material as THREE.ShaderMaterial;

  material.customProgramCacheKey = () =>
    `hibana-cinematic-sky-${options.mood}-${options.tier}`;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uSkyScale = skyScale;
    shader.uniforms.uSkyClamp = skyClamp;
    shader.uniforms.uCloudTime = cloudTime;
    shader.uniforms.uCloudDetail = cloudDetail;
    shader.uniforms.uCloudCoverage = { value: profile.coverage };
    shader.uniforms.uCloudOpacity = { value: profile.opacity };
    shader.uniforms.uCloudScale = { value: profile.scale };
    shader.uniforms.uCloudShadow = { value: cloudShadow };
    shader.uniforms.uCloudLight = { value: cloudLight };
    shader.uniforms.uCloudMap = { value: cloudMap };
    shader.fragmentShader = /* glsl */ `
uniform float uSkyScale;
uniform float uSkyClamp;
uniform float uCloudTime;
uniform float uCloudDetail;
uniform float uCloudCoverage;
uniform float uCloudOpacity;
uniform float uCloudScale;
uniform vec3 uCloudShadow;
uniform vec3 uCloudLight;
uniform sampler2D uCloudMap;
${shader.fragmentShader}`.replace(
      'gl_FragColor = vec4( retColor, 1.0 );',
      /* glsl */ `
      vec3 hibSkyBase = min(retColor * uSkyScale, vec3(uSkyClamp));
      // Sky.jsの白い地平ヘイズをそのままフォグに繋げると、
      // 300mステージ全体が白いスタジオ背景に見える。地平側だけ
      // 減光し、既存大気散乱の色相差を保ったまま少し強調する。
      float hibAltitude = smoothstep(-0.08, 0.42, direction.y);
      hibSkyBase *= mix(0.74, 1.0, hibAltitude);
      float hibSkyLuma = dot(hibSkyBase, vec3(0.2126, 0.7152, 0.0722));
      hibSkyBase = clamp(mix(vec3(hibSkyLuma), hibSkyBase, 1.12), 0.0, uSkyClamp);
      if (uCloudDetail > 0.001) {
        vec2 hibUvA = vec2(fract(uv.x * uCloudScale + uCloudTime), clamp(uv.y * 1.6, 0.0, 1.0));
        vec2 hibUvB = vec2(fract(uv.x * uCloudScale * 2.35 - uCloudTime * 0.63 + 0.31), clamp(uv.y * 2.15 + 0.08, 0.0, 1.0));
        float hibBase = texture2D(uCloudMap, hibUvA).r;
        float hibDetail = texture2D(uCloudMap, hibUvB).r;
        float hibN = hibBase * 0.68 + hibDetail * 0.32;
        // coverageは雲量。分布中央値付近へ遷移帯を置き、晴天は青空を残し、
        // 曇天は雲塊を繋げる。単純な減算では空全体が一様な灰色へ潰れる。
        float hibCloudFloor = mix(0.56, 0.40, uCloudCoverage);
        float hibCloud = smoothstep(hibCloudFloor, hibCloudFloor + 0.11, hibN);
        hibCloud *= mix(0.42, 1.0, smoothstep(0.24, 0.8, hibDetail));
        float hibHorizon = smoothstep(-0.15, 0.05, direction.y);
        hibHorizon *= 1.0 - smoothstep(0.76, 1.0, direction.y) * 0.34;
        float hibSunEdge = pow(max(dot(direction, vSunDirection), 0.0), 12.0);
        float hibCloudLight = clamp(0.08 + hibBase * 0.38 + hibDetail * 0.24 + hibSunEdge * 0.46, 0.0, 1.0);
        vec3 hibCloudColor = mix(uCloudShadow, uCloudLight, hibCloudLight);
        hibCloud *= hibHorizon * uCloudOpacity * uCloudDetail;
        hibSkyBase = mix(hibSkyBase, hibCloudColor, clamp(hibCloud, 0.0, 0.68));
      }
      gl_FragColor = vec4(min(hibSkyBase, vec3(uSkyClamp)), 1.0);`,
    );
  };
  material.needsUpdate = true;

  return {
    uniforms: { skyScale, skyClamp, cloudTime, cloudDetail },
    update(dt: number): void {
      if (options.reduceMotion || cloudDetail.value <= 0) return;
      cloudTime.value = (cloudTime.value + dt * profile.speed) % 1000;
    },
    setDetailScale(scale: number): void {
      cloudDetail.value = options.tier === 'low' ? 0 : scale >= 0.82 ? 1 : scale >= 0.72 ? 0.58 : 0;
    },
    dispose(): void {
      cloudMap.dispose();
    },
  };
}
