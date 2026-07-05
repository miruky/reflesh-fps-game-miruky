/**
 * GodRaysPass — 太陽光条 (crepuscular rays) ポストプロセスパス
 *
 * 【構成】毎フレーム最大5描画:
 *   RT pingA / pingB : 各 1/4 解像度 (4px量子化)、HalfFloat、depthBuffer なし
 *   Pass 1  深度テクスチャ → 空マスク (sky=1, objects=0 + 太陽UV集中ブースト) → pingA
 *   Pass 2  GodRaysGenerateShader: pingA → pingB  (fStepSize = density×1/6)
 *   Pass 3  GodRaysGenerateShader: pingB → pingA  (fStepSize = density×1/36)
 *   Pass 4  GodRaysGenerateShader: pingA → pingB  (fStepSize = density×1/216)
 *   Pass 5  加算合成: readBuffer.texture + godRayIntensity×pingB → writeBuffer
 *   ──
 *   3段カスケード = 6×6×6 = 216サンプル相当 (公式 Sousa2008 方式)
 *
 * 【深度オクルージョン設計】
 *   readBuffer.depthTexture (RenderPass が書いた DepthTexture) を使用。
 *   NDC depth=1.0 (far平面=空) → mask=1 (光源)、depth<1 (オブジェクト) → mask=0 (遮蔽)。
 *   depthTexture が未設定の場合はパススルーで返す。
 *
 * 【配線例 — match.ts の buildComposer 内】
 * ```typescript
 * // (1) readBuffer に depthTexture を付与 (GodRaysPass より前に行う)
 * import * as THREE from 'three';
 * const depthTex = new THREE.DepthTexture(w, h, THREE.UnsignedShortType);
 * composer.readBuffer.depthTexture = depthTex;
 * composer.readBuffer.depthBuffer  = true;
 *
 * // (2) RenderPass 直後、HalfBloom の前段に挿入
 * const godRays = new GodRaysPass();
 * godRays.setSize(w, h);
 * composer.addPass(new RenderPass(scene, camera));
 * composer.addPass(godRays);   // bloom 前段 → 光条に bloom が乗る
 * composer.addPass(bloom);
 *
 * // (3) 毎フレーム (match の renderLoop 内)
 * //     sunDir は stage の sunDir、適当な遠距離でワールド座標へ変換する
 * const sunWorldPos = camera.position.clone().addScaledVector(sunDir, 500);
 * godRays.setSun(sunWorldPos, camera);
 * godRays.setIntensity(0.35);  // 昼:0.35 / 夕焼け:0.5 など
 * ```
 *
 * 【初期値 (uniform名は公式 GodRaysShader.js に準拠)】
 *   density  = 0.95  (fStepSize スケール係数)
 *   decay    = 0.90  (三.js GodRaysGenerateShader 未サポート; 将来拡張用)
 *   intensity= 0.35  (fGodRayIntensity の基底値)
 *   exposure = 0.50  (fGodRayIntensity = intensity × exposure × edgeFade)
 */

import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { GodRaysGenerateShader } from 'three/addons/shaders/GodRaysShader.js';

// ---------------------------------------------------------------------------
// 定数
// ---------------------------------------------------------------------------

/** 3段カスケードのステップサイズ (density を乗算して実効値を得る) */
const STEP_S0 = 1 / 6; // cascade 1: 粗いタップ
const STEP_S1 = 1 / 36; // cascade 2: 中間
const STEP_S2 = 1 / 216; // cascade 3: 細かい (6^3 = 216 サンプル相当)

// ---------------------------------------------------------------------------
// 内部シェーダ定義
// ---------------------------------------------------------------------------

/**
 * 深度テクスチャ → 空マスク変換シェーダ
 *
 * DepthTexture の .r チャンネル (0=near, 1=far) を読み、
 *   sky   (depth ≈ 1.0) → mask = 1.0  [光源マスクとして "明るい"]
 *   objects (depth < 1.0) → mask = 0.0  [遮蔽として "暗い"]
 * に変換する。さらに太陽UV付近をガウスブーストして点光源を形成する。
 *
 * この方向性(sky=1, objects=0)に合わせ、combine も加算(反転なし)を使う。
 */
