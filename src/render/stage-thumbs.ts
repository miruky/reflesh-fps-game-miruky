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
import { buildCinematicStageKit } from './cinematic-stage-kit';

/** imagegenで制作し、実ステージIDへ固定対応させたR64シネマティックカード。 */
export const STATIC_STAGE_THUMB_IDS = new Set([
  'kunren', 'souko', 'nakaniwa', 'kairou', 'kouwan', 'takadai', 'sakyuu', 'setsugen',
  'koushou', 'yoichi', 'okujou', 'saisekiba', 'chikurin', 'tanada', 'misaki', 'haieki',
  'kyokoku', 'kohan', 'kuko', 'onsengai',
  'z01', 'z02', 'z03', 'z04', 'z05', 'z06', 'z07', 'z08', 'z09', 'z10',
  'renshujo',
]);

export function staticStageThumbUrl(stageId: string): string | null {
  if (!STATIC_STAGE_THUMB_IDS.has(stageId)) return null;
  const base = import.meta.env.BASE_URL.endsWith('/')
    ? import.meta.env.BASE_URL
    : `${import.meta.env.BASE_URL}/`;
  return `${base}assets/stage-thumbs/${stageId}.webp`;
}

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
let scheduledHandle: number | null = null;
let scheduledKind: 'idle' | 'raf' | null = null;

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
      // 320×184をCSS縮小表示するためMSAA差はほぼ見えない。低速GPUでの生成時間と
      // 一時RTメモリを抑え、本編へGPU待ちを持ち込まない。
      antialias: false,
      powerPreference: 'high-performance',
      // toDataURL は描画バッファ保持が必須
      preserveDrawingBuffer: true,
    });
    _renderer.setPixelRatio(1); // サムネは等倍で十分
    _renderer.setSize(THUMB_W, THUMB_H, false);
    _renderer.toneMapping = THREE.ACESFilmicToneMapping;
    _renderer.outputColorSpace = THREE.SRGBColorSpace;
    _renderer.shadowMap.enabled = true;
    _renderer.shadowMap.type = THREE.PCFSoftShadowMap;
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

  // 太陽方向(elevation/azimuth → THREE 球面座標)
  const elevation = p.elevation ?? 35;
  const azimuth = p.azimuth ?? 170;
  const sunDir = sunDirection(elevation, azimuth);

  // ── 夜/ゾンビ系ステージの露出補正 ──────────────────────────────────────────
  // ambientIntensity < 0.6 または elevation <= 16 の暗ムードはサムネ専用補正を施す。
  // 「その場所が暗い雰囲気なのは伝わるが、構造物がはっきり見える」バランスを目指す。
  // • fogFactor を絞る(霧で構造物が沈むのを防ぐ)
  // • hemi/sun 強度に下限を設ける
  // • toneMappingExposure を一時ブースト(白飛び 0.9 則 = 実ゲームではなくサムネのみ)
  const isDark = (p.ambientIntensity ?? 0.8) < 0.6 || elevation <= 16;
  const fogFactor = isDark ? 0.12 : 0.28;
  scene.fog = new THREE.FogExp2(p.fog, (p.fogDensity ?? 0.005) * fogFactor);

  const hemiIntensity = isDark ? 0.85 : (p.ambientIntensity ?? 0.8) * 0.65;
  const sunBaseIntensity = p.lightIntensity ?? 1.4;
  const sunIntensity = isDark ? Math.max(1.25, sunBaseIntensity) : sunBaseIntensity;

  // 半球ライト(空/床の環境光)。
  // V34修正: 暗ムードはパレット色をライト色に使わない(近黒の光×近黒の床=黒のまま)。
  // 中立的な月光色のスタジオリグで構造を照らし、色味はマテリアル側のパレットで出す。
  const hemi = isDark
    ? new THREE.HemisphereLight(0x9fb4d8, 0x4a4e58, hemiIntensity)
    : new THREE.HemisphereLight(p.sky, p.floor, hemiIntensity);
  scene.add(hemi);

  // 指向性ライト(太陽)。暗ムードは白寄りに持ち上げ+高度を最低28°確保(掠め光の黒潰れ防止)
  const sunColor = isDark
    ? new THREE.Color(p.lightColor).lerp(new THREE.Color(0xffffff), 0.55)
    : new THREE.Color(p.lightColor);
  const thumbSunDir = isDark && elevation < 28 ? sunDirection(28, azimuth) : sunDir;
  const sun = new THREE.DirectionalLight(sunColor, sunIntensity);
  sun.position.copy(thumbSunDir).multiplyScalar(def.size);
  sun.castShadow = true;
  const shadowExtent = def.size * 0.42;
  sun.shadow.camera.left = -shadowExtent;
  sun.shadow.camera.right = shadowExtent;
  sun.shadow.camera.top = shadowExtent;
  sun.shadow.camera.bottom = -shadowExtent;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = def.size * 2.5;
  // サムネ実解像度の約3倍で十分。1024²は最終320px画像に対して過剰で、
  // ソフトウェアWebGL/統合GPUではメニュー生成の主ボトルネックになる。
  sun.shadow.mapSize.set(512, 512);
  sun.shadow.bias = -0.00035;
  sun.shadow.normalBias = 0.025;
  scene.add(sun);

  // フィルライト(太陽の逆側・強度控えめ): 影側の完全黒潰れを防ぐ
  const fill = new THREE.DirectionalLight(p.floor, sunIntensity * 0.1);
  fill.position.copy(sunDir).multiplyScalar(-def.size).setY(def.size * 0.3);
  scene.add(fill);

  // 地面プレーン(stage 範囲より 60% 広く取り床が切れて見えないようにする)
  const groundGeo = new THREE.PlaneGeometry(def.size * 1.6, def.size * 1.6);
  // V34修正: 暗ムードは近黒アルベドを中間グレー方向へ持ち上げる(反射率4%は照らせない)
  const liftColor = (hex: string): THREE.Color => {
    const c = new THREE.Color(hex);
    if (!isDark) return c;
    const lum = c.r * 0.299 + c.g * 0.587 + c.b * 0.114;
    if (lum < 0.22) c.lerp(new THREE.Color(0x6a707c), 0.42 * (1 - lum / 0.22));
    return c;
  };
  const groundMat = new THREE.MeshStandardMaterial({ color: liftColor(p.floor), roughness: 0.92 });
  const groundMesh = new THREE.Mesh(groundGeo, groundMat);
  groundMesh.rotation.x = -Math.PI / 2;
  groundMesh.position.y = 0;
  groundMesh.receiveShadow = true;
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
    if (b.ghost === true || b.legacyHorizon === true) continue;

    const colorKey = b.color + (b.emissive ? '_e' : '');
    let mat = matMap.get(colorKey);
    if (mat === undefined) {
      mat = new THREE.MeshStandardMaterial({ color: liftColor(b.color), roughness: 0.76, metalness: 0 });
      if (b.emissive) {
        mat.emissive = new THREE.Color(b.color);
        mat.emissiveIntensity = 0.38;
      }
      matMap.set(colorKey, mat);
    }

    const mesh = new THREE.Mesh(sharedBox, mat);
    mesh.position.set(b.x, b.y, b.z);
    mesh.scale.set(b.w, b.h, b.d);
    mesh.castShadow = b.h > 0.7;
    mesh.receiveShadow = true;
    scene.add(mesh);
  }

  // 本編と同じ固有ランドマーク／地表動線／中遠景をmedium予算でサムネにも反映する。
  // 生成はメニューのidle時間に1枚ずつ行い、完成後はdataURLだけを保持するため、
  // 戦闘中の描画負荷を増やさず外装・瓦礫・屋上設備まで読める密度を確保できる。
  // プレビューと出撃後のアート方向が一致し、全31面をシルエットだけでも識別できる。
  const cinematicKit = buildCinematicStageKit({
    stage: def,
    tier: 'medium',
    boxes: layout.boxes.filter((box) => !box.ghost && !box.decor),
    propPlacements: layout.propPlacements,
  });
  scene.add(cinematicKit);

  // ─ カメラ: 斜め俯瞰(かっこいい構図) ───────────────────────────
  //
  // 太陽方位 azimuth+45° の方角から高度 32° で見下ろす。
  // 「カメラ≒太陽方向の少し横」にすることで lit な面が正面に来る。
  // lookAt は最大高さの 30% ほど上(= 建物天面を中央やや上に収める)。
  //
  const camAzDeg = azimuth + 38 + ((def.seed >>> 4) % 17) - 8;
  const camElDeg = 27 + ((def.seed >>> 9) % 7);
  const camDist = def.size * 0.47; // BO3マップカードのようにランドマークへ一段寄る

  const camAzRad = THREE.MathUtils.degToRad(camAzDeg);
  const camElRad = THREE.MathUtils.degToRad(camElDeg);

  const camera = new THREE.PerspectiveCamera(50, w / h, 1, def.size * 3.5);
  camera.position.set(
    Math.sin(camAzRad) * Math.cos(camElRad) * camDist,
    Math.sin(camElRad) * camDist,
    Math.cos(camAzRad) * Math.cos(camElRad) * camDist,
  );
  // 最大高さの 30% 上空を注視点にしてビルが下寄り中央に収まるよう調整
  const heroBoxes = layout.boxes
    .filter((box) => !box.ghost && !box.decor && box.h >= Math.max(2.5, def.maxHeight * 0.25))
    .sort((a, b) => b.w * b.h * b.d - a.w * a.h * a.d)
    .slice(0, 4);
  const heroWeight = heroBoxes.reduce((sum, box) => sum + Math.max(1, box.w * box.d), 0);
  const targetX = heroWeight > 0
    ? heroBoxes.reduce((sum, box) => sum + box.x * Math.max(1, box.w * box.d), 0) / heroWeight
    : 0;
  const targetZ = heroWeight > 0
    ? heroBoxes.reduce((sum, box) => sum + box.z * Math.max(1, box.w * box.d), 0) / heroWeight
    : 0;
  camera.lookAt(targetX * 0.32, def.maxHeight * 0.28, targetZ * 0.32);

  // ─ レンダ ─────────────────────────────────────────────────────
  // 暗系ステージはサムネ専用 exposure ブースト(実ゲームのbloom0.9則はサムネ非適用)
  const baseExposure = p.exposure ?? 1.0;
  r.toneMappingExposure = isDark ? Math.min(2.1, baseExposure * 1.8) : baseExposure;
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
  cinematicKit.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) return;
    node.geometry.dispose();
    const materials = Array.isArray(node.material) ? node.material : [node.material];
    for (const material of materials) material.dispose();
    if (node instanceof THREE.InstancedMesh) node.dispose();
  });
  scene.clear();
  // renderer内部のscene/object参照も画像ごとに切り、31面生成時の蓄積を防ぐ。
  (r.renderLists as { dispose?: () => void } | undefined)?.dispose?.();

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
  scheduledHandle = null;
  scheduledKind = null;
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
    scheduledKind = 'idle';
    scheduledHandle = requestIdleCallback(() => { processNext(); }, { timeout: 1500 });
  } else {
    scheduledKind = 'raf';
    scheduledHandle = requestAnimationFrame(() => { processNext(); });
  }
}

