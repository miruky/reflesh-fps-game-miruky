// R54-F7: フォトモード(P2旗艦)。ポーズ画面から入る自由飛行カメラ+構図オーバーレイ+
// フィルタ+PNG書き出し。ゲーム状態は main.ts が match.update()/match.frame() を
// 呼ばないことで「構造的に」凍結する(このモジュールは試合状態に一切触れない)。
// カメラは Match の公開 camera を直接動かし、退出後は次フレームの syncCamera が
// 一人称姿勢を取り戻す(fovのみ本モジュールが保存/復元する)。
import * as THREE from 'three';
import '../mk3-phase2.css';
import type { Input } from '../core/input';

export interface PhotoModeOpts {
  camera: THREE.PerspectiveCamera;
  input: Input;
  stageSize: number; // ステージ一辺(m)。AABBクランプの基準
  canvas: HTMLCanvasElement; // 撮影対象(rendererのdomElement)
  filterAvailable: boolean; // PostFX搭載時のみtrue(low tierはフィルタ無効)
  setFilter(mode: 0 | 1 | 2 | 3): void; // Match.setPhotoFilter への薄い橋
  reduceMotion: boolean; // 撮影フラッシュ等の省モーションゲート
}

export const PHOTO_ALT_MAX = 80; // 高度上限(m)
export const PHOTO_ALT_MIN = 0.3; // 地面すれすれの下限(m)
export const PHOTO_MARGIN = 4; // ステージAABBの外周余白(m)
export const PHOTO_SPEED = 8; // 移動速度(m/s)
export const PHOTO_SPEED_FAST = 24; // SHIFT時(m/s)
const PHOTO_LOOK_SENS = 0.0022; // rad/px
const PHOTO_PITCH_MAX = Math.PI / 2 - 0.02;

/** フィルタ表示名(uPhoto の 0-3 に対応)。 */
export const PHOTO_FILTERS = ['ノーマル', 'ノワール', 'ビビッド', '帝王'] as const;

/** 位置クランプ(純粋関数): ステージAABB+余白のXZ、高度0.3..80m。 */
export function photoClampPos(pos: THREE.Vector3, stageSize: number): THREE.Vector3 {
  const half = stageSize / 2 + PHOTO_MARGIN;
  pos.x = Math.min(half, Math.max(-half, pos.x));
  pos.z = Math.min(half, Math.max(-half, pos.z));
  pos.y = Math.min(PHOTO_ALT_MAX, Math.max(PHOTO_ALT_MIN, pos.y));
  return pos;
}

export class PhotoMode {
  private yaw = 0;
  private pitch = 0;
  private savedFov = 60;
  private gridMode: 0 | 1 | 2 = 0; // 0=なし / 1=三分割 / 2=黄金比
  private letterboxOn = false;
  private filter: 0 | 1 | 2 | 3 = 0;
  private pendingCapture = false;
  private root: HTMLDivElement | null = null;
  private filterLabelEl: HTMLElement | null = null;
  private flashEl: HTMLElement | null = null;
  private readonly keyHandler = (e: KeyboardEvent): void => this.onKey(e);
  private readonly moveScratch = new THREE.Vector3();
  private readonly fwdScratch = new THREE.Vector3();
  private readonly rightScratch = new THREE.Vector3();

  constructor(private readonly opts: PhotoModeOpts) {}

  /** フォトモード開始: 現在のカメラ姿勢からyaw/pitchを引き継ぎ、オーバーレイDOMを構築。 */
  enter(): void {
    const cam = this.opts.camera;
    const e = new THREE.Euler().setFromQuaternion(cam.quaternion, 'YXZ');
    this.yaw = e.y;
    this.pitch = e.x;
    this.savedFov = cam.fov;
    this.buildDom();
    window.addEventListener('keydown', this.keyHandler);
  }

  /** 毎レンダフレーム(main.tsのループから)。移動+視点。dtは実秒。 */
  frame(dt: number): void {
    const { input, camera } = this.opts;
    // 視点: pointer lock中のマウス相対量(input.endFrame は main が呼ぶ)
    this.yaw -= input.mouseDX * PHOTO_LOOK_SENS;
    this.pitch -= input.mouseDY * PHOTO_LOOK_SENS;
    this.pitch = Math.min(PHOTO_PITCH_MAX, Math.max(-PHOTO_PITCH_MAX, this.pitch));
    camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
    // 移動: カメラの向きに沿った自由飛行(SPACE上昇/CTRL・C下降/SHIFT加速)
    const speed = input.isDown('sprint') ? PHOTO_SPEED_FAST : PHOTO_SPEED;
    const fwd = this.fwdScratch.set(0, 0, -1).applyQuaternion(camera.quaternion);
    const right = this.rightScratch.set(1, 0, 0).applyQuaternion(camera.quaternion);
    const move = this.moveScratch.set(0, 0, 0);
    if (input.isDown('forward')) move.add(fwd);
    if (input.isDown('back')) move.sub(fwd);
    if (input.isDown('right')) move.add(right);
    if (input.isDown('left')) move.sub(right);
    if (input.isDown('jump')) move.y += 1;
    if (input.isDown('crouch')) move.y -= 1;
    if (move.lengthSq() > 0) {
      move.normalize().multiplyScalar(speed * dt);
      camera.position.add(move);
      photoClampPos(camera.position, this.opts.stageSize);
    }
  }

