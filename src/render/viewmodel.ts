import * as THREE from 'three';
import type { WeaponDef } from '../game/weapons';

const HIP_POSITION = new THREE.Vector3(0.24, -0.22, -0.5);
const ADS_POSITION = new THREE.Vector3(0, -0.142, -0.42);
const LOWERED_OFFSET = -0.35;

// カメラ直付けの一人称武器モデル。専用モデルを箱の組み合わせで構築し、
// スウェイ・ボブ・リコイルキック・リロードを手続きで動かす。
export class ViewModel {
  readonly root = new THREE.Group();

  private gun: THREE.Group | null = null;
  private muzzle = new THREE.Object3D();
  private flashMesh: THREE.Mesh;
  private flashLight: THREE.PointLight;
  private readonly cache = new Map<string, { gun: THREE.Group; muzzle: THREE.Object3D }>();

  private swayX = 0;
  private swayY = 0;
  private kickZ = 0;
  private kickRot = 0;
  private flashTimer = 0;
  private bobPhase = 0;
  // 着地インパルス(着地の瞬間に銃が沈んで戻る)。タイマー方式で固定step発火・可変dt減衰
  private landBobTimer = 0;
  private landBobStrength = 0;
  // ボルト閉鎖の二段演出。発砲キックの後、わずかに逆回転して落ち着く
  private counterKickTimer = 0;
  // スプリント中に銃を下げる量(滑らかに追従)。raiseRatioとは独立した加算項
  private sprintLower = 0;

