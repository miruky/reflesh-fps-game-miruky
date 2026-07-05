/**
 * AdsDofPass — ADS(照準)連動被写界深度 (Depth of Field) パス
 *
 * 【フォーク箇所 (BokehShader v1 より)】
 *   Original: vec2 dofblur = vec2( clamp( factor * aperture, -maxblur, maxblur ) );
 *   Forked:   vec2 dofblur = vec2( clamp( factor * aperture, -maxblur, 0.0   ) );
 *
 *   変更の効果:
 *     factor = focus + viewZ  (viewZ は負値: カメラ奥を向く)
 *     ● factor < 0 → オブジェクトが焦点面より遠い (背景) → blur < 0 → ボケる ✓
 *     ● factor > 0 → オブジェクトが焦点面より近い (前景=武器/腕) → 0にクランプ → シャープ ✓
 *   → ADS時に武器/腕はシャープなまま、焦点より奥の背景だけボケる。
 *
 * 【ADS 連動】
 *   ads01=0 (腰だめ): enabled=false → 深度パスもBokehパスも走らない (完全ゼロコスト)
 *   ads01=1 (完全ADS): aperture=5e-6, maxblur=0.008 で自然なボケ
 *   焦点距離は統合側の照準レイキャスト距離を毎フレーム update() に渡す。
 *
 * 【配線例 — match.ts の buildComposer 内】
 * ```typescript
 * import { AdsDofPass } from '../render/dof';
 *
 * const dof = new AdsDofPass(scene, camera as THREE.PerspectiveCamera);
 * dof.setSize(w, h);
 * // bloom 後、SMAA 前に挿入 (色収差 PostFX と干渉しない位置)
 * composer.addPass(new RenderPass(scene, camera));
 * composer.addPass(bloom);
 * composer.addPass(dof);
 * composer.addPass(smaa);
 *
 * // 毎フレーム (adsValue は ADS アニメーション 0→1 の float)
 * dof.update(adsValue, raycastHitDistance, deltaTime);
 * // raycastHitDistance: レイキャスト最近接ヒット距離 (m, 正値)
 * //                     ヒットなし時は適当な遠距離 (例: 500) を渡す
 * ```
 *
 * 【update パラメータ】
 *   ads01      : 0(腰だめ) → 1(完全ADS)。0.01 以下で enabled=false に切り替わる。
 *   focusDistM : レイキャスト距離 (m, 正値)。指数 lerp (τ≈8/s) でスムーズに追従。
 *   dt         : フレーム時間 (秒)。
 *
 * 【深度 RT】
 *   シーンを MeshDepthMaterial (RGBADepthPacking) でレンダリングした自前 RT を使用。
 *   BokehPass.js の構造を参考に render() 内で深度パス → Bokeh パスの順で実行する。
 */

import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

// ---------------------------------------------------------------------------
// BokehShader v1 フォーク (1行変更: clamp 上限を maxblur → 0.0)
// Original source: three/examples/jsm/shaders/BokehShader.js (r170)
// 変更点: 焦点面より手前のオブジェクト (前景) のブラーをゼロに固定する
// ---------------------------------------------------------------------------

const ADS_BOKEH_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

/**
 * 41 サンプルの Bokeh ブラー。
 * ★ 1行変更: clamp 上限を maxblur → 0.0 (前景シャープ維持)
 */