/**
 * requestStageThumb — 非同期遅延生成。
 *
 * キャッシュ済みでも cb はDOMマウント後のマイクロタスクで呼び出す。
 * 未生成なら生成キューに追加し、空きフレームで1枚ずつ生成後に cb を呼ぶ。
 * 同じ stageId が複数回 request された場合は生成1回でまとめて解決する。
 */
export function requestStageThumb(def: StageDef, cb: ReadyCallback): void {
  // キャッシュヒット: マイクロタスクで遅延コールバック。
  //
  // R56根治(実機フラットグラデ症状): 呼び出し元(deploy.ts renderStagePanel /
  // menu.ts renderStages)は <img> を DOM へ挿入する前に requestStageThumb を呼ぶ
  // (card 生成 → requestStageThumb → grid.appendChild(card) → body.appendChild(grid) の順)。
  // ここで cb を同期実行すると、deploy.ts 側の `if (img.isConnected) img.src = url` ガードが
  // その瞬間 img.isConnected===false のため src 代入を握り潰す。コールバックは既に消費され
  // 二度と発火しないので、キャッシュ命中(=セッション内で一度でも生成済み)の再訪時に
  // サムネが永久に貼られず、プレースホルダの空→床グラデーションだけが残る。
  // マイクロタスクへ回せば呼び出し元の同期マウント(card→grid→body 挿入)完了後に発火し、
  // img は接続済みになる。dispose 済みなら isConnected===false で従来どおり無害化される。
  const cached = thumbCache.get(def.id);
  if (cached !== undefined) {
    queueMicrotask(() => {
      cb(cached);
    });
    return;
  }

  // 固定31面はimagegen製のマップ固有カードを直接配信する。メニューで31回のWebGLシーン生成を
  // 行わないため高速で、実ゲームの箱プリミティブを俯瞰した「ジオラマ」表示にも戻らない。
  // 未知の生成キャンペーンだけは下のプロシージャルフォールバックへ流す。
  const staticUrl = staticStageThumbUrl(def.id);
  if (staticUrl !== null) {
    thumbCache.set(def.id, staticUrl);
    queueMicrotask(() => cb(staticUrl));
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
  if (scheduledHandle !== null) {
    if (scheduledKind === 'idle' && typeof cancelIdleCallback !== 'undefined') {
      cancelIdleCallback(scheduledHandle);
    } else if (scheduledKind === 'raf') {
      cancelAnimationFrame(scheduledHandle);
    }
  }
  scheduledHandle = null;
  scheduledKind = null;
  idleScheduled = false;
  pendingQueue.length = 0;
  pendingCallbacks.clear();
  // サムネ用WebGLコンテキスト/影RT/プログラムを出撃前に完全解放する。
  // dataURLキャッシュは残るため生成済みカードの画質・再表示速度は変わらない。
  if (_renderer) {
    _renderer.dispose();
    _renderer.forceContextLoss();
    _renderer = null;
  }
}
