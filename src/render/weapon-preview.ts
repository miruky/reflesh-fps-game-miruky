import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { easeOutCubic } from '../core/easing';
import type { WeaponDef } from '../game/weapons';
import { applyAttachments } from '../game/attachments';
import { buildGunBody } from './viewmodel';

// R57⑦: ARMORY 3Dプレビューにアタッチメント(サイト/マズル/グリップ/マガジン)を見た目反映する
// 単一経路。新UI(menu2)の previewWeaponId は WEAPON_DEFS[id](=アタッチ未適用のベースdef、
// attachmentIds:undefined)を setWeapon へ渡すため、そのままでは buildGunBody が装着物を描けない
// (ユーザー報告「サイトを選んでも武器に変化なし」の原因)。ここで永続ロードアウト(localStorage:
// メニューと同一キーの単一ソース)から現在の装備アタッチメントを解決し、プライマリ武器の
// プレビューにだけ適用する。既に合成済みのdef(旧menu.ts / 試合経路 = attachmentIds が配列)は
// そのまま尊重して二重適用しない。localStorage 不在(テスト/SSR)でも安全に [] を返す。
const LOADOUT_STORAGE_KEY = 'hibana.loadout.v1'; // menu2/menu と同一キー(兵装選択の単一ソース)
export function loadoutAttachmentsFor(weaponId: string): string[] {
  try {
    if (typeof localStorage === 'undefined') return [];
    const raw = localStorage.getItem(LOADOUT_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as { primaryId?: unknown; attachments?: unknown };
    if (parsed.primaryId !== weaponId) return []; // 副武器/他武器のプレビューには適用しない
    return Array.isArray(parsed.attachments)
      ? parsed.attachments.filter((x): x is string => typeof x === 'string')
      : [];
  } catch {
    return [];
  }
}

// ── R53 MK.III: インスペクトループ ──────────────────────────────────
// buildGunBody の可動ノード(vm:*、rest=identity契約)をプレビュー内でゆっくり駆動し、
// 「生きている機械」を見せる。ノードの分類: recip=前後往復(スライド/ボルト等)、
// mag=弾倉の微沈み、spin=回転(ミニガンバレル/リボルバーシリンダー)。
export type InspectKind = 'recip' | 'mag' | 'spin';
export interface InspectNode {
  node: THREE.Object3D;
  kind: InspectKind;
  phase: number;
}
const INSPECT_KIND_BY_NAME: Record<string, InspectKind> = {
  'vm:slide': 'recip',
  'vm:bolt': 'recip',
  'vm:charging': 'recip',
  'vm:forend': 'recip',
  'vm:magazine': 'mag',
  'vm:cylinder': 'spin',
  'vm:barrel': 'spin',
};
export function collectInspectNodes(root: THREE.Object3D): InspectNode[] {
  const out: InspectNode[] = [];
  root.traverse((o) => {
    const kind = INSPECT_KIND_BY_NAME[o.name];
    if (kind) out.push({ node: o, kind, phase: out.length * 1.7 });
  });
  return out;
}

// R55 W-C6[5]: buildGunBody は銃身をローカル -Z 方向へ伸ばす(FPV慣習: muzzle は
// z が負)。カメラはワールド+Z側からほぼ真後ろ(-Z方向)を見ているため、
// pivot.rotation.y=0(加算ゼロ)のままだと銃身の長さが奥行きに潰れて「縦に潰れた箱」に
// 見える。横向きプロファイル(銃身が画面水平)で見せるため、pivotの基準yawを-90°回し、
// ローカル-Z(銃口)をワールド+X(=画面右)へ向ける。menu.ts weaponSilSVG の2Dシルエットも
// 「銃口=右/ストック=左」で統一されているため、この向きを3Dプレビューにも揃える。
// ターンテーブル/ドラッグの回転量はこの基準角に対して加算される(yawフィールドを直接動かす)。
const PROFILE_YAW = -Math.PI / 2;

// 台座(祭壇)のホロ光輪。アセットレス: CircleGeometry + 手続きGLSLの加算合成のみ。
// 同心リング + 外周エッジ + レーダー掃引で「兵装を捧げる祭壇」の質感を作る。
const PEDESTAL_VERT = /* glsl */ `
varying vec2 vUv;
void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;
const PEDESTAL_FRAG = /* glsl */ `
precision mediump float;
varying vec2 vUv;
uniform float uTime;
uniform vec3 uColor;
void main(){
  vec2 p = vUv - 0.5;
  float d = length(p) * 2.0;                 // 0=中心 .. 1=外周
  float glow = smoothstep(1.0, 0.0, d);      // 中心へ向かう放射減衰
  float ring = 0.5 + 0.5 * sin(d * 30.0 - uTime * 1.5);
  float edge = smoothstep(0.82, 0.98, d) * (1.0 - smoothstep(0.98, 1.02, d));
  float ang = atan(p.y, p.x);
  float sweep = (0.5 + 0.5 * sin(ang - uTime * 0.9)) * glow; // 掃引
  float a = glow * (0.12 + 0.16 * ring) + edge * 0.15 + sweep * 0.1;
  gl_FragColor = vec4(uColor * a, a);
}
`;

// ARMORYの3D武器インスペクト・プレビュー。GameLoop/SpaceBgとは独立した自前レンダラで、
// 選択中の武器(アタッチメント反映済み)を回転表示する。ドラッグで手動回転、放置でオート
// ターンテーブル。dispose() は renderer.dispose()+forceContextLoss() でGLコンテキストを
// 確実に解放する(ゲーム本体・宇宙背景と合わせて3つ目の文脈なのでブラウザの上限に達しない)。
export class WeaponPreview {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly pivot = new THREE.Group();
  private readonly accent: THREE.PointLight;
  private readonly key: THREE.DirectionalLight;
  private readonly kicker: THREE.DirectionalLight;
  private readonly pedestal: THREE.Mesh;
  private readonly pedestalMat: THREE.ShaderMaterial;
  private envRT: THREE.WebGLRenderTarget | null = null; // ショールームIBL(PMREM生成物)
  private presentT = 1; // 武器登場ドリーの進捗(setWeaponで0へ)
  private current: THREE.Group | null = null;

  private rafId = 0;
  private running = false;
  private disposed = false;
  private reduceMotion = false;
  private lastT = 0;

  private yaw = PROFILE_YAW; // 累積ヨー(横向きプロファイル基準+オートスピン+ドラッグ+慣性)
  private pitch = 0;
  private velYaw = 0; // ドラッグ離した後の慣性
  private dragging = false;
  private lastX = 0;
  private lastY = 0;

  // R53 MK.III: インスペクトループ+空撃ち
  private inspectNodes: InspectNode[] = [];
  private fireT = 0; // 空撃ちキック(1→0へ減衰)
  private downX = 0;
  private downY = 0;
  private downT = 0;
  private movedPx = 0; // pointerdownからの累積移動量(クリック/ドラッグの弁別)

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
      powerPreference: 'low-power',
    });
    this.renderer.setClearColor(0x000000, 0);
    // R15: 本編と同じ Neutral(Khronos PBR Neutral)トーンマップへ統一。AgXのままだと
    // ショールームだけ白飛び/脱色し、戦闘と色味・明度が食い違う(exposureも1.0基準へ)。
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.camera = new THREE.PerspectiveCamera(34, 1, 0.05, 50);
    this.camera.position.set(0, 0.04, 1.75);
    this.camera.lookAt(0, 0, 0);

    // ショールームIBL: RoomEnvironment(アセットレス・プリミティブ~20メッシュ)を PMREM 化し
    // scene.environment に一度だけ焼く。金属面に周辺反射が乗り、武器が「陳列棚」の質感になる。
    // fromScene は RoomEnvironment の geo/mat を解放しないので pmrem.dispose() 後に手動 dispose。
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const roomEnv = new RoomEnvironment();
    this.envRT = pmrem.fromScene(roomEnv, 0.04);
    this.scene.environment = this.envRT.texture;
    pmrem.dispose();
    roomEnv.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.geometry.dispose();
      const mat = mesh.material;
      if (Array.isArray(mat)) for (const m of mat) m.dispose();
      else mat.dispose();
    });

    this.scene.add(this.pivot);
    // ガンスミス風ライティング: 柔らかいアンビエント + キー + クール寄りのリム
    // + 下方からのキッカー + 周回アクセント。IBL を足したぶんキー光は 1.55 へ抑える(白飛び相殺)
    this.scene.add(new THREE.AmbientLight(0xb8c4d6, 0.75));
    this.key = new THREE.DirectionalLight(0xffffff, 1.55);
    this.key.position.set(2.2, 3, 2.2);
    this.scene.add(this.key);
    const rim = new THREE.DirectionalLight(0x6f8dff, 0.7);
    rim.position.set(-2.4, 1, -2);
    this.scene.add(rim);
    // キッカー: 銃身下面のエッジを起こす暖色の下方光。台座の反射光の見立て
    this.kicker = new THREE.DirectionalLight(0xffe3b0, 0.55);
    this.kicker.position.set(0.4, -1.8, -1.2);
    this.scene.add(this.kicker);
    this.accent = new THREE.PointLight(0xffc46b, 7, 7);
    this.accent.position.set(-0.5, 0.35, 0.7);
    this.scene.add(this.accent);

    // 台座のホロ光輪(武器の真下・水平)。ドラッグ回転から独立させるためsceneへ直接
    this.pedestalMat = new THREE.ShaderMaterial({
      vertexShader: PEDESTAL_VERT,
      fragmentShader: PEDESTAL_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        // R55 W-C3[7]: 武器のtracerColor(橙アンバー系が多い)に追従させると常時強い橙で
        // 発光しモック非準拠+キャプション文字と衝突するため、低彩度グレー固定にする
        uColor: { value: new THREE.Color(0x2a2f36) },
      },
    });
    this.pedestal = new THREE.Mesh(new THREE.CircleGeometry(0.72, 64), this.pedestalMat);
    this.pedestal.rotation.x = -Math.PI / 2; // 水平に寝かせて光輪に
    this.pedestal.position.y = -0.44;
    this.scene.add(this.pedestal);

    canvas.style.touchAction = 'none';
    canvas.style.cursor = 'grab';
    canvas.addEventListener('pointerdown', this.onDown);
    canvas.addEventListener('pointermove', this.onMove);
    canvas.addEventListener('pointerup', this.onUp);
    canvas.addEventListener('pointercancel', this.onUp);
    window.addEventListener('resize', this.onResize);
    this.resize();
  }

  private readonly onResize = (): void => this.resize();

  private readonly onDown = (e: PointerEvent): void => {
    this.dragging = true;
    this.velYaw = 0;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    this.downX = e.clientX;
    this.downY = e.clientY;
    this.downT = performance.now();
    this.movedPx = 0;
    this.canvas.setPointerCapture(e.pointerId);
    this.canvas.style.cursor = 'grabbing';
  };
  private readonly onMove = (e: PointerEvent): void => {
    if (!this.dragging) return;
    const dx = (e.clientX - this.lastX) * 0.01;
    const dy = (e.clientY - this.lastY) * 0.01;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    this.movedPx = Math.max(
      this.movedPx,
      Math.hypot(e.clientX - this.downX, e.clientY - this.downY),
    );
    this.yaw += dx;
    this.pitch = Math.max(-0.6, Math.min(0.6, this.pitch + dy));
    this.velYaw = dx;
  };
  private readonly onUp = (e: PointerEvent): void => {
    const wasDragging = this.dragging;
    this.dragging = false;
    this.canvas.style.cursor = 'grab';
    try {
      this.canvas.releasePointerCapture(e.pointerId);
    } catch {
      // 既に解放済みなら無視
    }
    // R53 MK.III: 動かさず短く押した=クリック → 空撃ち(ドラッグ回転とは弁別)
    if (wasDragging && this.movedPx < 6 && performance.now() - this.downT < 450) {
      this.fireT = 1;
    }
  };

  setReduceMotion(v: boolean): void {
    this.reduceMotion = v;
  }

  // 武器を差し替える。前のメッシュ資源は解放し、共有マテリアルから切り離した複製を持つ
  // (ゲーム本体ViewModelのdisposeShared()に巻き込まれないようにする)。
  setWeapon(def: WeaponDef): void {
    if (this.disposed) return;
    this.clearCurrent();
    // R57⑦: アタッチ未適用のベースdef(attachmentIds===undefined)は、永続ロードアウトの
    // 現在装備アタッチメントを解決してプレビューに反映する。合成済みdefはそのまま使う。
    let composed = def;
    if (def.attachmentIds === undefined) {
      const ids = loadoutAttachmentsFor(def.id);
      if (ids.length > 0) composed = applyAttachments(def, ids);
    }
    const { gun } = buildGunBody(composed);
    // マテリアルをこのプレビュー専用に複製して所有(モジュール共有singletonと分離)。
    // 複製にだけショールームIBLを効かせる(envMapIntensity=0.8・ゲーム/shared は非改変)。
    const clonePreview = (m: THREE.Material): THREE.Material => {
      const c = m.clone();
      if (c instanceof THREE.MeshStandardMaterial) c.envMapIntensity = 0.8;
      return c;
    };
    gun.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const mat = mesh.material;
      mesh.material = Array.isArray(mat) ? mat.map(clonePreview) : clonePreview(mat);
    });
    this.fitToView(gun);
    this.pivot.add(gun);
    this.current = gun;
    this.inspectNodes = collectInspectNodes(gun); // MK.III: 可動ノードを一度だけ捕捉
    this.fireT = 0;
    this.accent.color.setHex(def.tracerColor);
    // R55 W-C3[7]: 祭壇光輪はtracerColorに追従させない(uColorは低彩度グレー固定)
    this.presentT = 0; // 新武器の登場ドリーを開始
  }

  private clearCurrent(): void {
    this.inspectNodes = [];
    if (!this.current) return;
    this.pivot.remove(this.current);
    this.current.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.geometry.dispose();
      const mat = mesh.material;
      if (Array.isArray(mat)) for (const m of mat) m.dispose();
      else mat.dispose();
    });
    this.current = null;
  }

  // bboxで中心化し、ビューに収まる一様スケールへ
  private fitToView(group: THREE.Group): void {
    const box = new THREE.Box3().setFromObject(group);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    group.position.sub(center);
    const maxDim = Math.max(size.x, size.y, size.z, 1e-3);
    const scale = 1.05 / maxDim;
    group.scale.setScalar(scale);
  }

  start(): void {
    if (this.disposed) return;
    this.running = true;
    this.canvas.hidden = false;
    this.resize();
    this.startLoop();
  }

  stop(): void {
    this.running = false;
    this.pauseLoop();
  }

  suspend(): void {
    this.pauseLoop();
  }

  resume(): void {
    if (this.disposed || !this.running) return;
    this.startLoop();
  }

  private startLoop(): void {
    if (this.rafId) return;
    const tick = (): void => {
      this.frame();
      if (this.rafId !== 0) this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  private pauseLoop(): void {
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = 0;
  }

  private frame(): void {
    const now = performance.now();
    const dt60 = this.lastT === 0 ? 1 : Math.min(((now - this.lastT) / 1000) * 60, 3);
    this.lastT = now;
    if (!this.dragging) {
      // 慣性 + 省モーションでなければ緩いオートスピン
      this.yaw += this.velYaw * dt60;
      this.velYaw *= Math.pow(0.9, dt60);
      if (Math.abs(this.velYaw) < 0.0004) this.velYaw = 0;
      if (!this.reduceMotion) this.yaw += 0.006 * dt60;
    }
    // R53 MK.III: 空撃ちキック(減衰)+可動ノードのインスペクト駆動。
    // ノードは rest=identity 契約なので毎フレーム絶対値で上書きすれば累積誤差なし
    // (spinのみ加算回転=連続性優先)。
    const fire = easeOutCubic(this.fireT);
    if (this.fireT > 0) this.fireT = Math.max(0, this.fireT - dt60 * 0.07);
    const tSec = now * 0.001;
    if (!this.reduceMotion) {
      for (const it of this.inspectNodes) {
        if (it.kind === 'recip') {
          it.node.position.z =
            Math.max(0, Math.sin(tSec * 1.3 + it.phase)) * 0.006 + fire * 0.03;
        } else if (it.kind === 'mag') {
          it.node.position.y = Math.sin(tSec * 0.9 + it.phase) * -0.0035 - fire * 0.008;
        } else {
          it.node.rotation.z += (0.0025 + fire * 0.06) * dt60;
        }
      }
    } else {
      for (const it of this.inspectNodes) {
        if (it.kind === 'recip') it.node.position.z = fire * 0.02;
      }
    }
    this.pivot.rotation.set(this.pitch + fire * 0.03, this.yaw, 0);

    if (this.reduceMotion) {
      // 省モーション: 登場ドリー/呼吸/光の周回/掃引を止め、静止ポーズで見せる
      // (空撃ちキックのみ控えめに残す=クリックへの応答は機能)
      this.presentT = 1;
      this.pivot.position.set(0, 0, fire * 0.02);
      this.pivot.scale.setScalar(1);
      this.key.intensity = 1.55;
    } else {
      // 登場ドリー: わずかに沈み+奥から迫り上がり、通常スケール・位置へ寄る。
      // 併せてキー光を一瞬持ち上げて「披露」のハイライトを流す
      this.presentT = Math.min(1, this.presentT + dt60 * 0.05);
      const pres = easeOutCubic(this.presentT);
      const breath = Math.sin(now * 0.0016) * 0.01;
      // 空撃ちキック: 手前へ短く跳ね、キー光が一瞬爆ぜる(MK.III)
      this.pivot.position.set(0, (1 - pres) * -0.14 + breath, (1 - pres) * -0.12 + fire * 0.05);
      this.pivot.scale.setScalar(0.96 + 0.04 * pres);
      this.key.intensity = 1.55 + (1 - pres) * 0.6 + fire * 0.8;
      // アクセント光を武器の周りへゆっくり周回させ、金属面にハイライトを流す
      const a = now * 0.0006;
      this.accent.position.set(Math.cos(a) * 0.72, 0.35, Math.sin(a) * 0.72);
      this.accent.intensity = 7 + fire * 9;
      // 祭壇のホロ光輪を掃引させる
      this.pedestalMat.uniforms.uTime!.value = now * 0.001;
    }

    this.renderer.render(this.scene, this.camera);
  }

  resize(): void {
    const w = Math.max(1, this.canvas.clientWidth || 320);
    const h = Math.max(1, this.canvas.clientHeight || 240);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (this.running && this.rafId === 0) this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stop();
    this.canvas.removeEventListener('pointerdown', this.onDown);
    this.canvas.removeEventListener('pointermove', this.onMove);
    this.canvas.removeEventListener('pointerup', this.onUp);
    this.canvas.removeEventListener('pointercancel', this.onUp);
    window.removeEventListener('resize', this.onResize);
    this.clearCurrent();
    this.pedestal.geometry.dispose();
    this.pedestalMat.dispose();
    if (this.envRT) {
      this.envRT.dispose();
      this.envRT = null;
    }
    this.scene.environment = null;
    this.renderer.dispose();
    // 一過性キャンバスなのでGLコンテキストを明示破棄(ブラウザの同時コンテキスト上限対策)
    this.renderer.forceContextLoss();
  }
}
