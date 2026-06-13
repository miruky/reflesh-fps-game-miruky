// ゲームモードのルール定義と進行計算。描画・物理に依存しない
export type GameMode = 'ffa' | 'tdm' | 'dom';

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
};

export const MODE_IDS: GameMode[] = ['ffa', 'tdm', 'dom'];

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
