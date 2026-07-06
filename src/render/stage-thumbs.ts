/**
 * stage-thumbs.ts — オフスクリーン WebGL によるステージサムネ生成。
 *
 * generateStage() の実レイアウト(BoxSpec)を THREE.js でレンダし、
 * 「そのステージの写真」に見えるかっこいい斜め俯瞰サムネを返す。
 *
 * API:
 *   renderStageThumb(def, w?, h?): string  … 同期1フレームレンダ → dataURL
 *   requestStageThumb(def, cb)             … 非同期遅延生成(rIC/rAF 分割)
 *
 * 設計方針:
 *  - WebGLRenderer を1個だけモジュール生存中に保持し再利用(コンテキスト枯渇防止)
 *  - 1ステージ/アイドルスロットのペース(requestIdleCallback or rAF fallback)
 *  - 生成済み dataURL は Map<stageId, dataURL> でキャッシュ(セッション内固定)
 *  - 各フレームのシーンオブジェクト(Geometry/Material/Mesh)は render 後に全て dispose
 */

import * as THREE from 'three';
import type { StageDef } from '../game/stage';
import { generateStage } from '../game/stage';

// ── サムネイル寸法: 既存の .stage-preview aspect-ratio 160/92 に合わせる ──
const THUMB_W = 320;
const THUMB_H = 184; // 320 * (92/160) = 184 で 160/92 比率を維持

// ── セッション内キャッシュ(stageId → dataURL) ──
const thumbCache = new Map<string, string>();

// ── 非同期生成キュー ──
type ReadyCallback = (dataURL: string) => void;
const pendingCallbacks = new Map<string, ReadyCallback[]>();
const pendingQueue: StageDef[] = [];
let idleScheduled = false;

// ── WebGLRenderer シングルトン(遅延生成・以降ずっと保持) ──
let _renderer: THREE.WebGLRenderer | null = null;

function getRenderer(): THREE.WebGLRenderer | null {
  if (_renderer !== null) return _renderer;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = THUMB_W;
    canvas.height = THUMB_H;
    _renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      powerPreference: 'low-power',
      // toDataURL は描画バッファ保持が必須
      preserveDrawingBuffer: true,
    });
    _renderer.setPixelRatio(1); // サムネは等倍で十分
    _renderer.setSize(THUMB_W, THUMB_H, false);
    _renderer.toneMapping = THREE.NeutralToneMapping;
    _renderer.outputColorSpace = THREE.SRGBColorSpace;
  } catch {
    _renderer = null;
  }
  return _renderer;
}

// ── 太陽方向(match.ts の sunDir 計算と同一ロジック) ──
function sunDirection(elevation: number, azimuth: number): THREE.Vector3 {
  const v = new THREE.Vector3();
  // setFromSphericalCoords(r, phi, theta): phi=Y軸からの極角, theta=方位角
  // elevation(地平線上の角度) → phi = 90 - elevation
  v.setFromSphericalCoords(
    1,
    THREE.MathUtils.degToRad(90 - elevation),
    THREE.MathUtils.degToRad(azimuth),
  );
  return v;
}

/**
 * renderStageThumb — 同期レンダ。
 * シーンを構築→1フレームレンダ→dataURL→シーン完全 dispose。
 * キャッシュ済みなら即返却。
 */
