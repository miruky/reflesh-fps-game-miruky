// ゲームモードのルール定義と進行計算。描画・物理に依存しない
// 'story'=キャンペーン(目的駆動・scoreTarget無効) / 'score'=スコアアタック(時間内キル数)
export type GameMode = 'ffa' | 'tdm' | 'dom' | 'story' | 'score' | 'zombie' | 'hardpoint' | 'killconfirm' | 'gungame' | 'training' | 'snd' | 'ctf';

export type TeamId = number;

export const PLAYER_TEAM: TeamId = 0;
export const ENEMY_TEAM: TeamId = 1;

export interface ModeDef {
  id: GameMode;
  name: string;
  desc: string;
  teamBased: boolean;
  // 先取スコア。キル数または拠点ポイント
  scoreTarget: number;
}

export const MODE_DEFS: Record<GameMode, ModeDef> = {
  gungame: {
    id: 'gungame',
    name: 'ガンゲーム',
    desc: '全員が同じ26段武器ラダーを進む。特殊兵装枠(18-23段)を経て最終段(クナイ)でキルした者が勝者',
    teamBased: false,
    scoreTarget: 26, // ランク=スコアとして表示。実勝利はGunGameStateが管理
  },
  ffa: {
    id: 'ffa',
    name: 'フリーフォーオール',
    desc: '全員が敵。個人キルの先取で勝つ',
    teamBased: false,
    scoreTarget: 20,
  },
  tdm: {
    id: 'tdm',
    name: 'チームデスマッチ',
    desc: 'BOTと組んでキル数を競う',
    teamBased: true,
    scoreTarget: 40,
  },
  dom: {
    id: 'dom',
    name: 'ドミネーション',
    desc: '3拠点を制圧してポイントを稼ぐ',
    teamBased: true,
    scoreTarget: 150,
  },
  hardpoint: {
    id: 'hardpoint',
    name: 'ハードポイント',
    desc: '60秒ごとに移動する1区域を占拠してポイントを稼ぐ',
    teamBased: true,
    scoreTarget: 250,
  },
  killconfirm: {
    id: 'killconfirm',
    name: 'キルコンファーム',
    desc: '倒した敵のドッグタグを回収して初めてスコアになる',
    teamBased: true,
    scoreTarget: 6500,
  },
  snd: {
    id: 'snd',
    name: 'サーチ&デストロイ',
    desc: 'ノーリスポーンのラウンド制。攻撃側は爆弾を設置、守備側は解除を狙う。先取4ラウンドで4ラウンドごとに攻守交替',
    teamBased: true,
    scoreTarget: 4, // ラウンド先取数。実勝敗はSndMatchが管理
  },
  ctf: {
    id: 'ctf',
    name: 'キャプチャー・ザ・フラッグ',
    desc: '敵陣の旗を奪って自陣へ持ち帰る。自陣の旗が基地にある時だけキャプチャ成立。3本先取',
    teamBased: true,
    scoreTarget: 3, // キャプチャ先取数(CTF_CAPS_TO_WIN)。実勝敗はCtfStateが管理
  },
  story: {
    id: 'story',
    name: 'ストーリー',
    desc: 'キャンペーン。目的の達成で勝敗が決まる',
    teamBased: false,
    scoreTarget: Infinity, // 先取スコアは無効。勝敗は updateMission が決める
  },
  score: {
    id: 'score',
    name: 'スコアアタック',
    desc: '制限時間内のキル数で自己ベストを競う',
    teamBased: false,
    scoreTarget: Infinity, // 時間切れまで戦い、最終キル数で記録更新
  },
  zombie: {
    id: 'zombie',
    name: 'ゾンビ',
    desc: '銃を持たぬゾンビの無限ウェーブ。ラウンドごとに数と体力が増す',
    teamBased: false,
    scoreTarget: Infinity, // ラウンド制。ダウンするまで無限
  },
  training: {
    id: 'training',
    name: '訓練場',
    desc: '的当て専用の無制限練習場。スコア記録なし・無敵・ウルト即満タン',
    teamBased: false,
    scoreTarget: Infinity,
  },
};

