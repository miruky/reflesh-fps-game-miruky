import * as THREE from 'three';

interface Timed<T> {
  obj: T;
  life: number;
  maxLife: number;
}

const MAX_DECALS = 80;

// トレーサー・弾痕・ヒット演出のプール管理。
// ステージ切替時はclearで全て破棄する。
export class Effects {
  private tracers: Timed<THREE.Line>[] = [];
  private puffs: Timed<THREE.Mesh>[] = [];
  private decals: Timed<THREE.Mesh>[] = [];
  private readonly decalGeometry = new THREE.CircleGeometry(0.06, 8);
  private readonly puffGeometry = new THREE.SphereGeometry(0.09, 8, 6);

  constructor(private readonly scene: THREE.Scene) {}

  tracer(from: THREE.Vector3, to: THREE.Vector3, color: number): void {
    const geometry = new THREE.BufferGeometry().setFromPoints([from, to]);
    const material = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.85 });
    const line = new THREE.Line(geometry, material);
    this.scene.add(line);
    this.tracers.push({ obj: line, life: 0.09, maxLife: 0.09 });
  }

  impact(point: THREE.Vector3, normal: THREE.Vector3): void {
    const material = new THREE.MeshBasicMaterial({
      color: 0x1d1f24,
      transparent: true,
      opacity: 0.7,
      side: THREE.DoubleSide,
    });
    const decal = new THREE.Mesh(this.decalGeometry, material);
    decal.position.copy(point).addScaledVector(normal, 0.01);
    decal.lookAt(point.clone().add(normal));
    this.scene.add(decal);
    this.decals.push({ obj: decal, life: 8, maxLife: 8 });
    if (this.decals.length > MAX_DECALS) {
      const oldest = this.decals.shift();
      if (oldest) this.dispose(oldest.obj);
    }
  }

  hitPuff(point: THREE.Vector3): void {
    const material = new THREE.MeshBasicMaterial({
      color: 0xff6b5a,
      transparent: true,
      opacity: 0.9,
    });
    const puff = new THREE.Mesh(this.puffGeometry, material);
    puff.position.copy(point);
    this.scene.add(puff);
    this.puffs.push({ obj: puff, life: 0.16, maxLife: 0.16 });
  }

  update(dt: number): void {
    this.tracers = this.tick(this.tracers, dt, (line, ratio) => {
      (line.material as THREE.LineBasicMaterial).opacity = 0.85 * ratio;
    });
    this.puffs = this.tick(this.puffs, dt, (puff, ratio) => {
      (puff.material as THREE.MeshBasicMaterial).opacity = 0.9 * ratio;
      puff.scale.setScalar(1 + (1 - ratio) * 2.5);
    });
    this.decals = this.tick(this.decals, dt, (decal, ratio) => {
      // 寿命の最後の四分の一だけフェードする
      (decal.material as THREE.MeshBasicMaterial).opacity = 0.7 * Math.min(1, ratio * 4);
    });
  }

  clear(): void {
    for (const list of [this.tracers, this.puffs, this.decals]) {
      for (const item of list) this.dispose(item.obj);
      list.length = 0;
    }
  }

  private tick<T extends THREE.Object3D>(
    list: Timed<T>[],
    dt: number,
    fade: (obj: T, ratio: number) => void,
  ): Timed<T>[] {
    const kept: Timed<T>[] = [];
    for (const item of list) {
      item.life -= dt;
      if (item.life <= 0) {
        this.dispose(item.obj);
        continue;
      }
      fade(item.obj, item.life / item.maxLife);
      kept.push(item);
    }
    return kept;
  }

  private dispose(obj: THREE.Object3D): void {
    this.scene.remove(obj);
    if (obj instanceof THREE.Mesh || obj instanceof THREE.Line) {
      if (obj.geometry !== this.decalGeometry && obj.geometry !== this.puffGeometry) {
        obj.geometry.dispose();
      }
      (obj.material as THREE.Material).dispose();
    }
  }
}
