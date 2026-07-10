// ── R54-F3: StoryEngine — ストーリー/ミッション/S&D のモード進行エンジン ──
// match.ts から「移動のみ」で抽出(挙動変更ゼロ)。ミッション構築/objective進行/波/
// ボスフェーズ機/無線スケジューラ/S&Dラウンド配線の全状態を保持する。
// DI は StoryHost(遅延クロージャ)経由 — Match への逆参照・循環 import を持たない
// (逆辺は型 import のみ)。snapshot 供給は「Match が engine を読んで組む」方式
// (killcam.playing / zombie director と同じパターン)。
import * as THREE from 'three';
import { Bot, BOT_NAMES, tuningFor, type BotKind, type BotTier, type BotTuning } from './bot';
import type {
  BossPhase,
  EnemyWaveDef,
  MissionDef,
  ObjectiveDef,
  RadioLine,
  RadioSpeaker,
} from './campaign';
import {
  DARK_SLASH_MAX,
  DARK_SLASH_RADIUS,
  HOSTILE_SLASH_DAMAGE,
  PLAYER_NAME,
  splitRadioLines,
} from './match-helpers';

import type { MedalEvent } from './medals';
import type { MatchSummary, MissionSummary } from './progression';
import {
  isWithinSndSite,
  makeSndSites,
  SndMatch,
  SndRound,
  SND_FUSE_S,
  type SndSite,
} from './snd';
import { ENEMY_TEAM, PLAYER_TEAM, type TeamId } from './modes';
import { Player } from './player';
import { SoundKit } from '../core/audio';
import { Input } from '../core/input';
import { Effects } from '../render/effects';
import { MedalTracker } from './medals';
import { Weapon } from './weapons';
import type { TeamPalette } from './teamcolors';
import type { MatchConfig, FeedEntry } from './match-types';
import type { DarkSlashWave } from './match';

// 帝王編ボスのフェーズ挙動定数(match.ts から移設 — 使用者は本エンジンのみ)
const BOSS_BLINK_OFFSET_M = 6;
const BOSS_PILLAR_DAMAGE = 60;
const BOSS_PILLAR_RADIUS_M = 2.2;
// R54-F6: resupply波(chB歴戦の間)の小休止秒数 — 全滅確認→補給→この秒数後に次波
const WAVE_INTERMISSION_S = 8;

// R54 音響2: ストーリー章番号(chapterId='ch<N>')から「帝王の指紋」動機の重みを決める。
// ch1-3=0(訓練/序盤は素の曲)/ch4-6=0.4/ch7以降=0.8(終盤ほど動機が濃くなる)。
// 非ストーリー(mission未注入)・数値化できない特別章(chB等)は0=従来と同一。
// main.ts の launch() から sounds.setMusicProfile の第2引数として配線される
// (main.tsはWebGL/DOM依存でテスト不可のため、ここに純関数として置いてテストする)
export function motifWeightForMission(mission: MissionDef | null | undefined): number {
  const m = /^ch(\d+)/.exec(mission?.chapterId ?? '');
  const num = m ? Number(m[1]) : 0;
  if (num >= 7) return 0.8;
  if (num >= 4) return 0.4;
  return 0;
}

export interface StoryHost {
  readonly player: Player;
  readonly sounds: SoundKit;
  readonly bots: Bot[];
  readonly mission: MissionDef | null;
  readonly modifierSet: ReadonlySet<string>;
  readonly scene: THREE.Scene;
  readonly config: MatchConfig;
  readonly input: Input;
  readonly effects: Effects;
  readonly tracker: MedalTracker;
  readonly colors: TeamPalette;
  readonly botSpawns: THREE.Vector3[];
  readonly playerSpawns: THREE.Vector3[];
  readonly announcements: string[];
  readonly feed: FeedEntry[];
  readonly incoming: number[];
  readonly weapons: [Weapon, Weapon];
  readonly activeWeapon: Weapon;
  readonly streakManager: { resetAll(): void };
  readonly darkSlashWaves: DarkSlashWave[];
  ultCharge: number;
  ultReadyNotified: boolean;
  tookDamage: boolean;
  deathVeil: number;
  over: boolean;
  spawnBot(name: string, spawn: THREE.Vector3, color: number, team: number, tuning: BotTuning, tier: BotTier, kind?: BotKind): Bot;
  pickSpawn(candidates: THREE.Vector3[], enemies: THREE.Vector3[], occupants?: THREE.Vector3[]): THREE.Vector3;
  notePlayerDeath(killer?: Bot | null): void;
  aliveEnemyCount(): number;
  addShake(v: number): void;
  emitMedals(events: MedalEvent[]): void;
  refillGrenades(): void;
  incomingAngle(source: THREE.Vector3): number;
  disposeDarkSlashWave(w: DarkSlashWave): void;
  hostilesOf(team: TeamId): THREE.Vector3[];
}

export class StoryEngine {
  constructor(private readonly h: StoryHost) {}

  // ── 状態(match.ts の R6/R53-W2 フィールド帯を移設) ──
  missionOutcome: 'pending' | 'won' | 'lost' = 'pending';
  missionTimeS = 0; // ミッション経過秒(クリアタイム算定用)
  pendingWaves: EnemyWaveDef[] = [];
  waveIndex = 0; // 出現済みの波数
  missionKills = 0; // 敵撃破数(eliminate-count用)
  missionBossKills = 0; // ★V-B修正: boss tier撃破数(eliminate-count bossOnly=c10m5用)
  waveSpawnCursor = 0; // 波スポーン地点の巡回カーソル
  readonly exfilPos = new THREE.Vector3(); // extract目的の脱出地点
  exfilTimer = 0; // 脱出地点滞在秒
  // ── R53-W2 M2b: ストーリー帝王編エンジン(mission が無ければ未使用) ──
  radioQueue: RadioLine[] = []; // 未発火の無線(at.s / at.event 待ち)
  radioPending: Array<{ speaker: RadioSpeaker; text: string }> = []; // 発火済み表示待ち
  radioCurrent: { speaker: RadioSpeaker; text: string } | null = null;
  radioCurrentTimer = 0; // 現在行の表示残り秒(5s)
  radioGapTimer = 0; // 行間の間隔(1s)
  radioBossHp50Fired = false; // 'boss-hp50' イベントの単発ガード
  bossPhaseIdx = 0; // 消化済み bossPhases 数(snapshot.bossPhase.idx)
  bossPhaseRef: Bot | null = null; // フェーズ管理対象のボス(missionのboss)
  bossPhaseDefeatNoted = false; // クロガネ撃破音/メダルの単発ガード
  // R54-F6: グループ固有フェーズ(EnemyGroupDef.phases)の再アーム機構。
  // null=従来どおり MissionDef.bossPhases を参照(c10m6非回帰)。phases持ちボスが
  // spawnWave で出現すると armBossPhases() がここへ差し替え、フェーズ機を初期化する
  activeBossPhases: BossPhase[] | null = null;
  waveIntermission = 0; // resupply波の小休止残り秒(>0の間は次波を出さない)
  waveClearNoted = false; // 現在の先頭wave-clear波の「全滅確認済み」単発ガード(無線/補給の重複発火防止)
  bossSlashTimer = 0; // blackSlash フェーズ挙動の周期
  bossBlinkTimer = 0; // blink フェーズ挙動の周期
  bossPillarTimer = 0; // pillars フェーズ挙動の周期
  infiltrateReinforced = false; // infiltrate: 発覚増援は1回だけ
  missionCollected = 0; // collect: 回収済み数
  collectItems: Array<{ pos: THREE.Vector3; mesh: THREE.Mesh }> = [];
  escortBot: Bot | null = null; // escort: 護衛対象(team=PLAYER_TEAM)
  escortGoal: THREE.Vector3 | null = null; // escort: 最終到達点
  // ── R53-W2 M2b: S&D状態(mode==='snd' 以外は未使用) ──
  sndMatch: SndMatch | null = null;
  sndRound: SndRound | null = null;
  sndSites: [SndSite, SndSite] | null = null;
  sndPlantedSite: SndSite | null = null; // 設置されたサイト(bomb位置の基準)
  sndHoldSite: SndSite | null = null; // プレイヤーが現在ホールド中のサイト
  sndPlayerHolding: 'plant' | 'defuse' | null = null; // プレイヤー自身のホールド種
  sndBotHolding = false; // bot が設置/解除ホールド中(プレイヤーと排他: キャリア/最寄り解除者)
  sndBombDropPos: THREE.Vector3 | null = null; // ドロップ中のボム位置(null=所持中/未使用)
  sndBombMesh: THREE.Mesh | null = null; // ドロップ/設置ボムの可視化
  sndPlantTickTimer = 0; // 設置ビープの周期
  sndFuseTickTimer = 0; // ヒューズ鼓動の周期
  private sndStemPlanted = false; // R54 音響2: setBgmStem('snd-planted')のエッジ検出用