// メニューで選べる対戦モード。'story' は専用UI、'zombie' は専用ラウンドUI。
// 'ctf' は純ロジックのみ実装済み(R54-F6)— match配線/旗ビジュアル/bot AI/HUDの完成時にここへ追加する
// (データ駆動メニューに未配線モードを出さないための意図的な保留)
export const MODE_IDS: GameMode[] = ['ffa', 'tdm', 'dom', 'hardpoint', 'killconfirm', 'snd', 'gungame', 'score', 'zombie', 'training'];

const CAPTURE_PER_S = 0.35;
const DECAY_PER_S = 0.2;
const MAX_CAPTURE_WEIGHT = 3;

export interface ZoneSnapshot {
  id: string;
  owner: TeamId | null;
  // 現在進行中の制圧の進み(0..1)と、進めているチーム
  progress: number;
  capturingTeam: TeamId | null;
  contested: boolean;
}

export type ZoneEvent = 'captured' | 'neutralized' | null;

// 1拠点の制圧状態機械。
// 中立から進捗1で制圧、所有中に敵が進捗1まで進めると中立化に戻す2段階制
export class Zone {
  owner: TeamId | null = null;
  progress = 0;
  capturingTeam: TeamId | null = null;
  contested = false;

  constructor(readonly id: string) {}

  // countsはチームごとの圏内人数。発生したイベントを返す
  update(dt: number, counts: ReadonlyMap<TeamId, number>): ZoneEvent {
    const present = [...counts.entries()].filter(([, n]) => n > 0);
    this.contested = present.length >= 2;

    if (present.length === 0 || this.contested) {
      // 無人・拮抗中は進捗がゆっくり戻る
      this.progress = Math.max(0, this.progress - DECAY_PER_S * dt);
      if (this.progress === 0) this.capturingTeam = null;
      return null;
    }

    const [team, count] = present[0]!;
    if (team === this.owner) {
      // 所有チームが居座れば敵の進捗を消す
      this.progress = Math.max(0, this.progress - CAPTURE_PER_S * dt * 2);
      if (this.progress === 0) this.capturingTeam = null;
      return null;
    }

    if (this.capturingTeam !== team) {
      // 進めていたチームと別のチームが入ったら進捗を奪い直す
      this.progress = Math.max(0, this.progress - CAPTURE_PER_S * dt * 2);
      if (this.progress === 0) this.capturingTeam = team;
      return null;
    }

    const weight = Math.min(count, MAX_CAPTURE_WEIGHT);
    this.progress += CAPTURE_PER_S * weight * dt;
    if (this.progress < 1) return null;

    this.progress = 0;
    if (this.owner === null) {
      this.owner = team;
      this.capturingTeam = null;
      return 'captured';
    }
    // 所有拠点はまず中立化される
    this.owner = null;
    this.capturingTeam = null;
    return 'neutralized';
  }

  snapshot(): ZoneSnapshot {
    return {
      id: this.id,
      owner: this.owner,
      progress: this.progress,
      capturingTeam: this.capturingTeam,
      contested: this.contested,
    };
  }
}

// ドミネーションの拠点群とポイント加算
export class DominationState {
  readonly zones: Zone[];
  private tickAccumulator = 0;

  constructor(zoneIds: string[] = ['A', 'B', 'C']) {
    this.zones = zoneIds.map((id) => new Zone(id));
  }