  constructor(camera: THREE.Camera) {
    camera.add(this.root);
    this.root.position.copy(HIP_POSITION);

    this.flashMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(0.16, 0.16),
      new THREE.MeshBasicMaterial({
        color: 0xffd9a0,
        transparent: true,
        opacity: 0.9,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    this.flashMesh.visible = false;
    this.flashLight = new THREE.PointLight(0xffc070, 0, 7);
  }

  setWeapon(def: WeaponDef): void {
    if (this.gun) this.root.remove(this.gun);
    const key = `${def.id}:${(def.attachmentIds ?? []).join(',')}`;
    let entry = this.cache.get(key);
    if (!entry) {
      entry = this.buildGun(def);
      this.cache.set(key, entry);
    }
    this.gun = entry.gun;
    this.muzzle = entry.muzzle;
    this.root.add(this.gun);
    this.muzzle.add(this.flashMesh);
    this.muzzle.add(this.flashLight);
  }

  private buildGun(def: WeaponDef): { gun: THREE.Group; muzzle: THREE.Object3D } {
    const gun = new THREE.Group();
    // 銃はカメラ近接(near 0.05)でワールドIBLの反射方向がズレるため envMapIntensity を抑える
    const dark = new THREE.MeshStandardMaterial({
      color: 0x2e3138,
      roughness: 0.45,
      envMapIntensity: 0.3,
    });
    const darker = new THREE.MeshStandardMaterial({
      color: 0x1d1f24,
      roughness: 0.5,
      envMapIntensity: 0.3,
    });
    const accent = new THREE.MeshStandardMaterial({
      color: def.tracerColor,
      roughness: 0.35,
      envMapIntensity: 0.3,
    });

    const long =
      def.id === 'yamasemi-dmr'
        ? 1.25
        : def.id === 'suzume'
          ? 0.65
          : def.id === 'kumagera-lmg'
            ? 1.15
            : def.id === 'hiiragi-sg'
              ? 1.1
              : 1;

    const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.095, 0.34 * long), dark);
    const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.034, 0.034, 0.24 * long), darker);
    barrel.position.set(0, 0.012, -0.27 * long);
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.14, 0.06), darker);
    grip.position.set(0, -0.1, 0.1);
    grip.rotation.x = 0.3;
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.078, 0.02, 0.1), accent);
    stripe.position.set(0, 0.02, 0.08);
    const frontSight = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.035, 0.008), darker);
    frontSight.position.set(0, 0.065, -0.34 * long);
    const rearLeft = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.03, 0.012), darker);
    rearLeft.position.set(-0.018, 0.062, 0.14);
    const rearRight = rearLeft.clone();
    rearRight.position.x = 0.018;
    gun.add(receiver, barrel, grip, stripe, frontSight, rearLeft, rearRight);

    const attachments = def.attachmentIds ?? [];
    const extendedMag = attachments.includes('extended');

    if (def.id === 'kumagera-lmg') {
      // LMGは箱型弾倉を下に吊る
      const box = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.11, 0.13), dark);
      box.position.set(0, -0.1, -0.05);
      gun.add(box);
    } else if (def.id === 'hiiragi-sg') {
      // ショットガンはチューブ弾倉とフォアエンド
      const tube = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, 0.22 * long), darker);
      tube.position.set(0, -0.025, -0.24 * long);
      const forend = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.045, 0.12), dark);
      forend.position.set(0, -0.03, -0.16);
      gun.add(tube, forend);
    } else if (def.id !== 'suzume') {
      const magHeight = extendedMag ? 0.18 : 0.13;
      const mag = new THREE.Mesh(new THREE.BoxGeometry(0.045, magHeight, 0.07), dark);
      mag.position.set(0, extendedMag ? -0.135 : -0.11, -0.04);
      mag.rotation.x = -0.15;
      gun.add(mag);
    }
    if (def.id === 'yamasemi-dmr') {
      const scope = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.16), darker);
      scope.rotation.x = Math.PI / 2;
      scope.position.set(0, 0.08, -0.02);
      gun.add(scope);
    }

    if (attachments.includes('reflex')) {
      const frame = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.02), darker);
      frame.position.set(0, 0.075, 0.05);
      const lens = new THREE.Mesh(
        new THREE.PlaneGeometry(0.034, 0.034),
        new THREE.MeshBasicMaterial({
          color: 0x7ad1ff,
          transparent: true,
          opacity: 0.35,
          side: THREE.DoubleSide,
        }),
      );
      lens.position.set(0, 0.075, 0.038);
      gun.add(frame, lens);
    }
    if (attachments.includes('telescopic') && def.id !== 'yamasemi-dmr') {
      const scope = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.14), darker);
      scope.rotation.x = Math.PI / 2;
      scope.position.set(0, 0.08, 0.0);
      gun.add(scope);
    }
    if (attachments.includes('suppressor')) {
      const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.14), darker);
      tube.rotation.x = Math.PI / 2;
      tube.position.set(0, 0.012, -0.45 * long);
      gun.add(tube);
    }
    if (attachments.includes('vertical') || attachments.includes('angled')) {
      const foregrip = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.09, 0.05), darker);
      foregrip.position.set(0, -0.085, -0.2 * long);
      if (attachments.includes('angled')) foregrip.rotation.x = 0.5;
      gun.add(foregrip);
    }

    // 一人称の腕。銃を両手で構えるように前腕+手を追加する。銃グループの
    // 子なのでADS・スウェイ・反動・リロードの動きにそのまま追従する。
    const sleeve = new THREE.MeshStandardMaterial({ color: 0x2b2e34, roughness: 0.7 });
    const glove = new THREE.MeshStandardMaterial({ color: 0x161820, roughness: 0.55 });
    const limb = (
      mat: THREE.Material,
      w: number,
      h: number,
      d: number,
      x: number,
      y: number,
      z: number,
      rx: number,
      ry: number,
      rz: number,
    ): THREE.Mesh => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      m.position.set(x, y, z);
      m.rotation.set(rx, ry, rz);
      return m;
    };
    // 右手(グリップ)と右前腕(画面右下へ抜ける)
    const rHand = limb(glove, 0.06, 0.07, 0.11, 0.0, -0.11, 0.11, 0.3, 0, 0);
    const rArm = limb(sleeve, 0.08, 0.08, 0.3, 0.03, -0.22, 0.3, 0.62, -0.1, 0);
    // 左手(ハンドガード)と左前腕。前腕の手首側が左手に届くよう、ハンドガード
    // 寄りに置いて横断ヨーを抑える(以前は左下へ流れて手と分離していた)
    const lHand = limb(glove, 0.06, 0.07, 0.11, 0.0, -0.05, -0.16 * long, 0.2, 0, 0);
    const lArm = limb(sleeve, 0.08, 0.08, 0.3, -0.03, -0.13, -0.04, 0.5, 0.2, 0.12);
    gun.add(rHand, rArm, lHand, lArm);

    const muzzle = new THREE.Object3D();
    const muzzleZ = attachments.includes('suppressor') ? -0.52 * long : -0.4 * long;
    muzzle.position.set(0, 0.012, muzzleZ);
    gun.add(muzzle);
    return { gun, muzzle };
  }

  fire(scoped = false): void {
    // スコープ武器はボルト排莢のように大きく後退・跳ね上げる(BO2 DSRの重い一撃)
    this.kickZ = Math.min(scoped ? 0.2 : 0.08, this.kickZ + (scoped ? 0.18 : 0.045));
    this.kickRot = Math.min(scoped ? 0.34 : 0.18, this.kickRot + (scoped ? 0.22 : 0.09));
    this.flashTimer = scoped ? 0.03 : 0.045;
    // スコープ武器のみ、約180ms後にボルト閉鎖の小さな揺り戻しを入れる
    if (scoped) this.counterKickTimer = 0.18;
  }

  // 着地の瞬間に呼ぶ。強さ(0..1)に応じて銃が一度沈んで戻る
  applyLandBob(strength: number): void {
    this.landBobTimer = 0.28;
    this.landBobStrength = THREE.MathUtils.clamp(strength, 0, 1);
  }

  muzzleWorldPosition(out: THREE.Vector3): THREE.Vector3 {
    return this.muzzle.getWorldPosition(out);
  }

  // 試合破棄時に呼ぶ。キャッシュ済みの非アクティブな銃(切替で外した方)は
  // シーングラフから外れていてMatch.disposeのtraverseに拾われないため、
  // ここで全キャッシュとフラッシュメッシュのGPU資源を明示的に解放する
  dispose(): void {
    for (const entry of this.cache.values()) {
      entry.gun.traverse((node) => {
        if (node instanceof THREE.Mesh) {
          node.geometry.dispose();
          (node.material as THREE.Material).dispose();
        }
      });
    }
    this.cache.clear();
    this.flashMesh.geometry.dispose();
    (this.flashMesh.material as THREE.Material).dispose();
  }

  update(
    dt: number,
    state: {
      adsProgress: number;
      mouseDX: number;
      mouseDY: number;
      moveFactor: number;
      grounded: boolean;
      reloadRatio: number | null; // 0..1、リロード中以外はnull
      raiseRatio: number; // 1=構え直し開始直後、0=構え完了
      motionScale: number; // 画面揺れ軽減で1未満になる
      alive: boolean; // 死亡中は銃を隠す
      scopeReveal01: number; // スコープ覗き込み度。1に近いほど銃を引っ込めて隠す
      sprinting?: boolean; // スプリント中は銃を下げる(戦闘遷移コストの可視化)
    },
  ): void {
    const ads = state.adsProgress;

    const swayTargetX =
      THREE.MathUtils.clamp(-state.mouseDX * 0.0011, -0.03, 0.03) *
      (1 - ads * 0.85) *
      state.motionScale;
    const swayTargetY =
      THREE.MathUtils.clamp(state.mouseDY * 0.0011, -0.03, 0.03) *
      (1 - ads * 0.85) *
      state.motionScale;
    this.swayX += (swayTargetX - this.swayX) * Math.min(1, dt * 10);
    this.swayY += (swayTargetY - this.swayY) * Math.min(1, dt * 10);

    if (state.grounded && state.moveFactor > 0.05) {
      this.bobPhase += dt * (6 + state.moveFactor * 6);
    }
    const bobAmp = 0.008 * state.moveFactor * (1 - ads * 0.9) * state.motionScale;
    const bobX = Math.sin(this.bobPhase) * bobAmp;
    const bobY = Math.abs(Math.cos(this.bobPhase)) * bobAmp;

    // やや遅い回復で「重い一撃」の余韻を残す
    this.kickZ = Math.max(0, this.kickZ - dt * 0.35);
    this.kickRot = Math.max(0, this.kickRot - dt * 1.0);
    this.flashTimer -= dt;
    this.flashMesh.visible = this.flashTimer > 0;
    this.flashLight.intensity = this.flashTimer > 0 ? 4.0 : 0;
    if (this.flashTimer > 0) {
      this.flashMesh.rotation.z = Math.random() * Math.PI;
    }

    // 着地インパルス: 0.28sかけて一度沈んで戻る半周期サイン
    let landDip = 0;
    if (this.landBobTimer > 0) {
      const phase = 1 - this.landBobTimer / 0.28;
      landDip = Math.sin(phase * Math.PI) * 0.07 * this.landBobStrength * state.motionScale;
      this.landBobTimer = Math.max(0, this.landBobTimer - dt);
    }
    // スプリント時の銃下げ。target -0.08 へ滑らかに追従(覗き込み中は無効)
    const sprintTarget = state.sprinting && ads < 0.2 ? -0.08 : 0;
    this.sprintLower += (sprintTarget - this.sprintLower) * Math.min(1, dt * 8);
    // ボルト閉鎖の揺り戻し(発砲から約180ms、終盤に逆回転)
    let counterKick = 0;
    if (this.counterKickTimer > 0) {
      this.counterKickTimer = Math.max(0, this.counterKickTimer - dt);
      counterKick = -Math.sin((1 - this.counterKickTimer / 0.18) * Math.PI) * 0.04;
    }

    const pos = new THREE.Vector3().lerpVectors(HIP_POSITION, ADS_POSITION, ads);
    pos.x += this.swayX + bobX;
    // スコープを覗き込むほど銃を下げ、完全に覗いたらDOMスコープのため非表示にする
    pos.y +=
      this.swayY +
      bobY +
      LOWERED_OFFSET * state.raiseRatio -
      0.55 * state.scopeReveal01 -
      landDip +
      this.sprintLower;
    pos.z += this.kickZ;
    this.root.position.copy(pos);
    this.root.visible = state.alive && state.scopeReveal01 < 0.95;

    let rotX = this.kickRot * 0.6 + counterKick + state.raiseRatio * -0.5;
    let rotZ = 0;
    if (state.reloadRatio !== null) {
      const wave = Math.sin(state.reloadRatio * Math.PI);
      rotX -= wave * 0.55;
      rotZ = wave * 0.25;
      this.root.position.y -= wave * 0.09;
    }
    this.root.rotation.set(rotX, this.swayX * 2, rotZ);
  }
}
