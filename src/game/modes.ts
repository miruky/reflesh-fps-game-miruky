// ゲームモードのルール定義と進行計算。描画・物理に依存しない
// 'story'=キャンペーン(目的駆動・scoreTarget無効) / 'score'=スコアアタック(時間内キル数)
export type GameMode = 'ffa' | 'tdm' | 'dom' | 'story' | 'score' | 'zombie' | 'hardpoint' | 'killconfirm';

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
};

// メニューで選べる対戦モード。'story' は専用UI、'zombie' は専用ラウンドUI
export const MODE_IDS: GameMode[] = ['ffa', 'tdm', 'dom', 'hardpoint', 'killconfirm', 'score', 'zombie'];

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