  // 戻り値は各チームへ加算するポイント。イベントはコールバックで通知する
  update(
    dt: number,
    presence: ReadonlyMap<string, ReadonlyMap<TeamId, number>>,
    onEvent?: (zone: Zone, event: Exclude<ZoneEvent, null>) => void,
  ): Map<TeamId, number> {
    for (const zone of this.zones) {
      const counts = presence.get(zone.id) ?? new Map<TeamId, number>();
      const event = zone.update(dt, counts);
      if (event && onEvent) onEvent(zone, event);
    }

    const points = new Map<TeamId, number>();
    this.tickAccumulator += dt;
    while (this.tickAccumulator >= 1) {
      this.tickAccumulator -= 1;
      for (const zone of this.zones) {
        if (zone.owner === null) continue;
        points.set(zone.owner, (points.get(zone.owner) ?? 0) + 1);
      }
    }
    return points;
  }
}

// ── ハードポイント: 1区域のローテーション管理とスコア計算 ─────────────────────────────
export const HP_ROTATION_S = 60;
export const HP_PREVIEW_S = 10;

export class HardpointState {
  private _zoneIndex = 0;
  private _timeInZone = 0;
  private _owner: TeamId | null = null;
  private _contested = false;
  private _tickAccumulator = 0;

  constructor(readonly zoneCount: number) {}

  get currentZoneIndex(): number { return this._zoneIndex; }
  get timeUntilRotation(): number { return HP_ROTATION_S - this._timeInZone; }

  /**
   * presence: zone内のチームごとの人数 (teamId -> count)
   * onRotate: ゾーンが切り替わった時に呼ばれる (from, to)
   * 戻り値: 各チームへ加算するポイント + rotated フラグ
   */
  update(
    dt: number,
    presence: ReadonlyMap<TeamId, number>,
    onRotate?: (from: number, to: number) => void,
  ): { points: Map<TeamId, number>; rotated: boolean } {
    const points = new Map<TeamId, number>();
    const present = [...presence.entries()].filter(([, n]) => n > 0);
    this._contested = present.length >= 2;

    // 1チームのみ在中 → そのチームが占拠
    if (!this._contested && present.length === 1) {
      this._owner = present[0]![0];
    }
    // 誰もいない or コンテストは owner をそのままにして得点させない

    // 1pt/s: 占拠中・非コンテスト時のみ。
    // V30修正: 無人ゾーンで前占拠チームが得点し続けないよう present>0 を必須に(BO2仕様)
    if (this._owner !== null && !this._contested && present.length > 0) {
      this._tickAccumulator += dt;
      while (this._tickAccumulator >= 1) {
        this._tickAccumulator -= 1;
        points.set(this._owner, (points.get(this._owner) ?? 0) + 1);
      }
    }

    // ゾーンローテーション
    this._timeInZone += dt;
    let rotated = false;
    if (this._timeInZone >= HP_ROTATION_S) {
      this._timeInZone -= HP_ROTATION_S;
      const from = this._zoneIndex;
      this._zoneIndex = (this._zoneIndex + 1) % this.zoneCount;
      this._owner = null;
      this._contested = false;
      this._tickAccumulator = 0;
      rotated = true;
      onRotate?.(from, this._zoneIndex);
    }

    return { points, rotated };
  }

  snapshot(): { zoneIndex: number; owner: TeamId | null; contested: boolean; timeUntilRotation: number } {
    return {
      zoneIndex: this._zoneIndex,
      owner: this._owner,
      contested: this._contested,
      timeUntilRotation: this.timeUntilRotation,
    };
  }
}

// ── キルコンファーム: ドッグタグのスポーン・回収・失効管理 ────────────────────────────
export const KC_TAG_LIFETIME_S = 30;
export const KC_PICKUP_RADIUS = 2.2;
export const KC_CONFIRM_PTS = 100;
export const KC_DENY_PTS = 25;

export interface DogTag {
  readonly id: number;
  readonly pos: { x: number; y: number; z: number };
  readonly deadTeam: TeamId;
  readonly spawnedAt: number; // elapsed game time (s)
}

export class KillConfirmState {
  private readonly tags: Array<DogTag & { collected: boolean }> = [];
  private _nextId = 0;

  /** 倒されたエンティティの位置にタグをスポーン。タグIDを返す */
  spawnTag(pos: { x: number; y: number; z: number }, deadTeam: TeamId, elapsed: number): number {
    const id = this._nextId++;
    this.tags.push({ id, pos: { ...pos }, deadTeam, spawnedAt: elapsed, collected: false });
    return id;
  }

