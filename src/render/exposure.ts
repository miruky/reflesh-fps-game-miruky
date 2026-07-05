/**
 * CPU-side ヒューリスティック自動露出コントローラー。
 *
 * ## 設計方針
 * - GPU readback なし・DOM/renderer 依存なし(純粋数値計算)。
 * - 毎フレーム `update()` を呼び、返り値を `renderer.toneMappingExposure` に代入するのは統合側の責務。
 *
 * ## アルゴリズム
 * 1. `up = 0.5 + 0.5 * camForward.y` で空向き係数を算出。
 * 2. `skyF = smoothstep(0.45, 0.85, up)` で空への寄与率を求める。
 * 3. ゾーン EV(屋内/屋外の補間)と skyEV を lerp して targetEV を決定。
 * 4. 非対称時定数で currentEV を targetEV に近づける:
 *    - 暗方向(targetEV < currentEV) → tau = 2.5 s (ゆっくり絞る)
 *    - 明方向(targetEV > currentEV) → tau = 0.8 s (すばやく開く)
 * 5. `exposure = baseExposure * 2^currentEV`
 *
 * ## デフォルト値
 * - outdoorEV =  0.0
 * - indoorEV  = +0.55
 * - skyEV     = -0.75
 */

import type { Vector3 } from 'three';

// ── ローカルヘルパー ──────────────────────────────────────────────────────────

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0.0, Math.min(1.0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3.0 - 2.0 * t);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

// ── 公開型 ───────────────────────────────────────────────────────────────────

/** `configure()` に渡すオプション。`baseExposure` は必須。 */
export interface AutoExposureOptions {
  /** 基準露出値。renderer.toneMappingExposure の分母になる係数。 */
  baseExposure: number;
  /** 屋外時の EV オフセット(既定 0.0)。 */
  outdoorEV?: number;
  /** 屋内時の EV オフセット(既定 +0.55)。 */
  indoorEV?: number;
  /** 空を直視したときの EV オフセット(既定 -0.75)。 */
  skyEV?: number;
}

// ── メインクラス ─────────────────────────────────────────────────────────────

/**
 * CPU-side 自動露出コントローラー。
 *
 * 統合例:
 * ```ts
 * const ae = new AutoExposure();
 * // ゲームループ内:
 * const fwd = new THREE.Vector3();
 * camera.getWorldDirection(fwd);
 * renderer.toneMappingExposure = ae.update(dt, fwd, indoor01);
 * ```
 */
export class AutoExposure {
  private baseExposure = 1.0;
  private outdoorEV = 0.0;
  private indoorEV = 0.55;
  private skyEV = -0.75;
  private currentEV = 0.0;

  /**
   * 毎フレーム呼び出す。返り値を `renderer.toneMappingExposure` に代入する。
   *
   * @param dt         フレーム時間(秒)。0 を渡すと状態を変えずに現在の exposure を返す。
   * @param camForward カメラ前方ベクトル(正規化済み)。`camera.getWorldDirection(v)` で取得。
   * @param indoor01   屋内度合い(0 = 屋外, 1 = 完全屋内)。統合側が供給する。
   * @returns `renderer.toneMappingExposure` に代入する最終 exposure 値。
   */
  update(dt: number, camForward: Vector3, indoor01: number): number {
    // 空向き係数: 真上=1.0, 水平=0.5, 真下=0.0
    const up = 0.5 + 0.5 * camForward.y;
    const skyF = smoothstep(0.45, 0.85, up);

    const zoneEV = lerp(this.outdoorEV, this.indoorEV, indoor01);
    const targetEV = lerp(zoneEV, this.skyEV, skyF);

    // 非対称時定数:
    //   targetEV < currentEV → 暗方向へ絞る → tau = 2.5 s (ゆっくり)
    //   targetEV > currentEV → 明方向へ開く → tau = 0.8 s (すばやく)
    const tau = targetEV < this.currentEV ? 2.5 : 0.8;
    const alpha = 1.0 - Math.exp(-dt / tau);
    this.currentEV += alpha * (targetEV - this.currentEV);

    return this.baseExposure * Math.pow(2.0, this.currentEV);
  }

  /**
   * 露出パラメータを更新する。
   * `baseExposure` は必須。`outdoorEV` / `indoorEV` / `skyEV` は省略可(変更なし)。
   */
  configure(opts: AutoExposureOptions): void {
    this.baseExposure = opts.baseExposure;
    if (opts.outdoorEV !== undefined) this.outdoorEV = opts.outdoorEV;
    if (opts.indoorEV !== undefined) this.indoorEV = opts.indoorEV;
    if (opts.skyEV !== undefined) this.skyEV = opts.skyEV;
  }

  /** `currentEV` を 0.0 にリセットする。シーン遷移時などに使用。 */
  reset(): void {
    this.currentEV = 0.0;
  }
}