  // ══ R53-W2 M2b: Search & Destroy 配線 ══════════════════════════════════
  // 重ロジック(フェーズ機/先取/交替)は snd.ts の SndRound/SndMatch。match は
  // 座標・入力・生死・音・snapshot の接着だけを行う(薄配線原則)。

  // サイトA/B: ドミネーションのA/C拠点と同じ係数の対角配置(全31ステージで実績のある安全座標)
  buildSndSites(): void {
    const size = this.h.config.stage.size;
    this.sndSites = makeSndSites(
      { x: -size * 0.3, z: size * 0.12 },
      { x: size * 0.3, z: -size * 0.12 },
    );
    for (const site of this.sndSites) {
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(site.radius - 0.35, site.radius, 36),
        new THREE.MeshBasicMaterial({
          color: 0xffb066,
          transparent: true,
          opacity: 0.6,
          side: THREE.DoubleSide,
          depthWrite: false,
        }),
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(site.center.x, 0.06, site.center.z);
      this.h.scene.add(ring);
      this.sndSiteRings.push(ring);
    }
  }
  sndSiteRings: THREE.Mesh[] = [];

  // ラウンド開始(first=試合開始時は初期配置をそのまま使う)。
  // 2ラウンド目以降は全員をチームスポーンへ再配置+復活+補給
  startSndRound(first: boolean): void {
    if (!this.sndMatch) return;
    this.sndRound = new SndRound(this.sndMatch.currentAttackTeam);
    this.sndPlantedSite = null;
    this.sndHoldSite = null;
    this.sndPlayerHolding = null;
    this.sndBotHolding = false;
    this.sndBombDropPos = null;
    this.disposeSndBombMesh();
    this.sndPlantTickTimer = 0;
    this.sndFuseTickTimer = 0;
    // キャリア割当: プレイヤーが攻撃側なら常にプレイヤー(uid=-1)。
    // (シンプル化の設計判断: bot任せの受動的なラウンドを作らない=プレイヤーが主役)
    const attack = this.sndRound.attackTeam;
    if (attack === PLAYER_TEAM) {
      this.sndRound.pickupBomb(-1);
    } else {
      const carrier = this.h.bots.find((b) => b.team === attack);
      if (carrier) this.sndRound.pickupBomb(carrier.uid);
    }
    // ★V-B修正: ラウンド頭はウルト/ストリークをリセット(BO2 S&D準拠 — ラウンド跨ぎの
    // 持ち越しはラウンド制の緊張感を壊す。初回ラウンドも同じ初期状態から)
    this.h.ultCharge = 0;
    this.h.ultReadyNotified = false;
    this.h.streakManager.resetAll();
    if (!first) {
      // 全員復活+再配置(kill/deathの数字は維持=S&Dの通算スタッツ)
      const reserved: THREE.Vector3[] = [];
      const sp = this.h.pickSpawn(this.h.playerSpawns, [], reserved);
      this.h.player.respawnAt(sp);
      reserved.push(sp);
      for (const weapon of this.h.weapons) weapon.resupply();
      this.h.activeWeapon.raise();
      this.h.refillGrenades();
      for (const bot of this.h.bots) {
        const spawns = bot.team === PLAYER_TEAM ? this.h.playerSpawns : this.h.botSpawns;
        const bsp = this.h.pickSpawn(spawns, [], reserved);
        bot.respawnAt(bsp);
        reserved.push(bsp);
      }
      this.h.deathVeil = Math.max(this.h.deathVeil, 0.5); // ラウンド替わりの短い暗転
    }
    this.h.announcements.push(
      attack === PLAYER_TEAM ? '攻撃側: 爆弾を設置せよ' : '防衛側: サイトを死守せよ',
    );
  }

  disposeSndBombMesh(): void {
    if (!this.sndBombMesh) return;
    this.h.scene.remove(this.sndBombMesh);
    this.sndBombMesh.geometry.dispose();
    (this.sndBombMesh.material as THREE.Material).dispose();
    this.sndBombMesh = null;
  }