  /**
   * collectorTeam がタグを拾えるか試みる。
   * 敵チームのタグ回収 → CONFIRM(+100), 味方タグ回収 → DENY(+25)
   */
  tryCollect(
    collectorTeam: TeamId,
    pos: { x: number; z: number },
  ): { id: number; event: 'confirm' | 'deny'; points: number } | null {
    for (const tag of this.tags) {
      if (tag.collected) continue;
      const dx = pos.x - tag.pos.x;
      const dz = pos.z - tag.pos.z;
      if (Math.hypot(dx, dz) > KC_PICKUP_RADIUS) continue;
      tag.collected = true;
      const event = collectorTeam !== tag.deadTeam ? 'confirm' : 'deny';
      return { id: tag.id, event, points: event === 'confirm' ? KC_CONFIRM_PTS : KC_DENY_PTS };
    }
    return null;
  }

  /** 期限切れ・回収済みタグを削除し、期限切れのIDリストを返す */
  pruneExpired(elapsed: number): number[] {
    const expired: number[] = [];
    for (let i = this.tags.length - 1; i >= 0; i--) {
      const tag = this.tags[i]!;
      if (tag.collected) { this.tags.splice(i, 1); continue; }
      if (elapsed - tag.spawnedAt >= KC_TAG_LIFETIME_S) {
        expired.push(tag.id);
        this.tags.splice(i, 1);
      }
    }
    return expired;
  }

  activeTags(): ReadonlyArray<DogTag> {
    return this.tags.filter((t) => !t.collected);
  }
}

// チームまたは個人のスコア台帳
export class ScoreBoard {
  private readonly scores = new Map<TeamId, number>();

  constructor(private readonly target: number) {}

  add(team: TeamId, amount: number): void {
    this.scores.set(team, (this.scores.get(team) ?? 0) + amount);
  }

  get(team: TeamId): number {
    return this.scores.get(team) ?? 0;
  }

  // 先取スコアに到達したチーム。未到達ならnull
  winner(): TeamId | null {
    for (const [team, score] of this.scores) {
      if (score >= this.target) return team;
    }
    return null;
  }

  leader(): TeamId | null {
    let best: TeamId | null = null;
    let bestScore = -Infinity;
    let tied = false;
    for (const [team, score] of this.scores) {
      if (score > bestScore) {
        best = team;
        bestScore = score;
        tied = false;
      } else if (score === bestScore) {
        tied = true;
      }
    }
    return tied ? null : best;
  }
}

// ── ガンゲーム: 26段武器ラダー(固定順。ステージ非依存) ──────────────────────────────
// ピストル→リボルバー→SG→SMG→AR→BR/LMG→マークスマン→スナイパー→特殊兵装(6種)→スナイパー2→ロケラン→クナイ(最終)
// rank18-23 が特殊兵装枠(exotic) ─ GG終盤の独自性を強調する
export const GG_LADDER: readonly string[] = [
  'kawasemi-pistol',  // rank  1: ピストル
  'taka-revolver',    // rank  2: リボルバー
  'hiiragi-sg',       // rank  3: ショットガン
  'raijin-sg',        // rank  4: ショットガン2
  'tsubaki-smg',      // rank  5: SMG
  'hayabusa-smg',     // rank  6: SMG2
  'enaga-pdw',        // rank  7: PDW
  'kaede-ar',         // rank  8: AR
  'kasasagi-ar',      // rank  9: AR2
  'akatsuki-ar',      // rank 10: AR3
  'shinonome-ar',     // rank 11: AR4
  'miyama-br',        // rank 12: BR
  'kumagera-lmg',     // rank 13: LMG
  'raitei-lmg',       // rank 14: LMG2
  'shirasagi-mk',     // rank 15: マークスマン
  'hibari-mk',        // rank 16: マークスマン2
  'yamasemi-dmr',     // rank 17: DSRスナイパー
  'gekkou-bow',       // rank 18: 月光弓(特殊兵装)
  'tenrai-staff',     // rank 19: 天雷杖(特殊兵装)
  'shinkirou-sniper', // rank 20: 蜃気楼スナイパー(特殊兵装)
  'shura-lmg',        // rank 21: 修羅LMG ミニガン(特殊兵装)
  'fujin-fan',        // rank 22: 藤神鉄扇(特殊兵装)
  'banjin-smg',       // rank 23: 万人SMG 手裏剣連射(特殊兵装)
  'raicho-sniper',    // rank 24: スナイパー2
  'gouka-rl',         // rank 25: 業火ロケットランチャー
  'fists',            // rank 26: クナイ(最終段・キルで勝利)
] as const;