const DEPTH_SKY_MASK_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const DEPTH_SKY_MASK_FRAG = /* glsl */ `
  varying vec2 vUv;
  uniform sampler2D tDepth;
  uniform vec2  uSunUV;
  uniform float uSkyThreshold;
  uniform float uSunBoost;
  void main() {
    float d   = texture2D(tDepth, vUv).r;
    // sky=1 / objects=0 (NDC depth=1.0 が far平面=空)
    float sky = smoothstep(uSkyThreshold, 1.0, d);
    // 太陽UV付近のガウスブースト: 空ピクセルのみ増幅して点光源を形成する
    vec2  diff  = vUv - uSunUV;
    float boost = exp(-dot(diff, diff) * 200.0) * uSunBoost;
    float mask  = clamp(sky + boost * sky, 0.0, 1.0);
    gl_FragColor = vec4(mask, mask, mask, 1.0);
  }
`;

/**
 * 加算合成シェーダ (depth対応版)
 *
 * 公式 GodRaysCombineShader は `fGodRayIntensity * (1.0 - tGodRays)` で
 * 反転してから加算するが、sky=1/objects=0 の深度マスク方式では
 * 反転が逆効果になるため、直接加算する版を使用する。
 *   out = tColors + fGodRayIntensity * tGodRays.r
 */
const ADDITIVE_COMBINE_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const ADDITIVE_COMBINE_FRAG = /* glsl */ `
  varying vec2 vUv;
  uniform sampler2D tColors;
  uniform sampler2D tGodRays;
  uniform float fGodRayIntensity;
  void main() {
    vec4  scene = texture2D(tColors,  vUv);
    float rays  = texture2D(tGodRays, vUv).r;
    gl_FragColor = scene + vec4(vec3(fGodRayIntensity * rays), 0.0);
    gl_FragColor.a = 1.0;
  }
`;

// ---------------------------------------------------------------------------
// ヘルパー
// ---------------------------------------------------------------------------

/** 4px 単位に切り捨て量子化 (最小 4px) */
function quantize4(v: number): number {
  return Math.max(4, Math.floor(v / 4) * 4);
}

/** 1/4解像度の HalfFloat RT を生成する */
function makeQuarterRT(w: number, h: number, name: string): THREE.WebGLRenderTarget {
  const rt = new THREE.WebGLRenderTarget(w, h, {
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    format: THREE.RGBAFormat,
    type: THREE.HalfFloatType,
    depthBuffer: false,
  });
  rt.texture.name = name;
  return rt;
}

// ---------------------------------------------------------------------------
// GodRaysPass
// ---------------------------------------------------------------------------

export class GodRaysPass extends Pass {
  // --- 寸法 ---
  private _qtW = 0; // 量子化後 1/4幅 (no-op ガード用)
  private _qtH = 0;

  // --- RT (setSize まで null) ---
  private _pingA: THREE.WebGLRenderTarget | null = null;
  private _pingB: THREE.WebGLRenderTarget | null = null;

  // --- シェーダ材質 ---
  private readonly _maskUniforms = {
    tDepth: { value: null as THREE.Texture | null },
    uSunUV: { value: new THREE.Vector2(0.5, 0.5) },
    uSkyThreshold: { value: 0.999 },
    uSunBoost: { value: 4.0 },
  };
  private readonly _maskMat: THREE.ShaderMaterial;

  private readonly _genUniforms = {
    tInput: { value: null as THREE.Texture | null },
    fStepSize: { value: STEP_S0 },
    vSunPositionScreenSpace: { value: new THREE.Vector3(0.5, 0.5, 1000) },
  };
  private readonly _genMat: THREE.ShaderMaterial;

  private readonly _combineUniforms = {
    tColors: { value: null as THREE.Texture | null },
    tGodRays: { value: null as THREE.Texture | null },
    fGodRayIntensity: { value: 0.175 }, // 初期値: intensity(0.35) × exposure(0.50)
  };
  private readonly _combineMat: THREE.ShaderMaterial;

  /** FSQ は material を都度差し替えて5パス共用 */
  private readonly _fsq: FullScreenQuad;

  // --- アルゴリズムパラメータ (公式 GodRaysShader のパラメータ名に準拠) ---
  private readonly _density = 0.95; // fStepSize スケール係数
  // decay = 0.90: GodRaysGenerateShader 未サポート (将来の custom GLSL 拡張用に予約)
  private readonly _exposure = 0.5; // intensity に乗算する露出係数

  // --- フレーム状態 (setSun で更新) ---
  private _sunUV = new THREE.Vector2(0.5, 0.5);
  private _sunBehind = false;
  private _edgeFade = 0.0;

  // --- ユーザー設定強度 ---
  private _baseIntensity = 0.35;