const ADS_BOKEH_FRAG = /* glsl */ `
  #include <common>

  varying vec2 vUv;

  uniform sampler2D tColor;
  uniform sampler2D tDepth;

  uniform float maxblur;   // 最大ブラー量
  uniform float aperture;  // 絞り値 (大きいほど浅い被写界深度)
  uniform float nearClip;
  uniform float farClip;
  uniform float focus;     // 焦点距離 (m, 正値)
  uniform float aspect;    // width / height

  #include <packing>

  float getDepth(const in vec2 screenPosition) {
    // DEPTH_PACKING == 1 (RGBADepthPacking) で固定
    return unpackRGBAToDepth(texture2D(tDepth, screenPosition));
  }

  float getViewZ(const in float depth) {
    // PERSPECTIVE_CAMERA == 1 固定
    return perspectiveDepthToViewZ(depth, nearClip, farClip);
  }

  void main() {
    vec2 aspectcorrect = vec2(1.0, aspect);

    float viewZ  = getViewZ(getDepth(vUv));
    float factor = focus + viewZ; // viewZ <= 0; factor<0=背景, factor>0=前景

    // ★ フォーク箇所: 上限 maxblur → 0.0 に変更
    //   factor > 0 (前景=武器/腕) → clamp(正値, -maxblur, 0.0) = 0 → ブラーなし
    //   factor < 0 (背景)         → clamp(負値, -maxblur, 0.0) = 負値 → ボケる
    vec2 dofblur  = vec2(clamp(factor * aperture, -maxblur, 0.0));

    vec2 dofblur9 = dofblur * 0.9;
    vec2 dofblur7 = dofblur * 0.7;
    vec2 dofblur4 = dofblur * 0.4;

    vec4 col = vec4(0.0);

    // 41 サンプル (BokehShader v1 と同一サンプルパターン)
    col += texture2D(tColor, vUv.xy);
    col += texture2D(tColor, vUv.xy + (vec2(  0.0,   0.4  ) * aspectcorrect) * dofblur);
    col += texture2D(tColor, vUv.xy + (vec2(  0.15,  0.37 ) * aspectcorrect) * dofblur);
    col += texture2D(tColor, vUv.xy + (vec2(  0.29,  0.29 ) * aspectcorrect) * dofblur);
    col += texture2D(tColor, vUv.xy + (vec2( -0.37,  0.15 ) * aspectcorrect) * dofblur);
    col += texture2D(tColor, vUv.xy + (vec2(  0.40,  0.0  ) * aspectcorrect) * dofblur);
    col += texture2D(tColor, vUv.xy + (vec2(  0.37, -0.15 ) * aspectcorrect) * dofblur);
    col += texture2D(tColor, vUv.xy + (vec2(  0.29, -0.29 ) * aspectcorrect) * dofblur);
    col += texture2D(tColor, vUv.xy + (vec2( -0.15, -0.37 ) * aspectcorrect) * dofblur);
    col += texture2D(tColor, vUv.xy + (vec2(  0.0,  -0.4  ) * aspectcorrect) * dofblur);
    col += texture2D(tColor, vUv.xy + (vec2( -0.15,  0.37 ) * aspectcorrect) * dofblur);
    col += texture2D(tColor, vUv.xy + (vec2( -0.29,  0.29 ) * aspectcorrect) * dofblur);
    col += texture2D(tColor, vUv.xy + (vec2(  0.37,  0.15 ) * aspectcorrect) * dofblur);
    col += texture2D(tColor, vUv.xy + (vec2( -0.4,   0.0  ) * aspectcorrect) * dofblur);
    col += texture2D(tColor, vUv.xy + (vec2( -0.37, -0.15 ) * aspectcorrect) * dofblur);
    col += texture2D(tColor, vUv.xy + (vec2( -0.29, -0.29 ) * aspectcorrect) * dofblur);
    col += texture2D(tColor, vUv.xy + (vec2(  0.15, -0.37 ) * aspectcorrect) * dofblur);

    col += texture2D(tColor, vUv.xy + (vec2(  0.15,  0.37 ) * aspectcorrect) * dofblur9);
    col += texture2D(tColor, vUv.xy + (vec2( -0.37,  0.15 ) * aspectcorrect) * dofblur9);
    col += texture2D(tColor, vUv.xy + (vec2(  0.37, -0.15 ) * aspectcorrect) * dofblur9);
    col += texture2D(tColor, vUv.xy + (vec2( -0.15, -0.37 ) * aspectcorrect) * dofblur9);
    col += texture2D(tColor, vUv.xy + (vec2( -0.15,  0.37 ) * aspectcorrect) * dofblur9);
    col += texture2D(tColor, vUv.xy + (vec2(  0.37,  0.15 ) * aspectcorrect) * dofblur9);
    col += texture2D(tColor, vUv.xy + (vec2( -0.37, -0.15 ) * aspectcorrect) * dofblur9);
    col += texture2D(tColor, vUv.xy + (vec2(  0.15, -0.37 ) * aspectcorrect) * dofblur9);

    col += texture2D(tColor, vUv.xy + (vec2(  0.29,  0.29 ) * aspectcorrect) * dofblur7);
    col += texture2D(tColor, vUv.xy + (vec2(  0.40,  0.0  ) * aspectcorrect) * dofblur7);
    col += texture2D(tColor, vUv.xy + (vec2(  0.29, -0.29 ) * aspectcorrect) * dofblur7);
    col += texture2D(tColor, vUv.xy + (vec2(  0.0,  -0.4  ) * aspectcorrect) * dofblur7);
    col += texture2D(tColor, vUv.xy + (vec2( -0.29,  0.29 ) * aspectcorrect) * dofblur7);
    col += texture2D(tColor, vUv.xy + (vec2( -0.4,   0.0  ) * aspectcorrect) * dofblur7);
    col += texture2D(tColor, vUv.xy + (vec2( -0.29, -0.29 ) * aspectcorrect) * dofblur7);
    col += texture2D(tColor, vUv.xy + (vec2(  0.0,   0.4  ) * aspectcorrect) * dofblur7);

    col += texture2D(tColor, vUv.xy + (vec2(  0.29,  0.29 ) * aspectcorrect) * dofblur4);
    col += texture2D(tColor, vUv.xy + (vec2(  0.4,   0.0  ) * aspectcorrect) * dofblur4);
    col += texture2D(tColor, vUv.xy + (vec2(  0.29, -0.29 ) * aspectcorrect) * dofblur4);
    col += texture2D(tColor, vUv.xy + (vec2(  0.0,  -0.4  ) * aspectcorrect) * dofblur4);
    col += texture2D(tColor, vUv.xy + (vec2( -0.29,  0.29 ) * aspectcorrect) * dofblur4);
    col += texture2D(tColor, vUv.xy + (vec2( -0.4,   0.0  ) * aspectcorrect) * dofblur4);
    col += texture2D(tColor, vUv.xy + (vec2( -0.29, -0.29 ) * aspectcorrect) * dofblur4);
    col += texture2D(tColor, vUv.xy + (vec2(  0.0,   0.4  ) * aspectcorrect) * dofblur4);

    gl_FragColor = col / 41.0;
    gl_FragColor.a = 1.0;
  }
`;