// botのランクに応じたダメージ/連射パラメタ近似テーブル(tuning部分上書き用)
// 低ランクは弱く、高ランクは強くなるように線形スケール(26段対応)
export const GG_BOT_RANK_TUNING: readonly { damage: number; burstPauseMin: number; burstPauseMax: number }[] = [
  { damage:  7, burstPauseMin: 0.90, burstPauseMax: 1.40 }, // rank  1: pistol
  { damage:  9, burstPauseMin: 0.90, burstPauseMax: 1.40 }, // rank  2: revolver
  { damage:  9, burstPauseMin: 1.00, burstPauseMax: 1.50 }, // rank  3: sg
  { damage: 10, burstPauseMin: 0.90, burstPauseMax: 1.40 }, // rank  4: sg2
  { damage: 10, burstPauseMin: 0.55, burstPauseMax: 0.85 }, // rank  5: smg
  { damage: 11, burstPauseMin: 0.50, burstPauseMax: 0.80 }, // rank  6: smg2
  { damage: 11, burstPauseMin: 0.50, burstPauseMax: 0.75 }, // rank  7: pdw
  { damage: 12, burstPauseMin: 0.55, burstPauseMax: 0.85 }, // rank  8: ar
  { damage: 13, burstPauseMin: 0.50, burstPauseMax: 0.80 }, // rank  9: ar2
  { damage: 13, burstPauseMin: 0.50, burstPauseMax: 0.75 }, // rank 10: ar3
  { damage: 14, burstPauseMin: 0.45, burstPauseMax: 0.70 }, // rank 11: ar4
  { damage: 15, burstPauseMin: 0.50, burstPauseMax: 0.80 }, // rank 12: br
  { damage: 15, burstPauseMin: 0.55, burstPauseMax: 0.85 }, // rank 13: lmg
  { damage: 14, burstPauseMin: 0.50, burstPauseMax: 0.75 }, // rank 14: lmg2
  { damage: 16, burstPauseMin: 0.60, burstPauseMax: 0.90 }, // rank 15: marksman
  { damage: 17, burstPauseMin: 0.60, burstPauseMax: 0.90 }, // rank 16: marksman2
  { damage: 20, burstPauseMin: 1.00, burstPauseMax: 1.60 }, // rank 17: sniper(DSR)
  { damage: 18, burstPauseMin: 1.20, burstPauseMax: 1.80 }, // rank 18: gekkou-bow(弓)
  { damage: 19, burstPauseMin: 0.80, burstPauseMax: 1.20 }, // rank 19: tenrai-staff(杖)
  { damage: 26, burstPauseMin: 1.40, burstPauseMax: 2.00 }, // rank 20: shinkirou-sniper(ビーム)
  { damage: 16, burstPauseMin: 0.35, burstPauseMax: 0.55 }, // rank 21: shura-lmg(ミニガン)
  { damage: 17, burstPauseMin: 0.40, burstPauseMax: 0.60 }, // rank 22: fujin-fan(扇)
  { damage: 14, burstPauseMin: 0.30, burstPauseMax: 0.50 }, // rank 23: banjin-smg(手裏剣)
  { damage: 22, burstPauseMin: 1.00, burstPauseMax: 1.60 }, // rank 24: raicho-sniper
  { damage: 25, burstPauseMin: 1.80, burstPauseMax: 2.50 }, // rank 25: gouka-rl
  { damage: 30, burstPauseMin: 0.50, burstPauseMax: 0.70 }, // rank 26: fists(最終)
] as const;

