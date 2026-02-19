import * as THREE from 'three';

interface Timed<T> {
  obj: T;
  life: number;
  maxLife: number;
}

const MAX_DECALS = 80;

// トレーサー・弾痕・爆発・スモークなど、寿命つき演出のプール管理。
// ステージ切替時はclearで全て破棄する。
export class Effects {
  private tracers: Timed<THREE.Line>[] = [];
  private puffs: Timed<THREE.Mesh>[] = [];
  private decals: Timed<THREE.Mesh>[] = [];
  private blasts: Timed<THREE.Mesh>[] = [];
  private clouds: Timed<THREE.Group>[] = [];
  private flames: Timed<THREE.Group>[] = [];
  private trajectoryLine: THREE.Line | null = null;
  private readonly decalGeometry = new THREE.CircleGeometry(0.06, 8);
  private readonly puffGeometry = new THREE.SphereGeometry(0.09, 8, 6);
  private readonly cloudGeometry = new THREE.SphereGeometry(1, 10, 8);
  private readonly blastGeometry = new THREE.SphereGeometry(1, 12, 10);

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
      if (oldest) this.disposeObject(oldest.obj);
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

  explosion(point: THREE.Vector3, radius: number): void {
    const core = new THREE.Mesh(
      this.blastGeometry,
      new THREE.MeshBasicMaterial({
        color: 0xffc070,
        transparent: true,
        opacity: 0.95,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    core.position.copy(point);
    core.scale.setScalar(radius * 0.25);
    core.userData.targetScale = radius;
    this.scene.add(core);
    this.blasts.push({ obj: core, life: 0.45, maxLife: 0.45 });

    // 土煙
    for (let i = 0; i < 5; i += 1) {
      const dust = new THREE.Mesh(
        this.cloudGeometry,
        new THREE.MeshBasicMaterial({
          color: 0x55504a,
          transparent: true,
          opacity: 0.5,
          depthWrite: false,
        }),
      );
      dust.position
        .copy(point)
        .add(
          new THREE.Vector3(
            (Math.random() - 0.5) * radius * 0.8,
            Math.random() * radius * 0.4,
            (Math.random() - 0.5) * radius * 0.8,
          ),
        );
      dust.scale.setScalar(radius * (0.2 + Math.random() * 0.2));
      dust.userData.targetScale = radius * (0.5 + Math.random() * 0.3);
      this.scene.add(dust);
      this.blasts.push({ obj: dust, life: 1.1, maxLife: 1.1 });
    }
  }

  smokeCloud(point: THREE.Vector3, radius: number, durationS: number): void {
    const group = new THREE.Group();
    group.position.copy(point);
    for (let i = 0; i < 9; i += 1) {
      const blob = new THREE.Mesh(
        this.cloudGeometry,
        new THREE.MeshLambertMaterial({
          color: 0x9aa2ad,
          transparent: true,
          opacity: 0.92,
          depthWrite: false,
        }),
      );
      blob.position.set(
        (Math.random() - 0.5) * radius * 1.1,
        Math.random() * radius * 0.7,
        (Math.random() - 0.5) * radius * 1.1,
      );
      blob.scale.setScalar(radius * (0.35 + Math.random() * 0.3));
      group.add(blob);
    }
    group.userData.maxLife = durationS;
    this.scene.add(group);
    this.clouds.push({ obj: group, life: durationS, maxLife: durationS });
  }

  firePatch(point: THREE.Vector3, radius: number, durationS: number): void {
    const group = new THREE.Group();
    group.position.copy(point);
    const base = new THREE.Mesh(
      new THREE.CircleGeometry(radius, 20),
      new THREE.MeshBasicMaterial({
        color: 0xff7a2e,
        transparent: true,
        opacity: 0.55,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    base.rotation.x = -Math.PI / 2;
    base.position.y = 0.03;
    base.userData.baseOpacity = 0.55;
    group.add(base);
    for (let i = 0; i < 7; i += 1) {
      const flame = new THREE.Mesh(
        new THREE.ConeGeometry(0.16, 0.6, 6),
        new THREE.MeshBasicMaterial({
          color: 0xffb13c,
          transparent: true,
          opacity: 0.85,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        }),
      );
      const angle = Math.random() * Math.PI * 2;
      const r = Math.random() * radius * 0.8;
      flame.position.set(Math.cos(angle) * r, 0.3, Math.sin(angle) * r);
      flame.userData.phase = Math.random() * Math.PI * 2;
      flame.userData.baseOpacity = 0.85;
      flame.userData.flicker = true;
      group.add(flame);
    }
    const light = new THREE.PointLight(0xff8a3c, 2.2, radius * 4);
    light.position.y = 0.7;
    group.add(light);
    this.scene.add(group);
    this.flames.push({ obj: group, life: durationS, maxLife: durationS });
  }

  // 投擲軌道のプレビュー。毎フレーム差し替え、非表示はhideTrajectoryで行う
  showTrajectory(points: THREE.Vector3[]): void {
    this.hideTrajectory();
    if (points.length < 2) return;
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const material = new THREE.LineDashedMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.55,
      dashSize: 0.25,
      gapSize: 0.18,
    });
    const line = new THREE.Line(geometry, material);
    line.computeLineDistances();
    this.scene.add(line);
    this.trajectoryLine = line;
  }

  hideTrajectory(): void {
    if (this.trajectoryLine) {
      this.disposeObject(this.trajectoryLine);
      this.trajectoryLine = null;
    }
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
    this.blasts = this.tick(this.blasts, dt, (blast, ratio) => {
      const target = (blast.userData.targetScale as number) ?? 1;
      const grown = target * (1 - ratio * ratio);
      blast.scale.setScalar(Math.max(blast.scale.x, grown));
      (blast.material as THREE.MeshBasicMaterial).opacity = 0.95 * ratio;
    });
    this.clouds = this.tick(this.clouds, dt, (group, ratio) => {
      const age = ((group.userData.age as number | undefined) ?? 0) + dt;
      group.userData.age = age;
      // 立ち上がり0.5秒で展開し、最後の2秒で薄れる
      const grow = Math.min(1, age / 0.5);
      const remaining = ratio * (group.userData.maxLife as number);
      const fade = Math.min(1, remaining / 2);
      for (const child of group.children) {
        const mesh = child as THREE.Mesh;
        mesh.scale.multiplyScalar(1 + dt * 0.012);
        (mesh.material as THREE.MeshLambertMaterial).opacity = 0.92 * grow * fade;
      }
    });
    this.flames = this.tick(this.flames, dt, (group, ratio) => {
      const t = performance.now() / 1000;
      for (const child of group.children) {
        if (child instanceof THREE.PointLight) {
          child.intensity = (1.6 + Math.sin(t * 17 + 1) * 0.6) * Math.min(1, ratio * 5);
          continue;
        }
        const mesh = child as THREE.Mesh;
        if (mesh.userData.flicker === true) {
          const phase = mesh.userData.phase as number;
          mesh.scale.y = 1 + Math.sin(t * 13 + phase) * 0.35;
        }
        const baseOpacity = (mesh.userData.baseOpacity as number) ?? 0.85;
        (mesh.material as THREE.MeshBasicMaterial).opacity = baseOpacity * Math.min(1, ratio * 5);
      }
    });
  }

  clear(): void {
    this.hideTrajectory();
    for (const list of [this.tracers, this.puffs, this.decals, this.blasts]) {
      for (const item of list) this.disposeObject(item.obj);
      list.length = 0;
    }
    for (const list of [this.clouds, this.flames]) {
      for (const item of list) this.disposeObject(item.obj);
      list.length = 0;
    }
  }

  // 試合破棄時に呼ぶ。プール共有ジオメトリも含めて解放する
  dispose(): void {
    this.clear();
    this.decalGeometry.dispose();
    this.puffGeometry.dispose();
    this.cloudGeometry.dispose();
    this.blastGeometry.dispose();
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
        this.disposeObject(item.obj);
        continue;
      }
      fade(item.obj, item.life / item.maxLife);
      kept.push(item);
    }
    return kept;
  }

  private disposeObject(obj: THREE.Object3D): void {
    this.scene.remove(obj);
    obj.traverse((node) => {
      if (node instanceof THREE.Mesh || node instanceof THREE.Line) {
        if (
          node.geometry !== this.decalGeometry &&
          node.geometry !== this.puffGeometry &&
          node.geometry !== this.cloudGeometry &&
          node.geometry !== this.blastGeometry
        ) {
          node.geometry.dispose();
        }
        (node.material as THREE.Material).dispose();
      }
    });
  }
}