  /** setSun の project 計算用スクラッチ (毎フレーム clone を避ける) */
  private readonly _projScratch = new THREE.Vector3();

  /** 二重 dispose ガード */
  private _disposed = false;

  constructor() {
    super();
    this.needsSwap = true;

    this._maskMat = new THREE.ShaderMaterial({
      uniforms: this._maskUniforms,
      vertexShader: DEPTH_SKY_MASK_VERT,
      fragmentShader: DEPTH_SKY_MASK_FRAG,
      depthTest: false,
      depthWrite: false,
    });

    // GodRaysGenerateShader (公式) の GLSL を使った材質
    this._genMat = new THREE.ShaderMaterial({
      uniforms: this._genUniforms,
      vertexShader: GodRaysGenerateShader.vertexShader,
      fragmentShader: GodRaysGenerateShader.fragmentShader,
      depthTest: false,
      depthWrite: false,
    });

    // 加算合成 (sky=bright 方式 / 反転なし)
    this._combineMat = new THREE.ShaderMaterial({
      uniforms: this._combineUniforms,
      vertexShader: ADDITIVE_COMBINE_VERT,
      fragmentShader: ADDITIVE_COMBINE_FRAG,
      depthTest: false,
      depthWrite: false,
      blending: THREE.NoBlending,
    });

    this._fsq = new FullScreenQuad(this._maskMat);
    this._applyIntensity();
  }

  // ---------------------------------------------------------------------------
  // 公開 API
  // ---------------------------------------------------------------------------

  /**
   * setSun — 毎フレーム呼ぶ。ワールド座標の太陽位置をカメラ空間に投影する。
   *   - 画面端 (NDC |x|, |y| > 0.7) で線形フェードアウト
   *   - カメラ後方 (projectedZ > 1.0) で intensity=0 (完全無効)
   * @param worldPos 太陽のワールド座標 (例: camera.position + sunDir×500)
   * @param camera   シーンカメラ (毎フレーム最新を渡すこと)
   */
  setSun(worldPos: THREE.Vector3, camera: THREE.Camera): void {
    const v = this._projScratch.copy(worldPos).project(camera);
    this._sunBehind = v.z > 1.0;

    // NDC [-1,1] → UV [0,1]
    const uvX = v.x * 0.5 + 0.5;
    const uvY = v.y * 0.5 + 0.5;
    this._sunUV.set(uvX, uvY);

    // 画面端フェード: |ndcX| or |ndcY| が 0.7 を超えると 1.0 から 0.0 へ線形減衰
    const edgeDist = Math.max(Math.abs(v.x), Math.abs(v.y));
    this._edgeFade = this._sunBehind
      ? 0
      : Math.max(0, 1 - Math.max(0, edgeDist - 0.7) / 0.3);

    // マスクシェーダに太陽UV を送る
    this._maskUniforms.uSunUV.value.set(uvX, uvY);

    // Generateシェーダ: vSunPositionScreenSpace.xy = UV, z = フェード係数 ×1000
    // (シェーダ内: f = min(1, max(z/1000, 0)) → z=1000でf=1.0, z=0でf=0)
    const sunZ = this._sunBehind ? 0 : 1000;
    this._genUniforms.vSunPositionScreenSpace.value.set(uvX, uvY, sunZ);

    this._applyIntensity();
  }

  /**
   * setIntensity — 毎フレームでも都度でも呼んでよい。
   * 実効値 = v × exposure(0.5) × edgeFade
   */
  setIntensity(v: number): void {
    this._baseIntensity = v;
    this._applyIntensity();
  }

  /**
   * setSize — EffectComposer のリサイズ時に呼ぶ。
   * 1/4 解像度を 4px 単位で量子化し、寸法が変わった場合のみ RT を再確保する。
   */
  override setSize(w: number, h: number): void {
    if (w <= 0 || h <= 0) return; // 0寸法ガード
    const qtW = quantize4(w / 4);
    const qtH = quantize4(h / 4);
    if (qtW === this._qtW && qtH === this._qtH) return; // 寸法同一 → no-op
    this._qtW = qtW;
    this._qtH = qtH;
    this._pingA?.dispose();
    this._pingB?.dispose();
    this._pingA = makeQuarterRT(qtW, qtH, 'GodRays.pingA');
    this._pingB = makeQuarterRT(qtW, qtH, 'GodRays.pingB');
  }