// ── GunGameState: ランク進行の純ロジック(描画・物理に依存しない) ────────────────────
export class GunGameState {
  private playerRank = 1;
  private readonly botRanks = new Map<number, number>(); // bot.uid → rank(1-20)

  // ラダー武器IDを返す(rank は 1-26)
  getWeaponIdAt(rank: number): string {
    return GG_LADDER[Math.max(0, Math.min(25, rank - 1))] ?? 'fists';
  }

  getPlayerRank(): number { return this.playerRank; }
  getBotRank(uid: number): number { return this.botRanks.get(uid) ?? 1; }

  // プレイヤーがキルを取ったとき。返り値 isWin=true なら試合終了
  playerRankUp(): { newRank: number; isWin: boolean } {
    const wasAt26 = this.playerRank === 26;
    if (!wasAt26) this.playerRank += 1;
    return { newRank: this.playerRank, isWin: wasAt26 };
  }

  // 近接キルされたとき(BO2 setback): プレイヤーランク -1(最低1)
  playerRankDown(): number {
    if (this.playerRank > 1) this.playerRank -= 1;
    return this.playerRank;
  }

  // botがキルを取ったとき
  botRankUp(uid: number): { newRank: number; isWin: boolean } {
    const current = this.getBotRank(uid);
    const wasAt26 = current === 26;
    if (!wasAt26) this.botRanks.set(uid, current + 1);
    return { newRank: this.getBotRank(uid), isWin: wasAt26 };
  }

  // bot が近接キルされたとき: ランク -1(最低1)
  botRankDown(uid: number): number {
    const current = this.getBotRank(uid);
    const next = Math.max(1, current - 1);
    this.botRanks.set(uid, next);
    return next;
  }

  // 全 bot の中のトップランクを返す
  topBotRank(botUids: readonly number[]): number {
    let best = 0;
    for (const uid of botUids) best = Math.max(best, this.getBotRank(uid));
    return best;
  }
}

// ── TrainingStats: 訓練場モードの計測ロジック(描画・物理に依存しない) ────────────────
export class TrainingStats {
  private readonly dmgWindow: Array<{ t: number; dmg: number }> = [];
  /** セッション通算・発射数 */
  shotsFired = 0;
  /** セッション通算・命中数 */
  shotsHit = 0;
  /** セッション通算・HS数 */
  headshots = 0;
  /** 連続ヒット数(ミスでリセット) */
  consecutiveHits = 0;

  /** 被弾登録(直近3秒ウィンドウへ追加) */
  addDamage(elapsed: number, dmg: number): void {
    this.dmgWindow.push({ t: elapsed, dmg });
  }

  /** ミス発生(連続ヒットをリセット) */
  addMiss(): void {
    this.consecutiveHits = 0;
  }

  /** DPS を計算(elapsed は現在のゲーム経過秒) */
  dps(elapsed: number): number {
    const cutoff = elapsed - 3;
    let i = 0;
    while (i < this.dmgWindow.length && (this.dmgWindow[i]?.t ?? 0) < cutoff) i += 1;
    if (i > 0) this.dmgWindow.splice(0, i);
    const total = this.dmgWindow.reduce((s, e) => s + e.dmg, 0);
    return total / 3;
  }

  /** 命中率 0..1 */
  accuracy(): number {
    return this.shotsFired > 0 ? this.shotsHit / this.shotsFired : 0;
  }

  /** HS率 0..1 */
  hsRate(): number {
    return this.shotsHit > 0 ? this.headshots / this.shotsHit : 0;
  }
}