export function renderStageThumb(def: StageDef, w = THUMB_W, h = THUMB_H): string {
  const cached = thumbCache.get(def.id);
  if (cached !== undefined) return cached;

  const r = getRenderer();
  if (r === null) return '';

  // サイズが変わっていれば再設定
  if (r.domElement.width !== w || r.domElement.height !== h) {
    r.setSize(w, h, false);
  }

  // ─ シーン組み立て ─────────────────────────────────────────────
  const scene = new THREE.Scene();
  const p = def.palette;

  // 空色 + 薄フォグ(実ゲームの 0.3 倍程度に抑えサムネが霧で沈まない)
  scene.background = new THREE.Color(p.sky);
  scene.fog = new THREE.FogExp2(p.fog, (p.fogDensity ?? 0.005) * 0.28);

  // 太陽方向(elevation/azimuth → THREE 球面座標)
  const elevation = p.elevation ?? 35;
  const azimuth = p.azimuth ?? 170;
  const sunDir = sunDirection(elevation, azimuth);

  // 半球ライト(空/床の環境光)
  const hemi = new THREE.HemisphereLight(p.sky, p.floor, (p.ambientIntensity ?? 0.8) * 0.65);
  scene.add(hemi);

  // 指向性ライト(太陽)
  const sun = new THREE.DirectionalLight(p.lightColor, p.lightIntensity ?? 1.4);
  sun.position.copy(sunDir).multiplyScalar(def.size);
  scene.add(sun);

  // フィルライト(太陽の逆側・強度控えめ): 影側の完全黒潰れを防ぐ
  const fill = new THREE.DirectionalLight(p.floor, (p.lightIntensity ?? 1.4) * 0.1);
  fill.position.copy(sunDir).multiplyScalar(-def.size).setY(def.size * 0.3);
  scene.add(fill);

  // 地面プレーン(stage 範囲より 60% 広く取り床が切れて見えないようにする)
  const groundGeo = new THREE.PlaneGeometry(def.size * 1.6, def.size * 1.6);
  const groundMat = new THREE.MeshStandardMaterial({ color: p.floor, roughness: 0.92 });
  const groundMesh = new THREE.Mesh(groundGeo, groundMat);
  groundMesh.rotation.x = -Math.PI / 2;
  groundMesh.position.y = 0;
  scene.add(groundMesh);

  // ─ ステージボックス(generateStage の BoxSpec を全て追加) ──────
  // ghost = コライダーのみ(不可視)→スキップ
  // それ以外(decor = 遠景シルエット含む)はすべて描画
  const layout = generateStage(def);

  // BoxGeometry(1,1,1) を共有してスケールで実寸に合わせる
  const sharedBox = new THREE.BoxGeometry(1, 1, 1);

  // 色ごとに MeshStandardMaterial をまとめる(draw call 削減ではなくオブジェクト数削減)
  const matMap = new Map<string, THREE.MeshStandardMaterial>();

  for (const b of layout.boxes) {
    if (b.ghost === true) continue;

    const colorKey = b.color + (b.emissive ? '_e' : '');
    let mat = matMap.get(colorKey);
    if (mat === undefined) {
      mat = new THREE.MeshStandardMaterial({ color: b.color, roughness: 0.76, metalness: 0 });
      if (b.emissive) {
        mat.emissive = new THREE.Color(b.color);
        mat.emissiveIntensity = 0.38;
      }
      matMap.set(colorKey, mat);
    }

    const mesh = new THREE.Mesh(sharedBox, mat);
    mesh.position.set(b.x, b.y, b.z);
    mesh.scale.set(b.w, b.h, b.d);
    scene.add(mesh);
  }

  // ─ カメラ: 斜め俯瞰(かっこいい構図) ───────────────────────────
  //
  // 太陽方位 azimuth+45° の方角から高度 32° で見下ろす。
  // 「カメラ≒太陽方向の少し横」にすることで lit な面が正面に来る。
  // lookAt は最大高さの 30% ほど上(= 建物天面を中央やや上に収める)。
  //
  const camAzDeg = azimuth + 45;
  const camElDeg = 32;
  const camDist = def.size * 0.52; // stage 全体より少し寄り・中心の建物が映える距離

  const camAzRad = THREE.MathUtils.degToRad(camAzDeg);
  const camElRad = THREE.MathUtils.degToRad(camElDeg);

  const camera = new THREE.PerspectiveCamera(50, w / h, 1, def.size * 3.5);
  camera.position.set(
    Math.sin(camAzRad) * Math.cos(camElRad) * camDist,
    Math.sin(camElRad) * camDist,
    Math.cos(camAzRad) * Math.cos(camElRad) * camDist,
  );
  // 最大高さの 30% 上空を注視点にしてビルが下寄り中央に収まるよう調整
  camera.lookAt(0, def.maxHeight * 0.3, 0);

  // ─ レンダ ─────────────────────────────────────────────────────
  r.toneMappingExposure = p.exposure ?? 1.0;
  r.render(scene, camera);

  // ─ dataURL 取得 ────────────────────────────────────────────────
  let dataURL: string;
  try {
    dataURL = r.domElement.toDataURL('image/webp');
    // webp 非対応ブラウザ(Edge 旧版等)は PNG に fallback
    if (dataURL === 'data:,' || dataURL.length < 200) {
      dataURL = r.domElement.toDataURL('image/png');
    }
  } catch {
    try {
      dataURL = r.domElement.toDataURL('image/png');
    } catch {
      dataURL = '';
    }
  }

  // ─ シーン完全 dispose ─────────────────────────────────────────
  // Geometry・Material を全て解放してから scene.clear()
  groundGeo.dispose();
  groundMat.dispose();
  sharedBox.dispose();
  for (const mat of matMap.values()) {
    mat.dispose();
  }
  scene.clear();

  // ─ キャッシュ登録 ─────────────────────────────────────────────
  if (dataURL.length > 0) {
    thumbCache.set(def.id, dataURL);
  }
  return dataURL;
}

