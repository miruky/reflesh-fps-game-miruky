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
    let entry = this.cache.get(def.id);
    if (!entry) {
      entry = this.buildGun(def);
      this.cache.set(def.id, entry);
    }
    this.gun = entry.gun;
    this.muzzle = entry.muzzle;
    this.root.add(this.gun);
    this.muzzle.add(this.flashMesh);
    this.muzzle.add(this.flashLight);
  }

  private buildGun(def: WeaponDef): { gun: THREE.Group; muzzle: THREE.Object3D } {
    const gun = new THREE.Group();
    const dark = new THREE.MeshStandardMaterial({ color: 0x2e3138, roughness: 0.45 });
    const darker = new THREE.MeshStandardMaterial({ color: 0x1d1f24, roughness: 0.5 });
    const accent = new THREE.MeshStandardMaterial({ color: def.tracerColor, roughness: 0.35 });

    const long = def.id === 'yamasemi-dmr' ? 1.25 : def.id === 'suzume' ? 0.65 : 1;

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

    if (def.id !== 'suzume') {
      const mag = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.13, 0.07), dark);
      mag.position.set(0, -0.11, -0.04);
      mag.rotation.x = -0.15;
      gun.add(mag);
    }
    if (def.id === 'yamasemi-dmr') {
      const scope = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.16), darker);
      scope.rotation.x = Math.PI / 2;
      scope.position.set(0, 0.08, -0.02);
      gun.add(scope);
    }

    const muzzle = new THREE.Object3D();
    muzzle.position.set(0, 0.012, -0.4 * long);
    gun.add(muzzle);
    return { gun, muzzle };
  }

  fire(): void {
    this.kickZ = Math.min(0.08, this.kickZ + 0.045);
    this.kickRot = Math.min(0.18, this.kickRot + 0.09);
    this.flashTimer = 0.045;
  }

  muzzleWorldPosition(out: THREE.Vector3): THREE.Vector3 {
    return this.muzzle.getWorldPosition(out);
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
    },
  ): void {
    const ads = state.adsProgress;

    const swayTargetX = THREE.MathUtils.clamp(-state.mouseDX * 0.0011, -0.03, 0.03) * (1 - ads * 0.85);
    const swayTargetY = THREE.MathUtils.clamp(state.mouseDY * 0.0011, -0.03, 0.03) * (1 - ads * 0.85);
    this.swayX += (swayTargetX - this.swayX) * Math.min(1, dt * 10);
    this.swayY += (swayTargetY - this.swayY) * Math.min(1, dt * 10);

    if (state.grounded && state.moveFactor > 0.05) {
      this.bobPhase += dt * (6 + state.moveFactor * 6);
    }
    const bobAmp = 0.008 * state.moveFactor * (1 - ads * 0.9);
    const bobX = Math.sin(this.bobPhase) * bobAmp;
    const bobY = Math.abs(Math.cos(this.bobPhase)) * bobAmp;

    this.kickZ = Math.max(0, this.kickZ - dt * 0.5);
    this.kickRot = Math.max(0, this.kickRot - dt * 1.6);
    this.flashTimer -= dt;
    this.flashMesh.visible = this.flashTimer > 0;
    this.flashLight.intensity = this.flashTimer > 0 ? 2.5 : 0;
    if (this.flashTimer > 0) {
      this.flashMesh.rotation.z = Math.random() * Math.PI;
    }

    const pos = new THREE.Vector3().lerpVectors(HIP_POSITION, ADS_POSITION, ads);
    pos.x += this.swayX + bobX;
    pos.y += this.swayY + bobY + LOWERED_OFFSET * state.raiseRatio;
    pos.z += this.kickZ;
    this.root.position.copy(pos);

    let rotX = this.kickRot * 0.6 + state.raiseRatio * -0.5;
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