// ── CTF: 2旗の状態機械(R54-F6。純ロジック — 描画/物理/座標検知はmatch側) ──────────────
// 【match配線メモ(次スロットのオーナー向け)】
//  - 旗座標: S&Dサイトと同じdomゾーン係数の対角配置を推奨
//    (自陣旗 { x: -size*0.3, z: size*0.12 } / 敵陣旗 { x: size*0.3, z: -size*0.12 })。
//  - 接触検知: プレイヤー/botが旗座標へ CTF_PICKUP_RADIUS 以内に入った時、
//    「敵旗なら onPickup(自team, uid)、自旗なら onFlagTouch(自team, uid)」を毎tick呼ぶ
//    (両APIとも状態が合わない呼び出しはnullで無視するため、呼び側の条件分岐は距離だけでよい)。
//  - 死亡: killされたuidに対して onCarrierDeath(uid, pos) を呼ぶ(運んでいなければnull)。
//  - snapshot案: snapshot.ctf?: { mine: CtfFlagPhase; enemy: CtfFlagPhase;
//    carrierIsPlayer: boolean; score: [number, number] } — HUDは旗アイコン2個+スコアで足りる。
//  - bot AI: objectiveFor に「攻め=敵旗(base/dropped位置)→奪取後は自陣旗座標へ帰還、
//    守り=自旗の現在位置」の分岐を足す(hardpoint/sndObjectiveForと同じ構造)。
//  - プレイヤーのuidは-1(S&Dのキャリア慣例と同じ)。
export const CTF_CAPS_TO_WIN = 3;
export const CTF_RETURN_S = 20;
export const CTF_PICKUP_RADIUS = 2.2;

export type CtfFlagPhase = 'base' | 'carried' | 'dropped';

export interface CtfFlagSnapshot {
  team: TeamId; // この旗の所有チーム(=旗が立つ基地の側)
  phase: CtfFlagPhase;
  carrierUid: number | null;
  dropPos: { x: number; y: number; z: number } | null;
  returnInS: number; // dropped時の自動帰還までの残り秒(それ以外は0)
}

export type CtfEvent =
  | { kind: 'taken'; flagTeam: TeamId; byTeam: TeamId; byUid: number }
  | { kind: 'dropped'; flagTeam: TeamId; pos: { x: number; y: number; z: number } }
  | { kind: 'returned'; flagTeam: TeamId; how: 'touch' | 'timeout' }
  | { kind: 'captured'; team: TeamId; score: number; isWin: boolean };

interface CtfFlag {
  phase: CtfFlagPhase;
  carrierUid: number | null;
  dropPos: { x: number; y: number; z: number } | null;
  returnTimer: number;
}

export class CtfState {
  private readonly flags = new Map<TeamId, CtfFlag>();
  private readonly scores = new Map<TeamId, number>();
  private _winner: TeamId | null = null;

  constructor(readonly teams: readonly [TeamId, TeamId] = [PLAYER_TEAM, ENEMY_TEAM]) {
    for (const t of teams) {
      this.flags.set(t, { phase: 'base', carrierUid: null, dropPos: null, returnTimer: 0 });
      this.scores.set(t, 0);
    }
  }

  private enemyOf(team: TeamId): TeamId {
    return team === this.teams[0] ? this.teams[1] : this.teams[0];
  }

  /** dropped旗の自動帰還カウントダウン。発生イベントを返す(勝敗確定後は何もしない) */
  update(dt: number): CtfEvent[] {
    if (this._winner !== null) return [];
    const events: CtfEvent[] = [];
    for (const [team, flag] of this.flags) {
      if (flag.phase !== 'dropped') continue;
      flag.returnTimer -= dt;
      if (flag.returnTimer <= 0) {
        this.resetFlag(flag);
        events.push({ kind: 'returned', flagTeam: team, how: 'timeout' });
      }
    }
    return events;
  }

