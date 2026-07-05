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
  private sparks: Timed<THREE.Group>[] = [];
  private flares: Timed<THREE.Mesh>[] = [];
  private rings: Timed<THREE.Mesh>[] = []; // 素手ウルトの拡大衝撃リング/刃閃フラッシュ
  private streaks: Timed<THREE.Group>[] = []; // 素手ウルトの放射状クラック斬撃
  private crescents: Timed<THREE.Mesh>[] = []; // ブリンク三日月斬撃(per-callジオメトリ)
  private impactRings: Timed<THREE.Mesh>[] = []; // ブリンク着地/落雷の小衝撃リング
  private darkNovas: Timed<THREE.Mesh | THREE.Group>[] = []; // 黒技ノヴァ(暗色リング+暗転球)
  private darkPuffs: Timed<THREE.Mesh>[] = [];               // 黒帝オーラ煙(足元低頻度)
  private darkAuras: Timed<THREE.Mesh>[] = [];               // 黒帝オーラ渦ウィスプ(螺旋上昇)
  private shingetsuRings: Timed<THREE.Group>[] = [];         // 真月拡大リング
  private trajectoryLine: THREE.Line | null = null;
  private readonly decalGeometry = new THREE.CircleGeometry(0.06, 8);
  private readonly puffGeometry = new THREE.SphereGeometry(0.09, 8, 6);
  private readonly cloudGeometry = new THREE.SphereGeometry(1, 10, 8);
  private readonly blastGeometry = new THREE.SphereGeometry(1, 12, 10);
  private readonly sparkGeometry = new THREE.BoxGeometry(0.05, 0.05, 0.05);
  private readonly flareGeometry = new THREE.SphereGeometry(0.13, 10, 8);
  // 単位リング(外半径1)。scale で任意半径へ拡大する共有ジオメトリ
  private readonly ringGeometry = new THREE.RingGeometry(0.8, 1.0, 44);
  // 単位クラック(長手Z=1)。scale.z で伸長する共有ジオメトリ
  private readonly streakGeometry = new THREE.BoxGeometry(0.04, 0.02, 1);

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

  // ヘッドショット専用の金色フレア。通常ヒットの赤パフと差別化した「決まった」手応え
  headshotFlare(point: THREE.Vector3): void {
    const material = new THREE.MeshBasicMaterial({
      color: 0xffe8a0,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const flare = new THREE.Mesh(this.flareGeometry, material);
    flare.position.copy(point);
    this.scene.add(flare);
    this.flares.push({ obj: flare, life: 0.22, maxLife: 0.22 });
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

  // 撃破時の発光バーストと飛散する破片(チーム色)
  deathBurst(point: THREE.Vector3, color: number): void {
    const flash = new THREE.Mesh(
      this.blastGeometry,
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.9,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    flash.position.copy(point);
    flash.scale.setScalar(0.3);
    flash.userData.targetScale = 1.5;
    this.scene.add(flash);
    this.blasts.push({ obj: flash, life: 0.4, maxLife: 0.4 });

    const group = new THREE.Group();
    group.position.copy(point);
    for (let i = 0; i < 10; i += 1) {
      const shard = new THREE.Mesh(
        this.sparkGeometry,
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 1 }),
      );
      shard.userData.vel = new THREE.Vector3(
        (Math.random() - 0.5) * 6,
        Math.random() * 5 + 1.5,
        (Math.random() - 0.5) * 6,
      );
      group.add(shard);
    }
    this.scene.add(group);
    this.sparks.push({ obj: group, life: 0.7, maxLife: 0.7 });
  }

  // 素手ウルト(残刃・大破斬)専用の衝撃波演出。center は足元(地面高さ)を渡す。
  // (1)地を走る拡大リング×2(主+追走)、(2)中心の一瞬の刃閃フラッシュ、(3)放射状に
  // 地を裂くクラック斬撃×10。全て加算・depthWrite:false・プール寿命管理で、既存fx同等の
  // 軽量予算(リング3+クラック10=1グループ)。共有ジオメトリを scale で拡大するだけ。
  shockwaveRing(center: THREE.Vector3, radius: number, color: number): void {
    const gy = center.y;
    // (1) 地面を走る拡大リング(主=太く速く/追走=薄く遅く)
    const ringSpecs = [
      { target: radius, life: 0.55, opacity: 0.92, y: 0.06 },
      { target: radius * 0.72, life: 0.78, opacity: 0.5, y: 0.05 },
    ];
    for (const rs of ringSpecs) {
      const ring = new THREE.Mesh(
        this.ringGeometry,
        new THREE.MeshBasicMaterial({
          color,
          transparent: true,
          opacity: rs.opacity,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          side: THREE.DoubleSide,
        }),
      );
      ring.position.set(center.x, gy + rs.y, center.z);
      ring.rotation.x = -Math.PI / 2;
      ring.scale.setScalar(radius * 0.18);
      ring.userData.targetScale = rs.target;
      ring.userData.baseOpacity = rs.opacity;
      this.scene.add(ring);
      this.rings.push({ obj: ring, life: rs.life, maxLife: rs.life });
    }
    // (2) 中心の刃閃(垂直の高速フラッシュリング)
    const flash = new THREE.Mesh(
      this.ringGeometry,
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.9,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    flash.position.set(center.x, gy + 0.9, center.z);
    flash.scale.setScalar(0.2);
    flash.userData.targetScale = radius * 0.5;
    flash.userData.baseOpacity = 0.9;
    this.scene.add(flash);
    this.rings.push({ obj: flash, life: 0.2, maxLife: 0.2 });
    // (3) 放射状に地を裂くクラック斬撃
    const group = new THREE.Group();
    group.position.set(center.x, gy + 0.04, center.z);
    const n = 10;
    for (let i = 0; i < n; i += 1) {
      const a = (i / n) * Math.PI * 2 + Math.random() * 0.25;
      const streak = new THREE.Mesh(
        this.streakGeometry,
        new THREE.MeshBasicMaterial({
          color,
          transparent: true,
          opacity: 0.95,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          side: THREE.DoubleSide,
        }),
      );
      streak.rotation.y = a; // 単位クラックの長手(-Z)を放射方向へ向ける
      streak.userData.len = radius * (0.7 + Math.random() * 0.3);
      streak.userData.dir = new THREE.Vector2(Math.sin(a), Math.cos(a));
      streak.scale.z = 0.01;
      group.add(streak);
    }
    this.scene.add(group);
    this.streaks.push({ obj: group, life: 0.5, maxLife: 0.5 });
  }

  // ブリンク斬撃: 三日月斬撃(加算弧×2、拡大+回転+フェード 0.15s)
  crescentSlash(pos: THREE.Vector3, dir: THREE.Vector3, color: number): void {
    const angle = Math.atan2(dir.x, dir.z);
    const specs = [
      { inner: 0.2, outer: 0.8, arc: Math.PI * 1.3, opacity: 0.92, target: 2.5, life: 0.15, tilt: Math.PI / 4 },
      { inner: 0.6, outer: 1.2, arc: Math.PI * 1.6, opacity: 0.45, target: 3.5, life: 0.18, tilt: -Math.PI / 6 },
    ];
    for (const s of specs) {
      const geo = new THREE.RingGeometry(s.inner, s.outer, 16, 1, 0, s.arc);
      const mat = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: s.opacity,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.copy(pos);
      mesh.rotation.set(-Math.PI / 2, 0, angle + s.tilt);
      mesh.scale.setScalar(0.3);
      mesh.userData.targetScale = s.target;
      mesh.userData.baseOpacity = s.opacity;
      this.scene.add(mesh);
      this.crescents.push({ obj: mesh, life: s.life, maxLife: s.life });
    }
  }

  // ブリンク残像: 並行ゴーストトレーサー3本(中央が濃く、両脇は薄い)
  blinkGhosts(from: THREE.Vector3, to: THREE.Vector3, color: number): void {
    const along = new THREE.Vector3().subVectors(to, from).normalize();
    const perp = new THREE.Vector3(-along.z, 0, along.x).normalize();
    const offsets = [-0.14, 0, 0.14];
    const opacities = [0.35, 0.65, 0.35];
    for (let i = 0; i < offsets.length; i += 1) {
      const f = from.clone().addScaledVector(perp, offsets[i]!);
      const t = to.clone().addScaledVector(perp, offsets[i]!);
      const geometry = new THREE.BufferGeometry().setFromPoints([f, t]);
      const material = new THREE.LineBasicMaterial({
        color,
        transparent: true,
        opacity: opacities[i]!,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const line = new THREE.Line(geometry, material);
      line.userData.baseOpacity = opacities[i]!;
      this.scene.add(line);
      const life = 0.1 + i * 0.02;
      this.tracers.push({ obj: line, life, maxLife: life });
    }
  }

  // ブリンク着地/落雷着弾の小衝撃リング(地面水平・拡大フェード)
  impactRing(pos: THREE.Vector3, color: number): void {
    const geo = new THREE.RingGeometry(0.5, 0.8, 24);
    const mat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.75,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(pos);
    mesh.rotation.x = -Math.PI / 2;
    mesh.scale.setScalar(0.3);
    mesh.userData.targetScale = 1.4;
    mesh.userData.baseOpacity = 0.75;
    this.scene.add(mesh);
    this.impactRings.push({ obj: mesh, life: 0.22, maxLife: 0.22 });
  }

  // 黒技・シュヴァルツヴァルト発動時の暗黒ノヴァ演出
  // (1) NormalBlendingの暗転スフィア (2) AdditiveBlendingの深紫コア (3) 暗色地面リング×2 (4) 黒煙群
  // intensity: 暗転(視界を塗る)成分の減衰係数。reduceMotion時に match 側が下げて渡す
  darkNova(center: THREE.Vector3, radius: number, intensity = 1): void {
    const gy = center.y;
    // (1) 暗転スフィア(NormalBlending=暗く塗る)
    const darkOpacity = 0.88 * intensity;
    const darkMat = new THREE.MeshBasicMaterial({
      color: 0x050008,
      transparent: true,
      opacity: darkOpacity,
      blending: THREE.NormalBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const darkBall = new THREE.Mesh(this.blastGeometry, darkMat);
    darkBall.position.copy(center);
    darkBall.scale.setScalar(radius * 0.12);
    darkBall.userData.targetScale = radius * 0.85;
    darkBall.userData.baseOpacity = darkOpacity;
    this.scene.add(darkBall);
    this.darkNovas.push({ obj: darkBall as THREE.Mesh, life: 0.38, maxLife: 0.38 });

    // (2) 深紫コアフラッシュ(AdditiveBlending)
    const purpleMat = new THREE.MeshBasicMaterial({
      color: 0x6a00b0,
      transparent: true,
      opacity: 0.72,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const purpleCore = new THREE.Mesh(this.blastGeometry, purpleMat);
    purpleCore.position.copy(center);
    purpleCore.scale.setScalar(radius * 0.06);
    purpleCore.userData.targetScale = radius * 0.42;
    purpleCore.userData.baseOpacity = 0.72;
    this.scene.add(purpleCore);
    this.darkNovas.push({ obj: purpleCore as THREE.Mesh, life: 0.26, maxLife: 0.26 });

    // (3) 地面を走る暗色拡大リング×2
    const ringSpecs = [
      { target: radius,        life: 0.68, opacity: 0.82, y: 0.07, color: 0x1a0032 },
      { target: radius * 0.62, life: 0.90, opacity: 0.40, y: 0.04, color: 0x07000e },
    ] as const;
    for (const rs of ringSpecs) {
      const mat = new THREE.MeshBasicMaterial({
        color: rs.color,
        transparent: true,
        opacity: rs.opacity,
        blending: THREE.NormalBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const ring = new THREE.Mesh(this.ringGeometry, mat);
      ring.position.set(center.x, gy + rs.y, center.z);
      ring.rotation.x = -Math.PI / 2;
      ring.scale.setScalar(radius * 0.14);
      ring.userData.targetScale = rs.target;
      ring.userData.baseOpacity = rs.opacity;
      this.scene.add(ring);
      this.darkNovas.push({ obj: ring as THREE.Mesh, life: rs.life, maxLife: rs.life });
    }

    // (4) 黒煙群(6ブロブ。cloudGeometry共有=disposeしない)
    const smokeGroup = new THREE.Group();
    smokeGroup.position.copy(center);
    smokeGroup.userData.maxLife = 2.2;
    smokeGroup.userData.age = 0;
    for (let i = 0; i < 6; i += 1) {
      const blobMat = new THREE.MeshBasicMaterial({
        color: 0x08000e,
        transparent: true,
        opacity: 0,
        depthWrite: false,
      });
      const blob = new THREE.Mesh(this.cloudGeometry, blobMat);
      blob.position.set(
        (Math.random() - 0.5) * radius * 0.75,
        Math.random() * radius * 0.45,
        (Math.random() - 0.5) * radius * 0.75,
      );
      blob.scale.setScalar(radius * (0.18 + Math.random() * 0.22));
      smokeGroup.add(blob);
    }
    this.scene.add(smokeGroup);
    this.darkNovas.push({ obj: smokeGroup as unknown as THREE.Mesh, life: 2.2, maxLife: 2.2 });
  }

  // 黒帝オーラ: 足元から低頻度で漂う暗色煙パフ(puffGeometry共有)
  darkSmokeEmit(pos: THREE.Vector3): void {
    const mat = new THREE.MeshBasicMaterial({
      color: 0x0c0016,
      transparent: true,
      opacity: 0.62,
      depthWrite: false,
    });
    const puff = new THREE.Mesh(this.puffGeometry, mat);
    puff.position.copy(pos);
    puff.scale.setScalar(0.5 + Math.random() * 0.4);
    this.scene.add(puff);
    this.darkPuffs.push({ obj: puff, life: 1.4, maxLife: 1.4 });
  }

  // ダイブスラム追加火花: 放射状に飛ぶ加算シャード(既存explosionを補完)
  slamSparks(pos: THREE.Vector3, color: number): void {
    const group = new THREE.Group();
    group.position.copy(pos);
    for (let i = 0; i < 16; i += 1) {
      const shard = new THREE.Mesh(
        this.sparkGeometry,
        new THREE.MeshBasicMaterial({
          color: i % 3 === 0 ? 0xffffff : color,
          transparent: true,
          opacity: 1,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        }),
      );
      const a = Math.random() * Math.PI * 2;
      const spd = 4 + Math.random() * 10;
      shard.userData.vel = new THREE.Vector3(Math.cos(a) * spd, Math.random() * 8 + 2, Math.sin(a) * spd);
      group.add(shard);
    }
    this.scene.add(group);
    this.sparks.push({ obj: group, life: 0.65, maxLife: 0.65 });
  }

  // ジグザグ雷弧(雷帝ウルト)。加算ライン・短寿命(トレーサープールへ相乗り)
  lightningArc(from: THREE.Vector3, to: THREE.Vector3, color: number): void {
    const segments = 8;
    const points: THREE.Vector3[] = [from.clone()];
    const amp = from.distanceTo(to) * 0.22;
    for (let i = 1; i < segments; i += 1) {
      const t = i / segments;
      const p = from.clone().lerp(to, t);
      p.x += (Math.random() - 0.5) * amp;
      p.y += (Math.random() - 0.5) * amp * 0.5;
      p.z += (Math.random() - 0.5) * amp;
      points.push(p);
    }
    points.push(to.clone());
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const material = new THREE.LineBasicMaterial({
      color,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const line = new THREE.Line(geometry, material);
    line.userData.baseOpacity = 0.95; // V23: tickのフェード基準(未設定だと0.85フォールバック)
    this.scene.add(line);
    const life = 0.08 + Math.random() * 0.06;
    this.tracers.push({ obj: line, life, maxLife: life });
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

  // 黒帝通常攻撃: 長く薄い斬線×2(暗芯+深紫縁)。
  // 形状: 長さ~4.2m×厚み~0.35m の細セクタ弧。tilt=0=水平(右薙ぎ/左薙ぎ)、tilt=π/2=垂直(突き)。
  // 飛翔中の回転は廃止し向きを保持。返却した Group は match.ts 側が位置更新・破棄を管理する
  darkSlashWave(origin: THREE.Vector3, dir: THREE.Vector3, tiltRad: number): THREE.Group {
    const group = new THREE.Group();
    group.position.copy(origin);
    const angle = Math.atan2(dir.x, dir.z);
    group.rotation.y = angle;
    group.rotation.z = tiltRad;

    // R28修正: 三日月(曲線)をやめ、両端が尖った「真っ直ぐな斬線」(細長いひし形)へ。
    // ローカルXY平面にX軸方向の細長ダイヤ: tilt=0で水平線、tilt=π/2で垂直線になる(曲率ゼロ)。
    const makeLineGeo = (len: number, thick: number): THREE.BufferGeometry => {
      const geo = new THREE.BufferGeometry();
      const h = len / 2;
      const t = thick / 2;
      // 4頂点のひし形(左端尖り・上・右端尖り・下)を2三角形で
      const verts = new Float32Array([
        -h, 0, 0,  0, t, 0,  0, -t, 0, // 左半分
         h, 0, 0,  0, -t, 0,  0, t, 0, // 右半分
      ]);
      geo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
      return geo;
    };
    // 暗芯(NormalBlending=暗く塗る): 長さ4.2m×厚み0.30mの直線刃
    const coreMat = new THREE.MeshBasicMaterial({
      color: 0x0a0812,
      transparent: true,
      opacity: 0.90,
      blending: THREE.NormalBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const coreMesh = new THREE.Mesh(makeLineGeo(4.2, 0.3), coreMat);
    group.add(coreMesh);

    // 深紫縁(AdditiveBlending): ひと回り大きい直線ダイヤでエッジの光を纏わせる
    const edgeMat = new THREE.MeshBasicMaterial({
      color: 0x7800cc,
      transparent: true,
      opacity: 0.60,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const edgeMesh = new THREE.Mesh(makeLineGeo(4.6, 0.46), edgeMat);
    edgeMesh.position.z = -0.01; // 暗芯の背面に重ねる
    group.add(edgeMesh);

    this.scene.add(group);
    return group;
  }

  // 黒帝オーラ渦: プレイヤー周囲にリング状に配置した暗色ウィスプが螺旋上昇(puffGeometry共有・低コスト)
  // pos = プレイヤー足元付近。6個のウィスプが半径0.6-0.9mの円環上に湧き上がる
  darkAuraSwirl(pos: THREE.Vector3): void {
    const COUNT = 6;
    for (let i = 0; i < COUNT; i++) {
      const angle = (i / COUNT) * Math.PI * 2 + Math.random() * 0.5;
      const radius = 0.6 + Math.random() * 0.3;
      const mat = new THREE.MeshBasicMaterial({
        color: i % 2 === 0 ? 0x0a0018 : 0x180030,
        transparent: true,
        opacity: 0,
        depthWrite: false,
      });
      const wisp = new THREE.Mesh(this.puffGeometry, mat);
      wisp.position.set(
        pos.x + Math.cos(angle) * radius,
        pos.y + Math.random() * 0.3,
        pos.z + Math.sin(angle) * radius,
      );
      wisp.scale.setScalar(0.22 + Math.random() * 0.18);
      wisp.userData.swirlVelY = 0.65 + Math.random() * 0.55;
      wisp.userData.swirlOmega = (1.5 + Math.random() * 1.0) * (Math.random() < 0.5 ? 1 : -1);
      wisp.userData.swirlAngle = angle;
      wisp.userData.swirlRadius = radius;
      wisp.userData.swirlCx = pos.x;
      wisp.userData.swirlCz = pos.z;
      this.scene.add(wisp);
      this.darkAuras.push({ obj: wisp, life: 1.1, maxLife: 1.1 });
    }
  }

  // 黒帝斬撃波のスモークトレイル(puffGeometry共有)
  darkSlashSmoke(pos: THREE.Vector3): void {
    const mat = new THREE.MeshBasicMaterial({
      color: 0x06000c,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
    });
    const puff = new THREE.Mesh(this.puffGeometry, mat);
    puff.position.copy(pos);
    puff.scale.setScalar(0.35 + Math.random() * 0.3);
    this.scene.add(puff);
    this.darkPuffs.push({ obj: puff, life: 0.9, maxLife: 0.9 });
  }

  // 真月: ステージ全域へ広がる暗黒リング + 一瞬の白閃スラッシュ + 黒煙ブロブ
  shingetsuWave(center: THREE.Vector3, maxRadius: number, reduceMotion = false): void {
    const life = 1.6;
    const group = new THREE.Group();
    group.position.copy(center);

    // 暗黒コアリング(NormalBlending)
    const coreRingGeo = new THREE.RingGeometry(0.82, 1.0, 64);
    const coreRingMat = new THREE.MeshBasicMaterial({
      color: 0x060010,
      transparent: true,
      opacity: reduceMotion ? 0.5 : 0.8,
      blending: THREE.NormalBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const coreRing = new THREE.Mesh(coreRingGeo, coreRingMat);
    coreRing.rotation.x = -Math.PI / 2;
    coreRing.scale.setScalar(0.5);
    coreRing.userData.targetScale = maxRadius;
    coreRing.userData.baseOpacity = coreRingMat.opacity;
    group.add(coreRing);

    // 深紫縁リング(AdditiveBlending)
    const edgeGeo = new THREE.RingGeometry(0.88, 1.06, 64);
    const edgeMat = new THREE.MeshBasicMaterial({
      color: 0x4a0080,
      transparent: true,
      opacity: reduceMotion ? 0.35 : 0.62,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const edgeRing = new THREE.Mesh(edgeGeo, edgeMat);
    edgeRing.rotation.x = -Math.PI / 2;
    edgeRing.scale.setScalar(0.5);
    edgeRing.userData.targetScale = maxRadius * 1.04;
    edgeRing.userData.baseOpacity = edgeMat.opacity;
    group.add(edgeRing);

    // 黒煙ブロブ(cloudGeometry共有=disposeしない)
    for (let i = 0; i < 5; i++) {
      const blobMat = new THREE.MeshBasicMaterial({
        color: 0x04000a,
        transparent: true,
        opacity: 0,
        depthWrite: false,
      });
      const blob = new THREE.Mesh(this.cloudGeometry, blobMat);
      const a = (i / 5) * Math.PI * 2 + Math.random() * 0.5;
      const r = maxRadius * (0.3 + Math.random() * 0.5);
      blob.position.set(Math.sin(a) * r, 0.3 + Math.random() * 1.5, Math.cos(a) * r);
      blob.scale.setScalar(maxRadius * (0.04 + Math.random() * 0.06));
      blob.userData.isSmoke = true;
      group.add(blob);
    }

    // 横断スラッシュフラッシュ(reduceMotion無効時のみ)
    if (!reduceMotion) {
      const slashGeo = new THREE.BoxGeometry(maxRadius * 2.2, 0.06, 0.22);
      const slashMat = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.9,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const slash = new THREE.Mesh(slashGeo, slashMat);
      slash.position.y = 0.1;
      slash.userData.isSlashFlash = true;
      slash.userData.baseOpacity = 0.9;
      group.add(slash);
    }

    this.scene.add(group);
    this.shingetsuRings.push({ obj: group, life, maxLife: life });
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
      (line.material as THREE.LineBasicMaterial).opacity =
        ((line.userData.baseOpacity as number) ?? 0.85) * ratio;
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
    this.sparks = this.tick(this.sparks, dt, (group, ratio) => {
      for (const child of group.children) {
        const mesh = child as THREE.Mesh;
        const vel = mesh.userData.vel as THREE.Vector3;
        vel.y -= 14 * dt;
        mesh.position.addScaledVector(vel, dt);
        (mesh.material as THREE.MeshBasicMaterial).opacity = ratio;
      }
    });
    this.flares = this.tick(this.flares, dt, (flare, ratio) => {
      flare.scale.setScalar(1 + (1 - ratio) * 1.5);
      (flare.material as THREE.MeshBasicMaterial).opacity = 0.95 * ratio;
    });
    this.rings = this.tick(this.rings, dt, (ring, ratio) => {
      // 誕生時(ratio=1)は小さく、寿命末(ratio→0)へ向けて target まで一気に拡大して据わる
      const target = (ring.userData.targetScale as number) ?? 1;
      const grown = target * (1 - ratio * ratio);
      ring.scale.setScalar(Math.max(ring.scale.x, grown));
      (ring.material as THREE.MeshBasicMaterial).opacity =
        ((ring.userData.baseOpacity as number) ?? 0.9) * ratio;
    });
    this.crescents = this.tick(this.crescents, dt, (mesh, ratio) => {
      // 拡大(三乗イーズ)+回転+フェードで「振り抜き」を出す
      const target = (mesh.userData.targetScale as number) ?? 2.5;
      mesh.scale.setScalar(0.3 + (target - 0.3) * (1 - ratio * ratio * ratio));
      mesh.rotation.z += dt * 2.5;
      (mesh.material as THREE.MeshBasicMaterial).opacity =
        ((mesh.userData.baseOpacity as number) ?? 0.92) * ratio;
    });
    this.impactRings = this.tick(this.impactRings, dt, (mesh, ratio) => {
      const target = (mesh.userData.targetScale as number) ?? 1.4;
      mesh.scale.setScalar(Math.max(mesh.scale.x, target * (1 - ratio * ratio)));
      (mesh.material as THREE.MeshBasicMaterial).opacity =
        ((mesh.userData.baseOpacity as number) ?? 0.75) * ratio;
    });
    this.darkNovas = this.tick(this.darkNovas as unknown as Timed<THREE.Object3D>[], dt, (obj, ratio) => {
      if (obj instanceof THREE.Group) {
        // 黒煙群: 展開フェードイン→末尾フェードアウト
        const age = ((obj.userData.age as number | undefined) ?? 0) + dt;
        obj.userData.age = age;
        const grow = Math.min(1, age / 0.4);
        const remaining = ratio * (obj.userData.maxLife as number);
        const fade = Math.min(1, remaining / 1.5);
        for (const child of obj.children) {
          (child as THREE.Mesh).scale.multiplyScalar(1 + dt * 0.015);
          ((child as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = 0.62 * grow * fade;
        }
      } else {
        // 暗転球・リング: 拡大+フェード
        const target = (obj.userData.targetScale as number) ?? 1;
        const grown = target * (1 - ratio * ratio);
        (obj as THREE.Mesh).scale.setScalar(Math.max((obj as THREE.Mesh).scale.x, grown));
        ((obj as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity =
          ((obj.userData.baseOpacity as number) ?? 0.85) * ratio;
      }
    }) as unknown as Timed<THREE.Mesh | THREE.Group>[];
    this.darkPuffs = this.tick(this.darkPuffs, dt, (puff, ratio) => {
      (puff.material as THREE.MeshBasicMaterial).opacity = 0.62 * ratio;
      puff.scale.multiplyScalar(1 + dt * 0.55); // ゆっくり膨らむ
    });
    this.darkAuras = this.tick(this.darkAuras, dt, (wisp, ratio) => {
      // 素早くフェードイン→ゆっくりフェードアウト
      const fadeIn = Math.min(1, (1 - ratio) * 4);
      (wisp.material as THREE.MeshBasicMaterial).opacity = 0.48 * ratio * fadeIn;
      // 螺旋上昇
      wisp.position.y += (wisp.userData.swirlVelY as number) * dt;
      const newAngle = (wisp.userData.swirlAngle as number) + (wisp.userData.swirlOmega as number) * dt;
      wisp.userData.swirlAngle = newAngle;
      wisp.position.x = (wisp.userData.swirlCx as number) + Math.cos(newAngle) * (wisp.userData.swirlRadius as number);
      wisp.position.z = (wisp.userData.swirlCz as number) + Math.sin(newAngle) * (wisp.userData.swirlRadius as number);
      wisp.scale.multiplyScalar(1 + dt * 0.35);
    });
    this.shingetsuRings = this.tick(this.shingetsuRings, dt, (group, ratio) => {
      const grow = 1 - ratio * ratio; // ratio=1(開始)→0(終了)なので拡大
      for (const child of group.children) {
        const mesh = child as THREE.Mesh;
        if (mesh.userData.isSmoke === true) {
          // 黒煙ブロブ: フェードイン→ゆっくりフェードアウト
          const age = 1 - ratio;
          const fadeIn = Math.min(1, age / 0.3);
          const fadeOut = Math.min(1, ratio * 2);
          (mesh.material as THREE.MeshBasicMaterial).opacity = 0.55 * fadeIn * fadeOut;
          mesh.scale.multiplyScalar(1 + dt * 0.4);
          continue;
        }
        if (mesh.userData.isSlashFlash === true) {
          // スラッシュフラッシュ: 素早くフェードアウト
          // V26修正: ratio*8のclampは寿命の大半を全開輝度で残す(逆挙動)。二乗減衰で
          // 「出現時に最も明るく短時間で消える」本来の斬り線フラッシュへ
          const flashRatio = ratio * ratio;
          (mesh.material as THREE.MeshBasicMaterial).opacity =
            (mesh.userData.baseOpacity as number) * flashRatio;
          (mesh.material as THREE.MeshBasicMaterial).color.setHex(
            ratio > 0.7 ? 0xffffff : 0x6a00b0,
          );
          continue;
        }
        // リングメッシュ: 拡大しながらフェードアウト
        const target = (mesh.userData.targetScale as number) ?? 10;
        const current = target * grow;
        mesh.scale.setScalar(Math.max(mesh.scale.x, current));
        (mesh.material as THREE.MeshBasicMaterial).opacity =
          (mesh.userData.baseOpacity as number) * ratio;
      }
    });
    this.streaks = this.tick(this.streaks, dt, (group, ratio) => {
      const grow = 1 - ratio * ratio; // 中心から外へ走る
      for (const child of group.children) {
        const mesh = child as THREE.Mesh;
        const len = (mesh.userData.len as number) * grow;
        const dir = mesh.userData.dir as THREE.Vector2;
        mesh.scale.z = Math.max(0.01, len);
        mesh.position.set(dir.x * len * 0.5, 0, dir.y * len * 0.5);
        (mesh.material as THREE.MeshBasicMaterial).opacity = 0.95 * ratio;
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
    for (const list of [
      this.tracers,
      this.puffs,
      this.decals,
      this.blasts,
      this.flares,
      this.rings,
      this.crescents,
      this.impactRings,
      this.darkPuffs,
      this.darkAuras,
      this.darkNovas as unknown as Timed<THREE.Object3D>[],
      this.shingetsuRings as unknown as Timed<THREE.Object3D>[],
    ]) {
      for (const item of list) this.disposeObject(item.obj);
      list.length = 0;
    }
    for (const list of [this.clouds, this.flames, this.sparks, this.streaks]) {
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
    this.sparkGeometry.dispose();
    this.flareGeometry.dispose();
    this.ringGeometry.dispose();
    this.streakGeometry.dispose();
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
          node.geometry !== this.blastGeometry &&
          node.geometry !== this.sparkGeometry &&
          node.geometry !== this.flareGeometry &&
          node.geometry !== this.ringGeometry &&
          node.geometry !== this.streakGeometry
        ) {
          node.geometry.dispose();
        }
        (node.material as THREE.Material).dispose();
      }
    });
  }
}