  // ボム可視化(ドロップ中=地面の発光箱 / 設置後=サイトの点滅箱)
  showSndBombMesh(pos: THREE.Vector3, planted: boolean): void {
    this.disposeSndBombMesh();
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.4, 0.26, 0.3),
      new THREE.MeshStandardMaterial({
        color: 0x20242c,
        emissive: planted ? 0xff3020 : 0xffb066,
        emissiveIntensity: 0.55,
      }),
    );
    mesh.position.set(pos.x, pos.y + 0.15, pos.z);
    this.h.scene.add(mesh);
    this.sndBombMesh = mesh;
  }

  // プレイヤー/botの所属が攻撃側か
  sndIsAttacker(team: TeamId): boolean {
    return this.sndRound?.attackTeam === team;
  }

  updateSnd(dt: number): void {
    const round = this.sndRound;
    const sndMatch = this.sndMatch;
    if (!round || !sndMatch || !this.sndSites) return;

    // R54 音響2: 設置中は排他BGMステムへ(エッジ検出のみ呼ぶ=毎tickの無駄なランプ再スケジュールを避ける)
    const planted = round.phase === 'planted';
    if (planted !== this.sndStemPlanted) {
      this.sndStemPlanted = planted;
      this.h.sounds.setBgmStem(planted ? 'snd-planted' : null);
    }

    // ノーリスポーン: 死亡者の復活カウントダウンを毎tick凍結(roundEnd中も=次ラウンド側で復活させる)
    if (!this.h.player.alive) this.h.player.respawnIn = Infinity;
    for (const b of this.h.bots) {
      if (!b.alive) b.respawnIn = Infinity;
    }

    // ── キャリア死亡→ドロップ/拾得 ──
    if (round.phase === 'live') {
      if (round.carrierUid === -1 && !this.h.player.alive && this.sndBombDropPos === null) {
        this.sndBombDropPos = this.h.player.position.clone();
        round.dropBomb();
        this.showSndBombMesh(this.sndBombDropPos, false);
        this.h.announcements.push('爆弾がドロップした');
        this.h.sounds.sndBombDrop(); // W4D: 緊張の要所の情報音
      } else if (round.carrierUid !== null && round.carrierUid >= 0) {
        const carrier = this.h.bots.find((b) => b.uid === round.carrierUid);
        if (carrier && !carrier.alive && this.sndBombDropPos === null) {
          this.sndBombDropPos = carrier.position.clone();
          round.dropBomb();
          this.showSndBombMesh(this.sndBombDropPos, false);
          this.h.sounds.sndBombDrop();
        }
      }
      // 拾得(攻撃側のみ、1.6m)
      if (this.sndBombDropPos !== null && round.carrierUid === null) {
        if (
          this.sndIsAttacker(PLAYER_TEAM) &&
          this.h.player.alive &&
          this.h.player.position.distanceTo(this.sndBombDropPos) < 1.6
        ) {
          round.pickupBomb(-1);
          this.sndBombDropPos = null;
          this.disposeSndBombMesh();
          this.h.sounds.sndBombPickup();
        } else {
          for (const b of this.h.bots) {
            if (!b.alive || !this.sndIsAttacker(b.team)) continue;
            if (b.position.distanceTo(this.sndBombDropPos) < 1.6) {
              round.pickupBomb(b.uid);
              this.sndBombDropPos = null;
              this.disposeSndBombMesh();
              this.h.sounds.sndBombPickup();
              break;
            }
          }
        }
      }
    }

    // ── プレイヤーの設置/解除ホールド(E長押し。毎tick再判定→継続しないならcancel) ──
    this.sndPlayerHolding = null;
    const holdE = this.h.player.alive && this.h.input.isDown('interact');
    if (round.phase === 'live' && round.carrierUid === -1 && holdE) {
      const site = this.sndSites.find((s) => isWithinSndSite(s, this.h.player.position));
      if (site) {
        this.sndHoldSite = site;
        round.beginPlant();
        this.sndPlayerHolding = 'plant';
        this.sndPlantTickTimer -= dt;
        if (this.sndPlantTickTimer <= 0) {
          this.sndPlantTickTimer = Math.max(0.12, 0.4 * (1 - round.plantProgress01));
          this.h.sounds.sndPlantTick();
        }
      } else if (round.isPlanting) round.cancelPlant();
    } else if (round.isPlanting && !this.sndBotHolding) {
      round.cancelPlant();
    }
    if (round.phase === 'planted' && !this.sndIsAttacker(PLAYER_TEAM) && holdE && this.sndPlantedSite) {
      if (isWithinSndSite(this.sndPlantedSite, this.h.player.position)) {
        round.beginDefuse();
        this.sndPlayerHolding = 'defuse';
      } else if (round.isDefusing && !this.sndBotHolding) round.cancelDefuse();
    } else if (round.phase === 'planted' && round.isDefusing && !this.sndBotHolding) {
      // プレイヤーがこのtickで defuse を開始していない(上の分岐に入らなかった)かつ
      // botも前tickで保持していない → 中断(botの保持は直後のブロックで毎tick再判定される)
      round.cancelDefuse();
    }

    // ── botの自動設置/解除(キャリアbot・最寄り守備bot。プレイヤーと同時には起きない=排他) ──
    this.sndBotHolding = false;
    if (round.phase === 'live' && round.carrierUid !== null && round.carrierUid >= 0) {
      const carrier = this.h.bots.find((b) => b.uid === round.carrierUid);
      if (carrier?.alive) {
        const site = this.sndSites.find((s) => isWithinSndSite(s, carrier.position));
        if (site) {
          this.sndHoldSite = site;
          round.beginPlant();
          this.sndBotHolding = true;
        } else if (round.isPlanting && this.sndPlayerHolding !== 'plant') {
          round.cancelPlant();
        }
      }
    }
    if (round.phase === 'planted' && this.sndPlantedSite && this.sndIsAttacker(PLAYER_TEAM)) {
      // プレイヤーが攻撃側のとき、守備botが解除を試みる
      const defuser = this.h.bots.find(
        (b) => b.alive && !this.sndIsAttacker(b.team) && isWithinSndSite(this.sndPlantedSite!, b.position),
      );
      if (defuser) {
        round.beginDefuse();
        this.sndBotHolding = true;
      } else if (round.isDefusing && this.sndPlayerHolding !== 'defuse') {
        round.cancelDefuse();
      }
    }

    // ── ヒューズ鼓動(planted中、残時間で加速) ──
    if (round.phase === 'planted') {
      const urgency = 1 - round.phaseTimeLeft / SND_FUSE_S;
      this.sndFuseTickTimer -= dt;
      if (this.sndFuseTickTimer <= 0) {
        this.sndFuseTickTimer = THREE.MathUtils.lerp(1.2, 0.25, urgency);
        this.h.sounds.sndFuseTick(urgency);
      }
    }

    // ── フェーズ機の進行+イベント処理 ──
    const events = round.update(dt);
    for (const ev of events) {
      if (ev.kind === 'planted') {
        this.sndPlantedSite = this.sndHoldSite ?? this.sndSites[0];
        const c = this.sndPlantedSite.center;
        this.showSndBombMesh(new THREE.Vector3(c.x, 0, c.z), true);
        this.h.sounds.sndPlanted();
        this.h.announcements.push(`爆弾設置: ${this.sndPlantedSite.id}サイト`);
      } else if (ev.kind === 'defused') {
        this.h.sounds.sndDefused();
        this.disposeSndBombMesh();
      } else if (ev.kind === 'detonate') {
        this.h.sounds.sndDetonate();
        if (this.sndPlantedSite) {
          const c = this.sndPlantedSite.center;
          const pos = new THREE.Vector3(c.x, 0.5, c.z);
          this.h.effects.explosion(pos, 8);
          this.h.addShake(0.5);
          // 起爆の巻き込み(演出込みの実害: 半径12m)
          if (this.h.player.alive && this.h.player.position.distanceTo(pos) < 12) {
            const died = this.h.player.takeDamage(160);
            if (died) {
              this.h.feed.push({ killer: '爆弾', victim: PLAYER_NAME, weapon: '起爆', headshot: false });
              this.h.sounds.death();
              this.h.notePlayerDeath(null);
            }
          }
        }
        this.disposeSndBombMesh();
      } else if (ev.kind === 'round-win') {
        this.handleSndRoundWin(ev.winner, ev.reason === 'defenders-dead' || ev.reason === 'attackers-dead');
      }
    }

    // ── 全滅判定(update後=同tickの死亡を反映。planted中の攻撃側全滅はsnd.tsが継続を保証) ──
    if (!round.isResolved) {
      const attackAlive = this.sndTeamAliveCount(round.attackTeam);
      const defendAlive = this.sndTeamAliveCount(round.defendTeam);
      if (attackAlive === 0) {
        const winner = round.resolveRound('attackers-dead');
        if (winner !== null) this.handleSndRoundWin(winner, true);
      } else if (defendAlive === 0) {
        const winner = round.resolveRound('defenders-dead');
        if (winner !== null) this.handleSndRoundWin(winner, true);
      }
    }

    // ── ラウンド終了→次ラウンド or 試合終了 ──
    if (round.phase === 'roundEnd' && round.phaseTimeLeft <= 0) {
      if (sndMatch.matchWinner() !== null) {
        this.h.over = true;
      } else {
        this.startSndRound(false);
      }
    }
  }

  sndTeamAliveCount(team: TeamId): number {
    let n = 0;
    if (team === PLAYER_TEAM && this.h.player.alive) n += 1;
    for (const b of this.h.bots) if (b.alive && b.team === team) n += 1;
    return n;
  }

  handleSndRoundWin(winner: TeamId, byWipe: boolean): void {
    if (!this.sndMatch || !this.sndRound) return;
    this.sndMatch.recordRound(winner);
    const won = winner === PLAYER_TEAM;
    this.h.sounds.sndRoundWin(won);
    this.h.announcements.push(won ? 'ラウンド勝利' : 'ラウンド敗北');
    // snd-ace: 自チームの全滅勝ち(1ラウンド全滅勝利)でプレイヤーが生存していた場合
    if (won && byWipe && this.h.player.alive) {
      const out: MedalEvent[] = [];
      this.h.tracker.emitManual('snd-ace', out);
      this.h.emitMedals(out);
    }
  }


  setupMission(mission: MissionDef): void {
    if (this.h.modifierSet.has('dense-fog') && this.h.scene.fog instanceof THREE.FogExp2) {
      // R13: 濃霧modifierも「意図的な霧」に留める。係数2.6/上限0.12は白飛びしすぎるため緩和
      this.h.scene.fog.density = Math.min(0.07, this.h.scene.fog.density * 1.6 + 0.01);
    }
    // 脱出地点(extract用): プレイヤー初期位置から最も遠い隅
    const start = this.h.playerSpawns[0] ?? new THREE.Vector3();
    let far = start;
    let farD = -Infinity;
    for (const c of [...this.h.playerSpawns, ...this.h.botSpawns]) {
      const d = c.distanceTo(start);
      if (d > farD) {
        farD = d;
        far = c;
      }
    }
    this.exfilPos.copy(far);
    // 脱出ミッションは到達地点を発光ビーコンで可視化する(目的地が分からない問題の解消)
    if (mission.objective.kind === 'extract') {
      const beacon = new THREE.Mesh(
        new THREE.CylinderGeometry(0.7, 0.7, 14, 14, 1, true),
        new THREE.MeshBasicMaterial({
          color: 0x35ffa0,
          transparent: true,
          opacity: 0.32,
          side: THREE.DoubleSide,
          depthWrite: false,
        }),
      );
      beacon.position.set(this.exfilPos.x, 7, this.exfilPos.z);
      this.h.scene.add(beacon);
    }
    // 防衛/生存ミッションは固定タレット2基を敵陣側へ据え「守りを崩す」画を作る。
    // 座標は障害物クリアランス済みのbotSpawnsから選ぶ(箱に埋まって撃破不能を防ぐ)
    if (mission.objective.kind === 'defend' || mission.objective.kind === 'survive') {
      const spots = [this.h.botSpawns[0], this.h.botSpawns[2]];
      for (const p of spots) {
        if (!p) continue;
        this.h.spawnBot(
          'ヤグラ砲台',
          p,
          this.h.colors.enemy,
          ENEMY_TEAM,
          tuningFor('elite', mission.difficulty),
          'elite',
          'turret',
        );
      }
    }
    // ── R53-W2 M2b: 新objective 3種の初期化 ──
    if (mission.objective.kind === 'infiltrate') {
      // 到達点=最遠隅(exfilPosを流用)。青いビーコンで可視化(extractの緑と区別)
      const beacon = new THREE.Mesh(
        new THREE.CylinderGeometry(0.7, 0.7, 14, 14, 1, true),
        new THREE.MeshBasicMaterial({
          color: 0x35a0ff,
          transparent: true,
          opacity: 0.3,
          side: THREE.DoubleSide,
          depthWrite: false,
        }),
      );
      beacon.position.set(this.exfilPos.x, 7, this.exfilPos.z);
      this.h.scene.add(beacon);
    }
    if (mission.objective.kind === 'escort') {
      // 護衛対象: プレイヤー側の随伴機。中央経由で最遠隅へ歩かせる
      const start = this.h.playerSpawns[1] ?? this.h.playerSpawns[0] ?? new THREE.Vector3();
      const ally = this.h.spawnBot(
        '随伴機ホタル',
        start.clone(),
        this.h.colors.ally,
        PLAYER_TEAM,
        tuningFor('elite', 'normal'),
        'elite',
        'humanoid',
      );
      const mid = new THREE.Vector3(0, 0, 0);
      this.escortGoal = this.exfilPos.clone();
      ally.escortWaypoints = [mid, this.escortGoal.clone()];
      this.escortBot = ally;
    }
    if (mission.objective.kind === 'collect') {
      // 回収物: botSpawns から散らばった N 点(障害物クリアランス済み座標)に発光オクタを置く
      const n = mission.objective.count ?? 3;
      for (let i = 0; i < n; i += 1) {
        const base = this.h.botSpawns[(i * 2 + 1) % this.h.botSpawns.length] ?? new THREE.Vector3();
        const mesh = new THREE.Mesh(
          new THREE.OctahedronGeometry(0.34),
          new THREE.MeshStandardMaterial({
            color: 0x223344,
            emissive: 0x35d0ff,
            emissiveIntensity: 0.5,
          }),
        );
        mesh.position.set(base.x, 1.1, base.z);
        this.h.scene.add(mesh);
        this.collectItems.push({ pos: new THREE.Vector3(base.x, 1.1, base.z), mesh });
      }
    }
    // ── R53-W2 M2b: 無線劇のロード。at.event==='start' はここで即時キューへ ──
    this.radioQueue = (mission.radio ?? []).slice();
    this.fireRadioEvent('start');
    this.pendingWaves = mission.waves.slice();
    this.advanceWaves();
  }

  // trigger を解釈して出せる波を出す。start=即時 / timer=delayS到達 / wave-clear=敵全滅。
  // start波は連続して全部出し、時限/殲滅波は1tickにつき1波だけ出す。
  advanceWaves(): void {
    while (this.pendingWaves.length > 0) {
      const wave = this.pendingWaves[0]!;
      let ready: boolean;
      if (wave.trigger === 'start') ready = true;
      else if (wave.trigger === 'timer') ready = this.missionTimeS >= (wave.delayS ?? 0);
      else if (wave.trigger === 'boss-hp') {
        // R53-W2 M2b: ボスHPが閾値以下になった瞬間に発火(ch10ボスラッシュ等)。
        // ボス不在(未出現)の間は待機、ボス死亡後(bossHp01=undefined)は即発火して波を詰まらせない
        const hp01 = this.bossHp01();
        ready = hp01 === undefined ? !this.h.bots.some((b) => b.tier === 'boss' && b.alive) && this.waveIndex > 0 : hp01 <= (wave.triggerHp01 ?? 0.5);
      } else {
        // 'wave-clear': 全滅確認は1回だけ処理(waveClearNotedガード)。resupply波は
        // 全滅確認と同時に完全補給し、8秒の小休止が明けてから出す(R54-F6 chB歴戦の間)。
        // 非resupply波は従来どおり即時(waveIntermissionは0のまま=ready即true)
        const cleared = this.h.aliveEnemyCount() === 0;
        if (cleared && !this.waveClearNoted) {
          this.waveClearNoted = true;
          this.fireRadioEvent('wave-clear');
          if (wave.resupply) {
            this.waveIntermission = WAVE_INTERMISSION_S;
            this.grantWaveResupply();
          }
        }
        ready = cleared && this.waveIntermission <= 0;
      }
      if (!ready) break;
      this.pendingWaves.shift();
      this.waveClearNoted = false; // 次のwave-clear波のためにガードを解除
      this.spawnWave(wave);
      this.waveIndex += 1;
      if (wave.announce) this.h.announcements.push(wave.announce);
      if (wave.trigger !== 'start') break;
    }
  }

  spawnWave(wave: EnemyWaveDef): void {
    const swarm = this.h.modifierSet.has('elite-swarm');
    let n = 0;
    for (const group of wave.enemies) {
      // elite-swarm: 通常兵を精鋭に格上げして圧を上げる
      const tier: BotTier = swarm && group.tier === 'normal' ? 'elite' : group.tier;
      for (let i = 0; i < group.count; i += 1) {
        const cursor = this.waveSpawnCursor;
        const baseSpawn = this.h.botSpawns[cursor % this.h.botSpawns.length] ?? new THREE.Vector3();
        // スポーン点数を超えたら同座標重なりを避けてリング状にずらす
        // A1-F04: ステージ外に出ないよう ±(size/2-5) にクランプ
        const wrap = Math.floor(cursor / this.h.botSpawns.length);
        const halfSize = (this.h.config.stage.size ?? 100) / 2 - 5;
        const spawn =
          wrap > 0
            ? new THREE.Vector3(
                THREE.MathUtils.clamp(baseSpawn.x + Math.cos(cursor * 1.7) * 2.5 * wrap, -halfSize, halfSize),
                baseSpawn.y,
                THREE.MathUtils.clamp(baseSpawn.z + Math.sin(cursor * 1.7) * 2.5 * wrap, -halfSize, halfSize),
              )
            : baseSpawn;
        this.waveSpawnCursor += 1;
        // 機体種: データ指定を優先。ボスの既定は章の物語に合わせる
        // (機械系の章=戦車、人型の教官/亡霊/砲主=人型、終章CINDERコア=大型ドローン)。
        // 「第2章以降の通常兵は3体に1体が偵察ドローン」で戦場の画を多様化する
        let kind: BotKind = group.kind ?? 'humanoid';
        if (!group.kind) {
          if (tier === 'boss') {
            const ch = this.h.mission?.chapterId ?? '';
            kind = ch === 'ch8' ? 'drone' : ch === 'ch1' || ch === 'ch3' || ch === 'ch4' ? 'humanoid' : 'tank';
          } else if (
            tier === 'normal' &&
            (this.h.mission?.chapterId ?? 'ch1') !== 'ch1' &&
            i % 3 === 2
          ) {
            kind = 'drone';
          }
        }
        // R54-F6: グループ固有名(chB 6連戦の個体名)> objective.bossName > 'BOSS'
        const name =
          tier === 'boss'
            ? (group.name ?? this.h.mission?.objective.bossName ?? 'BOSS')
            : kind === 'drone'
              ? `ドローン-${n + 1}`
              : (BOT_NAMES[n % BOT_NAMES.length] ?? `EN-${n}`);
        // ★W4B: 章ボスのHP倍率(EnemyGroupDef.hpMul)。tuning.maxHpへ乗算しておけば
        // spawnBot内のboss床 max(merged.maxHp, tuning.maxHp) が乗算後の値を採用する
        const waveTuning = tuningFor(tier, group.difficulty);
        if (group.hpMul !== undefined && group.hpMul !== 1) {
          waveTuning.maxHp = Math.round(waveTuning.maxHp * group.hpMul);
        }
        const spawned = this.h.spawnBot(
          name,
          spawn,
          this.h.colors.enemy,
          ENEMY_TEAM,
          waveTuning,
          tier,
          kind,
        );
        // R54-W1 Q4: story帝王編の燼骸(kind='zombie')は少数編成が設計意図のため、群衆間引き
        // LOD(既定hordeRank=99=最遠扱い)を外し常時フル精度で描画する。zombieモード本編は
        // updateZombieHordeRank が0.25s周期で上書きするため対象外(spawnWave専用の初期値上書き)
        if (kind === 'zombie') spawned.hordeRank = 0;
        // R54-F6: グループ固有のbossPhases(chB歴戦の間)。phases持ちボスの出現で
        // フェーズ機を再アームする(1ミッション内で複数のフェーズ戦を順に成立させる)
        if (tier === 'boss' && group.phases && group.phases.length > 0) {
          this.armBossPhases(spawned, group.phases);
        }
        n += 1;
      }
    }
  }

  // R54-F6: フェーズ機の再アーム — 対象ボスとフェーズ表を差し替え、進行状態を全初期化する。
  // MissionDef.bossPhases(c10m6)は activeBossPhases が null の間だけ参照されるため非回帰
  armBossPhases(boss: Bot, phases: BossPhase[]): void {
    this.activeBossPhases = phases;
    this.bossPhaseRef = boss;
    this.bossPhaseIdx = 0;
    this.bossPhaseDefeatNoted = false;
    this.bossSlashTimer = 0;
    this.bossBlinkTimer = 0;
    this.bossPillarTimer = 0;
  }

  // R54-F6: resupply波の完全補給 — 弾薬/グレネード/HPを満量へ(chB歴戦の間の連戦テンポ)。
  // 確保ジングル(capture)は既存資産の流用で「一区切り」の手応えを出す
  grantWaveResupply(): void {
    for (const weapon of this.h.weapons) weapon.resupply();
    this.h.refillGrenades();
    this.h.player.hp = this.h.player.maxHp;
    this.h.sounds.capture();
    this.h.announcements.push(`補給完了 — ${WAVE_INTERMISSION_S}秒後、次の敵が来る`);
  }

  // 目的の進行・勝敗判定(update の先取スコア判定の代わりに呼ぶ)
  updateMission(dt: number): void {
    const m = this.h.mission;
    if (!m || this.missionOutcome !== 'pending') return;
    this.missionTimeS += dt;
    // R54-F6: resupply波の小休止カウントダウン(advanceWavesが参照)
    if (this.waveIntermission > 0) this.waveIntermission = Math.max(0, this.waveIntermission - dt);
    if (this.h.modifierSet.has('one-life') && !this.h.player.alive) {
      this.missionOutcome = 'lost';
      return;
    }
    this.advanceWaves();
    const obj = m.objective;
    const allClear = this.h.aliveEnemyCount() === 0 && this.pendingWaves.length === 0;
    switch (obj.kind) {
      case 'eliminate-all':
        if (allClear) this.missionOutcome = 'won';
        break;
      case 'eliminate-count':
        if (this.missionEliminateCount(obj) >= (obj.count ?? 1)) this.missionOutcome = 'won';
        break;
      case 'assassinate':
        if (this.pendingWaves.length === 0 && !this.h.bots.some((b) => b.alive && b.tier === 'boss')) {
          this.missionOutcome = 'won';
        }
        break;
      case 'survive':
      case 'defend':
        if (this.missionTimeS >= (obj.surviveS ?? m.durationS)) this.missionOutcome = 'won';
        break;
      case 'extract': {
        const near = this.h.player.alive && this.h.player.position.distanceTo(this.exfilPos) < 4;
        this.exfilTimer = near ? this.exfilTimer + dt : 0;
        if (this.exfilTimer >= 3) this.missionOutcome = 'won';
        break;
      }
      // ── R53-W2 M2b: 新objective 3種 ──
      case 'infiltrate': {
        // 到達点(exfilPos流用)へ到達で達成。発覚(SPOTTED)は即敗北ではなく増援1回(親切設計)
        if (this.h.player.alive && this.h.player.position.distanceTo(this.exfilPos) < 4) {
          this.missionOutcome = 'won';
        }
        if (!this.infiltrateReinforced && this.maxEnemySpotAwareness() >= 0.9) {
          this.infiltrateReinforced = true;
          this.h.announcements.push('発覚: 増援接近');
          this.spawnWave({
            trigger: 'start',
            enemies: [{ tier: 'normal', count: 3, difficulty: m.difficulty }],
          });
        }
        break;
      }
      case 'escort': {
        const ally = this.escortBot;
        if (!ally || !ally.alive) {
          this.missionOutcome = 'lost';
          break;
        }
        if (this.escortGoal && ally.position.distanceTo(this.escortGoal) < 3.5) {
          this.missionOutcome = 'won';
        }
        break;
      }
      case 'collect': {
        if (this.missionCollected >= (obj.count ?? this.collectItems.length + this.missionCollected)) {
          this.missionOutcome = 'won';
        }
        break;
      }
    }
    // R53-W2 M2b: ストーリー帝王編の毎tick進行(無線/ボスフェーズ/回収物の見た目)
    this.updateStoryEngine(dt);
    if (this.missionOutcome === 'won') this.onMissionWon();
  }

  // R53-W2 M2b: 敵bot(ENEMY_TEAM)の最大発見メータ(infiltrateのdetect01供給)
  maxEnemySpotAwareness(): number {
    let max = 0;
    for (const b of this.h.bots) {
      if (!b.alive || b.team === PLAYER_TEAM) continue;
      if (b.spotAwareness > max) max = b.spotAwareness;
    }
    return Math.min(1, max);
  }

  // R53-W2 M2b: 勝利確定時の単発処理(章クリアメダル+objective-done無線)。
  // updateMission は outcome!=='pending' で以後早期returnするため、この関数は勝利遷移の
  // まさにそのtickに1回だけ呼ばれる
  onMissionWon(): void {
    this.fireRadioEvent('objective-done');
    const id = this.h.mission?.id ?? '';
    // 章最終ミッションのクリア=章制覇メダル(報酬カモ/称号はprogression側が自動処理)。
    // emitManual→emitMedals はPaPと同じ流儀(XP/バッジ/アナウンスの既存経路に乗せる)
    if (id.startsWith('c9m6') || id.startsWith('c10m6')) {
      const out: MedalEvent[] = [];
      this.h.tracker.emitManual(id.startsWith('c9m6') ? 'ch9-clear' : 'ch10-clear', out);
      this.h.emitMedals(out);
    }
    // R54-F6: chB「歴戦の間」クリア=歴戦メダル。par(300s)以内なら神速メダルも同時発火
    if (id.startsWith('cbm1')) {
      const out: MedalEvent[] = [];
      this.h.tracker.emitManual('boss-rush-clear', out);
      if (this.missionTimeS <= (this.h.mission?.parTimeS ?? 300)) {
        this.h.tracker.emitManual('boss-rush-ace', out);
      }
      this.h.emitMedals(out);
    }
  }

  // 目的の表示文言と進捗(HUD用)
  // ★V-B MEDIUM修正: eliminate-countの実カウント。bossOnly(c10m5ボスラッシュ)は護衛elite等の
  // 巻き込みキルで早期達成しないよう boss tier撃破のみを数える。既定=従来の総キル
  missionEliminateCount(obj: ObjectiveDef): number {
    return obj.bossOnly ? this.missionBossKills : this.missionKills;
  }

  objectiveText(): string {
    const m = this.h.mission;
    if (!m) return '';
    const obj = m.objective;
    if (obj.kind === 'eliminate-count')
      return `${obj.label} (${this.missionEliminateCount(obj)}/${obj.count ?? 0})`;
    if (obj.kind === 'survive' || obj.kind === 'defend') {
      const left = Math.max(0, Math.ceil((obj.surviveS ?? m.durationS) - this.missionTimeS));
      return `${obj.label} (残り${left}s)`;
    }
    if (obj.kind === 'extract' && this.exfilTimer > 0) return `${obj.label} (確保 ${this.exfilTimer.toFixed(1)}s/3s)`;
    // R53-W2 M2b: 新objective 3種の進捗文言
    if (obj.kind === 'collect') return `${obj.label} (${this.missionCollected}/${obj.count ?? 0})`;
    if (obj.kind === 'infiltrate' && this.maxEnemySpotAwareness() >= 0.9) return `${obj.label} 【発覚】`;
    if (obj.kind === 'escort' && this.escortBot) {
      const hp01 = Math.max(0, Math.ceil((this.escortBot.hp / this.escortBot.maxHp) * 100));
      return `${obj.label} (随伴機 ${hp01}%)`;
    }
    return obj.label;
  }

  objectiveProgress01(): number {
    const m = this.h.mission;
    if (!m) return 0;
    const obj = m.objective;
    if (obj.kind === 'eliminate-count' && obj.count)
      return Math.min(1, this.missionEliminateCount(obj) / obj.count);
    if (obj.kind === 'survive' || obj.kind === 'defend') {
      return Math.min(1, this.missionTimeS / (obj.surviveS ?? m.durationS));
    }
    if (obj.kind === 'extract') return Math.min(1, this.exfilTimer / 3);
    // R53-W2 M2b: 新objective 3種の進捗
    if (obj.kind === 'collect' && obj.count) return Math.min(1, this.missionCollected / obj.count);
    if (obj.kind === 'infiltrate') {
      // 到達距離ベース(開始点=最初のプレイヤースポーンからexfilまでを1とする近似)
      const start = this.h.playerSpawns[0];
      if (!start) return 0;
      const total = start.distanceTo(this.exfilPos);
      const left = this.h.player.position.distanceTo(this.exfilPos);
      return total > 0 ? THREE.MathUtils.clamp(1 - left / total, 0, 1) : 0;
    }
    if (obj.kind === 'escort' && this.escortBot && this.escortGoal) {
      const start = this.h.playerSpawns[1] ?? this.h.playerSpawns[0];
      if (!start) return 0;
      const total = start.distanceTo(this.escortGoal);
      const left = this.escortBot.position.distanceTo(this.escortGoal);
      return total > 0 ? THREE.MathUtils.clamp(1 - left / total, 0, 1) : 0;
    }
    if (obj.kind === 'assassinate') {
      const boss = this.h.bots.find((b) => b.tier === 'boss');
      return boss ? 1 - boss.hp / boss.maxHp : this.missionOutcome === 'won' ? 1 : 0;
    }
    // eliminate-all: 倒した割合(おおまかな指標)
    const totalSpawned = this.h.bots.length;
    const dead = this.h.bots.filter((b) => !b.alive).length;
    return totalSpawned > 0 ? dead / totalSpawned : 0;
  }

  bossHp01(): number | undefined {
    const boss = this.h.bots.find((b) => b.tier === 'boss' && b.alive);
    return boss ? boss.hp / boss.maxHp : undefined;
  }

  // R54 音響2: 台本化されたボスフェーズ機(activeBossPhases/mission.bossPhases)が
  // 稼働中かつ対象ボスが生存しているか。単発bossなし(assassinate等)はfalse=通常の物語動機のまま
  bossPhasesActive(): boolean {
    const phases = this.activeBossPhases ?? this.h.mission?.bossPhases;
    if (!phases || phases.length === 0) return false;
    const boss =
      this.bossPhaseRef && this.h.bots.includes(this.bossPhaseRef)
        ? this.bossPhaseRef
        : (this.h.bots.find((b) => b.tier === 'boss') ?? null);
    return !!boss && boss.alive;
  }

  // ══ R53-W2 M2b: ストーリー帝王編エンジン ═══════════════════════════════
  // updateMission から毎tick呼ばれる(mission確定時のみ)。無線劇・ボスフェーズ・回収物の
  // 「進行」だけを担い、重いロジック(台本/フェーズ定義)は campaign.ts のデータ、
  // 挙動プリミティブ(applyBossPhase/blinkTo等)は bot.ts の公開APIに委譲する薄い配線。
  updateStoryEngine(dt: number): void {
    this.updateRadio(dt);
    this.updateBossPhases(dt);
    // R54 音響2: 排他BGMステム。bossPhases活性中は決闘曲、それ以外は目的進行度で強まる物語動機
    if (this.bossPhasesActive()) {
      this.h.sounds.setBgmStem('boss-duel');
    } else {
      this.h.sounds.setBgmStem('story-motif', this.objectiveProgress01());
    }
    // 回収物の回転(視認性)。ダメージ等は持たない演出のみ
    for (const item of this.collectItems) item.mesh.rotation.y += dt * 1.8;
    // collectのEインタラクト(ゾンビEと同じキー。storyではケアパッケージと共存 — 距離判定が排他)
    if (
      this.h.mission?.objective.kind === 'collect' &&
      this.h.player.alive &&
      this.h.input.wasPressed('interact')
    ) {
      const pp = this.h.player.position;
      for (let i = this.collectItems.length - 1; i >= 0; i -= 1) {
        const item = this.collectItems[i]!;
        if (pp.distanceTo(item.pos) > 2.2) continue;
        this.h.scene.remove(item.mesh);
        item.mesh.geometry.dispose();
        (item.mesh.material as THREE.Material).dispose();
        this.collectItems.splice(i, 1);
        this.missionCollected += 1;
        this.h.sounds.capture(); // 既存の確保ジングルを流用(回収の手応え)
        this.h.announcements.push(`回収 ${this.missionCollected}/${this.h.mission.objective.count ?? 0}`);
        break;
      }
    }
  }

  // 無線イベント発火: 該当する未発火行を表示待ちキューへ移す(データ順を維持)
  fireRadioEvent(event: 'start' | 'boss-hp50' | 'wave-clear' | 'objective-done'): void {
    if (this.radioQueue.length === 0) return;
    const { fired, rest } = splitRadioLines(this.radioQueue, { event });
    for (const line of fired) this.radioPending.push({ speaker: line.speaker, text: line.text });
    this.radioQueue = rest;
  }

  updateRadio(dt: number): void {
    // 時刻トリガーの行を表示待ちへ
    if (this.radioQueue.length > 0) {
      const { fired, rest } = splitRadioLines(this.radioQueue, { timeS: this.missionTimeS });
      for (const line of fired) this.radioPending.push({ speaker: line.speaker, text: line.text });
      this.radioQueue = rest;
    }
    // boss-hp50 イベント(単発)
    if (!this.radioBossHp50Fired) {
      const hp01 = this.bossHp01();
      if (hp01 !== undefined && hp01 <= 0.5) {
        this.radioBossHp50Fired = true;
        this.fireRadioEvent('boss-hp50');
      }
    }
    // 表示中の行の寿命
    if (this.radioCurrent) {
      this.radioCurrentTimer -= dt;
      if (this.radioCurrentTimer <= 0) {
        this.radioCurrent = null;
        this.radioGapTimer = 1; // 行間1s
      }
      return;
    }
    if (this.radioGapTimer > 0) {
      this.radioGapTimer -= dt;
      return;
    }
    // 次の行を表示+発話(TTS無効環境でも字幕は snapshot.radioLine で必ず出る)
    const next = this.radioPending.shift();
    if (next) {
      this.radioCurrent = next;
      this.radioCurrentTimer = 5;
      this.h.sounds.radioSpeak(next.speaker, next.text);
    }
  }

  // ボスフェーズ: HP閾値通過で campaign.ts の bossPhases を順に適用し、
  // アクティブなフェーズ挙動(blackSlash/blink/pillars)を周期実行する
  updateBossPhases(dt: number): void {
    // R54-F6: グループ固有フェーズ(armBossPhases済み)を優先、無ければ従来の
    // ミッション単位 bossPhases(c10m6)— どちらも無ければフェーズ機は眠ったまま
    const phases = this.activeBossPhases ?? this.h.mission?.bossPhases;
    if (!phases || phases.length === 0) return;
    // ボス参照の解決(未出現→出現の遷移を拾う)
    if (!this.bossPhaseRef || !this.h.bots.includes(this.bossPhaseRef)) {
      this.bossPhaseRef = this.h.bots.find((b) => b.tier === 'boss') ?? null;
    }
    const boss = this.bossPhaseRef;
    if (!boss) return;
    // R54-F6: クロガネ演出(フェーズスティング/終焉音)は個体名でも判定する
    // (chB「歴戦の間」最終戦=黒雷帝クロガネ・再来でも同じ演出を鳴らす)。
    // 討伐メダル kurogane-slayer は c10m6 限定(初出の物語文脈を保つ)
    const missionId = this.h.mission?.id ?? '';
    const isKurogane = missionId.startsWith('c10m6') || boss.name.includes('クロガネ');
    // 撃破検知(単発): クロガネなら専用の終焉音+メダル
    if (!boss.alive) {
      if (!this.bossPhaseDefeatNoted) {
        this.bossPhaseDefeatNoted = true;
        if (isKurogane) {
          this.h.sounds.kuroganeDefeat();
          if (missionId.startsWith('c10m6')) {
            const out: MedalEvent[] = [];
            this.h.tracker.emitManual('kurogane-slayer', out);
            this.h.emitMedals(out);
          }
        }
      }
      return;
    }
    // フェーズ遷移(hp01降順データ。1tickに1段のみ=多段同時通過でも順に演出される)
    const hp01 = boss.hp / boss.maxHp;
    const next = phases[this.bossPhaseIdx];
    if (next && hp01 <= next.hp01) {
      this.bossPhaseIdx += 1;
      this.applyBossPhaseTransition(boss, next, isKurogane);
    }
    // アクティブフェーズ挙動
    const flags = boss.bossPhaseFlags;
    if (flags.blackSlash) {
      this.bossSlashTimer -= dt;
      if (this.bossSlashTimer <= 0 && this.h.player.alive && boss.alive) {
        this.bossSlashTimer = 4;
        this.spawnHostileBossSlash(boss);
      }
    }
    if (flags.blink) {
      this.bossBlinkTimer -= dt;
      if (this.bossBlinkTimer <= 0 && this.h.player.alive) {
        this.bossBlinkTimer = 6.5;
        // プレイヤー側面へ転移(左右は交互ではなくヨー基準の右側=読み合いの余地を残す)
        const yaw = this.h.player.yaw;
        const px = this.h.player.position.x + Math.cos(yaw) * BOSS_BLINK_OFFSET_M;
        const pz = this.h.player.position.z - Math.sin(yaw) * BOSS_BLINK_OFFSET_M;
        this.h.effects.darkSlashSmoke(boss.position.clone()); // 出発点の残煙
        boss.blinkTo(px, boss.position.y, pz);
        this.h.effects.darkSlashSmoke(new THREE.Vector3(px, boss.position.y, pz));
        this.h.sounds.darkSlash();
      }
    }
    if (flags.pillars) {
      this.bossPillarTimer -= dt;
      if (this.bossPillarTimer <= 0 && this.h.player.alive) {
        this.bossPillarTimer = 5;
        // プレイヤー近傍±3mへ黒雷柱(既存キル柱FXの流用)。直下回避の猶予がある小AoE
        const ang = Math.random() * Math.PI * 2;
        const r = Math.random() * 3;
        const pos = new THREE.Vector3(
          this.h.player.position.x + Math.cos(ang) * r,
          this.h.player.position.y,
          this.h.player.position.z + Math.sin(ang) * r,
        );
        this.h.effects.kokuraiteiKillColumn(pos);
        const d = this.h.player.position.distanceTo(pos);
        if (d < BOSS_PILLAR_RADIUS_M && this.h.player.alive) {
          const died = this.h.player.takeDamage(BOSS_PILLAR_DAMAGE);
          this.h.tookDamage = true;
          this.h.incoming.push(this.h.incomingAngle(pos));
          this.h.sounds.hurt();
          this.h.tracker.onPlayerDamaged();
          if (died) {
            this.h.feed.push({ killer: boss.name, victim: PLAYER_NAME, weapon: '黒雷柱', headshot: false });
            this.h.sounds.death();
            this.h.notePlayerDeath(boss);
          }
        }
      }
    }
  }

  applyBossPhaseTransition(boss: Bot, phase: BossPhase, isKurogane: boolean): void {
    boss.applyBossPhase(phase.speedMul, phase.damageMul);
    boss.setBossPhaseFlags({
      blackSlash: phase.blackSlash ?? false,
      blink: phase.blink ?? false,
      pillars: phase.pillars ?? false,
    });
    if (phase.announce) this.h.announcements.push(phase.announce);
    // クロガネ専用: フェーズ2/3のスティング(bossPhaseIdxは遷移後の段数=2段目→2)
    if (isKurogane && (this.bossPhaseIdx === 2 || this.bossPhaseIdx === 3)) {
      this.h.sounds.kuroganePhase(this.bossPhaseIdx as 2 | 3);
    }
    // 増援召喚(章の絵に合わせ humanoid。少数=フェーズの脅威はボス本体が主役)
    const summon = phase.summonCount ?? 0;
    for (let i = 0; i < summon; i += 1) {
      const spawn = this.h.botSpawns[(this.waveSpawnCursor + i) % this.h.botSpawns.length];
      if (!spawn) continue;
      this.h.spawnBot(
        `增援-${i + 1}`,
        spawn.clone(),
        this.h.colors.enemy,
        ENEMY_TEAM,
        tuningFor('normal', this.h.mission?.difficulty ?? 'normal'),
        'normal',
        'humanoid',
      );
    }
    this.waveSpawnCursor += summon;
    // フェーズ遷移の画: ボス足元に柱1本(演出のみ、ダメージなし)
    this.h.effects.kokuraiteiKillColumn(boss.position.clone());
    this.h.addShake(0.3);
  }

  // ボスの敵対黒斬撃: プレイヤーの現在位置へ向けて水平発射(既存の黒帝斬撃資産を敵起点で流用)
  spawnHostileBossSlash(boss: Bot): void {
    const origin = boss.position.clone();
    origin.y += 1.5;
    const dir = this.h.player.position.clone().sub(origin);
    dir.y = 0;
    if (dir.lengthSq() < 0.01) return;
    dir.normalize();
    if (this.h.darkSlashWaves.length >= DARK_SLASH_MAX) {
      const oldest = this.h.darkSlashWaves.shift()!;
      this.h.disposeDarkSlashWave(oldest);
    }
    const group = this.h.effects.darkSlashWave(origin, dir, 0);
    this.h.darkSlashWaves.push({
      group,
      pos: origin,
      dir,
      traveled: 0,
      hitSet: new Set(),
      smokeTimer: 0,
      hitRadius: DARK_SLASH_RADIUS,
      hostile: true,
      hitPlayer: false,
      hostileOwnerName: boss.name,
      // ボスフェーズの damageMul は「基準34×現フェーズ倍率」で反映(bot.tuning.damageは近接用)。
      // R54-F6: フェーズ表の参照元はupdateBossPhasesと同じ優先順(グループ固有→ミッション単位)
      dmgOverride: Math.round(
        HOSTILE_SLASH_DAMAGE *
          ((this.activeBossPhases ?? this.h.mission?.bossPhases)?.[this.bossPhaseIdx - 1]?.damageMul ?? 1),
      ),
    });
    this.h.sounds.darkSlash();
  }


  // R53-W2 M2b: S&D 初期化(初回攻撃側はプレイヤーチーム=BO2の先攻)
  initSnd(): void {
    this.sndMatch = new SndMatch(PLAYER_TEAM);
    this.buildSndSites();
    this.startSndRound(true);
  }

  // R53-W2 M2b: S&D — bot AI目標(攻撃側=サイト/ドロップボム、守備側=警戒/解除)。
  // undefined = S&D非アクティブ(呼び出し側objectiveForは他モードの判定へフォールスルー)
  sndObjectiveFor(bot: Bot): THREE.Vector3 | undefined {
    if (!this.sndRound || !this.sndSites) return undefined;
    const round = this.sndRound;
      const siteVec = (s: SndSite): THREE.Vector3 => new THREE.Vector3(s.center.x, 0, s.center.z);
      if (this.sndIsAttacker(bot.team)) {
        // ボムがドロップ中なら最寄り攻撃botが回収に向かう
        if (this.sndBombDropPos !== null && round.carrierUid === null) {
          return this.sndBombDropPos.clone();
        }
        if (round.phase === 'planted' && this.sndPlantedSite) {
          return siteVec(this.sndPlantedSite); // 設置後は守り
        }
        // キャリアは最寄りサイトへ、他は uid で A/B に分散して支援
        if (round.carrierUid === bot.uid) {
          const a = this.sndSites[0];
          const b = this.sndSites[1];
          const da = bot.position.distanceTo(siteVec(a));
          const db = bot.position.distanceTo(siteVec(b));
          return siteVec(da <= db ? a : b);
        }
        return siteVec(this.sndSites[bot.uid % 2 === 0 ? 0 : 1]);
      }
      // 守備側
      if (round.phase === 'planted' && this.sndPlantedSite) {
        return siteVec(this.sndPlantedSite); // 解除へ向かう
      }
      return siteVec(this.sndSites[bot.uid % 2 === 0 ? 0 : 1]); // A/B分散警戒
  }

  // ストーリー時のミッション要約(applyCampaignMission へ渡す)。base = Match.result().summary
  missionSummary(base: MatchSummary): MissionSummary {
    const mission = this.h.mission!;
    const won = this.missionOutcome === 'won';
    return {
      ...base,
      rated: false,
      won,
      missionId: mission.id,
      chapterId: mission.chapterId,
      missionWon: won,
      timeS: this.missionTimeS,
      objectiveMet: won,
      modifiers: mission.modifiers,
    };
  }

  // 試合 dispose: 回収物/S&Dボム/サイトリング/無線状態を解放(match.dispose と同一の操作)
  dispose(): void {
    for (const item of this.collectItems) {
      this.h.scene.remove(item.mesh);
      item.mesh.geometry.dispose();
      (item.mesh.material as THREE.Material).dispose();
    }
    this.collectItems = [];
    this.disposeSndBombMesh();
    for (const ring of this.sndSiteRings) {
      this.h.scene.remove(ring);
      ring.geometry.dispose();
      (ring.material as THREE.Material).dispose();
    }
    this.sndSiteRings = [];
    this.radioQueue = [];
    this.radioPending = [];
    this.radioCurrent = null;
  }
}