  /**
   * team の一員(uid)が「敵旗」に触れた: base/droppedなら奪取してcarried化。
   * すでに運搬中/勝敗確定後は null(呼び側は距離判定だけで毎tick呼んでよい)
   */
  onPickup(team: TeamId, uid: number): CtfEvent | null {
    if (this._winner !== null) return null;
    const flagTeam = this.enemyOf(team);
    const flag = this.flags.get(flagTeam);
    if (!flag || flag.phase === 'carried') return null;
    flag.phase = 'carried';
    flag.carrierUid = uid;
    flag.dropPos = null;
    flag.returnTimer = 0;
    return { kind: 'taken', flagTeam, byTeam: team, byUid: uid };
  }

  /**
   * team の一員(uid)が「自陣旗」に触れた:
   *  - 自旗がdropped → 即時帰還(味方タッチリターン)
   *  - 自旗がbase & uidが敵旗を運搬中 → キャプチャ(+1点、敵旗は基地へ戻る)。3本先取で勝利
   *  - それ以外(base&非運搬、carried=敵が持ち去り中) → null
   */
  onFlagTouch(team: TeamId, uid: number): CtfEvent | null {
    if (this._winner !== null) return null;
    const own = this.flags.get(team);
    if (!own) return null;
    if (own.phase === 'dropped') {
      this.resetFlag(own);
      return { kind: 'returned', flagTeam: team, how: 'touch' };
    }
    if (own.phase !== 'base') return null; // 自旗が奪われている間はキャプチャ不成立(CTFの基本則)
    const enemyFlag = this.flags.get(this.enemyOf(team));
    if (!enemyFlag || enemyFlag.phase !== 'carried' || enemyFlag.carrierUid !== uid) return null;
    this.resetFlag(enemyFlag);
    const score = (this.scores.get(team) ?? 0) + 1;
    this.scores.set(team, score);
    const isWin = score >= CTF_CAPS_TO_WIN;
    if (isWin) this._winner = team;
    return { kind: 'captured', team, score, isWin };
  }

  /** uid が死亡した: 運搬中の旗があれば pos へドロップし20秒の帰還タイマーを開始 */
  onCarrierDeath(uid: number, pos: { x: number; y: number; z: number }): CtfEvent | null {
    if (this._winner !== null) return null;
    for (const [team, flag] of this.flags) {
      if (flag.phase !== 'carried' || flag.carrierUid !== uid) continue;
      flag.phase = 'dropped';
      flag.carrierUid = null;
      flag.dropPos = { ...pos };
      flag.returnTimer = CTF_RETURN_S;
      return { kind: 'dropped', flagTeam: team, pos: { ...pos } };
    }
    return null;
  }

  /** uid が運搬中の旗の所有チーム(運搬していなければ null)。HUD/bot AI用 */
  carrying(uid: number): TeamId | null {
    for (const [team, flag] of this.flags) {
      if (flag.phase === 'carried' && flag.carrierUid === uid) return team;
    }
    return null;
  }

  score(team: TeamId): number {
    return this.scores.get(team) ?? 0;
  }

  winner(): TeamId | null {
    return this._winner;
  }

  flagPhase(team: TeamId): CtfFlagPhase {
    return this.flags.get(team)?.phase ?? 'base';
  }

  snapshot(): { flags: CtfFlagSnapshot[]; scores: Array<{ team: TeamId; score: number }>; winner: TeamId | null } {
    return {
      flags: [...this.flags.entries()].map(([team, f]) => ({
        team,
        phase: f.phase,
        carrierUid: f.carrierUid,
        dropPos: f.dropPos ? { ...f.dropPos } : null,
        returnInS: f.phase === 'dropped' ? Math.max(0, f.returnTimer) : 0,
      })),
      scores: [...this.scores.entries()].map(([team, score]) => ({ team, score })),
      winner: this._winner,
    };
  }

  private resetFlag(flag: CtfFlag): void {
    flag.phase = 'base';
    flag.carrierUid = null;
    flag.dropPos = null;
    flag.returnTimer = 0;
  }
}
