import * as THREE from 'three';
import { easeOutCubic } from '../core/easing';
import type { WeaponDef } from '../game/weapons';
import { buildGunBody } from './viewmodel';

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
  float a = glow * (0.12 + 0.16 * ring) + edge * 0.7 + sweep * 0.1;
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
  private presentT = 1; // 武器登場ドリーの進捗(setWeaponで0へ)
  private current: THREE.Group | null = null;

  private rafId = 0;
  private running = false;
  private disposed = false;
  private reduceMotion = false;
  private lastT = 0;

  private yaw = 0; // 累積ヨー(オートスピン+ドラッグ+慣性)
  private pitch = 0;
  private velYaw = 0; // ドラッグ離した後の慣性
  private dragging = false;
  private lastX = 0;
  private lastY = 0;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
      powerPreference: 'low-power',
    });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.toneMapping = THREE.AgXToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.camera = new THREE.PerspectiveCamera(34, 1, 0.05, 50);
    this.camera.position.set(0, 0.04, 1.75);
    this.camera.lookAt(0, 0, 0);

    this.scene.add(this.pivot);
    // ガンスミス風ライティング: 柔らかいアンビエント + キー + クール寄りのリム
    // + 下方からのキッカー + 周回アクセント
    this.scene.add(new THREE.AmbientLight(0xb8c4d6, 0.75));
    this.key = new THREE.DirectionalLight(0xffffff, 1.7);
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
        uColor: { value: new THREE.Color(0x6f8dff) },
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
    this.canvas.setPointerCapture(e.pointerId);
    this.canvas.style.cursor = 'grabbing';
  };
  private readonly onMove = (e: PointerEvent): void => {
    if (!this.dragging) return;
    const dx = (e.clientX - this.lastX) * 0.01;
    const dy = (e.clientY - this.lastY) * 0.01;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    this.yaw += dx;
    this.pitch = Math.max(-0.6, Math.min(0.6, this.pitch + dy));
    this.velYaw = dx;
  };
  private readonly onUp = (e: PointerEvent): void => {
    this.dragging = false;
    this.canvas.style.cursor = 'grab';
    try {
      this.canvas.releasePointerCapture(e.pointerId);
    } catch {
      // 既に解放済みなら無視
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
    const { gun } = buildGunBody(def);
    // マテリアルをこのプレビュー専用に複製して所有(モジュール共有singletonと分離)
    gun.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const mat = mesh.material;
      mesh.material = Array.isArray(mat) ? mat.map((m) => m.clone()) : mat.clone();
    });
    this.fitToView(gun);
    this.pivot.add(gun);
    this.current = gun;
    this.accent.color.setHex(def.tracerColor);
    this.pedestalMat.uniforms.uColor!.value.setHex(def.tracerColor);
    this.presentT = 0; // 新武器の登場ドリーを開始
  }

  private clearCurrent(): void {
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
    this.pivot.rotation.set(this.pitch, this.yaw, 0);

    if (this.reduceMotion) {
      // 省モーション: 登場ドリー/呼吸/光の周回/掃引を止め、静止ポーズで見せる
      this.presentT = 1;
      this.pivot.position.set(0, 0, 0);
      this.pivot.scale.setScalar(1);
      this.key.intensity = 1.7;
    } else {
      // 登場ドリー: わずかに沈み+奥から迫り上がり、通常スケール・位置へ寄る。
      // 併せてキー光を一瞬持ち上げて「披露」のハイライトを流す
      this.presentT = Math.min(1, this.presentT + dt60 * 0.05);
      const pres = easeOutCubic(this.presentT);
      const breath = Math.sin(now * 0.0016) * 0.01;
      this.pivot.position.set(0, (1 - pres) * -0.14 + breath, (1 - pres) * -0.12);
      this.pivot.scale.setScalar(0.96 + 0.04 * pres);
      this.key.intensity = 1.7 + (1 - pres) * 0.6;
      // アクセント光を武器の周りへゆっくり周回させ、金属面にハイライトを流す
      const a = now * 0.0006;
      this.accent.position.set(Math.cos(a) * 0.72, 0.35, Math.sin(a) * 0.72);
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
    this.renderer.dispose();
    // 一過性キャンバスなのでGLコンテキストを明示破棄(ブラウザの同時コンテキスト上限対策)
    this.renderer.forceContextLoss();
  }
}
