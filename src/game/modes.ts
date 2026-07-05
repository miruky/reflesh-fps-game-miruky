// ゲームモードのルール定義と進行計算。描画・物理に依存しない
// 'story'=キャンペーン(目的駆動・scoreTarget無効) / 'score'=スコアアタック(時間内キル数)
export type GameMode = 'ffa' | 'tdm' | 'dom' | 'story' | 'score' | 'zombie' | 'hardpoint' | 'killconfirm' | 'gungame' | 'training';

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
    desc: '全員が同じ20段武器ラダーを進む。最終段(クナイ)でキルした者が勝者',
    teamBased: false,
    scoreTarget: 20, // ランク=スコアとして表示。実勝利はGunGameStateが管理
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

// メニューで選べる対戦モード。'story' は専用UI、'zombie' は専用ラウンドUI
export const MODE_IDS: GameMode[] = ['ffa', 'tdm', 'dom', 'hardpoint', 'killconfirm', 'gungame', 'score', 'zombie', 'training'];

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

// ── ガンゲーム: 20段武器ラダー(固定順。ステージ非依存) ──────────────────────────────
// ピストル→リボルバー→SG→SMG→AR→BR/LMG→マークスマン→スナイパー→ロケラン→クナイ(最終)
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
  'raicho-sniper',    // rank 18: スナイパー2
  'gouka-rl',         // rank 19: 業火ロケットランチャー
  'fists',            // rank 20: クナイ(最終段・キルで勝利)
] as const;

// botのランクに応じたダメージ/連射パラメタ近似テーブル(tuning部分上書き用)
// 低ランクは弱く、高ランクは強くなるように線形スケール
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
  { damage: 20, burstPauseMin: 1.00, burstPauseMax: 1.60 }, // rank 17: sniper
  { damage: 22, burstPauseMin: 1.00, burstPauseMax: 1.60 }, // rank 18: sniper2
  { damage: 25, burstPauseMin: 1.80, burstPauseMax: 2.50 }, // rank 19: launcher
  { damage: 30, burstPauseMin: 0.50, burstPauseMax: 0.70 }, // rank 20: fists
] as const;

// ── GunGameState: ランク進行の純ロジック(描画・物理に依存しない) ────────────────────
export class GunGameState {
  private playerRank = 1;
  private readonly botRanks = new Map<number, number>(); // bot.uid → rank(1-20)

  // ラダー武器IDを返す(rank は 1-20)
  getWeaponIdAt(rank: number): string {
    return GG_LADDER[Math.max(0, Math.min(19, rank - 1))] ?? 'fists';
  }

  getPlayerRank(): number { return this.playerRank; }
  getBotRank(uid: number): number { return this.botRanks.get(uid) ?? 1; }

  // プレイヤーがキルを取ったとき。返り値 isWin=true なら試合終了
  playerRankUp(): { newRank: number; isWin: boolean } {
    const wasAt20 = this.playerRank === 20;
    if (!wasAt20) this.playerRank += 1;
    return { newRank: this.playerRank, isWin: wasAt20 };
  }

  // 近接キルされたとき(BO2 setback): プレイヤーランク -1(最低1)
  playerRankDown(): number {
    if (this.playerRank > 1) this.playerRank -= 1;
    return this.playerRank;
  }

  // botがキルを取ったとき
  botRankUp(uid: number): { newRank: number; isWin: boolean } {
    const current = this.getBotRank(uid);
    const wasAt20 = current === 20;
    if (!wasAt20) this.botRanks.set(uid, current + 1);
    return { newRank: this.getBotRank(uid), isWin: wasAt20 };
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