// ── 非同期キュー処理 ─────────────────────────────────────────────────────

function flushCallbacks(stageId: string, dataURL: string): void {
  const cbs = pendingCallbacks.get(stageId);
  if (cbs === undefined) return;
  pendingCallbacks.delete(stageId);
  for (const cb of cbs) cb(dataURL);
}

function processNext(): void {
  idleScheduled = false;
  const def = pendingQueue.shift();
  if (def === undefined) return;

  // 既にキャッシュされている場合(別パスで生成済み)はコールバックだけ解決する
  const already = thumbCache.get(def.id);
  if (already !== undefined) {
    flushCallbacks(def.id, already);
  } else {
    const url = renderStageThumb(def);
    flushCallbacks(def.id, url);
  }

  // 残りがあれば次フレームへ(メニュー操作の邪魔をしない)
  if (pendingQueue.length > 0) scheduleNext();
}

function scheduleNext(): void {
  if (idleScheduled) return;
  idleScheduled = true;

  // requestIdleCallback があれば使う(timeout=1500ms でフレーム欠損でも最終的に完了)
  if (typeof requestIdleCallback !== 'undefined') {
    requestIdleCallback(() => { processNext(); }, { timeout: 1500 });
  } else {
    requestAnimationFrame(() => { processNext(); });
  }
}

/**
 * requestStageThumb — 非同期遅延生成。
 *
 * キャッシュ済みなら cb を同期で即呼び出す。
 * 未生成なら生成キューに追加し、空きフレームで1枚ずつ生成後に cb を呼ぶ。
 * 同じ stageId が複数回 request された場合は生成1回でまとめて解決する。
 */
export function requestStageThumb(def: StageDef, cb: ReadyCallback): void {
  // キャッシュヒット: 同期コールバック
  const cached = thumbCache.get(def.id);
  if (cached !== undefined) {
    cb(cached);
    return;
  }

  // 既にキュー投入済みならコールバックだけ追加
  const existing = pendingCallbacks.get(def.id);
  if (existing !== undefined) {
    existing.push(cb);
    return;
  }

  // 新規キュー投入
  pendingCallbacks.set(def.id, [cb]);
  pendingQueue.push(def);
  scheduleNext();
}

// V32: 出撃時に未生成キューを破棄する(試合中のトリクル生成ヒッチ防止)。
// メニューへ戻って再表示された時に requestStageThumb が再キューするので安全。
export function cancelPendingThumbs(): void {
  pendingQueue.length = 0;
  pendingCallbacks.clear();
}