// ---------------------------------------------------------------------------
// AdsDofPass
// ---------------------------------------------------------------------------

export class AdsDofPass extends Pass {
  private readonly _scene: THREE.Scene;
  private readonly _camera: THREE.PerspectiveCamera;

  /** シーン深度を RGBA packed で書き込む RT */
  private _depthRT: THREE.WebGLRenderTarget;

  /** 深度パス素材 (MeshDepthMaterial / RGBADepthPacking) */
  private readonly _depthMat: THREE.MeshDepthMaterial;

  /** Bokeh フラグメントシェーダを持つ材質 */
  private readonly _bokehMat: THREE.ShaderMaterial;

  /** Bokeh uniform を型安全に参照するための直接ハンドル */
  private readonly _u: {
    tColor: { value: THREE.Texture | null };
    tDepth: { value: THREE.Texture | null };
    focus: { value: number };
    aspect: { value: number };
    aperture: { value: number };
    maxblur: { value: number };
    nearClip: { value: number };
    farClip: { value: number };
  };

  private readonly _fsq: FullScreenQuad;

  /** 指数 lerp で追従する現在の焦点距離 (m) */
  private _focusCurrent = 10.0;

  /** watchdog による永続無効化フラグ (true になると update() は早期リターン) */
  private _forcedDisable = false;

  /** 二重 dispose ガード */
  private _disposed = false;

  /** getClearColor 用の一時バッファ (毎フレーム new を避ける) */
  private readonly _oldClearColor = new THREE.Color();

  constructor(scene: THREE.Scene, camera: THREE.PerspectiveCamera) {
    super();
    this._scene = scene;
    this._camera = camera;
    this.needsSwap = true;
    this.enabled = false; // ads01 > 0.01 で update() が有効化する

    // 深度 RT (フルサイズ, nearest filter, RGBA packed)
    this._depthRT = new THREE.WebGLRenderTarget(1, 1, {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      type: THREE.HalfFloatType,
    });
    this._depthRT.texture.name = 'AdsDof.depth';

    // 深度素材 (BokehPass.js と同一設定)
    this._depthMat = new THREE.MeshDepthMaterial();
    this._depthMat.depthPacking = THREE.RGBADepthPacking;
    this._depthMat.blending = THREE.NoBlending;

    // Bokeh uniform オブジェクト (ShaderMaterial に直接渡し、参照を保持)
    this._u = {
      tColor: { value: null },
      tDepth: { value: this._depthRT.texture },
      focus: { value: this._focusCurrent },
      aspect: { value: camera.aspect },
      aperture: { value: 0.0 },
      maxblur: { value: 0.0 },
      nearClip: { value: camera.near },
      farClip: { value: camera.far },
    };

    this._bokehMat = new THREE.ShaderMaterial({
      // defines: DEPTH_PACKING/PERSPECTIVE_CAMERA は #include を使わず
      //   シェーダ内に hardcode しているため不要 (コンパイル最適化)
      uniforms: this._u,
      vertexShader: ADS_BOKEH_VERT,
      fragmentShader: ADS_BOKEH_FRAG,
      depthTest: false,
      depthWrite: false,
    });

    this._fsq = new FullScreenQuad(this._bokehMat);
  }