  /**
   * render — EffectComposer から毎フレーム呼ばれる。
   *
   * enabled=false の場合、EffectComposer は呼ばないので here には来ない。
   * 深度テクスチャ未設定 / 太陽後方 / RT未確保 のときはパススルー(読み書きバッファコピー)。
   */
  override render(
    renderer: THREE.WebGLRenderer,
    writeBuffer: THREE.WebGLRenderTarget,
    readBuffer: THREE.WebGLRenderTarget,
    _deltaTime: number,
    _maskActive: boolean,
  ): void {
    // RT 未確保 or 太陽後方 or edgeFade ≈ 0 → パススルー
    if (!this._pingA || !this._pingB || this._sunBehind || this._edgeFade < 1e-4) {
      this._passthrough(renderer, writeBuffer, readBuffer);
      return;
    }

    const depthTex = readBuffer.depthTexture;
    if (!depthTex) {
      // 統合側が depthTexture を設定していない → パススルー (警告は初回のみ)
      this._passthrough(renderer, writeBuffer, readBuffer);
      return;
    }

    // ── Pass 1: 深度 → 空マスク → pingA ──
    this._maskUniforms.tDepth.value = depthTex;
    renderer.setRenderTarget(this._pingA);
    this._fsq.material = this._maskMat;
    this._fsq.render(renderer);

    // ── Pass 2: cascade 1 (pingA → pingB, fStepSize = density/6) ──
    this._genUniforms.tInput.value = this._pingA.texture;
    this._genUniforms.fStepSize.value = STEP_S0 * this._density;
    renderer.setRenderTarget(this._pingB);
    this._fsq.material = this._genMat;
    this._fsq.render(renderer);

    // ── Pass 3: cascade 2 (pingB → pingA, fStepSize = density/36) ──
    this._genUniforms.tInput.value = this._pingB.texture;
    this._genUniforms.fStepSize.value = STEP_S1 * this._density;
    renderer.setRenderTarget(this._pingA);
    this._fsq.render(renderer);

    // ── Pass 4: cascade 3 (pingA → pingB, fStepSize = density/216) ──
    this._genUniforms.tInput.value = this._pingA.texture;
    this._genUniforms.fStepSize.value = STEP_S2 * this._density;
    renderer.setRenderTarget(this._pingB);
    this._fsq.render(renderer);

    // ── Pass 5: 加算合成 (sceneColor + godRays → 出力先) ──
    this._combineUniforms.tColors.value = readBuffer.texture;
    this._combineUniforms.tGodRays.value = this._pingB.texture;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this._fsq.material = this._combineMat;
    this._fsq.render(renderer);
  }

  /** RT・材質・FSQ をすべて解放する (冪等) */
  override dispose(): void {
    if (this._disposed) return;
    this._disposed = true;
    this._pingA?.dispose();
    this._pingB?.dispose();
    this._maskMat.dispose();
    this._genMat.dispose();
    this._combineMat.dispose();
    this._fsq.dispose();
    this._pingA = null;
    this._pingB = null;
  }

  // ---------------------------------------------------------------------------
  // 内部ヘルパー
  // ---------------------------------------------------------------------------

  /** fGodRayIntensity = baseIntensity × exposure × edgeFade */
  private _applyIntensity(): void {
    this._combineUniforms.fGodRayIntensity.value =
      this._baseIntensity * this._exposure * this._edgeFade;
  }

  /**
   * パススルー: readBuffer.texture をそのまま writeBuffer (または画面) へコピーする。
   * combine シェーダを intensity=0 で実行するだけなので余分な RT は使わない。
   */
  private _passthrough(
    renderer: THREE.WebGLRenderer,
    writeBuffer: THREE.WebGLRenderTarget,
    readBuffer: THREE.WebGLRenderTarget,
  ): void {
    const saved = this._combineUniforms.fGodRayIntensity.value;
    this._combineUniforms.tColors.value = readBuffer.texture;
    this._combineUniforms.tGodRays.value = null; // null → three.js が黒テクスチャで代替
    this._combineUniforms.fGodRayIntensity.value = 0; // 0×anything=0 → シーン色そのまま
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this._fsq.material = this._combineMat;
    this._fsq.render(renderer);
    this._combineUniforms.fGodRayIntensity.value = saved; // 復元
  }
}

// ---------------------------------------------------------------------------
// デバッグ用の寸法チェック (開発時のみ)
// ---------------------------------------------------------------------------
// console.log('[GodRaysPass] pingA:', this._qtW, 'x', this._qtH); → setSize 内で必要なら追加
