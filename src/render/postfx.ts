import * as THREE from 'three';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

// R11 ジュース: 表示空間(OutputPass後=Neutral+sRGB適用済みLDR)をサンプルする最終ポストFX。
// ビネット / フィルムグレイン / 画面端の色収差 / 周辺彩度低下 / 被弾パルス(赤tint+収差増)。
// Neutralトーンマップと喧嘩しないよう必ずコンポーザ最後段に置く。正規化UV設計で解像度非依存。
export interface PostFXParams {
  vigInner: number; // ビネット開始半径(中央から, 0.5..1)
  vigOuter: number; // 周辺減光が最大になる半径
  grain: number; // フィルムグレイン量 0..0.1
  aberration: number; // 画面端の色収差量 0..2
  desat: number; // 周辺の彩度低下 0..1
  hitPulse: number; // 被弾パルス 0..1(赤tint+収差増幅・毎フレーム減衰)
  hitTint: [number, number, number]; // 被弾時の乗算色(赤系)
  enabled: boolean;
}

const POSTFX_SHADER = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uTime: { value: 0 },
    uVigInner: { value: 0.62 },
    uVigOuter: { value: 1.0 },
    uGrain: { value: 0.03 },
    uAberration: { value: 0.6 },
    uDesat: { value: 0.25 },
    uHitPulse: { value: 0 },
    uHitTint: { value: new THREE.Color(1, 0.35, 0.3) },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime, uVigInner, uVigOuter, uGrain, uAberration, uDesat, uHitPulse;
    uniform vec3 uHitTint;
    varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      vec2 d = vUv - 0.5;
      float r = length(d);
      // 色収差(画面端ほど強く、被弾時に増幅)。正規化UVで解像度非依存
      float ab = (uAberration + uHitPulse * 1.6) * r * r * 0.012;
      vec2 dir = d / max(r, 1e-4);
      vec3 col;
      col.r = texture2D(tDiffuse, vUv + dir * ab).r;
      col.g = texture2D(tDiffuse, vUv).g;
      col.b = texture2D(tDiffuse, vUv - dir * ab).b;
      // 周辺の彩度低下(視線を中央へ集める)
      float dv = smoothstep(uVigInner, uVigOuter, r);
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(col, vec3(l), dv * uDesat);
      // ビネット(周辺減光)
      col *= 1.0 - dv * 0.55;
      // 被弾パルス(周辺ほど赤く締まる)
      col = mix(col, col * uHitTint, uHitPulse * clamp(r * 1.5, 0.0, 1.0));
      // フィルムグレイン(大係数のhashで擬似高周波、uResolution不要)
      col += (hash(vUv * 1873.0 + uTime) - 0.5) * uGrain;
      gl_FragColor = vec4(max(col, 0.0), 1.0);
    }
  `,
};

export class PostFXPass extends ShaderPass {
  constructor() {
    super(POSTFX_SHADER);
  }

  setParams(p: PostFXParams): void {
    // uniformsは全てPOSTFX_SHADERで定義済み(存在保証)。noUncheckedIndexedAccess対策の断定
    const u = this.uniforms;
    u['uVigInner']!.value = p.vigInner;
    u['uVigOuter']!.value = p.vigOuter;
    u['uGrain']!.value = p.grain;
    u['uAberration']!.value = p.aberration;
    u['uDesat']!.value = p.desat;
    u['uHitPulse']!.value = p.hitPulse;
    (u['uHitTint']!.value as THREE.Color).setRGB(p.hitTint[0], p.hitTint[1], p.hitTint[2]);
    this.enabled = p.enabled;
  }

  // 被弾パルスだけを毎フレーム更新(setParamsより軽い)
  setHitPulse(v: number): void {
    this.uniforms['uHitPulse']!.value = v;
  }

  setTime(t: number): void {
    this.uniforms['uTime']!.value = t;
  }
}
