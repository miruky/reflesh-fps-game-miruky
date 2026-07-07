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
  // ── R33 特殊武器エフェクト ──
  private bowArrowFX: Timed<THREE.Group>[] = [];   // 月光弓 矢跡/命中
  private staffBoltFX: Timed<THREE.Group>[] = [];  // 天雷杖 雷球/AoE
  private beamLines: Timed<THREE.Line>[] = [];      // 蜃気楼ビーム
  private shurikenFX: Timed<THREE.Group>[] = [];   // 手裏剣 disc/衝撃
  private fanWindFX: Timed<THREE.Group>[] = [];     // 風神扇 扇形風
  // ── R34 特殊武器溜め/ウルトエフェクト ──
  private banjinBladesFX: Timed<THREE.Group>[] = [];    // 千刃嵐 銀十字ブレードストリーム
  private gekkouArrowFX: Timed<THREE.Group>[] = [];     // 満月の矢 大矢+月光柱+ノヴァ
  private fujinWallFX: Timed<THREE.Group>[] = [];       // 大颶風 風の壁
  private gouenBlastFX: Timed<THREE.Group>[] = [];      // 大業火弾 火柱+爆発+煙
  private tenraiBoltFX: Timed<THREE.Group>[] = [];      // 天罰 落雷スケジューラ
  private shinkirouSweepFX: Timed<THREE.Group>[] = [];  // 千里眼閃 掃引ビーム+残像
  private shuraRampageFX: Timed<THREE.Group>[] = [];    // 阿修羅連撃 弾嵐オーラ
  private banjinCloneFX: Timed<THREE.Group>[] = [];     // 影分身万刃繚乱 クローン+手裏剣嵐
  private gekkouMoonFX: Timed<THREE.Group>[] = [];      // 月落とし 月球+ノヴァ+柱
  private fujinVortexFX: Timed<THREE.Group>[] = [];     // 神風竜巻
  private gouenCorridorFX: Timed<THREE.Group>[] = [];   // 業火滅世 火柱回廊+地割れ
  private shinkirouMirageFX: Timed<THREE.Group>[] = []; // 虚像世界 歪曲リング+熱揺らぎ
  private shuraKourinFX: Timed<THREE.Group>[] = [];     // 阿修羅降臨 3頭6腕
  // ── R35 エフェクト追加プール ──
  private kokuteiMantleFX: Timed<THREE.Group>[] = [];  // BE-1 黒帝羽根煙マントル
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

    // ── KE-5 追加演出 ──

    // 垂直世界亀裂10本(0.05×28m、0xaa00ff、streaksフリッカー)
    const vertCrackCount = reduceMotion ? 0 : 10;
    for (let i = 0; i < vertCrackCount; i++) {
      const a = (i / vertCrackCount) * Math.PI * 2 + Math.random() * 0.3;
      const d = maxR * (0.1 + Math.random() * 0.7);
      const crackGeo = new THREE.BoxGeometry(0.05, 28, 0.05);
      const crackMat = new THREE.MeshBasicMaterial({
        color: 0xaa00ff, transparent: true, opacity: 0.72,
        blending: THREE.AdditiveBlending, depthWrite: false,
      });
      const crack = new THREE.Mesh(crackGeo, crackMat);
      crack.position.set(
        center.x + Math.cos(a) * d,
        center.y + 14,
        center.z + Math.sin(a) * d,
      );
      crack.userData.fissure = true;
      crack.userData.baseOpacity = 0.72;
      const sg = new THREE.Group();
      sg.add(crack);
      this.scene.add(sg);
      this.streaks.push({ obj: sg, life: 3.0 + Math.random() * 0.5, maxLife: 3.5 });
    }

    // 反転フラッシュ3段スケジューラ(t=1.2/1.6/2.2s、tenraiBoltFX相乗り)
    if (!reduceMotion) {
      const flashSched = new THREE.Group();
      flashSched.position.copy(center);
      flashSched.userData.age = 0;
      flashSched.userData.maxR = maxR;
      flashSched.userData.stageTimers = [1.2, 1.6, 2.2];
      flashSched.userData.stagesFired = [false, false, false];
      flashSched.userData.isFlashScheduler = true;
      this.scene.add(flashSched);
      this.tenraiBoltFX.push({ obj: flashSched, life: 3.5, maxLife: 3.5 });
    }

    // 空間裂目ライン3本(420m長、0x9900ff、tracers)
    if (!reduceMotion) {
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2 + Math.random() * 0.4;
        const half = 210;
        const riftGeo = new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(center.x - Math.cos(a) * half, center.y + 4 + i * 2.5, center.z - Math.sin(a) * half),
          new THREE.Vector3(center.x + Math.cos(a) * half, center.y + 4 + i * 2.5, center.z + Math.sin(a) * half),
        ]);
        const riftMat = new THREE.LineBasicMaterial({
          color: 0x9900ff, transparent: true, opacity: 0.62,
          blending: THREE.AdditiveBlending, depthWrite: false,
        });
        const rift = new THREE.Line(riftGeo, riftMat);
        rift.userData.baseOpacity = 0.62;
        this.scene.add(rift);
        this.tracers.push({ obj: rift, life: 3.5, maxLife: 3.5 });
      }
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

  // ── R33 特殊武器エフェクト メソッド ─────────────────────────────────────────

  /** 月光弓 発射時の白光軌跡フラッシュ (charge01: 0-1) */
  bowArrowFire(origin: THREE.Vector3, _dir: THREE.Vector3, charge01: number): void {
    const group = new THREE.Group();
    // 発射フラッシュ球
    const flashMat = new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0.7 + 0.25 * charge01,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const flash = new THREE.Mesh(this.flareGeometry, flashMat);
    flash.scale.setScalar(0.4 + 0.3 * charge01);
    flash.userData.baseOpacity = 0.7 + 0.25 * charge01;
    group.add(flash);
    group.position.copy(origin);
    this.scene.add(group);
    this.bowArrowFX.push({ obj: group, life: 0.12, maxLife: 0.12 });
  }

  /** 月光弓 命中時の白十字バースト */
  bowImpact(point: THREE.Vector3): void {
    const group = new THREE.Group();
    // リング
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xeef8ff, transparent: true, opacity: 0.75,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    });
    const ring = new THREE.Mesh(this.ringGeometry, ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.userData.baseOpacity = 0.75;
    group.add(ring);
    // 縦横スジ
    const hGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-0.55, 0, 0), new THREE.Vector3(0.55, 0, 0),
    ]);
    const vGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, -0.55, 0), new THREE.Vector3(0, 0.55, 0),
    ]);
    const crossMat = new THREE.LineBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0.9,
      blending: THREE.AdditiveBlending,
    });
    group.add(new THREE.Line(hGeo, crossMat));
    group.add(new THREE.Line(vGeo, crossMat.clone()));
    group.position.copy(point);
    this.scene.add(group);
    this.bowArrowFX.push({ obj: group, life: 0.22, maxLife: 0.22 });
  }

  /** 風神扇 扇形風エフェクト (adsProgress 0-1) */
  fanWind(origin: THREE.Vector3, dir: THREE.Vector3, _adsProgress: number): void {
    const group = new THREE.Group();
    const SPAN = 24 * (Math.PI / 180);
    const steps = 9;
    const right = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 1, 0)).normalize();
    for (let i = 0; i < steps; i += 1) {
      const t = i / (steps - 1);
      const yaw = -SPAN + t * SPAN * 2;
      const slitDir = dir.clone().addScaledVector(right, Math.tan(yaw)).normalize();
      const pts = [origin.clone(), origin.clone().addScaledVector(slitDir, 4.5)];
      const geo = new THREE.BufferGeometry().setFromPoints(pts);
      const mat = new THREE.LineBasicMaterial({
        color: 0xaaffcc, transparent: true, opacity: 0.55,
        blending: THREE.AdditiveBlending,
      });
      const line = new THREE.Line(geo, mat);
      line.userData.baseOpacity = 0.55;
      group.add(line);
    }
    group.position.set(0, 0, 0);
    this.scene.add(group);
    this.fanWindFX.push({ obj: group, life: 0.08, maxLife: 0.08 });
  }

  /** 天雷杖 AoE 爆発エフェクト */
  staffAoe(point: THREE.Vector3, radius: number): void {
    const group = new THREE.Group();
    // リング
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xaabbff, transparent: true, opacity: 0.72,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    });
    const ring = new THREE.Mesh(this.ringGeometry, ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.scale.setScalar(radius * 0.15);
    ring.userData.targetScale = radius;
    ring.userData.baseOpacity = 0.72;
    group.add(ring);
    // 爆発球
    const blastMat = new THREE.MeshBasicMaterial({
      color: 0x6688ff, transparent: true, opacity: 0.55,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const blast = new THREE.Mesh(this.blastGeometry, blastMat);
    blast.scale.setScalar(radius * 0.5);
    blast.userData.baseOpacity = 0.55;
    group.add(blast);
    // 分岐雷 3 本
    for (let b = 0; b < 3; b += 1) {
      const angle = (b / 3) * Math.PI * 2 + Math.random() * 1.0;
      const endX = Math.cos(angle) * radius * 0.7;
      const endZ = Math.sin(angle) * radius * 0.7;
      const pts = [new THREE.Vector3(0, 0.2, 0), new THREE.Vector3(endX * 0.5, 0.8, endZ * 0.5), new THREE.Vector3(endX, 0, endZ)];
      const geo = new THREE.BufferGeometry().setFromPoints(pts);
      const mat = new THREE.LineBasicMaterial({ color: 0xccddff, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending });
      const line = new THREE.Line(geo, mat);
      line.userData.baseOpacity = 0.8;
      group.add(line);
    }
    group.position.copy(point);
    this.scene.add(group);
    this.staffBoltFX.push({ obj: group, life: 0.45, maxLife: 0.45 });
  }

  /** 天雷杖 スタン中スパーク */
  staffStunSpark(point: THREE.Vector3): void {
    const geo = new THREE.BufferGeometry().setFromPoints([
      point.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.4, Math.random() * 0.4, (Math.random() - 0.5) * 0.4)),
      point.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.6, Math.random() * 0.8, (Math.random() - 0.5) * 0.6)),
    ]);
    const mat = new THREE.LineBasicMaterial({ color: 0x88aaff, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending });
    const line = new THREE.Line(geo, mat);
    line.userData.baseOpacity = 0.7;
    this.scene.add(line);
    this.tracers.push({ obj: line, life: 0.1, maxLife: 0.1 });
  }

  /** 蜃気楼 シアンビームライン */
  beamLine(from: THREE.Vector3, to: THREE.Vector3): void {
    const geo = new THREE.BufferGeometry().setFromPoints([from, to]);
    const mat = new THREE.LineBasicMaterial({
      color: 0x00ffee, transparent: true, opacity: 0.85,
      blending: THREE.AdditiveBlending,
    });
    const line = new THREE.Line(geo, mat);
    line.userData.baseOpacity = 0.85;
    this.scene.add(line);
    this.beamLines.push({ obj: line, life: 0.08, maxLife: 0.08 });
  }

  /** 万刃 手裏剣ディスク飛行グループを作成し scene に追加して返す */
  shurikenDiscFly(origin: THREE.Vector3, dir: THREE.Vector3): THREE.Group {
    const group = new THREE.Group();
    // 4枚羽ディスク
    const pts: THREE.Vector3[] = [];
    for (let a = 0; a < 5; a += 1) {
      const rad = (a / 4) * Math.PI * 2;
      pts.push(new THREE.Vector3(Math.cos(rad) * 0.12, Math.sin(rad) * 0.12, 0));
    }
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    const mat = new THREE.LineBasicMaterial({ color: 0xddeeff, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending });
    const disc = new THREE.Line(geo, mat);
    disc.userData.baseOpacity = 0.8;
    group.add(disc);
    // 十字スジ
    for (let a = 0; a < 4; a += 1) {
      const rad = (a / 4) * Math.PI * 2;
      const lineGeo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, 0, 0), new THREE.Vector3(Math.cos(rad) * 0.15, Math.sin(rad) * 0.15, 0),
      ]);
      const lineMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending });
      const spoke = new THREE.Line(lineGeo, lineMat);
      spoke.userData.baseOpacity = 0.6;
      group.add(spoke);
    }
    group.position.copy(origin);
    if (dir.length() > 0.001) {
      group.lookAt(origin.clone().add(dir));
    }
    this.scene.add(group);
    // F3: match側が0.5s寿命を所有するため二重登録しない
    return group;
  }

  // ─── R34 特殊武器溜め攻撃エフェクト ───────────────────────────────────────

  /** 千刃嵐: 溜め放出 — 銀十字ブレード30枚が扇状ストリーム(0.8s)。EX-2: 残像尾2本+終幕shurikenBlade×6 */
  banjinStorm(origin: THREE.Vector3, dir: THREE.Vector3): void {
    const group = new THREE.Group();
    const COUNT = 30;
    const FAN = Math.PI * 0.65;
    const D = dir.clone().normalize();
    const right = new THREE.Vector3().crossVectors(D, new THREE.Vector3(0, 1, 0)).normalize();
    for (let i = 0; i < COUNT; i++) {
      const t = i / (COUNT - 1);
      const yaw = (-FAN / 2) + t * FAN;
      const dist = 1 + (i / COUNT) * 12 + Math.random() * 3;
      const bladeDir = D.clone().addScaledVector(right, Math.tan(yaw)).normalize();
      const pos = origin.clone().addScaledVector(bladeDir, dist);
      const hLen = 0.16 + Math.random() * 0.10;
      const hGeo = new THREE.BufferGeometry().setFromPoints([
        pos.clone().addScaledVector(right, -hLen),
        pos.clone().addScaledVector(right, hLen),
      ]);
      const hLine = new THREE.Line(hGeo, new THREE.LineBasicMaterial({
        color: 0xddeeff, transparent: true, opacity: 0.82,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }));
      hLine.userData.baseOpacity = 0.82;
      group.add(hLine);
      const vGeo = new THREE.BufferGeometry().setFromPoints([
        pos.clone().add(new THREE.Vector3(0, -hLen, 0)),
        pos.clone().add(new THREE.Vector3(0, hLen, 0)),
      ]);
      const vLine = new THREE.Line(vGeo, new THREE.LineBasicMaterial({
        color: 0xffffff, transparent: true, opacity: 0.72,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }));
      vLine.userData.baseOpacity = 0.72;
      group.add(vLine);
      // EX-2: 残像尾2本(グループ内子、プール非消費)
      for (let trail = 1; trail <= 2; trail++) {
        const trailPos = pos.clone().addScaledVector(bladeDir, -trail * 0.28);
        const tOp = 0.35 - trail * 0.12;
        const tGeo = new THREE.BufferGeometry().setFromPoints([
          trailPos.clone().addScaledVector(right, -hLen * 0.75),
          trailPos.clone().addScaledVector(right, hLen * 0.75),
        ]);
        const tLine = new THREE.Line(tGeo, new THREE.LineBasicMaterial({
          color: 0x8899cc, transparent: true, opacity: tOp,
          blending: THREE.AdditiveBlending, depthWrite: false,
        }));
        tLine.userData.baseOpacity = tOp;
        tLine.userData.isTrail = true;
        group.add(tLine);
      }
    }
    // EX-2: 終幕バースト用データ
    group.userData.origin = origin.clone();
    group.userData.dir = D.clone();
    group.userData.burstFired = false;
    this.scene.add(group);
    this.banjinBladesFX.push({ obj: group, life: 0.8, maxLife: 0.8 });
  }

  /** 満月の矢: 巨大白矢 + 月光柱トレイル + 月ノヴァ(2.0s) */
  gekkouFullMoon(origin: THREE.Vector3, dir: THREE.Vector3): void {
    const group = new THREE.Group();
    const D = dir.clone().normalize();
    const REACH = 40;
    const right = new THREE.Vector3().crossVectors(D, new THREE.Vector3(0, 1, 0)).normalize();
    const impact = origin.clone().addScaledVector(D, REACH);
    const shaftGeo = new THREE.BufferGeometry().setFromPoints([origin, impact]);
    const shaft = new THREE.Line(shaftGeo, new THREE.LineBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0.88,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    shaft.userData.baseOpacity = 0.88;
    group.add(shaft);
    const tail = origin.clone().addScaledVector(D, -1.2);
    for (const side of [right.clone(), right.clone().negate()]) {
      const finGeo = new THREE.BufferGeometry().setFromPoints([
        tail.clone().addScaledVector(side, 0.7),
        origin.clone(),
        tail.clone().addScaledVector(side, -0.4),
      ]);
      const fin = new THREE.Line(finGeo, new THREE.LineBasicMaterial({
        color: 0xaaccff, transparent: true, opacity: 0.62,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }));
      fin.userData.baseOpacity = 0.62;
      group.add(fin);
    }
    for (let i = 0; i < 3; i++) {
      const pp = origin.clone().addScaledVector(D, REACH * (0.25 + i * 0.25));
      const pGeo = new THREE.BufferGeometry().setFromPoints([
        pp.clone().add(new THREE.Vector3(0, -4, 0)),
        pp.clone().add(new THREE.Vector3(0, 4, 0)),
      ]);
      const pl = new THREE.Line(pGeo, new THREE.LineBasicMaterial({
        color: 0x88aaee, transparent: true, opacity: 0.36,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }));
      pl.userData.baseOpacity = 0.36;
      group.add(pl);
    }
    const novaRing = new THREE.Mesh(this.ringGeometry, new THREE.MeshBasicMaterial({
      color: 0xddeeff, transparent: true, opacity: 0.72,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    }));
    novaRing.position.copy(impact);
    novaRing.rotation.x = -Math.PI / 2;
    novaRing.scale.setScalar(1.2);
    novaRing.userData.targetScale = 14;
    novaRing.userData.baseOpacity = 0.72;
    group.add(novaRing);
    const novaBall = new THREE.Mesh(this.blastGeometry, new THREE.MeshBasicMaterial({
      color: 0xeeeeff, transparent: true, opacity: 0.50,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    novaBall.position.copy(impact);
    novaBall.scale.setScalar(3.0);
    novaBall.userData.baseOpacity = 0.50;
    novaBall.userData.targetScale = 10;
    group.add(novaBall);
    this.scene.add(group);
    this.gekkouArrowFX.push({ obj: group, life: 2.0, maxLife: 2.0 });
  }

  /** 大颶風: 20m幅の風の壁が前進(シアン渦+砂塵)(1.5s) */
  fujinTyphoon(origin: THREE.Vector3, dir: THREE.Vector3): void {
    const group = new THREE.Group();
    const D = dir.clone().normalize();
    const right = new THREE.Vector3().crossVectors(D, new THREE.Vector3(0, 1, 0)).normalize();
    for (let c = 0; c <= 8; c++) {
      const x = -10 + (c / 8) * 20;
      const pts = [
        origin.clone().addScaledVector(right, x),
        origin.clone().addScaledVector(right, x).add(new THREE.Vector3(0, 4, 0)),
      ];
      const wl = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(pts),
        new THREE.LineBasicMaterial({ color: 0x44ffdd, transparent: true, opacity: 0.32, blending: THREE.AdditiveBlending, depthWrite: false }),
      );
      wl.userData.baseOpacity = 0.32;
      group.add(wl);
    }
    for (let r = 0; r < 5; r++) {
      const yOff = 0.4 + r * 0.7;
      const cx = (Math.random() - 0.5) * 8;
      const rpts: THREE.Vector3[] = [];
      for (let a = 0; a <= 22; a++) {
        const ang = (a / 22) * Math.PI * 2;
        rpts.push(origin.clone()
          .addScaledVector(right, cx + Math.cos(ang) * (1.2 + Math.random() * 0.5))
          .add(new THREE.Vector3(0, yOff + Math.sin(ang) * 0.6, 0)));
      }
      const rl = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(rpts),
        new THREE.LineBasicMaterial({ color: 0x66ffee, transparent: true, opacity: 0.36, blending: THREE.AdditiveBlending, depthWrite: false }),
      );
      rl.userData.baseOpacity = 0.36;
      group.add(rl);
    }
    for (let p = 0; p < 18; p++) {
      const puff = new THREE.Mesh(this.puffGeometry, new THREE.MeshBasicMaterial({
        color: 0x88ffdd, transparent: true, opacity: 0.24,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }));
      puff.position.copy(origin)
        .addScaledVector(right, (Math.random() - 0.5) * 16)
        .add(new THREE.Vector3(0, Math.random() * 3.5, 0));
      puff.userData.baseOpacity = 0.24;
      puff.userData.vel = D.clone().multiplyScalar(6 + Math.random() * 6);
      group.add(puff);
    }
    group.userData.windDir = D.clone();
    this.scene.add(group);
    this.fujinWallFX.push({ obj: group, life: 1.5, maxLife: 1.5 });
  }

  /** 大業火弾: 25m火球 + 4火柱 + 白煙 + 焦げ地(3.5s、reduceMotion=柱ゼロ) */
  gouenBlast(center: THREE.Vector3, reduceMotion = false): void {
    const group = new THREE.Group();
    const core = new THREE.Mesh(this.blastGeometry, new THREE.MeshBasicMaterial({
      color: 0xff7700, transparent: true, opacity: 0.88,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    core.position.copy(center);
    core.scale.setScalar(3);
    core.userData.baseOpacity = 0.88;
    core.userData.targetScale = 12;
    group.add(core);
    const halo = new THREE.Mesh(this.blastGeometry, new THREE.MeshBasicMaterial({
      color: 0xffaa00, transparent: true, opacity: 0.50,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    halo.position.copy(center);
    halo.scale.setScalar(6);
    halo.userData.baseOpacity = 0.50;
    halo.userData.targetScale = 22;
    group.add(halo);
    const groundRing = new THREE.Mesh(this.ringGeometry, new THREE.MeshBasicMaterial({
      color: 0xff5500, transparent: true, opacity: 0.68,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    }));
    groundRing.rotation.x = -Math.PI / 2;
    groundRing.position.copy(center);
    groundRing.scale.setScalar(1);
    groundRing.userData.targetScale = 25;
    groundRing.userData.baseOpacity = 0.68;
    group.add(groundRing);
    if (!reduceMotion) {
      for (let i = 0; i < 4; i++) {
        const angle = (i / 4) * Math.PI * 2 + Math.PI / 4;
        const px = center.x + Math.cos(angle) * 8;
        const pz = center.z + Math.sin(angle) * 8;
        for (let seg = 0; seg < 3; seg++) {
          const y0 = center.y + seg * 3;
          const y1 = y0 + 3 + Math.random() * 1.5;
          const pl = new THREE.Line(
            new THREE.BufferGeometry().setFromPoints([
              new THREE.Vector3(px + (Math.random() - 0.5) * 0.3, y0, pz + (Math.random() - 0.5) * 0.3),
              new THREE.Vector3(px + (Math.random() - 0.5) * 0.5, y1, pz + (Math.random() - 0.5) * 0.5),
            ]),
            new THREE.LineBasicMaterial({
              color: seg === 0 ? 0xff6600 : 0xffaa00,
              transparent: true, opacity: 0.72,
              blending: THREE.AdditiveBlending, depthWrite: false,
            }),
          );
          pl.userData.baseOpacity = 0.72;
          group.add(pl);
        }
      }
    }
    const smoke = new THREE.Mesh(this.cloudGeometry, new THREE.MeshBasicMaterial({
      color: 0xddd8cc, transparent: true, opacity: 0.36,
      blending: THREE.NormalBlending, depthWrite: false,
    }));
    smoke.position.copy(center).add(new THREE.Vector3(0, 6, 0));
    smoke.scale.setScalar(4.5);
    smoke.userData.baseOpacity = 0.36;
    smoke.userData.velY = 1.8;
    group.add(smoke);
    const scorch = new THREE.Mesh(this.ringGeometry, new THREE.MeshBasicMaterial({
      color: 0x2a0800, transparent: true, opacity: 0.60, side: THREE.DoubleSide,
    }));
    scorch.rotation.x = -Math.PI / 2;
    scorch.position.copy(center).add(new THREE.Vector3(0, 0.03, 0));
    scorch.scale.setScalar(12);
    scorch.userData.targetScale = 12;
    scorch.userData.baseOpacity = 0.60;
    group.add(scorch);
    this.scene.add(group);
    this.gouenBlastFX.push({ obj: group, life: 3.5, maxLife: 3.5 });
  }

  /** 天罰: 40m半径に20本の落雷を1.5sに分散(gokuraiColumns経由、reduceMotion=ゼロ) */
  tenraiTenbatsu(center: THREE.Vector3, radius: number, reduceMotion = false): void {
    if (reduceMotion) return;
    const COUNT = 20;
    const bolts: Array<{ t: number; pos: THREE.Vector3; fired: boolean }> = [];
    for (let i = 0; i < COUNT; i++) {
      const angle = Math.random() * Math.PI * 2;
      const r = 4 + Math.random() * Math.max(1, radius - 4);
      bolts.push({
        t: (i / COUNT) * 1.5,
        pos: new THREE.Vector3(
          center.x + Math.cos(angle) * r,
          center.y,
          center.z + Math.sin(angle) * r,
        ),
        fired: false,
      });
    }
    const group = new THREE.Group();
    group.userData.age = 0;
    group.userData.pendingBolts = bolts;
    this.scene.add(group);
    this.tenraiBoltFX.push({ obj: group, life: 1.8, maxLife: 1.8 });
  }

  /** 千里眼閃: シアン太ビームが90°掃引(0.7s) + 残像 */
  shinkirouSweep(origin: THREE.Vector3, yawFrom: number, yawTo: number): void {
    const REACH = 50;
    const group = new THREE.Group();
    group.userData.yawFrom = yawFrom;
    group.userData.yawTo = yawTo;
    group.userData.age = 0;
    group.userData.sweepS = 0.6;
    group.userData.origin = origin.clone();
    group.userData.reach = REACH;
    const bPts = [origin, origin.clone().add(new THREE.Vector3(Math.cos(yawFrom) * REACH, 0, Math.sin(yawFrom) * REACH))];
    const beam = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(bPts),
      new THREE.LineBasicMaterial({ color: 0x00ffee, transparent: true, opacity: 0.88, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    beam.userData.baseOpacity = 0.88;
    beam.name = 'sweepBeam';
    group.add(beam);
    for (let i = 1; i <= 3; i++) {
      const prevYaw = yawFrom - (yawTo - yawFrom) * i * 0.06;
      const aPts = [
        origin,
        origin.clone().add(new THREE.Vector3(Math.cos(prevYaw) * REACH, 0, Math.sin(prevYaw) * REACH)),
      ];
      const aft = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(aPts),
        new THREE.LineBasicMaterial({
          color: 0x00ccdd, transparent: true, opacity: 0.42 - i * 0.10,
          blending: THREE.AdditiveBlending, depthWrite: false,
        }),
      );
      aft.userData.baseOpacity = 0.42 - i * 0.10;
      aft.name = `aftBeam${i}`;
      group.add(aft);
    }
    this.scene.add(group);
    this.shinkirouSweepFX.push({ obj: group, life: 0.7, maxLife: 0.7 });
  }

  /** 阿修羅連撃: オレンジ弾嵐オーラ + 薬莢落下(1.2s) */
  shuraRampage(origin: THREE.Vector3): void {
    const group = new THREE.Group();
    for (let i = 0; i < 24; i++) {
      const yaw = (i / 24) * Math.PI * 2;
      const pitch = (Math.random() - 0.3) * 0.4;
      const len = 3 + Math.random() * 5;
      const d = new THREE.Vector3(Math.cos(yaw) * Math.cos(pitch), Math.sin(pitch), Math.sin(yaw) * Math.cos(pitch));
      const start = origin.clone().add(new THREE.Vector3(Math.cos(yaw) * 0.3, 0.5, Math.sin(yaw) * 0.3));
      const end = start.clone().addScaledVector(d, len);
      const bl = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([start, end]),
        new THREE.LineBasicMaterial({ color: 0xff8800, transparent: true, opacity: 0.76, blending: THREE.AdditiveBlending, depthWrite: false }),
      );
      bl.userData.baseOpacity = 0.76;
      group.add(bl);
    }
    for (let c = 0; c < 12; c++) {
      const casing = new THREE.Mesh(this.sparkGeometry, new THREE.MeshBasicMaterial({
        color: 0xffbb44, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false,
      }));
      casing.position.copy(origin).add(new THREE.Vector3((Math.random() - 0.5) * 0.5, 0.8, (Math.random() - 0.5) * 0.5));
      casing.userData.baseOpacity = 0.85;
      casing.userData.vel = new THREE.Vector3(
        (Math.random() - 0.5) * 3, 2 + Math.random() * 2, (Math.random() - 0.5) * 3,
      );
      group.add(casing);
    }
    this.scene.add(group);
    this.shuraRampageFX.push({ obj: group, life: 1.2, maxLife: 1.2 });
  }

  // ─── R34 Mウルトエフェクト ────────────────────────────────────────────────

  /** 影分身・万刃繚乱: 8体影クローン+手裏剣嵐(3.5s, reduceMotion=クローンスキップ) */
  banjinKagemai(center: THREE.Vector3, reduceMotion = false): void {
    const group = new THREE.Group();
    const CLONE_COUNT = 8;
    const RING_R = 8;
    if (!reduceMotion) {
      for (let i = 0; i < CLONE_COUNT; i++) {
        const angle = (i / CLONE_COUNT) * Math.PI * 2;
        const px = center.x + Math.cos(angle) * RING_R;
        const pz = center.z + Math.sin(angle) * RING_R;
        const clone = new THREE.Group();
        const head = new THREE.Mesh(this.puffGeometry, new THREE.MeshBasicMaterial({
          color: 0x220033, transparent: true, opacity: 0.68, blending: THREE.NormalBlending, depthWrite: false,
        }));
        head.position.set(px, center.y + 1.7, pz);
        head.scale.setScalar(2.5);
        head.userData.baseOpacity = 0.68;
        clone.add(head);
        const bodyGeo = new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(px, center.y + 0.3, pz),
          new THREE.Vector3(px, center.y + 1.4, pz),
        ]);
        const body = new THREE.Line(bodyGeo, new THREE.LineBasicMaterial({
          color: 0x440066, transparent: true, opacity: 0.62, blending: THREE.NormalBlending,
        }));
        body.userData.baseOpacity = 0.62;
        clone.add(body);
        for (const side of [-1, 1]) {
          const armGeo = new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(px, center.y + 1.2, pz),
            new THREE.Vector3(px + side * Math.cos(angle) * 0.6, center.y + 0.8, pz + side * Math.sin(angle) * 0.6),
          ]);
          const arm = new THREE.Line(armGeo, new THREE.LineBasicMaterial({
            color: 0x440066, transparent: true, opacity: 0.52, blending: THREE.NormalBlending,
          }));
          arm.userData.baseOpacity = 0.52;
          clone.add(arm);
        }
        group.add(clone);
      }
    }
    const SHURIKEN_COUNT = reduceMotion ? 16 : CLONE_COUNT * 4;
    for (let s = 0; s < SHURIKEN_COUNT; s++) {
      const yaw = (s / SHURIKEN_COUNT) * Math.PI * 2;
      const speed = 8 + Math.random() * 10;
      const d = new THREE.Vector3(Math.cos(yaw), (Math.random() - 0.3) * 0.3, Math.sin(yaw));
      const startPt = center.clone().add(new THREE.Vector3(Math.cos(yaw) * 0.1, 1, Math.sin(yaw) * 0.1));
      const disc = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([startPt, startPt.clone().addScaledVector(d, 0.2)]),
        new THREE.LineBasicMaterial({ color: 0xddeeff, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false }),
      );
      disc.userData.baseOpacity = 0.8;
      disc.userData.vel = d.clone().multiplyScalar(speed);
      group.add(disc);
    }
    this.scene.add(group);
    this.banjinCloneFX.push({ obj: group, life: 3.5, maxLife: 3.5 });
  }

  /** 月落とし: 月球が高空から落下→30mノヴァ+柱+クレーターリング(4.0s) */
  gekkouTsukiotoshi(center: THREE.Vector3, reduceMotion = false): void {
    const group = new THREE.Group();
    const moon = new THREE.Mesh(this.blastGeometry, new THREE.MeshBasicMaterial({
      color: 0xeeeeff, transparent: true, opacity: 0.82,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    moon.position.copy(center).add(new THREE.Vector3(0, 30, 0));
    moon.scale.setScalar(4);
    moon.userData.baseOpacity = 0.82;
    moon.userData.isMoon = true;
    moon.userData.fallSpeed = 22;
    group.add(moon);
    if (!reduceMotion) {
      for (let i = 0; i < 6; i++) {
        const angle = (i / 6) * Math.PI * 2;
        const px = center.x + Math.cos(angle) * 10;
        const pz = center.z + Math.sin(angle) * 10;
        const pillar = new THREE.Line(
          new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(px, center.y, pz),
            new THREE.Vector3(px, center.y + 14, pz),
          ]),
          new THREE.LineBasicMaterial({ color: 0xaabedd, transparent: true, opacity: 0.48, blending: THREE.AdditiveBlending, depthWrite: false }),
        );
        pillar.userData.baseOpacity = 0.48;
        pillar.visible = false;
        pillar.userData.delayShow = true;
        group.add(pillar);
      }
    }
    const novaRing = new THREE.Mesh(this.ringGeometry, new THREE.MeshBasicMaterial({
      color: 0xddeeff, transparent: true, opacity: 0.0,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    }));
    novaRing.rotation.x = -Math.PI / 2;
    novaRing.position.copy(center);
    novaRing.scale.setScalar(0.5);
    novaRing.userData.targetScale = 30;
    novaRing.userData.baseOpacity = 0.78;
    novaRing.userData.isNova = true;
    group.add(novaRing);
    const craterRing = new THREE.Mesh(this.ringGeometry, new THREE.MeshBasicMaterial({
      color: 0x334466, transparent: true, opacity: 0.0, side: THREE.DoubleSide,
    }));
    craterRing.rotation.x = -Math.PI / 2;
    craterRing.position.copy(center).add(new THREE.Vector3(0, 0.04, 0));
    craterRing.scale.setScalar(8);
    craterRing.userData.baseOpacity = 0.55;
    craterRing.userData.isCrater = true;
    group.add(craterRing);
    group.userData.floorY = center.y;
    group.userData.impactDone = false;
    this.scene.add(group);
    this.gekkouMoonFX.push({ obj: group, life: 4.0, maxLife: 4.0 });
  }

  /** 個別竜巻スポーン — fujinKamikaze および match.ts から直接呼ぶ */
  fujinTornadoAt(pos: THREE.Vector3): void {
    const group = new THREE.Group();
    const SEGS = 12;
    const HEIGHT = 14;
    for (let ring = 0; ring < SEGS; ring++) {
      const y = (ring / SEGS) * HEIGHT;
      const r = 0.8 + (1 - ring / SEGS) * 2.5;
      const pts: THREE.Vector3[] = [];
      for (let a = 0; a <= 16; a++) {
        const ang = (a / 16) * Math.PI * 2 + ring * 0.5;
        pts.push(new THREE.Vector3(pos.x + Math.cos(ang) * r, pos.y + y, pos.z + Math.sin(ang) * r));
      }
      const tornadoLine = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(pts),
        new THREE.LineBasicMaterial({ color: 0x55ffee, transparent: true, opacity: 0.26, blending: THREE.AdditiveBlending, depthWrite: false }),
      );
      tornadoLine.userData.baseOpacity = 0.26;
      group.add(tornadoLine);
    }
    for (let p = 0; p < 8; p++) {
      const ang = (p / 8) * Math.PI * 2;
      const puff = new THREE.Mesh(this.puffGeometry, new THREE.MeshBasicMaterial({
        color: 0x99eedd, transparent: true, opacity: 0.20,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }));
      puff.position.set(pos.x + Math.cos(ang) * 1.5, pos.y + 0.5, pos.z + Math.sin(ang) * 1.5);
      puff.userData.baseOpacity = 0.20;
      group.add(puff);
    }
    group.userData.spinRate = 1.8 + Math.random() * 1.2;
    this.scene.add(group);
    this.fujinVortexFX.push({ obj: group, life: 3.5, maxLife: 3.5 });
  }

  /** 神風・天空舞: マップ全域に竜巻群スポーン(reduceMotion=3本に削減) */
  fujinKamikaze(center: THREE.Vector3, maxR: number, reduceMotion = false): void {
    const count = reduceMotion ? 3 : 8;
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2 + Math.random() * 0.5;
      const r = maxR * 0.3 + Math.random() * maxR * 0.7;
      this.fujinTornadoAt(new THREE.Vector3(
        center.x + Math.cos(angle) * r,
        center.y,
        center.z + Math.sin(angle) * r,
      ));
    }
  }

  /** 業火滅世: 60m回廊に交互L/R火壁+地割れ赤光(4.0s, reduceMotion=柱ゼロ) */
  gouenMesse(origin: THREE.Vector3, dir: THREE.Vector3, reduceMotion = false): void {
    const group = new THREE.Group();
    const D = dir.clone().normalize();
    const right = new THREE.Vector3().crossVectors(D, new THREE.Vector3(0, 1, 0)).normalize();
    const CORRIDOR = 60;
    const WALL_OFFSET = 5;
    const WALL_COUNT = reduceMotion ? 0 : 10;
    for (let i = 0; i < WALL_COUNT; i++) {
      const t = (i + 0.5) / WALL_COUNT;
      const dist = t * CORRIDOR;
      const side = i % 2 === 0 ? 1 : -1;
      const wb = origin.clone().addScaledVector(D, dist).addScaledVector(right, side * WALL_OFFSET);
      const HEIGHT = 8 + Math.random() * 4;
      for (let seg = 0; seg < 4; seg++) {
        const y0 = seg * (HEIGHT / 4);
        const y1 = y0 + (HEIGHT / 4) + Math.random() * 0.8;
        const wl = new THREE.Line(
          new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(wb.x + (Math.random() - 0.5) * 0.4, wb.y + y0, wb.z + (Math.random() - 0.5) * 0.4),
            new THREE.Vector3(wb.x + (Math.random() - 0.5) * 0.6, wb.y + y1, wb.z + (Math.random() - 0.5) * 0.6),
          ]),
          new THREE.LineBasicMaterial({
            color: seg < 2 ? 0xff5500 : 0xffaa00,
            transparent: true, opacity: 0.72,
            blending: THREE.AdditiveBlending, depthWrite: false,
          }),
        );
        wl.userData.baseOpacity = 0.72;
        group.add(wl);
      }
    }
    for (let i = 0; i < 20; i++) {
      const t0 = (i / 20) * CORRIDOR;
      const t1 = ((i + 1) / 20) * CORRIDOR;
      const cs = origin.clone().addScaledVector(D, t0).add(new THREE.Vector3((Math.random() - 0.5) * 0.6, 0.05, (Math.random() - 0.5) * 0.6));
      const ce = origin.clone().addScaledVector(D, t1).add(new THREE.Vector3((Math.random() - 0.5) * 0.6, 0.05, (Math.random() - 0.5) * 0.6));
      const cl = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([cs, ce]),
        new THREE.LineBasicMaterial({ color: 0xff2200, transparent: true, opacity: 0.66, blending: THREE.AdditiveBlending, depthWrite: false }),
      );
      cl.userData.baseOpacity = 0.66;
      cl.userData.fissure = true;
      group.add(cl);
    }
    this.scene.add(group);
    this.gouenCorridorFX.push({ obj: group, life: 4.0, maxLife: 4.0 });
  }

  /** 神鳴八雷: 最大8方向の巨大落雷を同時打ち(gokuraiColumns経由、reduceMotion=ゼロ) */
  tenraiHachirai(positions: THREE.Vector3[], reduceMotion = false): void {
    if (reduceMotion) return;
    const MAX = Math.min(8, positions.length);
    for (let i = 0; i < MAX; i++) {
      const pos = positions[i]!;
      const top = pos.clone().add(new THREE.Vector3(
        (Math.random() - 0.5) * 3,
        35 + Math.random() * 5,
        (Math.random() - 0.5) * 3,
      ));
      this.buildBranchBolt(top, pos, 4, false, 0.5 + Math.random() * 0.2);
      this.impactRing(pos, 0x44aaff);
    }
  }

  /** 虚像世界: 空間歪曲リング+熱揺らぎ粒子(durationS上限4s、NOTpostfx) */
  shinkirouKyozou(durationS: number, reduceMotion = false): void {
    const life = Math.min(4.0, durationS + 0.5);
    const group = new THREE.Group();
    const center = new THREE.Vector3(0, 1.5, -5);
    for (let i = 0; i < 4; i++) {
      const rScale = 2 + i * 3;
      const ring = new THREE.Mesh(this.ringGeometry, new THREE.MeshBasicMaterial({
        color: 0x00ddff, transparent: true, opacity: 0.32 - i * 0.05,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
      }));
      ring.position.copy(center);
      ring.rotation.x = -Math.PI / 2;
      ring.scale.setScalar(rScale);
      ring.userData.baseOpacity = 0.32 - i * 0.05;
      ring.userData.pulsePhi = i * Math.PI * 0.5;
      ring.userData.isDistortRing = true;
      group.add(ring);
    }
    if (!reduceMotion) {
      for (let p = 0; p < 24; p++) {
        const angle = Math.random() * Math.PI * 2;
        const rad = 1 + Math.random() * 8;
        const puff = new THREE.Mesh(this.puffGeometry, new THREE.MeshBasicMaterial({
          color: 0x44eeff, transparent: true, opacity: 0.18,
          blending: THREE.AdditiveBlending, depthWrite: false,
        }));
        puff.position.copy(center).add(new THREE.Vector3(Math.cos(angle) * rad, (Math.random() - 0.5) * 3, Math.sin(angle) * rad));
        puff.userData.baseOpacity = 0.18;
        puff.userData.swirlAngle = angle;
        puff.userData.swirlR = rad;
        puff.userData.swirlCx = center.x;
        puff.userData.swirlCz = center.z;
        puff.userData.swirlOmega = (Math.random() > 0.5 ? 1 : -1) * (0.4 + Math.random() * 0.6);
        puff.userData.swirlVelY = (Math.random() - 0.5) * 0.5;
        puff.userData.isHeatPuff = true;
        group.add(puff);
      }
    }
    this.scene.add(group);
    this.shinkirouMirageFX.push({ obj: group, life, maxLife: life });
  }

  /** 阿修羅降臨: 3頭6腕阿修羅シルエット+気合オーラ(3.5s, reduceMotion=腕省略) */
  shuraKourin(center: THREE.Vector3, reduceMotion = false): void {
    const group = new THREE.Group();
    const BASE = center.clone().add(new THREE.Vector3(-2, 0, -3));
    const HEAD_POSITIONS = [
      new THREE.Vector3(0, 6.5, 0),
      new THREE.Vector3(-1.2, 5.2, 0),
      new THREE.Vector3(1.2, 5.2, 0),
    ];
    for (const hp of HEAD_POSITIONS) {
      const head = new THREE.Mesh(this.puffGeometry, new THREE.MeshBasicMaterial({
        color: 0xff4400, transparent: true, opacity: 0.68,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }));
      head.position.copy(BASE).add(hp);
      head.scale.setScalar(3.5);
      head.userData.baseOpacity = 0.68;
      group.add(head);
    }
    const body = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([
        BASE.clone().add(new THREE.Vector3(0, 1, 0)),
        BASE.clone().add(new THREE.Vector3(0, 5, 0)),
      ]),
      new THREE.LineBasicMaterial({ color: 0x220000, transparent: true, opacity: 0.62, blending: THREE.NormalBlending }),
    );
    body.userData.baseOpacity = 0.62;
    group.add(body);
    if (!reduceMotion) {
      const ARM_ANGLES = [Math.PI * 0.2, Math.PI * 0.5, Math.PI * 0.8];
      const ARM_HEIGHTS = [4.8, 3.6, 2.4];
      for (let pair = 0; pair < 3; pair++) {
        const hy = ARM_HEIGHTS[pair]!;
        const baseAng = ARM_ANGLES[pair]!;
        for (const side of [-1, 1]) {
          const ang = side > 0 ? baseAng : Math.PI - baseAng;
          const armEnd = BASE.clone().add(new THREE.Vector3(Math.cos(ang) * 3.5, hy, Math.sin(ang) * 0.3));
          const arm = new THREE.Line(
            new THREE.BufferGeometry().setFromPoints([BASE.clone().add(new THREE.Vector3(0, hy, 0)), armEnd]),
            new THREE.LineBasicMaterial({ color: 0xcc2200, transparent: true, opacity: 0.58, blending: THREE.AdditiveBlending, depthWrite: false }),
          );
          arm.userData.baseOpacity = 0.58;
          group.add(arm);
          const handFlare = new THREE.Mesh(this.flareGeometry, new THREE.MeshBasicMaterial({
            color: 0xff5500, transparent: true, opacity: 0.52, blending: THREE.AdditiveBlending, depthWrite: false,
          }));
          handFlare.position.copy(armEnd);
          handFlare.userData.baseOpacity = 0.52;
          group.add(handFlare);
        }
      }
    }
    for (let w = 0; w < 8; w++) {
      const ang = (w / 8) * Math.PI * 2;
      const wisp = new THREE.Mesh(this.puffGeometry, new THREE.MeshBasicMaterial({
        color: 0x110000, transparent: true, opacity: 0.48, blending: THREE.NormalBlending, depthWrite: false,
      }));
      wisp.position.copy(BASE).add(new THREE.Vector3(Math.cos(ang) * 1.5, 0.5, Math.sin(ang) * 1.5));
      wisp.userData.baseOpacity = 0.48;
      wisp.userData.vel = new THREE.Vector3(Math.cos(ang) * 0.3, 1.5 + Math.random(), Math.sin(ang) * 0.3);
      group.add(wisp);
    }
    this.scene.add(group);
    this.shuraKourinFX.push({ obj: group, life: 3.5, maxLife: 3.5 });
  }

  // ─── R35 新規エフェクト API ────────────────────────────────────────────────

  /** KE-2: 黒雷帝足跡ルーン — 暗紫拡大リング(0.18→0.85m/0.32s)+分岐ボルト小1本 */
  walkKokuraiRune(pos: THREE.Vector3, reduceMotion = false): void {
    const geo = new THREE.RingGeometry(0.7, 1.0, 32);
    const mat = new THREE.MeshBasicMaterial({
      color: 0x5500aa, transparent: true, opacity: 0.78,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    });
    const ring = new THREE.Mesh(geo, mat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.copy(pos);
    ring.scale.setScalar(0.18);
    ring.userData.targetScale = 0.85;
    ring.userData.baseOpacity = 0.78;
    this.scene.add(ring);
    this.impactRings.push({ obj: ring, life: 0.32, maxLife: 0.32 });
    if (!reduceMotion) {
      this.buildBranchBolt(new THREE.Vector3(pos.x, pos.y + 2.5, pos.z), pos, 1, true, 0.18);
    }
  }

  /** KE-3: 魂吸引ビーム — 吸引ライン3本+発生地ノヴァリング+吸引パーティクル5 */
  soulAbsorbBeam(fromPos: THREE.Vector3, toPos: THREE.Vector3, reduceMotion = false): void {
    const OPACITIES = [0.58, 0.38, 0.22] as const;
    const COLORS = [0x9900ff, 0x6600bb, 0x440088] as const;
    for (let i = 0; i < 3; i++) {
      const off = new THREE.Vector3(
        (Math.random() - 0.5) * 0.08, (Math.random() - 0.5) * 0.08, (Math.random() - 0.5) * 0.08,
      );
      const beamGeo = new THREE.BufferGeometry().setFromPoints([fromPos.clone().add(off), toPos.clone().add(off)]);
      const beamMat = new THREE.LineBasicMaterial({
        color: COLORS[i]!, transparent: true, opacity: OPACITIES[i]!,
        blending: THREE.AdditiveBlending, depthWrite: false,
      });
      const line = new THREE.Line(beamGeo, beamMat);
      line.userData.baseOpacity = OPACITIES[i]!;
      this.scene.add(line);
      this.tracers.push({ obj: line, life: 0.42, maxLife: 0.42 });
    }
    // 発生地ノヴァリング
    const novaGeo = new THREE.RingGeometry(0.5, 0.8, 24);
    const novaMat = new THREE.MeshBasicMaterial({
      color: 0x8800cc, transparent: true, opacity: 0.65,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    });
    const novaRing = new THREE.Mesh(novaGeo, novaMat);
    novaRing.rotation.x = -Math.PI / 2;
    novaRing.position.copy(fromPos);
    novaRing.scale.setScalar(0.15);
    novaRing.userData.targetScale = 1.2;
    novaRing.userData.baseOpacity = 0.65;
    this.scene.add(novaRing);
    this.impactRings.push({ obj: novaRing, life: 0.28, maxLife: 0.28 });
    // 吸引パーティクル5(darkPuffs、toPos方向8-14m/s)
    if (!reduceMotion) {
      const absorbDir = new THREE.Vector3().subVectors(toPos, fromPos).normalize();
      for (let i = 0; i < 5; i++) {
        const spread = new THREE.Vector3(
          (Math.random() - 0.5) * 1.5, (Math.random() - 0.5) * 1.5, (Math.random() - 0.5) * 1.5,
        );
        const puffMat = new THREE.MeshBasicMaterial({
          color: 0x330055, transparent: true, opacity: 0.55, depthWrite: false,
        });
        const puff = new THREE.Mesh(this.puffGeometry, puffMat);
        puff.position.copy(fromPos).add(spread);
        puff.scale.setScalar(0.3 + Math.random() * 0.25);
        puff.userData.vel = absorbDir.clone().multiplyScalar(8 + Math.random() * 6);
        this.scene.add(puff);
        this.darkPuffs.push({ obj: puff, life: 0.42, maxLife: 0.42 });
      }
    }
  }

  /** KE-4: 暗黒空虚パルス — 暗転球(BackSide Normal)+紫電コア+収縮吸引8粒 */
  darkVoidPulse(pos: THREE.Vector3, charge01: number, reduceMotion = false): void {
    const c = Math.max(0, Math.min(1, charge01));
    const radius = 0.25 + c * 0.8;
    const darkMat = new THREE.MeshBasicMaterial({
      color: 0x020005, transparent: true, opacity: 0.82,
      blending: THREE.NormalBlending, depthWrite: false, side: THREE.BackSide,
    });
    const darkBall = new THREE.Mesh(this.blastGeometry, darkMat);
    darkBall.position.copy(pos);
    darkBall.scale.setScalar(radius * 0.2);
    darkBall.userData.targetScale = radius;
    darkBall.userData.baseOpacity = 0.82;
    this.scene.add(darkBall);
    this.darkNovas.push({ obj: darkBall as THREE.Mesh, life: 0.38, maxLife: 0.38 });
    const coreMat = new THREE.MeshBasicMaterial({
      color: 0x7700dd, transparent: true, opacity: 0.68,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const core = new THREE.Mesh(this.blastGeometry, coreMat);
    core.position.copy(pos);
    core.scale.setScalar(radius * 0.08);
    core.userData.targetScale = radius * 0.4;
    core.userData.baseOpacity = 0.68;
    this.scene.add(core);
    this.darkNovas.push({ obj: core as THREE.Mesh, life: 0.22, maxLife: 0.22 });
    if (!reduceMotion) {
      for (let i = 0; i < 8; i++) {
        const angle = (i / 8) * Math.PI * 2;
        const r = 1.2 + Math.random() * 0.8;
        const puffMat = new THREE.MeshBasicMaterial({
          color: 0x1a0030, transparent: true, opacity: 0.48, depthWrite: false,
        });
        const puff = new THREE.Mesh(this.puffGeometry, puffMat);
        puff.position.set(pos.x + Math.cos(angle) * r, pos.y + (Math.random() - 0.5) * 0.6, pos.z + Math.sin(angle) * r);
        puff.scale.setScalar(0.2 + Math.random() * 0.2);
        puff.userData.vel = new THREE.Vector3(pos.x - puff.position.x, pos.y - puff.position.y, pos.z - puff.position.z)
          .normalize().multiplyScalar(6 + Math.random() * 4);
        this.scene.add(puff);
        this.darkPuffs.push({ obj: puff, life: 0.32, maxLife: 0.32 });
      }
    }
  }

  /** RE-2: 雷帝足跡 — 氷青リング+氷青ボルト1本 */
  raiteiFootprint(pos: THREE.Vector3, reduceMotion = false): void {
    const geo = new THREE.RingGeometry(0.55, 0.78, 28);
    const mat = new THREE.MeshBasicMaterial({
      color: 0x44aaff, transparent: true, opacity: 0.70,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    });
    const ring = new THREE.Mesh(geo, mat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.copy(pos);
    ring.scale.setScalar(0.15);
    ring.userData.targetScale = 1.0;
    ring.userData.baseOpacity = 0.70;
    this.scene.add(ring);
    this.impactRings.push({ obj: ring, life: 0.28, maxLife: 0.28 });
    if (!reduceMotion) {
      this.buildBranchBolt(new THREE.Vector3(pos.x, pos.y + 2.0, pos.z), pos, 1, false, 0.15);
    }
  }

  /** BE-1: 黒帝煙マントル — 羽根形状2+胴体煙ブロブ3 */
  kokuteiSmokeMantle(pos: THREE.Vector3, reduceMotion = false): void {
    const group = new THREE.Group();
    group.position.copy(pos);
    for (const wingAngle of [1.1, -1.1]) {
      const wing = new THREE.Mesh(this.streakGeometry, new THREE.MeshBasicMaterial({
        color: 0x050010, transparent: true, opacity: 0.72,
        blending: THREE.NormalBlending, depthWrite: false, side: THREE.DoubleSide,
      }));
      wing.scale.set(3.5, 1.5, 4.2);
      wing.rotation.z = wingAngle;
      wing.rotation.y = Math.PI / 2;
      wing.position.y = 0.8;
      wing.userData.baseOpacity = 0.72;
      group.add(wing);
    }
    if (!reduceMotion) {
      for (let i = 0; i < 3; i++) {
        const blobMat = new THREE.MeshBasicMaterial({
          color: 0x07000e, transparent: true, opacity: 0, depthWrite: false,
        });
        const blob = new THREE.Mesh(this.cloudGeometry, blobMat);
        blob.position.set((Math.random() - 0.5) * 0.6, 0.3 + i * 0.5, (Math.random() - 0.5) * 0.4);
        blob.scale.setScalar(0.35 + Math.random() * 0.2);
        blob.userData.isSmoke = true;
        group.add(blob);
      }
    }
    this.scene.add(group);
    this.kokuteiMantleFX.push({ obj: group, life: 0.65, maxLife: 0.65 });
  }

  /** BE-2: 黒帝斬撃残光ライン — 赤残光1本(0xcc0011 Additive 0.32/0.50s) */
  kokuteiSlashResidual(from: THREE.Vector3, to: THREE.Vector3): void {
    const geo = new THREE.BufferGeometry().setFromPoints([from, to]);
    const mat = new THREE.LineBasicMaterial({
      color: 0xcc0011, transparent: true, opacity: 0.32,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const line = new THREE.Line(geo, mat);
    line.userData.baseOpacity = 0.32;
    this.scene.add(line);
    this.tracers.push({ obj: line, life: 0.50, maxLife: 0.50 });
  }

  /** EX-1: 月光弓月相チャージ — 三日月(c=0)→満月(c=1)リング+満月バースト */
  gekkouMoonPhaseCharge(origin: THREE.Vector3, charge01: number, reduceMotion = false): void {
    const c = Math.max(0, Math.min(1, charge01));
    const innerR = 0.3 + c * 0.55;
    const arcAngle = Math.PI * (0.5 + c * 1.5);
    const cresGeo = new THREE.RingGeometry(innerR, innerR + 0.12, 24, 1, 0, arcAngle);
    const cresMat = new THREE.MeshBasicMaterial({
      color: c > 0.8 ? 0xffffff : 0xddeeff,
      transparent: true, opacity: 0.65 + c * 0.25,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(cresGeo, cresMat);
    mesh.position.copy(origin);
    mesh.rotation.x = -Math.PI / 2;
    mesh.userData.baseOpacity = 0.65 + c * 0.25;
    mesh.userData.targetScale = 1.0;
    this.scene.add(mesh);
    this.crescents.push({ obj: mesh, life: 0.28, maxLife: 0.28 });
    if (c >= 0.9 && !reduceMotion) {
      this.bowImpact(origin);
      const burstGeo = new THREE.RingGeometry(0.82, 1.0, 36);
      const burstMat = new THREE.MeshBasicMaterial({
        color: 0xffffff, transparent: true, opacity: 0.72,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
      });
      const burstRing = new THREE.Mesh(burstGeo, burstMat);
      burstRing.rotation.x = -Math.PI / 2;
      burstRing.position.copy(origin);
      burstRing.scale.setScalar(0.5);
      burstRing.userData.targetScale = 4.5;
      burstRing.userData.baseOpacity = 0.72;
      this.scene.add(burstRing);
      this.rings.push({ obj: burstRing, life: 0.35, maxLife: 0.35 });
    }
  }

  /** GE-1: ボット死亡エフェクト(武器クラス別) */
  botDeathFxByClass(
    point: THREE.Vector3,
    teamColor: number,
    weaponClass: string,
    reduceMotion = false,
  ): void {
    switch (weaponClass) {
      case 'sniper': {
        if (!reduceMotion) {
          for (let i = 0; i < 4; i++) {
            const a = (i / 4) * Math.PI * 2 + Math.random() * 0.4;
            const len = 1.2 + Math.random() * 0.8;
            const lineGeo = new THREE.BufferGeometry().setFromPoints([
              point,
              point.clone().add(new THREE.Vector3(Math.cos(a) * len, (Math.random() - 0.3) * len * 0.5, Math.sin(a) * len)),
            ]);
            const lineMat = new THREE.LineBasicMaterial({
              color: 0xccddee, transparent: true, opacity: 0.78,
              blending: THREE.AdditiveBlending, depthWrite: false,
            });
            const sl = new THREE.Line(lineGeo, lineMat);
            sl.userData.baseOpacity = 0.78;
            this.scene.add(sl);
            this.tracers.push({ obj: sl, life: 0.25, maxLife: 0.25 });
          }
        }
        this.impactRing(point, 0xffffff);
        break;
      }
      case 'shotgun': {
        const sparkGroup = new THREE.Group();
        sparkGroup.position.copy(point);
        const cnt = reduceMotion ? 8 : 20;
        for (let i = 0; i < cnt; i++) {
          const shard = new THREE.Mesh(this.sparkGeometry, new THREE.MeshBasicMaterial({
            color: i % 4 === 0 ? 0xffffff : 0xff8822,
            transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false,
          }));
          const a = Math.random() * Math.PI * 2;
          const spd = 3 + Math.random() * 7;
          shard.userData.vel = new THREE.Vector3(Math.cos(a) * spd, Math.random() * 5 + 1, Math.sin(a) * spd);
          sparkGroup.add(shard);
        }
        this.scene.add(sparkGroup);
        this.sparks.push({ obj: sparkGroup, life: 0.55, maxLife: 0.55 });
        const coreMesh = new THREE.Mesh(this.blastGeometry, new THREE.MeshBasicMaterial({
          color: 0xff6600, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false,
        }));
        coreMesh.position.copy(point);
        coreMesh.scale.setScalar(0.25);
        coreMesh.userData.targetScale = 1.0;
        coreMesh.userData.baseOpacity = 0.85;
        this.scene.add(coreMesh);
        this.blasts.push({ obj: coreMesh, life: 0.25, maxLife: 0.25 });
        break;
      }
      case 'launcher': {
        this.rocketBlast(point, 2.5);
        break;
      }
      case 'melee': {
        this.shockwaveRing(point.clone(), 2.0, 0x8822ff);
        if (!reduceMotion) {
          for (let i = 0; i < 2; i++) {
            const puffMat = new THREE.MeshBasicMaterial({
              color: 0x1a0030, transparent: true, opacity: 0.55, depthWrite: false,
            });
            const puff = new THREE.Mesh(this.puffGeometry, puffMat);
            puff.position.copy(point).add(new THREE.Vector3(
              (Math.random() - 0.5) * 0.6, Math.random() * 0.5, (Math.random() - 0.5) * 0.6,
            ));
            puff.scale.setScalar(0.6 + Math.random() * 0.4);
            this.scene.add(puff);
            this.darkPuffs.push({ obj: puff, life: 0.8, maxLife: 0.8 });
          }
        }
        break;
      }
      case 'exotic': {
        this.deathBurst(point, teamColor);
        const accentGeo = new THREE.RingGeometry(0.82, 1.0, 36);
        const accentMat = new THREE.MeshBasicMaterial({
          color: teamColor, transparent: true, opacity: 0.70,
          blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
        });
        const accentRing = new THREE.Mesh(accentGeo, accentMat);
        accentRing.rotation.x = -Math.PI / 2;
        accentRing.position.copy(point);
        accentRing.scale.setScalar(0.3);
        accentRing.userData.targetScale = 2.8;
        accentRing.userData.baseOpacity = 0.70;
        this.scene.add(accentRing);
        this.rings.push({ obj: accentRing, life: 0.4, maxLife: 0.4 });
        break;
      }
      default: {
        this.deathBurst(point, teamColor);
        break;
      }
    }
  }

  /** GE-2: ヘッドショットフレアV2 — 黄金十字線2+拡大黄金リング+球scale0.18/opacity0.75。シグネチャ互換 */
  headshotFlareV2(point: THREE.Vector3): void {
    const crossPairs: Array<[THREE.Vector3, THREE.Vector3]> = [
      [new THREE.Vector3(-0.4, 0.4, 0), new THREE.Vector3(0.4, -0.4, 0)],
      [new THREE.Vector3(-0.4, -0.4, 0), new THREE.Vector3(0.4, 0.4, 0)],
    ];
    for (const [a, b] of crossPairs) {
      const crossGeo = new THREE.BufferGeometry().setFromPoints([point.clone().add(a), point.clone().add(b)]);
      const crossMat = new THREE.LineBasicMaterial({
        color: 0xffd700, transparent: true, opacity: 0.88, blending: THREE.AdditiveBlending, depthWrite: false,
      });
      const crossLine = new THREE.Line(crossGeo, crossMat);
      crossLine.userData.baseOpacity = 0.88;
      this.scene.add(crossLine);
      this.tracers.push({ obj: crossLine, life: 0.22, maxLife: 0.22 });
    }
    const hsRingGeo = new THREE.RingGeometry(0.82, 1.0, 32);
    const hsRingMat = new THREE.MeshBasicMaterial({
      color: 0xffd700, transparent: true, opacity: 0.80,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    });
    const hsRing = new THREE.Mesh(hsRingGeo, hsRingMat);
    hsRing.position.copy(point);
    hsRing.rotation.x = -Math.PI / 2;
    hsRing.scale.setScalar(0.2);
    hsRing.userData.targetScale = 1.8;
    hsRing.userData.baseOpacity = 0.80;
    this.scene.add(hsRing);
    this.rings.push({ obj: hsRing, life: 0.22, maxLife: 0.22 });
    const flareMat = new THREE.MeshBasicMaterial({
      color: 0xffe8a0, transparent: true, opacity: 0.75, blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const flare = new THREE.Mesh(this.flareGeometry, flareMat);
    flare.position.copy(point);
    flare.scale.setScalar(0.18);
    flare.userData.baseOpacity = 0.75;
    this.scene.add(flare);
    this.flares.push({ obj: flare, life: 0.22, maxLife: 0.22 });
  }

  /** GE-3: スライドスパーク — 橙6+白2の後方スパーク(重力 sparks tick準拠) */
  slideSparks(pos: THREE.Vector3, dir: THREE.Vector3, reduceMotion = false): void {
    if (reduceMotion) return;
    const group = new THREE.Group();
    group.position.copy(pos);
    const back = dir.clone().negate().normalize();
    const COLORS = [0xff8800, 0xff6600, 0xff9900, 0xff7700, 0xff8800, 0xff6600, 0xffffff, 0xffffff] as const;
    for (let i = 0; i < 8; i++) {
      const shard = new THREE.Mesh(this.sparkGeometry, new THREE.MeshBasicMaterial({
        color: COLORS[i]!, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false,
      }));
      const spread = (Math.random() - 0.5) * 1.0;
      const spd = 4 + Math.random() * 5;
      shard.userData.vel = new THREE.Vector3(back.x * spd + spread, Math.random() * 1.5 + 0.3, back.z * spd + spread);
      group.add(shard);
    }
    this.scene.add(group);
    this.sparks.push({ obj: group, life: 0.35, maxLife: 0.35 });
  }

  /** GE-4: 着地衝撃波 — 地面リング+土煙6+強着地で亀裂2本(strength01>=0.5) */
  landingShockwave(pos: THREE.Vector3, strength01: number, reduceMotion = false): void {
    const s = Math.max(0, Math.min(1, strength01));
    const ringR = 0.8 + s * 1.5;
    const shockOpacity = 0.65 + s * 0.25;
    const shockGeo = new THREE.RingGeometry(0.82, 1.0, 36);
    const shockMat = new THREE.MeshBasicMaterial({
      color: 0xaaaaaa, transparent: true, opacity: shockOpacity,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    });
    const shockRing = new THREE.Mesh(shockGeo, shockMat);
    shockRing.rotation.x = -Math.PI / 2;
    shockRing.position.copy(pos);
    shockRing.scale.setScalar(0.2);
    shockRing.userData.targetScale = ringR;
    shockRing.userData.baseOpacity = shockOpacity;
    this.scene.add(shockRing);
    this.rings.push({ obj: shockRing, life: 0.38, maxLife: 0.38 });
    const dustCount = reduceMotion ? 3 : 6;
    for (let i = 0; i < dustCount; i++) {
      const dustMat = new THREE.MeshBasicMaterial({
        color: 0x887766, transparent: true, opacity: 0, depthWrite: false,
      });
      const dust = new THREE.Mesh(this.puffGeometry, dustMat);
      const a = Math.random() * Math.PI * 2;
      const r = ringR * (0.2 + Math.random() * 0.5);
      dust.position.set(pos.x + Math.cos(a) * r, pos.y, pos.z + Math.sin(a) * r);
      dust.scale.setScalar(0.3 + s * 0.4 + Math.random() * 0.3);
      dust.userData.velY = 1.5 + Math.random() * 1.5;
      dust.userData.baseOpacity = 0.48 + s * 0.25;
      dust.userData.targetScale = 2.0;
      this.scene.add(dust);
      this.blasts.push({ obj: dust, life: 0.65 + s * 0.3, maxLife: 0.95 });
    }
    if (s >= 0.5 && !reduceMotion) {
      for (let i = 0; i < 2; i++) {
        const a = Math.random() * Math.PI;
        const len = ringR * (0.6 + Math.random() * 0.4);
        const crackDir = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
        const crackMesh = new THREE.Mesh(this.streakGeometry, new THREE.MeshBasicMaterial({
          color: 0x665544, transparent: true, opacity: 0.68, blending: THREE.AdditiveBlending, depthWrite: false,
        }));
        crackMesh.scale.z = len;
        crackMesh.scale.x = 0.07;
        crackMesh.position.copy(pos).addScaledVector(crackDir, len * 0.5);
        crackMesh.position.y -= 0.04;
        crackMesh.rotation.y = a;
        crackMesh.userData.fissure = true;
        crackMesh.userData.baseOpacity = 0.68;
        const crackGroup = new THREE.Group();
        crackGroup.add(crackMesh);
        this.scene.add(crackGroup);
        this.streaks.push({ obj: crackGroup, life: 0.55 + s * 0.2, maxLife: 0.75 });
      }
    }
  }

  /** GE-5: 壁走りスパーク — 橙4+白2 */
  wallRunSparks(pos: THREE.Vector3, wallNormal: THREE.Vector3, reduceMotion = false): void {
    if (reduceMotion) return;
    const group = new THREE.Group();
    group.position.copy(pos);
    const COLORS = [0xff8800, 0xff9900, 0xff7700, 0xff8800, 0xffffff, 0xffffff] as const;
    for (let i = 0; i < 6; i++) {
      const shard = new THREE.Mesh(this.sparkGeometry, new THREE.MeshBasicMaterial({
        color: COLORS[i]!, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false,
      }));
      const bounce = wallNormal.clone().multiplyScalar(1.5 + Math.random() * 2);
      shard.userData.vel = bounce.clone().add(
        new THREE.Vector3((Math.random() - 0.5) * 3, Math.random() * 2 + 0.5, (Math.random() - 0.5) * 3),
      );
      group.add(shard);
    }
    this.scene.add(group);
    this.sparks.push({ obj: group, life: 0.28, maxLife: 0.28 });
  }

  /** GE-6: リロード完了フラッシュ — 白フレア小+ガンメタルリング */
  reloadCompleteFlash(origin: THREE.Vector3): void {
    const flareMat = new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0.72, blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const flare = new THREE.Mesh(this.flareGeometry, flareMat);
    flare.position.copy(origin);
    flare.scale.setScalar(0.22);
    flare.userData.baseOpacity = 0.72;
    this.scene.add(flare);
    this.flares.push({ obj: flare, life: 0.18, maxLife: 0.18 });
    const rcRingGeo = new THREE.RingGeometry(0.82, 1.0, 28);
    const rcRingMat = new THREE.MeshBasicMaterial({
      color: 0x8899aa, transparent: true, opacity: 0.62,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    });
    const rcRing = new THREE.Mesh(rcRingGeo, rcRingMat);
    rcRing.position.copy(origin);
    rcRing.rotation.x = -Math.PI / 2;
    rcRing.scale.setScalar(0.15);
    rcRing.userData.targetScale = 0.9;
    rcRing.userData.baseOpacity = 0.62;
    this.scene.add(rcRing);
    this.impactRings.push({ obj: rcRing, life: 0.22, maxLife: 0.22 });
  }

  /** 万刃 命中スパーク */
  shurikenImpact(point: THREE.Vector3): void {
    for (let i = 0; i < 5; i += 1) {
      const dir = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
      const end = point.clone().addScaledVector(dir, 0.25 + Math.random() * 0.25);
      const geo = new THREE.BufferGeometry().setFromPoints([point, end]);
      const mat = new THREE.LineBasicMaterial({ color: 0xddddff, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending });
      const spark = new THREE.Line(geo, mat);
      spark.userData.baseOpacity = 0.7;
      this.scene.add(spark);
      this.tracers.push({ obj: spark, life: 0.08, maxLife: 0.08 });
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
      // KE-3/KE-4: vel指定時は位置更新(収縮・飛翔パーティクル対応)
      const vel = puff.userData.vel as THREE.Vector3 | undefined;
      if (vel) puff.position.addScaledVector(vel, dt);
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
    // ── R33 特殊武器エフェクト tick ──
    this.bowArrowFX = this.tick(this.bowArrowFX, dt, (group, ratio) => {
      for (const child of group.children) {
        const m = child as THREE.Mesh | THREE.Line;
        if ((m as THREE.Mesh).isMesh) {
          (m.material as THREE.MeshBasicMaterial).opacity = 0.85 * ratio * ratio;
          (m as THREE.Mesh).scale.multiplyScalar(1 + dt * 3);
        } else {
          (m.material as THREE.LineBasicMaterial).opacity = 0.9 * ratio;
        }
      }
    });
    this.staffBoltFX = this.tick(this.staffBoltFX, dt, (group, ratio) => {
      const t = performance.now() / 1000;
      for (const child of group.children) {
        const mesh = child as THREE.Mesh | THREE.Line;
        const base = (mesh.userData.baseOpacity as number) ?? 0.85;
        if ((mesh as THREE.Mesh).isMesh) {
          (mesh.material as THREE.MeshBasicMaterial).opacity = base * ratio * (0.8 + 0.2 * Math.sin(t * 18));
          (mesh as THREE.Mesh).scale.multiplyScalar(1 + dt * 2.5);
        } else {
          (mesh.material as THREE.LineBasicMaterial).opacity = base * ratio;
        }
      }
    });
    this.beamLines = this.tick(this.beamLines, dt, (line, ratio) => {
      (line.material as THREE.LineBasicMaterial).opacity = (line.userData.baseOpacity as number ?? 0.9) * ratio;
    });
    this.shurikenFX = this.tick(this.shurikenFX, dt, (group, ratio) => {
      group.rotation.z += dt * 22;
      for (const child of group.children) {
        const m = child as THREE.Mesh | THREE.Line;
        const base = (m.userData.baseOpacity as number) ?? 0.8;
        if ((m as THREE.Mesh).isMesh) {
          (m.material as THREE.MeshBasicMaterial).opacity = base * ratio;
        } else {
          (m.material as THREE.LineBasicMaterial).opacity = base * ratio;
        }
      }
    });
    this.fanWindFX = this.tick(this.fanWindFX, dt, (group, ratio) => {
      group.scale.multiplyScalar(1 + dt * 5);
      for (const child of group.children) {
        if ((child as THREE.Mesh).material) { ((child as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = 0.3 * ratio; }
      }
    });
    // ── R34 特殊武器溜め/ウルト tick ──
    this.banjinBladesFX = this.tick(this.banjinBladesFX, dt, (group, ratio) => {
      for (const child of group.children) {
        const base = (child.userData.baseOpacity as number) ?? 0.72;
        // EX-2: 残像尾は通常の半分の不透明度で早めにフェード
        const trailMul = child.userData.isTrail === true ? 0.5 : 1.0;
        ((child as THREE.Line).material as THREE.LineBasicMaterial).opacity = base * ratio * trailMul;
      }
      // EX-2: 終幕(ratio≈life<0.18s/0.8s=0.225)にshurikenMotionBlade×6を一度だけスポーン
      if (!(group.userData.burstFired as boolean) && ratio < 0.225) {
        group.userData.burstFired = true;
        const o = group.userData.origin as THREE.Vector3 | undefined;
        const d = group.userData.dir as THREE.Vector3 | undefined;
        if (o && d) {
          for (let sb = 0; sb < 6; sb++) {
            const a = (sb / 6) * Math.PI * 2;
            const sDir = d.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), a);
            this.shurikenMotionBlade(
              o.clone().add(new THREE.Vector3(Math.cos(a) * 2.0, 0.5, Math.sin(a) * 2.0)),
              sDir,
              0xddeeff,
            );
          }
        }
      }
    });
    this.gekkouArrowFX = this.tick(this.gekkouArrowFX, dt, (group, ratio) => {
      for (const child of group.children) {
        const base = (child.userData.baseOpacity as number) ?? 0.7;
        if ((child as THREE.Mesh).isMesh) {
          const mesh = child as THREE.Mesh;
          const target = mesh.userData.targetScale as number | undefined;
          if (target !== undefined) {
            const grown = target * (1 - ratio * ratio);
            mesh.scale.setScalar(Math.max(mesh.scale.x, grown));
          }
          (mesh.material as THREE.MeshBasicMaterial).opacity = base * ratio;
        } else {
          ((child as THREE.Line).material as THREE.LineBasicMaterial).opacity = base * ratio;
        }
      }
    });
    this.fujinWallFX = this.tick(this.fujinWallFX, dt, (group, ratio) => {
      const windDir = group.userData.windDir as THREE.Vector3 | undefined;
      for (const child of group.children) {
        const base = (child.userData.baseOpacity as number) ?? 0.30;
        if ((child as THREE.Mesh).isMesh) {
          const vel = child.userData.vel as THREE.Vector3 | undefined;
          if (vel) (child as THREE.Mesh).position.addScaledVector(vel, dt);
          ((child as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = base * ratio;
        } else {
          ((child as THREE.Line).material as THREE.LineBasicMaterial).opacity = base * ratio;
        }
      }
      if (windDir) group.position.addScaledVector(windDir, dt * 14);
    });
    this.gouenBlastFX = this.tick(this.gouenBlastFX, dt, (group, ratio) => {
      for (const child of group.children) {
        const base = (child.userData.baseOpacity as number) ?? 0.5;
        if ((child as THREE.Mesh).isMesh) {
          const mesh = child as THREE.Mesh;
          const target = mesh.userData.targetScale as number | undefined;
          if (target !== undefined) {
            const grown = target * (1 - ratio * ratio);
            mesh.scale.setScalar(Math.max(mesh.scale.x, grown));
          }
          const velY = mesh.userData.velY as number | undefined;
          if (velY !== undefined) {
            mesh.position.y += velY * dt;
            const age = 1 - ratio;
            (mesh.material as THREE.MeshBasicMaterial).opacity = base * Math.min(1, age * 5) * ratio;
          } else {
            (mesh.material as THREE.MeshBasicMaterial).opacity = base * ratio;
          }
        } else if ((child as THREE.Line).isLine !== undefined) {
          ((child as THREE.Line).material as THREE.LineBasicMaterial).opacity = base * ratio;
        }
      }
    });
    this.tenraiBoltFX = this.tick(this.tenraiBoltFX, dt, (group, _ratio) => {
      const age = ((group.userData.age as number) ?? 0) + dt;
      group.userData.age = age;
      const pending = group.userData.pendingBolts as Array<{ t: number; pos: THREE.Vector3; fired?: boolean }> | undefined;
      if (pending) {
        for (const bolt of pending) {
          if (!bolt.fired && age >= bolt.t) {
            bolt.fired = true;
            const top = bolt.pos.clone().add(new THREE.Vector3(
              (Math.random() - 0.5) * 4, 28 + Math.random() * 4, (Math.random() - 0.5) * 4,
            ));
            this.buildBranchBolt(top, bolt.pos, 3, false, 0.4);
            this.impactRing(bolt.pos, 0x44aaff);
          }
        }
      }
      // KE-5: 反転フラッシュスケジューラ
      if (group.userData.isFlashScheduler === true) {
        const timers = group.userData.stageTimers as number[];
        const fired = group.userData.stagesFired as boolean[];
        const maxR = (group.userData.maxR as number) ?? 32;
        for (let si = 0; si < timers.length; si++) {
          if (!fired[si] && age >= timers[si]!) {
            fired[si] = true;
            const flash = new THREE.Mesh(this.blastGeometry, new THREE.MeshBasicMaterial({
              color: 0xffffff, transparent: true, opacity: 0.72,
              blending: THREE.AdditiveBlending, depthWrite: false,
            }));
            flash.position.copy(group.position);
            flash.scale.setScalar(maxR * 0.5);
            flash.userData.targetScale = maxR * 1.2;
            this.scene.add(flash);
            this.blasts.push({ obj: flash, life: 0.15, maxLife: 0.15 });
          }
        }
      }
    });
    this.shinkirouSweepFX = this.tick(this.shinkirouSweepFX, dt, (group, ratio) => {
      const age = ((group.userData.age as number) ?? 0) + dt;
      group.userData.age = age;
      const originPt = group.userData.origin as THREE.Vector3 | undefined;
      const yawFrom = group.userData.yawFrom as number ?? 0;
      const yawTo = group.userData.yawTo as number ?? 0;
      const sweepS = group.userData.sweepS as number ?? 0.6;
      const reach = group.userData.reach as number ?? 50;
      const t = Math.min(1, age / sweepS);
      const curYaw = yawFrom + (yawTo - yawFrom) * t;
      const beamObj = group.getObjectByName('sweepBeam') as THREE.Line | undefined;
      if (beamObj && originPt) {
        const bPts = [originPt, originPt.clone().add(new THREE.Vector3(Math.cos(curYaw) * reach, 0, Math.sin(curYaw) * reach))];
        beamObj.geometry.setFromPoints(bPts);
        (beamObj.material as THREE.LineBasicMaterial).opacity = 0.88 * ratio;
      }
      for (let i = 1; i <= 3; i++) {
        const aftObj = group.getObjectByName(`aftBeam${i}`) as THREE.Line | undefined;
        if (aftObj && originPt) {
          const aftBase = (aftObj.userData.baseOpacity as number) ?? 0.22;
          (aftObj.material as THREE.LineBasicMaterial).opacity = aftBase * ratio;
          const aftYaw = curYaw - (yawTo - yawFrom) * i * 0.1;
          const aPts = [originPt, originPt.clone().add(new THREE.Vector3(Math.cos(aftYaw) * reach, 0, Math.sin(aftYaw) * reach))];
          aftObj.geometry.setFromPoints(aPts);
        }
      }
    });
    this.shuraRampageFX = this.tick(this.shuraRampageFX, dt, (group, ratio) => {
      for (const child of group.children) {
        const base = (child.userData.baseOpacity as number) ?? 0.7;
        if ((child as THREE.Mesh).isMesh) {
          const vel = child.userData.vel as THREE.Vector3 | undefined;
          if (vel) {
            vel.y -= 14 * dt;
            (child as THREE.Mesh).position.addScaledVector(vel, dt);
          }
          ((child as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = base * ratio;
        } else {
          ((child as THREE.Line).material as THREE.LineBasicMaterial).opacity = base * ratio;
        }
      }
    });
    this.banjinCloneFX = this.tick(this.banjinCloneFX, dt, (group, ratio) => {
      for (const child of group.children) {
        if (child instanceof THREE.Group) {
          const fadeIn = Math.min(1, (1 - ratio) * 4);
          for (const cc of child.children) {
            const base = (cc.userData.baseOpacity as number) ?? 0.6;
            if ((cc as THREE.Mesh).isMesh) {
              ((cc as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = base * fadeIn * ratio;
            } else {
              ((cc as THREE.Line).material as THREE.LineBasicMaterial).opacity = base * fadeIn * ratio;
            }
          }
        } else {
          const vel = child.userData.vel as THREE.Vector3 | undefined;
          if (vel) child.position.addScaledVector(vel, dt);
          const base = (child.userData.baseOpacity as number) ?? 0.8;
          ((child as THREE.Line).material as THREE.LineBasicMaterial).opacity = base * ratio;
        }
      }
    });
    this.gekkouMoonFX = this.tick(this.gekkouMoonFX, dt, (group, ratio) => {
      const floorY = group.userData.floorY as number ?? 0;
      for (const child of group.children) {
        const base = (child.userData.baseOpacity as number) ?? 0.7;
        if (child.userData.isMoon === true) {
          const moon = child as THREE.Mesh;
          if (!(group.userData.impactDone as boolean)) {
            moon.position.y -= (moon.userData.fallSpeed as number ?? 22) * dt;

            // EX-3: 落下中の空暗転パルス(y>floorY+22 と y>floorY+10 で各1回)
            if (!(moon.userData.darkPulseA as boolean) && moon.position.y <= floorY + 22) {
              moon.userData.darkPulseA = true;
              this.darkNova(moon.position.clone(), 4.0, 0.55);
            }
            if (!(moon.userData.darkPulseB as boolean) && moon.position.y <= floorY + 10) {
              moon.userData.darkPulseB = true;
              this.darkNova(moon.position.clone(), 6.0, 0.72);
            }

            // EX-3: 軌跡puff(0.08s毎)
            const trailTimer = ((moon.userData.trailTimer as number | undefined) ?? 0) + dt;
            moon.userData.trailTimer = trailTimer;
            if (trailTimer >= 0.08) {
              moon.userData.trailTimer = 0;
              const puffMat = new THREE.MeshBasicMaterial({
                color: 0xddeeff, transparent: true, opacity: 0.35, depthWrite: false,
              });
              const trailPuff = new THREE.Mesh(this.puffGeometry, puffMat);
              trailPuff.position.copy(moon.position);
              trailPuff.scale.setScalar(0.8 + Math.random() * 0.4);
              this.scene.add(trailPuff);
              this.blasts.push({ obj: trailPuff, life: 0.45, maxLife: 0.45 });
            }

            if (moon.position.y <= floorY + 0.5) {
              moon.position.y = floorY;
              group.userData.impactDone = true;
              // EX-3: 着弾時fissureGlow
              this.fissureGlow(moon.position.clone(), 14);
              for (const sib of group.children) {
                if (sib.userData.isNova === true || sib.userData.isCrater === true || sib.userData.delayShow === true) {
                  sib.visible = true;
                  if ((sib as THREE.Mesh).isMesh) {
                    ((sib as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = sib.userData.baseOpacity as number ?? 0.5;
                  }
                }
              }
            }
          }
          (moon.material as THREE.MeshBasicMaterial).opacity = base * Math.min(1, ratio * 5);
        } else if (child.userData.isNova === true) {
          const mesh = child as THREE.Mesh;
          const target = mesh.userData.targetScale as number ?? 30;
          mesh.scale.setScalar(Math.max(mesh.scale.x, target * (1 - ratio * ratio)));
          (mesh.material as THREE.MeshBasicMaterial).opacity = base * ratio;
        } else if (child.userData.isCrater === true) {
          ((child as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = base * ratio;
        } else if ((child as THREE.Line).isLine !== undefined) {
          ((child as THREE.Line).material as THREE.LineBasicMaterial).opacity = base * ratio;
        }
      }
    });
    this.fujinVortexFX = this.tick(this.fujinVortexFX, dt, (group, ratio) => {
      const spinRate = group.userData.spinRate as number ?? 1.8;
      group.rotation.y += spinRate * dt;
      for (const child of group.children) {
        const base = (child.userData.baseOpacity as number) ?? 0.26;
        if ((child as THREE.Mesh).isMesh) {
          ((child as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = base * ratio;
        } else {
          ((child as THREE.Line).material as THREE.LineBasicMaterial).opacity = base * ratio;
        }
      }
    });
    this.gouenCorridorFX = this.tick(this.gouenCorridorFX, dt, (group, ratio) => {
      const t = performance.now() / 1000;
      for (const child of group.children) {
        const base = (child.userData.baseOpacity as number) ?? 0.65;
        if (child.userData.fissure === true) {
          const flicker = 0.5 + Math.sin(t * 18 + child.position.x) * 0.5;
          ((child as THREE.Line).material as THREE.LineBasicMaterial).opacity = base * ratio * Math.max(0.15, flicker);
        } else {
          ((child as THREE.Line).material as THREE.LineBasicMaterial).opacity = base * ratio;
        }
      }
    });
    this.shinkirouMirageFX = this.tick(this.shinkirouMirageFX, dt, (group, ratio) => {
      const t = performance.now() / 1000;
      for (const child of group.children) {
        const base = (child.userData.baseOpacity as number) ?? 0.22;
        if (child.userData.isDistortRing === true) {
          const phi = child.userData.pulsePhi as number ?? 0;
          const pulse = 0.6 + 0.4 * Math.sin(t * 3.5 + phi);
          ((child as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = base * ratio * pulse;
          child.rotation.z += dt * 0.6;
        } else if (child.userData.isHeatPuff === true) {
          const ang = ((child.userData.swirlAngle as number) ?? 0) + ((child.userData.swirlOmega as number) ?? 0.5) * dt;
          child.userData.swirlAngle = ang;
          const r = child.userData.swirlR as number ?? 3;
          const cx = child.userData.swirlCx as number ?? 0;
          const cz = child.userData.swirlCz as number ?? 0;
          child.position.x = cx + Math.cos(ang) * r;
          child.position.z = cz + Math.sin(ang) * r;
          child.position.y += ((child.userData.swirlVelY as number) ?? 0) * dt;
          ((child as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = base * ratio;
        }
      }
    });
    this.shuraKourinFX = this.tick(this.shuraKourinFX, dt, (group, ratio) => {
      for (const child of group.children) {
        const base = (child.userData.baseOpacity as number) ?? 0.6;
        if ((child as THREE.Mesh).isMesh) {
          const vel = child.userData.vel as THREE.Vector3 | undefined;
          if (vel) {
            vel.y -= 9.8 * dt;
            (child as THREE.Mesh).position.addScaledVector(vel, dt);
          }
          ((child as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = base * ratio;
        } else {
          ((child as THREE.Line).material as THREE.LineBasicMaterial).opacity = base * ratio;
        }
      }
    });
    // ── R35 追加 tick ──
    // BE-1 黒帝煙マントル: 羽根フェードアウト+煙ブロブフェードイン→フェードアウト
    this.kokuteiMantleFX = this.tick(this.kokuteiMantleFX, dt, (group, ratio) => {
      const age = 1 - ratio;
      const fadeIn = Math.min(1, age * 6);
      for (const child of group.children) {
        const base = (child.userData.baseOpacity as number) ?? 0.65;
        if ((child as THREE.Mesh).isMesh) {
          if (child.userData.isSmoke === true) {
            const smokeFade = Math.min(1, age * 5) * ratio;
            ((child as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = 0.45 * smokeFade;
            (child as THREE.Mesh).scale.multiplyScalar(1 + dt * 0.6);
          } else {
            ((child as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = base * fadeIn * ratio;
          }
        }
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
    // R33 特殊武器エフェクト clear
    for (const list of [
      this.bowArrowFX as unknown as Timed<THREE.Object3D>[],
      this.staffBoltFX as unknown as Timed<THREE.Object3D>[],
      this.shurikenFX as unknown as Timed<THREE.Object3D>[],
      this.fanWindFX as unknown as Timed<THREE.Object3D>[],
    ]) {
      for (const item of list) this.disposeObject(item.obj);
      list.length = 0;
    }
    for (const item of this.beamLines) {
      item.obj.geometry.dispose();
      (item.obj.material as THREE.LineBasicMaterial).dispose();
      this.scene.remove(item.obj);
    }
    this.beamLines.length = 0;
    // R34 特殊武器溜め/ウルト clear
    for (const list of [
      this.banjinBladesFX as unknown as Timed<THREE.Object3D>[],
      this.gekkouArrowFX as unknown as Timed<THREE.Object3D>[],
      this.fujinWallFX as unknown as Timed<THREE.Object3D>[],
      this.gouenBlastFX as unknown as Timed<THREE.Object3D>[],
      this.tenraiBoltFX as unknown as Timed<THREE.Object3D>[],
      this.shinkirouSweepFX as unknown as Timed<THREE.Object3D>[],
      this.shuraRampageFX as unknown as Timed<THREE.Object3D>[],
      this.banjinCloneFX as unknown as Timed<THREE.Object3D>[],
      this.gekkouMoonFX as unknown as Timed<THREE.Object3D>[],
      this.fujinVortexFX as unknown as Timed<THREE.Object3D>[],
      this.gouenCorridorFX as unknown as Timed<THREE.Object3D>[],
      this.shinkirouMirageFX as unknown as Timed<THREE.Object3D>[],
      this.shuraKourinFX as unknown as Timed<THREE.Object3D>[],
      this.kokuteiMantleFX as unknown as Timed<THREE.Object3D>[],
    ]) {
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
