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
  private debris: Timed<THREE.Group>[] = [];                 // 破壊可能プロップの破片群
  private geppaRings: Timed<THREE.Group>[] = [];             // 月花雷轟/雷帝衝撃リング
  private gokuraiColumns: Timed<THREE.Group>[] = [];         // 雷帝落雷柱
  private kokuraiTrails: Timed<THREE.Group>[] = [];          // 黒雷帝移動トレイル(上限6)
  private shurikenTrails: Timed<THREE.Group>[] = [];          // B ult モーションブレード残像
  private schwarzAbsorbs: Timed<THREE.Group>[] = [];          // M ult 暗黒吸引粒子
  private shingetsuCuts: Timed<THREE.Group>[] = [];           // 真月 空間切れ残留線
  private overdriveAuras: Timed<THREE.Mesh>[] = [];           // オーバードライブ 金オーラ
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
  // 破片(単位箱・scale で各フラグメントサイズへ拡大)。deathBurst の sparkGeometry より大きめ
  private readonly debrisFragGeo = new THREE.BoxGeometry(1, 1, 1);

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

  // ロケット着弾専用の超強化爆発エフェクト。
  // (a) 白熱コア→オレンジ外殻の二段火球、(b) 地面衝撃波リング(shockwaveRing流用)、
  // (c) 放射する火花ストリーク×12、(d) 立ち上る黒煙柱×4(velYで上昇)、
  // (e) 一瞬の白フラッシュ球(0.12s)。全て加算+NormalBlendingを使い分け、bloom超過は0.12s内のみ。
  rocketBlast(point: THREE.Vector3, radius: number): void {
    // (e) 白フラッシュ球(最短寿命・白飛び禁則内)
    const flash = new THREE.Mesh(
      this.blastGeometry,
      new THREE.MeshBasicMaterial({
        color: 0xfff8f0,
        transparent: true,
        opacity: 0.9,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    flash.position.copy(point);
    flash.scale.setScalar(radius * 0.12);
    flash.userData.targetScale = radius * 0.75;
    this.scene.add(flash);
    this.blasts.push({ obj: flash, life: 0.12, maxLife: 0.12 });

    // (a) 白熱コア(急速拡大)
    const core = new THREE.Mesh(
      this.blastGeometry,
      new THREE.MeshBasicMaterial({
        color: 0xffecc8,
        transparent: true,
        opacity: 0.95,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    core.position.copy(point);
    core.scale.setScalar(radius * 0.08);
    core.userData.targetScale = radius * 0.55;
    this.scene.add(core);
    this.blasts.push({ obj: core, life: 0.42, maxLife: 0.42 });

    // (a) オレンジ外殻(コアより遅れ・より大きく広がる)
    const outer = new THREE.Mesh(
      this.blastGeometry,
      new THREE.MeshBasicMaterial({
        color: 0xff5a10,
        transparent: true,
        opacity: 0.78,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    outer.position.copy(point);
    outer.scale.setScalar(radius * 0.18);
    outer.userData.targetScale = radius;
    this.scene.add(outer);
    this.blasts.push({ obj: outer, life: 0.62, maxLife: 0.62 });

    // (b) 地面を走る衝撃波リング(shockwaveRing 流用・白→オレンジ)
    this.shockwaveRing(point.clone(), radius * 0.85, 0xff6820);

    // (c) 放射する火花ストリーク × 12
    const sparkGroup = new THREE.Group();
    sparkGroup.position.copy(point);
    const STREAK_N = 12;
    for (let i = 0; i < STREAK_N; i += 1) {
      const a = (i / STREAK_N) * Math.PI * 2 + Math.random() * 0.4;
      const elev = (Math.random() - 0.25) * 0.9;
      const spd = (5 + Math.random() * 7) * Math.min(1, radius * 0.07);
      const shard = new THREE.Mesh(
        this.sparkGeometry,
        new THREE.MeshBasicMaterial({
          color: i % 4 === 0 ? 0xffffff : 0xff7030,
          transparent: true,
          opacity: 1,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        }),
      );
      shard.userData.vel = new THREE.Vector3(
        Math.cos(a) * Math.cos(elev) * spd,
        Math.abs(Math.sin(elev)) * spd + 1.5 + Math.random() * 3,
        Math.sin(a) * Math.cos(elev) * spd,
      );
      sparkGroup.add(shard);
    }
    this.scene.add(sparkGroup);
    this.sparks.push({ obj: sparkGroup, life: 0.85, maxLife: 0.85 });

    // (d) 立ち上る黒煙柱 × 4(blasts + velY で上昇)
    const SMOKE_N = 4;
    for (let i = 0; i < SMOKE_N; i += 1) {
      const smoke = new THREE.Mesh(
        this.cloudGeometry,
        new THREE.MeshBasicMaterial({
          color: 0x1a1812,
          transparent: true,
          opacity: 0,
          depthWrite: false,
        }),
      );
      smoke.position.copy(point).add(
        new THREE.Vector3(
          (Math.random() - 0.5) * radius * 0.28,
          Math.random() * radius * 0.18,
          (Math.random() - 0.5) * radius * 0.28,
        ),
      );
      smoke.scale.setScalar(radius * (0.12 + Math.random() * 0.1));
      smoke.userData.targetScale = radius * (0.42 + Math.random() * 0.22);
      smoke.userData.velY = 0.7 + Math.random() * 1.1;
      smoke.userData.baseOpacity = 0.48;
      this.scene.add(smoke);
      this.blasts.push({ obj: smoke, life: 2.2, maxLife: 2.2 });
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

  // BF5簡易破壊: プロップの色・寸法から 6〜10 個の小箱片が弾け飛ぶ。
  // deathBurst流儀(重力落下・0.9sフェード)。match.ts側で土煙はexplosion()小半径で担う。
  // colorHex: THREE色番号(0xrrggbb)。w/h/d: プロップの World 寸法(m)。
  debrisBurst(pos: THREE.Vector3, colorHex: number, w: number, h: number, d: number): void {
    const count = 6 + Math.floor(Math.random() * 5); // 6〜10
    const group = new THREE.Group();
    group.position.copy(pos);
    for (let i = 0; i < count; i += 1) {
      const mat = new THREE.MeshBasicMaterial({
        color: colorHex,
        transparent: true,
        opacity: 0.95,
      });
      const frag = new THREE.Mesh(this.debrisFragGeo, mat);
      // 破片サイズ: プロップ寸法の 10〜30 % でランダムにばらす
      frag.scale.set(
        w * (0.1 + Math.random() * 0.2),
        h * (0.1 + Math.random() * 0.2),
        d * (0.1 + Math.random() * 0.2),
      );
      // 初期位置をプロップ内部でばらす
      frag.position.set(
        (Math.random() - 0.5) * w * 0.4,
        (Math.random() - 0.5) * h * 0.4,
        (Math.random() - 0.5) * d * 0.4,
      );
      // 外方向へ弾け飛ぶ速度(上向き成分を多めに)
      frag.userData.vel = new THREE.Vector3(
        (Math.random() - 0.5) * 9,
        Math.random() * 5 + 1.5,
        (Math.random() - 0.5) * 9,
      );
      group.add(frag);
    }
    this.scene.add(group);
    this.debris.push({ obj: group, life: 0.9, maxLife: 0.9 });
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
  // sizeMul=1 = 通常(4.2m×0.3m). charge最大時 sizeMul=10 で横幅×10
  darkSlashWave(origin: THREE.Vector3, dir: THREE.Vector3, tiltRad: number, sizeMul = 1): THREE.Group {
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
    // 暗芯(NormalBlending=暗く塗る): sizeMul で長さ・厚みを拡大(thick は最大3倍)
    const coreLen = 4.2 * sizeMul;
    const coreThick = 0.3 * Math.min(sizeMul, 3);
    const coreMat = new THREE.MeshBasicMaterial({
      color: 0x0a0812,
      transparent: true,
      opacity: 0.90,
      blending: THREE.NormalBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const coreMesh = new THREE.Mesh(makeLineGeo(coreLen, coreThick), coreMat);
    group.add(coreMesh);

    // 深紫縁(AdditiveBlending): ひと回り大きい直線ダイヤでエッジの光を纏わせる
    const edgeMat = new THREE.MeshBasicMaterial({
      color: sizeMul >= 5 ? 0xaa00ff : 0x7800cc,
      transparent: true,
      opacity: sizeMul >= 5 ? 0.75 : 0.60,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const edgeMesh = new THREE.Mesh(makeLineGeo(coreLen * 1.095, coreThick * 1.53), edgeMat);
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

  // 黒帝斬撃波(可変サイズ版): lenM/thickM を外部指定。match.ts が位置・破棄を管理する
  darkSlashWaveSized(origin: THREE.Vector3, dir: THREE.Vector3, tiltRad: number, lenM: number, thickM: number): THREE.Group {
    const group = new THREE.Group();
    group.position.copy(origin);
    group.rotation.y = Math.atan2(dir.x, dir.z);
    group.rotation.z = tiltRad;

    const makeGeo = (len: number, thick: number): THREE.BufferGeometry => {
      const geo = new THREE.BufferGeometry();
      const h = len / 2;
      const t = thick / 2;
      const verts = new Float32Array([
        -h, 0, 0,  0, t, 0,  0, -t, 0,
         h, 0, 0,  0, -t, 0,  0, t, 0,
      ]);
      geo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
      return geo;
    };

    const coreMat = new THREE.MeshBasicMaterial({
      color: 0x0a0812, transparent: true, opacity: 0.90,
      blending: THREE.NormalBlending, depthWrite: false, side: THREE.DoubleSide,
    });
    group.add(new THREE.Mesh(makeGeo(lenM, thickM), coreMat));

    const edgeMat = new THREE.MeshBasicMaterial({
      color: 0x7800cc, transparent: true, opacity: 0.60,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    });
    const edgeMesh = new THREE.Mesh(makeGeo(lenM * 1.08, thickM * 1.5), edgeMat);
    edgeMesh.position.z = -0.01;
    group.add(edgeMesh);

    this.scene.add(group);
    return group;
  }

  // 雷帝通常攻撃AoE: 氷青衝撃リング + 放射落雷柱(radiusMは爆発半径m)
  lightningStrikeAoE(center: THREE.Vector3, radiusM: number, reduceMotion = false): void {
    const life = 0.75;
    const group = new THREE.Group();
    group.position.copy(center);

    const addRing = (color: number, inner: number, outer: number, opacity: number, targetR: number) => {
      const geo = new THREE.RingGeometry(inner, outer, 48);
      const mat = new THREE.MeshBasicMaterial({
        color, transparent: true,
        opacity: reduceMotion ? opacity * 0.45 : opacity,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
      });
      const ring = new THREE.Mesh(geo, mat);
      ring.rotation.x = -Math.PI / 2;
      ring.scale.setScalar(0.3);
      ring.userData.targetScale = targetR;
      ring.userData.baseOpacity = mat.opacity;
      group.add(ring);
    };

    addRing(0x44aaff, 0.82, 1.0,  0.85, radiusM);
    addRing(0xaaddff, 0.88, 1.06, 0.50, radiusM * 1.06);
    this.scene.add(group);
    this.geppaRings.push({ obj: group, life, maxLife: life });

    const colCount = reduceMotion ? 0 : 8; // rm=柱ゼロ(旧契約維持: 光過敏配慮)
    for (let i = 0; i < colCount; i++) {
      const angle = (i / colCount) * Math.PI * 2 + Math.random() * 0.4;
      const dist = radiusM * (0.35 + Math.random() * 0.55);
      this._spawnLightningColumn(
        new THREE.Vector3(center.x + Math.cos(angle) * dist, center.y, center.z + Math.sin(angle) * dist),
        5 + Math.random() * 3, 0.4 + Math.random() * 0.25,
      );
    }
    if (!reduceMotion) {
      this.buildBranchBolt(
        new THREE.Vector3(center.x, center.y + radiusM * 1.5, center.z),
        center.clone(),
        3, false, 0.2,
      );
    }
  }

  // 黒雷帝通常攻撃AoE: 黒帝暗黒リング + 雷青リング + 落雷柱
  kokuraiteiStrikeAoE(center: THREE.Vector3, radiusM: number, reduceMotion = false): void {
    const life = 0.85;
    const group = new THREE.Group();
    group.position.copy(center);

    const addRing = (color: number, inner: number, outer: number, opacity: number, targetR: number, blend: THREE.Blending) => {
      const geo = new THREE.RingGeometry(inner, outer, 48);
      const mat = new THREE.MeshBasicMaterial({
        color, transparent: true,
        opacity: reduceMotion ? opacity * 0.5 : opacity,
        blending: blend, depthWrite: false, side: THREE.DoubleSide,
      });
      const ring = new THREE.Mesh(geo, mat);
      ring.rotation.x = -Math.PI / 2;
      ring.scale.setScalar(0.3);
      ring.userData.targetScale = targetR;
      ring.userData.baseOpacity = mat.opacity;
      group.add(ring);
    };

    addRing(0x1a0030, 0.82, 1.0,  0.90, radiusM * 0.95, THREE.NormalBlending);
    addRing(0x5500aa, 0.88, 1.06, 0.65, radiusM,        THREE.AdditiveBlending);
    addRing(0x2266cc, 0.82, 1.0,  0.55, radiusM * 1.08, THREE.AdditiveBlending);
    this.scene.add(group);
    this.geppaRings.push({ obj: group, life, maxLife: life });

    const colCount = reduceMotion ? 0 : 10; // rm=柱ゼロ
    for (let i = 0; i < colCount; i++) {
      const angle = (i / colCount) * Math.PI * 2 + Math.random() * 0.3;
      const dist = radiusM * (0.3 + Math.random() * 0.6);
      this._spawnLightningColumn(
        new THREE.Vector3(center.x + Math.cos(angle) * dist, center.y, center.z + Math.sin(angle) * dist),
        5 + Math.random() * 4, 0.4 + Math.random() * 0.3, true,
      );
    }
    if (!reduceMotion) {
      this.buildBranchBolt(
        new THREE.Vector3(center.x, center.y + radiusM * 1.5, center.z),
        center.clone(),
        3, true, 0.2,
      );
    }
  }

  // 月花雷轟: 4秒嵐エフェクト(N ult + raiteiMode)。天の裁き — 氷青波状攻撃 + 月光柱 + ストロボ
  geppaRaigouStorm(center: THREE.Vector3, maxRadius: number, durationS: number, reduceMotion = false): void {
    const waveCount = reduceMotion ? 5 : 12;
    for (let w = 0; w < waveCount; w++) {
      // 掃き感: リング中心を一軸方向にずらす
      const sweepFrac = w / waveCount;
      const sweepX = (sweepFrac - 0.5) * maxRadius * 0.55;
      const offsetCenter = new THREE.Vector3(center.x + sweepX, center.y, center.z);
      const r = maxRadius * (0.48 + sweepFrac * 0.48);
      const lf = durationS * (0.95 - sweepFrac * 0.32);
      const group = new THREE.Group();
      group.position.copy(offsetCenter);
      const addR = (color: number, inner: number, outer: number, op: number, tr: number): void => {
        const geo = new THREE.RingGeometry(inner, outer, 52);
        const mat = new THREE.MeshBasicMaterial({
          color, transparent: true,
          opacity: reduceMotion ? op * 0.45 : op,
          blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
        });
        const ring = new THREE.Mesh(geo, mat);
        ring.rotation.x = -Math.PI / 2;
        ring.scale.setScalar(0.1);
        ring.userData.targetScale = Math.min(tr, maxRadius * 1.12);
        ring.userData.baseOpacity = mat.opacity;
        group.add(ring);
      };
      addR(0x44ccff, 0.82, 1.0,  0.82, r);
      addR(0xeef8ff, 0.88, 1.02, 0.48, r * 1.04);
      addR(0x2266dd, 0.76, 1.06, 0.32, r * 1.08);
      this.scene.add(group);
      this.geppaRings.push({ obj: group, life: Math.max(0.3, lf), maxLife: Math.max(0.3, lf) });
    }

    // 月光柱(天→地への白光柱 5本、reduceMotion=0)
    const pillarCount = reduceMotion ? 0 : 5; // rm=柱ゼロ
    for (let p = 0; p < pillarCount; p++) {
      const pa = (p / pillarCount) * Math.PI * 2 + Math.random() * 0.8;
      const pr = maxRadius * (0.25 + Math.random() * 0.5);
      const pillarPos = new THREE.Vector3(center.x + Math.cos(pa) * pr, center.y, center.z + Math.sin(pa) * pr);
      const pgeo = new THREE.BoxGeometry(0.55, 35, 0.55);
      const pmat = new THREE.MeshBasicMaterial({
        color: 0xaaddff, transparent: true, opacity: 0.42,
        blending: THREE.AdditiveBlending, depthWrite: false,
      });
      const pillar = new THREE.Mesh(pgeo, pmat);
      pillar.position.y = 17.5;
      pillar.userData.targetScale = 1;
      pillar.userData.baseOpacity = 0.42;
      const pillarGroup = new THREE.Group();
      pillarGroup.position.copy(pillarPos);
      pillarGroup.add(pillar);
      this.scene.add(pillarGroup);
      this.geppaRings.push({ obj: pillarGroup, life: durationS * 0.55 + Math.random() * 0.4, maxLife: durationS });
    }

    // ストロボ氷青フラッシュ(3発)
    const strobeCount = reduceMotion ? 0 : 3;
    for (let s = 0; s < strobeCount; s++) {
      const flashMat = new THREE.MeshBasicMaterial({
        color: 0x88ccff, transparent: true, opacity: 0.42,
        blending: THREE.AdditiveBlending, depthWrite: false,
      });
      const flash = new THREE.Mesh(this.blastGeometry, flashMat);
      flash.position.copy(center);
      flash.scale.setScalar(0.8);
      flash.userData.targetScale = maxRadius * 0.85;
      this.scene.add(flash);
      this.blasts.push({ obj: flash, life: 0.12 + s * 0.1, maxLife: 0.32 });
    }

    const colCount = reduceMotion ? 0 : 28; // rm=柱ゼロ
    for (let i = 0; i < colCount; i++) {
      const angle = (i / colCount) * Math.PI * 2 + Math.random() * 0.35;
      const d = maxRadius * (0.2 + Math.random() * 0.7);
      this._spawnLightningColumn(
        new THREE.Vector3(center.x + Math.cos(angle) * d, center.y, center.z + Math.sin(angle) * d),
        5 + Math.random() * 9, 0.25 + Math.random() * durationS * 0.65,
      );
    }
  }

  // 極雷絶滅: 終幕演出エフェクト(M ult + kokuraiteiMode)。終焉/虚無 — 黒ドーム + 少数巨大柱 + 地面亀裂 + 最後の一閃
  gokuraiZetsumetsuEffect(center: THREE.Vector3, reduceMotion = false): void {
    const maxR = 32;

    // 黒いドーム球(BackSide で内部から不吉な暗闇を演出)
    if (!reduceMotion) {
      const domeMat = new THREE.MeshBasicMaterial({
        color: 0x000008, transparent: true, opacity: 0.82,
        blending: THREE.NormalBlending, depthWrite: false, side: THREE.BackSide,
      });
      const dome = new THREE.Mesh(this.blastGeometry, domeMat);
      dome.position.copy(center);
      dome.scale.setScalar(0.5);
      dome.userData.targetScale = maxR * 1.8;
      dome.userData.baseOpacity = 0.82;
      this.scene.add(dome);
      this.darkNovas.push({ obj: dome, life: 3.5, maxLife: 3.5 });
    }

    // 暗色拡大リング3枚
    const ringParams: Array<{ color: number; inner: number; outer: number; op: number; tr: number; lf: number }> = [
      { color: 0x000010, inner: 0.75, outer: 1.0,  op: 0.90, tr: maxR * 0.70, lf: 3.5 },
      { color: 0x330055, inner: 0.82, outer: 1.06, op: 0.65, tr: maxR,         lf: 3.0 },
      { color: 0x110033, inner: 0.88, outer: 1.10, op: 0.40, tr: maxR * 1.1,  lf: 2.5 },
    ];
    for (const rd of ringParams) {
      const group = new THREE.Group();
      group.position.copy(center);
      const geo = new THREE.RingGeometry(rd.inner, rd.outer, 52);
      const mat = new THREE.MeshBasicMaterial({
        color: rd.color, transparent: true,
        opacity: reduceMotion ? rd.op * 0.5 : rd.op,
        blending: rd.color === 0x000010 ? THREE.NormalBlending : THREE.AdditiveBlending,
        depthWrite: false, side: THREE.DoubleSide,
      });
      const ring = new THREE.Mesh(geo, mat);
      ring.rotation.x = -Math.PI / 2;
      ring.scale.setScalar(0.1);
      ring.userData.targetScale = rd.tr;
      ring.userData.baseOpacity = mat.opacity;
      group.add(ring);
      this.scene.add(group);
      this.geppaRings.push({ obj: group, life: rd.lf, maxLife: rd.lf });
    }

    // 地面の紫亀裂(10本の放射状ライン、fissure フリッカー)
    const crackCount = reduceMotion ? 0 : 10;
    for (let i = 0; i < crackCount; i++) {
      const a = (i / crackCount) * Math.PI * 2 + Math.random() * 0.22;
      const len = maxR * (0.3 + Math.random() * 0.6);
      const crackDir = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
      const streak = new THREE.Mesh(this.streakGeometry, new THREE.MeshBasicMaterial({
        color: 0x8800cc, transparent: true, opacity: 0.72,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }));
      streak.scale.z = len;
      streak.scale.x = 0.08 + Math.random() * 0.06;
      streak.position.copy(center).addScaledVector(crackDir, len * 0.5);
      streak.position.y -= 0.06;
      streak.rotation.y = a;
      streak.userData.fissure = true;
      streak.userData.baseOpacity = 0.72;
      const sg = new THREE.Group();
      sg.add(streak);
      this.scene.add(sg);
      this.streaks.push({ obj: sg, life: 3.0 + Math.random() * 0.5, maxLife: 3.5 });
    }

    // 5本の巨大落雷柱(1本ずつ重く遅く: 各柱が長命)
    const colCount = reduceMotion ? 0 : 5; // rm=柱ゼロ
    for (let i = 0; i < colCount; i++) {
      const a = (i / colCount) * Math.PI * 2 + Math.random() * 0.4;
      const d = maxR * (0.2 + Math.random() * 0.65);
      this._spawnLightningColumn(
        new THREE.Vector3(center.x + Math.cos(a) * d, center.y, center.z + Math.sin(a) * d),
        14 + Math.random() * 6, 2.0 + Math.random() * 1.5, true,
      );
    }

    // 最後の黒白反転一閃(isInversion: 寿命の最後12.5%で出現)
    if (!reduceMotion) {
      const invGroup = new THREE.Group();
      invGroup.position.copy(center);
      const invGeo = new THREE.RingGeometry(0.85, 1.0, 64);
      const invMat = new THREE.MeshBasicMaterial({
        color: 0xffffff, transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
      });
      const invRing = new THREE.Mesh(invGeo, invMat);
      invRing.rotation.x = -Math.PI / 2;
      invRing.scale.setScalar(0.5);
      invRing.userData.targetScale = maxR * 1.5;
      invRing.userData.baseOpacity = 0.55;
      invRing.userData.isInversion = true;
      invGroup.add(invRing);
      this.scene.add(invGroup);
      this.geppaRings.push({ obj: invGroup, life: 4.0, maxLife: 4.0 });
    }
  }

  buildBranchBolt(
    from: THREE.Vector3,
    to: THREE.Vector3,
    branches: number,
    isKokurai: boolean,
    life: number,
  ): void {
    const group = new THREE.Group();
    group.position.copy(from);
    const dir = to.clone().sub(from);
    const len = dir.length();
    const segs = 6 + Math.floor(Math.random() * 4);
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      const jitter = len * 0.18 * (t > 0 && t < 1 ? 1 : 0);
      pts.push(new THREE.Vector3(
        dir.x * t + (Math.random() - 0.5) * jitter,
        dir.y * t + (Math.random() - 0.5) * jitter,
        dir.z * t + (Math.random() - 0.5) * jitter,
      ));
    }

    const addLine = (points: THREE.Vector3[], color: number, opacity: number): void => {
      const geo = new THREE.BufferGeometry().setFromPoints(points);
      const mat = new THREE.LineBasicMaterial({
        color, transparent: true, opacity,
        blending: THREE.AdditiveBlending, depthWrite: false,
      });
      const line = new THREE.Line(geo, mat);
      line.userData.baseOpacity = opacity;
      group.add(line);
    };

    const coreColor = isKokurai ? 0x220033 : 0xffffff;
    const haloColor = isKokurai ? 0x8800ff : 0x88ddff;
    addLine(pts, coreColor, isKokurai ? 0.70 : 0.95);
    addLine(pts, haloColor, isKokurai ? 0.55 : 0.60);

    const branchCount = Math.min(branches, 2 + Math.floor(Math.random() * 3));
    for (let b = 0; b < branchCount; b++) {
      const startT = 0.2 + Math.random() * 0.5;
      const startPt = (pts[Math.floor(startT * segs)] ?? pts[0]!).clone();
      const endPt = startPt.clone().add(new THREE.Vector3(
        (Math.random() - 0.5) * len * 0.5,
        -len * (0.15 + Math.random() * 0.25),
        (Math.random() - 0.5) * len * 0.5,
      ));
      const bOpacity = 0.35 + Math.random() * 0.2;
      const bGeo = new THREE.BufferGeometry().setFromPoints([startPt, endPt]);
      const bMat = new THREE.LineBasicMaterial({
        color: haloColor, transparent: true, opacity: bOpacity,
        blending: THREE.AdditiveBlending, depthWrite: false,
      });
      const bLine = new THREE.Line(bGeo, bMat);
      bLine.userData.baseOpacity = bOpacity;
      group.add(bLine);
    }

    this.scene.add(group);
    this.pushGokuraiColumn({ obj: group, life, maxLife: life });
  }

  // 黒雷帝移動トレイル: スプリント/スライド中に足元へ這う小分岐ボルト(上限6本プール)
  spawnKokuraiTrail(pos: THREE.Vector3, isSliding: boolean): void {
    const MAX_KOKURAI_TRAILS = 6;
    const count = isSliding ? 2 : 1;
    for (let c = 0; c < count; c++) {
      // 水平方向へランダムな短いブランチボルト(地面に這う電弧)
      const angle = Math.random() * Math.PI * 2;
      const len = 1.0 + Math.random() * 0.8;
      const to = new THREE.Vector3(
        pos.x + Math.cos(angle) * len,
        pos.y - 0.08,  // わずかに地面方向へ傾ける
        pos.z + Math.sin(angle) * len,
      );
      const life = 0.3 + Math.random() * 0.2;
      this.buildBranchBolt(pos, to, 2, true, life);
      // buildBranchBolt は gokuraiColumns に積む。kokuraiTrails は別管理なので
      // ここは gokuraiColumns に入った最後のエントリを直接管理する必要はない。
      // 代わりにスライド時の「焦げ小リング」専用エントリをkokuraiTrailsで管理する
    }
    if (isSliding) {
      // 地面焦げ小リング: impactRingより小さく短命
      const geo = new THREE.RingGeometry(0.5, 0.62, 24);
      const mat = new THREE.MeshBasicMaterial({
        color: 0x5500aa,
        transparent: true,
        opacity: 0.7,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const ring = new THREE.Mesh(geo, mat);
      ring.rotation.x = -Math.PI / 2;
      ring.position.copy(pos);
      ring.scale.setScalar(0.2);
      ring.userData.targetScale = 1.2;
      ring.userData.baseOpacity = 0.7;
      const group = new THREE.Group();
      group.add(ring);
      this.scene.add(group);
      if (this.kokuraiTrails.length >= MAX_KOKURAI_TRAILS) {
        const oldest = this.kokuraiTrails.shift();
        if (oldest) this.disposeObject(oldest.obj);
      }
      this.kokuraiTrails.push({ obj: group, life: 0.25, maxLife: 0.25 });
    }
  }

  // 黒雷帝ブリンク消失点エフェクト: 上向き小ボルト2本 + 小フラッシュ
  kokuraiBlinkDepart(pos: THREE.Vector3): void {
    for (let i = 0; i < 2; i++) {
      const a = (i / 2) * Math.PI * 2 + Math.random() * 0.6;
      const top = new THREE.Vector3(
        pos.x + Math.cos(a) * 0.4,
        pos.y + 3.0 + Math.random(),
        pos.z + Math.sin(a) * 0.4,
      );
      this.buildBranchBolt(top, pos.clone().add(new THREE.Vector3(Math.cos(a) * 0.1, 0, Math.sin(a) * 0.1)), 1, true, 0.18);
    }
    const flash = new THREE.Mesh(
      this.blastGeometry,
      new THREE.MeshBasicMaterial({
        color: 0x9944ff,
        transparent: true,
        opacity: 0.50,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    flash.position.copy(pos);
    flash.scale.setScalar(0.3);
    flash.userData.targetScale = 1.8;
    this.scene.add(flash);
    this.blasts.push({ obj: flash, life: 0.15, maxLife: 0.15 });
  }

  // 黒雷帝ブリンク出現点エフェクト: 短い落雷柱 + 小衝撃リング + 地這い紫電ボルト
  kokuraiBlinkArrive(pos: THREE.Vector3): void {
    this._spawnLightningColumn(pos, 6, 0.18, true);
    this.impactRing(pos, 0x5500aa);
    const count = 3 + Math.floor(Math.random() * 2);
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + Math.random() * 0.5;
      const len = 3.5 + Math.random() * 1.5;
      const to = new THREE.Vector3(
        pos.x + Math.cos(a) * len, pos.y - 0.04, pos.z + Math.sin(a) * len,
      );
      this.buildBranchBolt(pos, to, 2, true, 0.18 + Math.random() * 0.08);
    }
  }

  // 雷帝ブリンク消失点: 小上向きボルト + 氷青フラッシュ
  raiteiBlinkDepart(pos: THREE.Vector3): void {
    const top = new THREE.Vector3(pos.x, pos.y + 2.5, pos.z);
    this.buildBranchBolt(top, pos, 1, false, 0.14);
    const flash = new THREE.Mesh(this.blastGeometry, new THREE.MeshBasicMaterial({
      color: 0x44aaff, transparent: true, opacity: 0.42,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    flash.position.copy(pos);
    flash.scale.setScalar(0.2);
    flash.userData.targetScale = 1.4;
    this.scene.add(flash);
    this.blasts.push({ obj: flash, life: 0.14, maxLife: 0.14 });
  }

  // 雷帝ブリンク出現点: 落雷柱 + 衝撃リング + 地這い氷青電撃3-4本
  raiteiBlinkArrive(pos: THREE.Vector3): void {
    this._spawnLightningColumn(pos, 5, 0.16, false);
    this.impactRing(pos, 0x44aaff);
    const count = 3 + Math.floor(Math.random() * 2);
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + Math.random() * 0.5;
      const len = 4 + Math.random() * 1.5;
      const to = new THREE.Vector3(
        pos.x + Math.cos(a) * len, pos.y - 0.04, pos.z + Math.sin(a) * len,
      );
      this.buildBranchBolt(pos, to, 2, false, 0.20 + Math.random() * 0.1);
    }
  }

  // 黒雷帝ブリンク残光ライン: 消失点から出現点への細い加算ライン(0.1s)
  kokuraiBlinkResidual(from: THREE.Vector3, to: THREE.Vector3): void {
    const geo = new THREE.BufferGeometry().setFromPoints([from, to]);
    const mat = new THREE.LineBasicMaterial({
      color: 0x8822ff,
      transparent: true,
      opacity: 0.45,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const line = new THREE.Line(geo, mat);
    line.userData.baseOpacity = 0.45;
    const group = new THREE.Group();
    group.add(line);
    this.scene.add(group);
    this.pushGokuraiColumn({ obj: group, life: 0.10, maxLife: 0.10 });
  }

  // 黒雷帝の遠方落雷公開ラッパー(match.ts から呼べるよう private _spawnLightningColumn を公開)
  spawnKokuraiDistantColumn(pos: THREE.Vector3, height: number, life: number): void {
    this._spawnLightningColumn(pos, height, life, true);
  }

  // 黒雷帝キル演出: 対象位置に黒い雷柱1本+小フラッシュ(_spawnLightningColumnの黒雷公開版)
  kokuraiteiKillColumn(pos: THREE.Vector3): void {
    this._spawnLightningColumn(pos, 14, 0.2, true);
    const flash = new THREE.Mesh(
      this.blastGeometry,
      new THREE.MeshBasicMaterial({
        color: 0xbb88ff,
        transparent: true,
        opacity: 0.55,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    flash.position.copy(pos);
    flash.scale.setScalar(0.6);
    flash.userData.targetScale = 2.2;
    this.scene.add(flash);
    this.blasts.push({ obj: flash, life: 0.22, maxLife: 0.22 });
  }

  // 黒雷帝降臨フラッシュ: 自身を中心に紫電リング+周囲へ黒雷ボルト3本(タイムスロー代替の見得)
  kokuraiteiActivateFlash(center: THREE.Vector3, reduceMotion = false): void {
    this.shockwaveRing(center, 9, 0x8844ff);
    const bolts = reduceMotion ? 1 : 3;
    for (let i = 0; i < bolts; i += 1) {
      const a = (i / bolts) * Math.PI * 2 + Math.random() * 0.8;
      const ground = new THREE.Vector3(
        center.x + Math.cos(a) * (2.5 + Math.random() * 2),
        center.y,
        center.z + Math.sin(a) * (2.5 + Math.random() * 2),
      );
      this._spawnLightningColumn(ground, 12, 0.22, true);
    }
  }

  // F ult 地割れ亀裂発光: 放射クラックの明滅 + 塵の巻き上げ
  fissureGlow(center: THREE.Vector3, radius: number): void {
    const ground = new THREE.Vector3(center.x, center.y - 0.02, center.z);
    const n = 8;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + Math.random() * 0.22;
      const len = radius * (0.3 + Math.random() * 0.55);
      const crackDir = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
      const streak = new THREE.Mesh(this.streakGeometry, new THREE.MeshBasicMaterial({
        color: 0xff7722, transparent: true, opacity: 0.82,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }));
      streak.scale.z = len;
      streak.scale.x = 0.11 + Math.random() * 0.05;
      streak.position.copy(ground).addScaledVector(crackDir, len * 0.5);
      streak.rotation.y = a;
      streak.userData.fissure = true;
      streak.userData.baseOpacity = 0.82;
      const sg = new THREE.Group();
      sg.add(streak);
      this.scene.add(sg);
      this.streaks.push({ obj: sg, life: 0.7 + Math.random() * 0.3, maxLife: 1.0 });
    }
    for (let d = 0; d < 6; d++) {
      const a = Math.random() * Math.PI * 2;
      const r = radius * Math.random() * 0.45;
      const puff = new THREE.Mesh(this.puffGeometry, new THREE.MeshBasicMaterial({
        color: 0xb07040, transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }));
      puff.position.set(center.x + Math.cos(a) * r, center.y, center.z + Math.sin(a) * r);
      puff.scale.setScalar(0.5 + Math.random() * 0.5);
      puff.userData.velY = 2.5 + Math.random() * 2;
      puff.userData.baseOpacity = 0.48;
      puff.userData.targetScale = 2.5;
      this.scene.add(puff);
      this.blasts.push({ obj: puff, life: 0.8 + Math.random() * 0.35, maxLife: 1.2 });
    }
  }

  // B ult モーションブレード残像: 進行後方に半透明ブレード幻影を3枚重ねる
  shurikenMotionBlade(pos: THREE.Vector3, dir: THREE.Vector3, color: number): void {
    const group = new THREE.Group();
    for (let i = 0; i < 3; i++) {
      const offset = dir.clone().multiplyScalar(-(i + 1) * 0.35);
      const geo = new THREE.BoxGeometry(0.12, 1.6, 0.02);
      const op = 0.44 - i * 0.12;
      const mat = new THREE.MeshBasicMaterial({
        color, transparent: true, opacity: op,
        blending: THREE.AdditiveBlending, depthWrite: false,
      });
      const blade = new THREE.Mesh(geo, mat);
      blade.position.copy(pos).add(offset);
      blade.rotation.z = (i / 3) * Math.PI;
      blade.userData.baseOpacity = op;
      group.add(blade);
    }
    this.scene.add(group);
    this.shurikenTrails.push({ obj: group, life: 0.16, maxLife: 0.16 });
  }

  // M ult 暗黒逆流: 周囲から中心へ吸い込まれる暗色粒子 + 地面の黒い脈動紋様
  schwarzwaldAbsorb(center: THREE.Vector3, reduceMotion = false): void {
    const n = reduceMotion ? 5 : 14;
    const group = new THREE.Group();
    group.position.copy(center);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + Math.random() * 0.4;
      const r = 6 + Math.random() * 8;
      const puff = new THREE.Mesh(this.puffGeometry, new THREE.MeshBasicMaterial({
        color: 0x220033, transparent: true, opacity: 0,
        depthWrite: false,
      }));
      puff.position.set(Math.cos(a) * r, Math.random() * 1.5, Math.sin(a) * r);
      puff.scale.setScalar(0.5 + Math.random() * 0.9);
      puff.userData.vel = new THREE.Vector3(-Math.cos(a), 0, -Math.sin(a)).multiplyScalar(12 + Math.random() * 8);
      puff.userData.baseOpacity = 0.50 + Math.random() * 0.28;
      group.add(puff);
    }
    this.scene.add(group);
    this.schwarzAbsorbs.push({ obj: group, life: 0.65, maxLife: 0.65 });
    // 地面の黒い脈動リング2枚
    for (let j = 0; j < 2; j++) {
      const rr = 3 + j * 4;
      const geo = new THREE.RingGeometry(rr * 0.88, rr, 48);
      const mat = new THREE.MeshBasicMaterial({
        color: 0x000005, transparent: true, opacity: reduceMotion ? 0.38 : 0.68,
        blending: THREE.NormalBlending, depthWrite: false, side: THREE.DoubleSide,
      });
      const ring = new THREE.Mesh(geo, mat);
      ring.rotation.x = -Math.PI / 2;
      ring.position.copy(center);
      ring.position.y -= 0.02;
      ring.userData.baseOpacity = mat.opacity;
      ring.userData.targetScale = 1;
      this.scene.add(ring);
      this.darkNovas.push({ obj: ring, life: 1.2, maxLife: 1.2 });
    }
  }

  // 真月 空間切れ残留線: 横断する細い黒刃線 + 赤エッジが 0.8s 残留する
  shingetsuSpatialCut(center: THREE.Vector3, radius: number): void {
    const group = new THREE.Group();
    group.position.copy(center);
    const cutGeo = new THREE.BoxGeometry(radius * 2.5, 0.014, 0.035);
    const cutMat = new THREE.MeshBasicMaterial({
      color: 0x0a0010, transparent: true, opacity: 0.88,
      blending: THREE.NormalBlending, depthWrite: false,
    });
    const cut = new THREE.Mesh(cutGeo, cutMat);
    cut.position.y = 0.1;
    cut.userData.baseOpacity = 0.88;
    group.add(cut);
    const edgeGeo = new THREE.BoxGeometry(radius * 2.5, 0.007, 0.007);
    const edgeMat = new THREE.MeshBasicMaterial({
      color: 0xff0022, transparent: true, opacity: 0.82,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const edge = new THREE.Mesh(edgeGeo, edgeMat);
    edge.position.y = 0.1;
    edge.userData.baseOpacity = 0.82;
    group.add(edge);
    this.scene.add(group);
    this.shingetsuCuts.push({ obj: group, life: 0.8, maxLife: 0.8 });
  }

  // オーバードライブ発動 金色オーラバースト
  overdriveActivateAura(pos: THREE.Vector3): void {
    const geo = new THREE.RingGeometry(0.82, 1.0, 44);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffd700, transparent: true, opacity: 0.82,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    });
    const ring = new THREE.Mesh(geo, mat);
    ring.rotation.x = -Math.PI / 2;
    ring.scale.setScalar(0.2);
    ring.userData.targetScale = 5.5;
    ring.userData.baseOpacity = 0.82;
    ring.position.copy(pos);
    this.scene.add(ring);
    this.overdriveAuras.push({ obj: ring, life: 0.4, maxLife: 0.4 });
    const flash = new THREE.Mesh(this.blastGeometry, new THREE.MeshBasicMaterial({
      color: 0xffc830, transparent: true, opacity: 0.52,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    flash.position.copy(pos);
    flash.scale.setScalar(0.3);
    flash.userData.targetScale = 2.8;
    this.scene.add(flash);
    this.blasts.push({ obj: flash, life: 0.25, maxLife: 0.25 });
  }

  // V33: 分岐雷の総数上限。最悪時(極雷+月花+トレイル+多段落雷の重なり)のDC/GC暴走を防ぐ。
  private pushGokuraiColumn(entry: { obj: THREE.Group; life: number; maxLife: number }): void {
    if (this.gokuraiColumns.length >= 96) {
      const oldest = this.gokuraiColumns.shift();
      if (oldest) this.disposeObject(oldest.obj);
    }
    this.gokuraiColumns.push(entry);
  }

  private _spawnLightningColumn(pos: THREE.Vector3, height: number, life: number, isKokurai = false): void {
    const top = new THREE.Vector3(pos.x, pos.y + height, pos.z);
    this.buildBranchBolt(top, pos, 3, isKokurai, life);

    if (Math.random() > 0.5) {
      const off = new THREE.Vector3((Math.random() - 0.5) * 1.2, 0, (Math.random() - 0.5) * 1.2);
      this.buildBranchBolt(
        top.clone().add(off),
        pos.clone().add(new THREE.Vector3(off.x * 0.3, 0, off.z * 0.3)),
        2, isKokurai, life * 0.7,
      );
    }

    this.impactRing(pos, isKokurai ? 0x5500aa : 0x44aaff);

    const flashMat = new THREE.MeshBasicMaterial({
      color: isKokurai ? 0x8800ff : 0xaaddff,
      transparent: true, opacity: 0.55,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const flash = new THREE.Mesh(this.blastGeometry, flashMat);
    flash.position.copy(pos);
    flash.scale.setScalar(0.25 + Math.random() * 0.15);
    this.scene.add(flash);
    this.blasts.push({ obj: flash, life: 0.12, maxLife: 0.12 });

    const sparkGroup = new THREE.Group();
    const sparkCount = 4 + Math.floor(Math.random() * 4);
    for (let s = 0; s < sparkCount; s++) {
      const sm = new THREE.Mesh(this.sparkGeometry, new THREE.MeshBasicMaterial({
        color: isKokurai ? 0xaa00ff : 0x88ccff,
        transparent: true, opacity: 0.8,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }));
      sm.position.copy(pos).add(new THREE.Vector3(
        (Math.random() - 0.5) * 0.4,
        Math.random() * 0.3,
        (Math.random() - 0.5) * 0.4,
      ));
      sm.userData.vel = new THREE.Vector3(
        (Math.random() - 0.5) * 3,
        1 + Math.random() * 2,
        (Math.random() - 0.5) * 3,
      );
      sparkGroup.add(sm);
    }
    this.scene.add(sparkGroup);
    this.sparks.push({ obj: sparkGroup, life: 0.4 + Math.random() * 0.2, maxLife: 0.6 });
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
      const slashGeo = new THREE.BoxGeometry(maxRadius * 2.8, 0.09, 0.35);
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
      const velY = blast.userData.velY as number | undefined;
      if (velY !== undefined) {
        // 上昇煙: 位置を上昇させ、フェードイン→フェードアウトで煙の自然な立ち上りを表現
        blast.position.y += velY * dt;
        const baseOp = (blast.userData.baseOpacity as number) ?? 0.5;
        const age = 1 - ratio;
        const fadeIn = Math.min(1, age * 8); // 寿命の12.5%でフルオパシティ
        (blast.material as THREE.MeshBasicMaterial).opacity = baseOp * fadeIn * ratio;
      } else {
        (blast.material as THREE.MeshBasicMaterial).opacity = 0.95 * ratio;
      }
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
        if (mesh.userData.fissure === true) {
          // fissure: 既存スケール/位置を維持しオパシティだけ明滅させる
          const t = performance.now() / 1000;
          const flicker = 0.5 + Math.sin(t * 22 + mesh.position.x) * 0.5;
          (mesh.material as THREE.MeshBasicMaterial).opacity =
            ((mesh.userData.baseOpacity as number) ?? 0.82) * ratio * Math.max(0.15, flicker);
          continue;
        }
        const len = (mesh.userData.len as number) * grow;
        const dir = mesh.userData.dir as THREE.Vector2;
        mesh.scale.z = Math.max(0.01, len);
        mesh.position.set(dir.x * len * 0.5, 0, dir.y * len * 0.5);
        (mesh.material as THREE.MeshBasicMaterial).opacity = 0.95 * ratio;
      }
    });
    this.debris = this.tick(this.debris, dt, (group, ratio) => {
      for (const child of group.children) {
        const frag = child as THREE.Mesh;
        const vel = frag.userData.vel as THREE.Vector3;
        vel.y -= 14 * dt; // 重力
        frag.position.addScaledVector(vel, dt);
        (frag.material as THREE.MeshBasicMaterial).opacity = 0.95 * ratio;
      }
    });
    this.geppaRings = this.tick(this.geppaRings, dt, (group, ratio) => {
      const grow = 1 - ratio * ratio;
      for (const child of group.children) {
        const mesh = child as THREE.Mesh;
        const target = (mesh.userData.targetScale as number) ?? 1;
        mesh.scale.setScalar(Math.max(mesh.scale.x, target * grow));
        if (mesh.userData.isInversion === true) {
          // 最後 12.5% の寿命のみ出現するフラッシュ(黒白反転一閃)
          const showRatio = ratio < 0.125 ? (0.125 - ratio) / 0.125 : 0;
          (mesh.material as THREE.MeshBasicMaterial).opacity =
            ((mesh.userData.baseOpacity as number) ?? 0.55) * showRatio;
        } else {
          (mesh.material as THREE.MeshBasicMaterial).opacity =
            ((mesh.userData.baseOpacity as number) ?? 0.75) * ratio;
        }
      }
    });
    this.gokuraiColumns = this.tick(this.gokuraiColumns, dt, (group, ratio) => {
      const t = performance.now() / 1000;
      const flicker = 0.75 + Math.sin(t * 28 + group.position.x + group.position.z) * 0.25;
      for (const child of group.children) {
        const mesh = child as THREE.Mesh;
        (mesh.material as THREE.MeshBasicMaterial).opacity =
          ((mesh.userData.baseOpacity as number) ?? 0.7) * ratio * flicker;
      }
    });
    // 黒雷帝移動トレイル(焦げ小リング): 拡大しながらフェードアウト
    this.kokuraiTrails = this.tick(this.kokuraiTrails, dt, (group, ratio) => {
      for (const child of group.children) {
        const mesh = child as THREE.Mesh;
        const target = (mesh.userData.targetScale as number) ?? 1.2;
        mesh.scale.setScalar(Math.max(mesh.scale.x, target * (1 - ratio * ratio)));
        (mesh.material as THREE.MeshBasicMaterial).opacity =
          ((mesh.userData.baseOpacity as number) ?? 0.7) * ratio;
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
    this.shurikenTrails = this.tick(this.shurikenTrails, dt, (group, ratio) => {
      for (const child of group.children) {
        const mesh = child as THREE.Mesh;
        (mesh.material as THREE.MeshBasicMaterial).opacity =
          ((mesh.userData.baseOpacity as number) ?? 0.44) * ratio;
      }
    });
    this.schwarzAbsorbs = this.tick(this.schwarzAbsorbs, dt, (group, ratio) => {
      const age = 1 - ratio;
      const fadeIn = Math.min(1, age * 5);
      for (const child of group.children) {
        const puff = child as THREE.Mesh;
        const vel = puff.userData.vel as THREE.Vector3;
        puff.position.addScaledVector(vel, dt);
        (puff.material as THREE.MeshBasicMaterial).opacity =
          ((puff.userData.baseOpacity as number) ?? 0.5) * fadeIn * ratio;
      }
    });
    this.shingetsuCuts = this.tick(this.shingetsuCuts, dt, (group, ratio) => {
      for (const child of group.children) {
        const mesh = child as THREE.Mesh;
        (mesh.material as THREE.MeshBasicMaterial).opacity =
          ((mesh.userData.baseOpacity as number) ?? 0.88) * ratio;
      }
    });
    this.overdriveAuras = this.tick(this.overdriveAuras, dt, (ring, ratio) => {
      const target = (ring.userData.targetScale as number) ?? 5.5;
      ring.scale.setScalar(Math.max(ring.scale.x, target * (1 - ratio * ratio)));
      (ring.material as THREE.MeshBasicMaterial).opacity =
        ((ring.userData.baseOpacity as number) ?? 0.82) * ratio;
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
    for (const list of [
      this.clouds, this.flames, this.sparks, this.streaks, this.debris,
      this.geppaRings, this.gokuraiColumns, this.kokuraiTrails,
      this.shurikenTrails, this.schwarzAbsorbs, this.shingetsuCuts,
    ]) {
      for (const item of list) this.disposeObject(item.obj);
      list.length = 0;
    }
    for (const item of this.overdriveAuras) this.disposeObject(item.obj);
    this.overdriveAuras.length = 0;
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
    this.debrisFragGeo.dispose();
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
          node.geometry !== this.streakGeometry &&
          node.geometry !== this.debrisFragGeo
        ) {
          node.geometry.dispose();
        }
        (node.material as THREE.Material).dispose();
      }
    });
  }
}