  // ---------------------------------------------------------------------------
  // 公開 API
  // ---------------------------------------------------------------------------

  /**
   * update — 毎フレーム呼ぶ。ADS 値と照準レイキャスト距離を渡す。
   *
   * @param ads01      ADS アニメーション値 0(腰だめ) → 1(完全ADS)
   * @param focusDistM 照準レイキャスト距離 (m, 正値)。ヒットなし時は遠距離 (例 500) を渡す。
   * @param dt         フレーム時間 (秒)
   */
  /**
   * forceDisable — watchdog から呼ぶ。以後 update() は早期リターンし、
   * enabled は常時 false に固定される (ADS 進行値で上書きされない)。
   */
  forceDisable(): void {
    this._forcedDisable = true;
    this.enabled = false;
  }

  update(ads01: number, focusDistM: number, dt: number): void {
    if (this._forcedDisable) return;
    // 焦点距離を指数 lerp で追従 (τ=1/8s → dt=0.125s で目標の 63% に収束)
    const tau = 8.0;
    this._focusCurrent += (focusDistM - this._focusCurrent) * (1 - Math.exp(-dt * tau));

    // ADS 強度に応じた絞り/最大ブラー
    const aperture = ads01 * 5e-6;
    const maxblur = ads01 * 0.008;

    this._u.focus.value = this._focusCurrent;
    this._u.aperture.value = aperture;
    this._u.maxblur.value = maxblur;
    // near/far はカメラ変更時のズレ防止のため毎フレーム更新
    this._u.nearClip.value = this._camera.near;
    this._u.farClip.value = this._camera.far;
    // aspect は setSize でも更新するが、カメラ aspect 変化への対策として毎フレーム更新
    // (既知バグ: setSize だけでは aspect 値がズレることがある)
    this._u.aspect.value = this._camera.aspect;

    // ads01 が閾値以下では Pass を完全停止 (深度パスも走らない)
    this.enabled = ads01 > 0.01;
  }

  /**
   * setSize — EffectComposer のリサイズ時に呼ぶ。
   * 深度 RT をリサイズし、aspect を更新する。
   */
  override setSize(w: number, h: number): void {
    if (w <= 0 || h <= 0) return; // 0寸法ガード
    this._depthRT.setSize(w, h);
    this._u.aspect.value = w / h;
  }

  /**
   * render — EffectComposer から呼ばれる (enabled=true 時のみ)。
   *
   * 深度パス → Bokeh パスの 2段構成 (BokehPass.js と同構造)。
   */
  override render(
    renderer: THREE.WebGLRenderer,
    writeBuffer: THREE.WebGLRenderTarget,
    readBuffer: THREE.WebGLRenderTarget,
    _deltaTime: number,
    _maskActive: boolean,
  ): void {
    // ── 深度パス: シーンを MeshDepthMaterial で深度 RT に描画 ──
    this._scene.overrideMaterial = this._depthMat;
    renderer.getClearColor(this._oldClearColor);
    const oldAlpha = renderer.getClearAlpha();
    const oldAutoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.setClearColor(0xffffff, 1.0); // 深度パスは白背景でクリア
    renderer.setRenderTarget(this._depthRT);
    renderer.clear();
    renderer.render(this._scene, this._camera);
    this._scene.overrideMaterial = null;
    renderer.setClearColor(this._oldClearColor, oldAlpha);
    renderer.autoClear = oldAutoClear;

    // ── Bokeh パス: シーン色 (readBuffer) + 深度 → ボケ合成 ──
    this._u.tColor.value = readBuffer.texture;
    // tDepth は constructor で _depthRT.texture に設定済み; RT リサイズ後も参照は同一

    if (this.renderToScreen) {
      renderer.setRenderTarget(null);
    } else {
      renderer.setRenderTarget(writeBuffer);
      renderer.clear();
    }
    this._fsq.render(renderer);
  }

  /** RT・材質・FSQ をすべて解放する (冪等) */
  override dispose(): void {
    if (this._disposed) return;
    this._disposed = true;
    this._depthRT.dispose();
    this._depthMat.dispose();
    this._bokehMat.dispose();
    this._fsq.dispose();
  }
}
