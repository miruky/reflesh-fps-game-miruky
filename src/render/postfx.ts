import * as THREE from 'three';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

// R11 ジュース: 表示空間(OutputPass後=Neutral+sRGB適用済みLDR)をサンプルする最終ポストFX。
// ビネット / フィルムグレイン / 画面端の色収差 / 周辺彩度低下 / 被弾パルス(赤tint+収差増)。
// R20 戦闘グレード拡張: 方向ヴィネット(被弾側へ赤集中)/ 低HP脱色+脈打つ赤エッジ /
// キル確定サージ(彩度・コントラスト持ち上げ+高速白エッジ)。bloomより後段=白飛びを誘発しない。
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
    // R20 戦闘グレード拡張
    uHitDir: { value: new THREE.Vector2(0, 0) }, // 被弾方向(画面空間の単位ベクトル・0=方向なし)
    uHealth: { value: 1 }, // HP比 0..1(死へ向かうほど脱色+赤エッジ)
    uKillSurge: { value: 0 }, // キル確定サージ封筒 0..1
    uMotion: { value: 1 }, // 1=通常 / 0=省モーション(時間依存の脈動を凍結)
    // R21 Teal & Orange カラーグレーディング(0=完全no-op・high tier のみ 0.3 を設定)
    uGrade: { value: 0 },
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
    uniform float uHealth, uKillSurge, uMotion, uGrade;
    uniform vec2 uHitDir;
    uniform vec3 uHitTint;
    varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      vec2 d = vUv - 0.5;
      float r = length(d);
      vec2 dir = d / max(r, 1e-4);
      // 色収差(画面端ほど強く、被弾/キルサージ時に増幅)。正規化UVで解像度非依存
      float ab = (uAberration + uHitPulse * 1.6 + uKillSurge * 1.2) * r * r * 0.012;
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
      // 被弾パルス: uHitDir(単位)方向へ赤を集中。方向ゼロ(length0)時は従来の対称パルスへ縮退
      float rEdge = clamp(r * 1.5, 0.0, 1.0);
      float dirBias = 0.5 + 0.5 * clamp(dot(dir, uHitDir), -1.0, 1.0);
      float hitAmt = uHitPulse * rEdge * mix(1.0, dirBias * 1.6, min(length(uHitDir), 1.0));
      col = mix(col, col * uHitTint, clamp(hitAmt, 0.0, 1.0));
      // 低HP(near-death): 全体脱色 + 脈打つ赤エッジ。uMotion=0(省モーション)で脈動を凍結
      float nearDeath = 1.0 - smoothstep(0.0, 0.38, uHealth);
      if (nearDeath > 0.0) {
        float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
        col = mix(col, vec3(lum), nearDeath * 0.55);
        float beat = mix(1.0, 0.55 + 0.45 * sin(uTime * 5.5), uMotion);
        float deathEdge = smoothstep(0.32, 0.98, r) * nearDeath * beat;
        col = mix(col, col * vec3(1.0, 0.26, 0.22), deathEdge * 0.7);
      }
      // キル確定サージ: 一瞬 彩度/コントラストを持ち上げ + 周辺の高速白エッジ(白飛び回避へキャップ)
      if (uKillSurge > 0.0) {
        float ks = uKillSurge;
        float lum2 = dot(col, vec3(0.2126, 0.7152, 0.0722));
        col = mix(vec3(lum2), col, 1.0 + ks * 0.5);   // 彩度ブースト(mix係数>1で外挿)
        col = (col - 0.5) * (1.0 + ks * 0.18) + 0.5;  // コントラスト(中心0.5基準)
        float whiteEdge = smoothstep(0.5, 1.0, r) * ks;
        col += min(whiteEdge * 0.12, 0.1);            // キャップで白飛び回避
      }
      // R21 Teal & Orange カラーグレーディング(uGrade=0 → 完全no-op。乗算/加算がゼロで消える式)
      // shadows→teal / highlights→warm / pow0.96コントラスト / +3%彩度
      if (uGrade > 0.0) {
        float gLum = dot(col, vec3(0.2126, 0.7152, 0.0722));
        // shadows teal: 暗部(lum<0.25)へ teal を加算
        float shadowW = clamp(1.0 - gLum * 4.0, 0.0, 1.0);
        col += vec3(0.0, 0.05, 0.08) * shadowW * uGrade;
        // highlights warm: 明部(lum>0.7)へ warm を加算(白飛び防止・控えめ値)
        float highlightW = clamp((gLum - 0.7) / 0.3, 0.0, 1.0);
        col += vec3(0.08, 0.04, 0.0) * highlightW * uGrade;
        // pow 0.96 コントラスト(uGrade=0 で col に縮退)
        vec3 contrasted = pow(max(col, 0.0001), vec3(0.96));
        col = mix(col, contrasted, uGrade);
        // +3% 彩度(mix係数 1.03 で外挿, uGrade=0 → 係数1.0=col)
        float gLum2 = dot(col, vec3(0.2126, 0.7152, 0.0722));
        col = mix(vec3(gLum2), col, 1.0 + uGrade * 0.10);
        col = clamp(col, 0.0, 1.0); // 白飛び完全防止
      }
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

  // R20 戦闘グレードの封筒を毎フレーム更新(被弾方向・HP比・キルサージ・モーション許可)。
  // dirX/dirYは画面空間の単位ベクトル(0,0=方向なし=対称パルスへ縮退)。motionは省モーション時0。
  setCombat(dirX: number, dirY: number, health: number, killSurge: number, motion: number): void {
    const u = this.uniforms;
    (u['uHitDir']!.value as THREE.Vector2).set(dirX, dirY);
    u['uHealth']!.value = health;
    u['uKillSurge']!.value = killSurge;
    u['uMotion']!.value = motion;
  }

  setTime(t: number): void {
    this.uniforms['uTime']!.value = t;
  }

  // R21 Teal & Orange グレーディング強度(0=no-op, high tier では 0.3 を設定)
  setGrade(v: number): void {
    this.uniforms['uGrade']!.value = v;
  }
}
