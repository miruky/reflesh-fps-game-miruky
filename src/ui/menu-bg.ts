import * as THREE from 'three';

// メニュー背景の宇宙(星野)。GameLoopとは独立した自前RAFで回す軽量レンダラ。
// アセットレス: 単一のPointsで約3000星を1ドローコール。start/stopは冪等で、
// 出撃時は確実に停止・非表示にしてプレイ中のRAF/GPUを圧迫しない。
export class SpaceBg {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly stars: THREE.Points;
  private readonly geometry: THREE.BufferGeometry;
  private readonly material: THREE.PointsMaterial;
  private rafId = 0;
  private running = false;
  private reduceMotion = false;
  private spin = 0;
  private targetX = 0;
  private targetY = 0;
  private offX = 0;
  private offY = 0;
  private readonly finePointer: boolean;

  private readonly onResize = (): void => this.resize();
  private readonly onVisibility = (): void => {
    if (document.hidden) this.pauseLoop();
    else if (this.running) this.startLoop();
  };
  private readonly onPointer = (e: PointerEvent): void => {
    if (!this.finePointer) return;
    this.targetX = e.clientX / window.innerWidth - 0.5;
    this.targetY = e.clientY / window.innerHeight - 0.5;
  };

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.finePointer =
      typeof matchMedia === 'function' && matchMedia('(hover: hover) and (pointer: fine)').matches;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      alpha: false,
      powerPreference: 'low-power',
    });
    this.renderer.setClearColor(0x05070b, 1);
    this.camera = new THREE.PerspectiveCamera(
      70,
      window.innerWidth / Math.max(1, window.innerHeight),
      0.1,
      2000,
    );

    const COUNT = 3000;
    const positions = new Float32Array(COUNT * 3);
    const colors = new Float32Array(COUNT * 3);
    // 純白を避け、わずかにシアン/アンバーへ振った星色(--ink/--signal/--ember-ink相当)
    const palette = [
      new THREE.Color(0xf0f1ee),
      new THREE.Color(0xf0f1ee),
      new THREE.Color(0xf0f1ee),
      new THREE.Color(0x9fd6e8),
      new THREE.Color(0xbcdcff),
      new THREE.Color(0xffb9a8),
    ];
    for (let i = 0; i < COUNT; i += 1) {
      positions[i * 3] = THREE.MathUtils.randFloatSpread(1200);
      positions[i * 3 + 1] = THREE.MathUtils.randFloatSpread(1200);
      positions[i * 3 + 2] = THREE.MathUtils.randFloatSpread(1200);
      const c = palette[Math.floor(Math.random() * palette.length)] ?? palette[0]!;
      const b = 0.5 + Math.random() * 0.5;
      colors[i * 3] = c.r * b;
      colors[i * 3 + 1] = c.g * b;
      colors[i * 3 + 2] = c.b * b;
    }
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    this.material = new THREE.PointsMaterial({
      size: 1.7,
      sizeAttenuation: false,
      vertexColors: true,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
    });
    this.stars = new THREE.Points(this.geometry, this.material);
    this.scene.add(this.stars);
    this.resize();
  }

  // 冪等: 既に走行中なら何もしない
  start(): void {
    if (this.running) return;
    this.running = true;
    this.canvas.hidden = false;
    this.resize();
    window.addEventListener('resize', this.onResize);
    document.addEventListener('visibilitychange', this.onVisibility);
    if (this.finePointer) window.addEventListener('pointermove', this.onPointer);
    this.startLoop();
  }

  // 冪等: 二重停止しても安全
  stop(): void {
    if (!this.running) return;
    this.running = false;
    this.pauseLoop();
    window.removeEventListener('resize', this.onResize);
    document.removeEventListener('visibilitychange', this.onVisibility);
    window.removeEventListener('pointermove', this.onPointer);
    this.canvas.hidden = true;
  }

  setReduceMotion(v: boolean): void {
    const was = this.reduceMotion;
    this.reduceMotion = v;
    // 省モーションを解除したら動きを再開。有効化時は frame() が1枚描いて自然停止する
    if (was && !v && this.running) this.startLoop();
  }

  private startLoop(): void {
    if (this.rafId) return;
    const tick = (): void => {
      this.frame();
      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  private pauseLoop(): void {
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = 0;
  }

  private frame(): void {
    // 省モーション時は静止画を1枚だけ描いてループを止める(GPU/電力の浪費を避ける)
    if (this.reduceMotion) {
      this.stars.rotation.y = this.spin;
      this.camera.rotation.set(0, 0, 0);
      this.renderer.render(this.scene, this.camera);
      this.pauseLoop();
      return;
    }
    this.spin += 0.0002; // ごく緩い旋回(約9分/周)。dt非依存なので高リフレッシュ環境ではやや速い
    this.offX += (this.targetX - this.offX) * 0.04;
    this.offY += (this.targetY - this.offY) * 0.04;
    this.stars.rotation.y = this.spin;
    this.camera.rotation.set(-this.offY * 0.1, -this.offX * 0.1, 0);
    this.renderer.render(this.scene, this.camera);
  }

  private resize(): void {
    const w = window.innerWidth;
    const h = Math.max(1, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    // 省モーションでループ停止中(running かつ rafId==0)はリサイズ時に1枚描き直す
    if (this.running && this.rafId === 0) this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.stop();
    this.geometry.dispose();
    this.material.dispose();
    this.renderer.dispose();
  }
}