  /**
   * match.render() の直後・同一タスク内で呼ぶ(main.tsのループが保証)。
   * preserveDrawingBuffer:false のWebGLキャンバスは合成後にバックバッファが破棄される
   * ため、toBlob は「renderと同一タスク」で呼ばなければ黒画像になる — rAF跨ぎ・
   * setTimeout経由の遅延キャプチャは禁止(このメソッドの存在理由)。
   */
  afterRender(): void {
    if (!this.pendingCapture) return;
    this.pendingCapture = false;
    this.opts.canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `hibana-photo-${Date.now()}.png`;
      a.click();
      // click() の取り込み完了後に解放(即時revokeはダウンロード失敗の恐れ)
      window.setTimeout(() => URL.revokeObjectURL(url), 2000);
    }, 'image/png');
    // 撮影フラッシュ(白の短い明滅)。省モーション時はスキップ
    if (!this.opts.reduceMotion && this.flashEl) {
      const el = this.flashEl;
      el.style.transition = 'none';
      el.style.opacity = '0.55';
      requestAnimationFrame(() => {
        el.style.transition = 'opacity 0.3s ease-out';
        el.style.opacity = '0';
      });
    }
  }

  /** 退出: フィルタ0復帰+DOM/リスナー解除+fov復元(位置姿勢はsyncCameraが取り戻す)。 */
  dispose(): void {
    this.opts.setFilter(0);
    window.removeEventListener('keydown', this.keyHandler);
    this.root?.remove();
    this.root = null;
    const cam = this.opts.camera;
    if (Math.abs(cam.fov - this.savedFov) > 0.01) {
      cam.fov = this.savedFov;
      cam.updateProjectionMatrix();
    }
  }

  private onKey(e: KeyboardEvent): void {
    switch (e.code) {
      case 'KeyG': {
        this.gridMode = ((this.gridMode + 1) % 3) as 0 | 1 | 2;
        this.applyOverlayState();
        break;
      }
      case 'KeyL': {
        this.letterboxOn = !this.letterboxOn;
        this.applyOverlayState();
        break;
      }
      case 'Digit1':
      case 'Digit2':
      case 'Digit3':
      case 'Digit4': {
        if (!this.opts.filterAvailable) break; // low tier: PostFX非搭載
        this.filter = (Number(e.code.slice(-1)) - 1) as 0 | 1 | 2 | 3;
        this.opts.setFilter(this.filter);
        if (this.filterLabelEl) this.filterLabelEl.textContent = PHOTO_FILTERS[this.filter];
        break;
      }
      case 'Enter': {
        this.pendingCapture = true; // 実キャプチャは afterRender(同一タスク規約)
        break;
      }
      default:
        break;
    }
  }

  private applyOverlayState(): void {
    if (!this.root) return;
    this.root.classList.toggle('p2-grid-thirds', this.gridMode === 1);
    this.root.classList.toggle('p2-grid-golden', this.gridMode === 2);
    this.root.classList.toggle('p2-letterbox-on', this.letterboxOn);
  }

  private buildDom(): void {
    const root = document.createElement('div');
    root.id = 'p2-photo';
    root.setAttribute('aria-hidden', 'true');
    // 構図グリッド: 三分割(33.3/66.7)と黄金比(38.2/61.8)をinline SVGで(静的=省モーション非該当)
    const gridLines = (a: number, b: number, cls: string): string =>
      `<g class="${cls}">
        <line x1="${a}" y1="0" x2="${a}" y2="100"/><line x1="${b}" y1="0" x2="${b}" y2="100"/>
        <line x1="0" y1="${a}" x2="100" y2="${a}"/><line x1="0" y1="${b}" x2="100" y2="${b}"/>
      </g>`;
    root.innerHTML = `
      <svg class="p2-grid" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        ${gridLines(33.333, 66.667, 'p2-grid-g-thirds')}
        ${gridLines(38.197, 61.803, 'p2-grid-g-golden')}
      </svg>
      <div class="p2-lb p2-lb-t"></div>
      <div class="p2-lb p2-lb-b"></div>
      <div class="p2-photo-flash"></div>
      <div class="p2-photo-head">
        <span class="p2-photo-title">PHOTO MODE</span>
        <span class="p2-photo-filter" data-id="p2-filter">${
          this.opts.filterAvailable ? PHOTO_FILTERS[0] : 'フィルタ: 低画質では無効'
        }</span>
      </div>
      <div class="p2-photo-keys">
        WASD 移動 / SPACE 上昇 / C 下降 / SHIFT 加速 / G グリッド / L レターボックス${
          this.opts.filterAvailable ? ' / 1-4 フィルター' : ''
        } / ENTER 撮影 / ESC 終了
      </div>
    `;
    document.body.appendChild(root);
    this.root = root;
    this.filterLabelEl = root.querySelector('[data-id="p2-filter"]');
    this.flashEl = root.querySelector('.p2-photo-flash');
  }
}
