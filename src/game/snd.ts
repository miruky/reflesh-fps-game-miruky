// BO2式サーチ&デストロイ(S&D)の純ロジック。描画・物理・THREE/Rapierに一切依存しない
// (Zone/HardpointState/KillConfirmState と同じ設計原則。match.ts が唯一の状態保持者=単体テスト可能)。
//
// ─── 配線ポイント一覧(match.ts 側の実装者=M2b 向け) ─────────────────────────────
//
// 1. 試合ライフサイクル:
//      const sndMatch = new SndMatch(initialAttackTeam);
//      let round = new SndRound(sndMatch.currentAttackTeam);
//      // 毎tick:
//      const events = round.update(dt);
//      for (const ev of events) {
//        if (ev.kind === 'round-win') sndMatch.recordRound(ev.winner);
//        // phase/planted/defused/detonate は SE・字幕・バッジ演出のトリガーに使う
//      }
//      // roundEnd フェーズの表示猶予(SND_ROUND_END_S)が尽きたら次ラウンドへ:
//      if (round.phase === 'roundEnd' && round.phaseTimeLeft <= 0) {
//        if (sndMatch.matchWinner() !== null) { /* 結果画面へ */ }
//        else { round = new SndRound(sndMatch.currentAttackTeam); /* bot/プレイヤー再配置は match 側の責務 */ }
//      }
//
// 2. リスポーン抑止: S&Dはノーリスポーン。既存の bot/player.respawnIn カウントダウン方式を
//    そのまま流用し、死亡時に `respawnIn = Infinity` を設定すればラウンド中は復活しない
//    (match.ts:8363/8389 の `respawnIn <= 0` チェックが Infinity では常に false のまま自然に止まる)。
//    ラウンド開始時に生存者を全員リスポーンさせ直す処理は match 側で行う。
//
// 3. bot AI 目標: 攻撃側は「爆弾を運んでサイトへ向かう→設置→離脱/警戒」、守備側は
//    「サイトを警戒し、設置されたら解除ホールドに向かう」。既存の dom.ts ゾーン到達AI
//    (拠点座標を目標にする経路)や killconfirm のドッグタグ回収AI(最寄りアイテムへ寄る)の
//    「目標地点に向かって移動する」ロジックをそのまま転用できる。目標座標には
//    `SndSite.center`(サイトA/B) または (未設置時は)ボム落下位置を渡せばよい。
//
// 4. HUD snapshot フィールド案(match.ts の Snapshot 型へ追加する候補名):
//      sndPhase: SndPhase
//      sndScore: [number, number]              // [attackTeamの合計勝利数, defendTeamの合計勝利数] 等、表示都合で並べ替え可
//      sndBombTimer: number | null              // phase==='planted' の間だけ round.phaseTimeLeft、それ以外は null
//      sndProgress01: number                    // 設置中は plantProgress01、解除中は defuseProgress01、非活性時は0
//      sndCarrierIsPlayer: boolean               // round.carrierUid === player.uid
//
// 5. plant/defuse 呼び出しゲート(このモジュールは座標もuidの正当性も検証しない):
//    beginPlant() は「操作者が現在のボムキャリア(round.carrierUid) かつ SndSite 内(isWithinSndSite)」
//    を match 側で確認してから呼ぶこと。beginDefuse() は「守備側かつ SndSite 内」を確認してから呼ぶこと。
//    移動/被弾/離脱などでホールドが崩れたら毎tick cancelPlant()/cancelDefuse() を呼び直す
//    (=「今フレームもホールド継続中か」を毎tick再判定し、継続しないなら cancel する設計を推奨)。
//
// 6. resolveRound の呼び分け: 'timeout' と 'detonate' は update() が自動発火するため match 側は
//    呼ばない。match 側が毎tick生存者数を監視し、攻撃側/守備側が全滅した瞬間にだけ
//    resolveRound('attackers-dead' | 'defenders-dead') を呼ぶ。設置後の攻撃側全滅は
//    BO2仕様でラウンド継続(呼んでも null が返り何も起きない)なので、それを見て
//    「ラウンド継続時の専用ボイス」等を出し分けてよい。

import { ENEMY_TEAM, PLAYER_TEAM, type TeamId } from './modes';

// ─── タイミング定数 ──────────────────────────────────────────────────────────
/** 開始演出タイマー(秒)。この間も撃てる=純粋な対峙猶予の見た目上のカウントダウン */
export const SND_BUY_S = 5;
/** 未設置のままの制限時間(秒)。経過で守備側の勝利(timeout) */
export const SND_LIVE_S = 90;
/** 設置後のヒューズ(秒)。経過で攻撃側の勝利(detonate) */
export const SND_FUSE_S = 45;
/** ラウンド決着後、結果演出を見せる猶予(秒) */
export const SND_ROUND_END_S = 4;
/** 設置に必要な連続ホールド時間(秒) */
export const SND_PLANT_HOLD_S = 4;
/** 解除に必要な連続ホールド時間(秒) */
export const SND_DEFUSE_HOLD_S = 6;
/** マッチ先取ラウンド数 */
export const SND_ROUNDS_TO_WIN = 4;
/** 何ラウンドごとに攻守交替するか(スコアは維持) */
export const SND_SIDE_SWAP_EVERY = 4;
/** サイト半径の既定値(m)。match 側が実座標のゾーンを作る際の目安 */
export const SND_SITE_RADIUS_DEFAULT = 6;

export type SndPhase = 'buy' | 'live' | 'planted' | 'roundEnd';

export type SndRoundEndReason = 'detonate' | 'defuse' | 'attackers-dead' | 'defenders-dead' | 'timeout';

export type SndEvent =
  | { kind: 'phase'; phase: SndPhase }
  | { kind: 'planted' }
  | { kind: 'defused' }
  | { kind: 'detonate' }
  | { kind: 'round-win'; winner: TeamId; reason: SndRoundEndReason };

// ─── サイト(設置地点)の抽象表現。実座標は match 側が供給する ───────────────────
export interface SndSite {
  readonly id: 'A' | 'B';
  readonly center: { x: number; z: number };
  readonly radius: number;
}

/** 2D(XZ平面)円内判定。実座標を持つ match 側のゾーン判定に流用する純関数 */
export function isWithinSndSite(site: SndSite, pos: { x: number; z: number }): boolean {
  const dx = pos.x - site.center.x;
  const dz = pos.z - site.center.z;
  return dx * dx + dz * dz <= site.radius * site.radius;
}

/** A/B 2サイトを既定半径で組み立てる補助(座標は match 側のステージ定義から渡す) */
export function makeSndSites(
  centerA: { x: number; z: number },
  centerB: { x: number; z: number },
  radius = SND_SITE_RADIUS_DEFAULT,
): [SndSite, SndSite] {
  return [
    { id: 'A', center: { ...centerA }, radius },
    { id: 'B', center: { ...centerB }, radius },
  ];
}

export interface SndRoundSnapshot {
  phase: SndPhase;
  phaseTimeLeft: number;
  attackTeam: TeamId;
  plantProgress01: number;
  defuseProgress01: number;
  carrierUid: number | null;
  winner: TeamId | null;
}

// ── SndRound: 1ラウンドの進行状態機械 ────────────────────────────────────────
// buy(5s 演出) → live(90s、設置で planted へ) → planted(45sヒューズ、解除で決着) → roundEnd(4s)
export class SndRound {
  private _phase: SndPhase = 'buy';
  private _timer = SND_BUY_S;
  private _planting = false;
  private _plantProgress = 0;
  private _defusing = false;
  private _defuseProgress = 0;
  private _resolved = false;
  private _winner: TeamId | null = null;

  /** 現在ボムを運搬中のエンティティ uid。未所持は null */
  carrierUid: number | null = null;

  constructor(readonly attackTeam: TeamId) {}

  get phase(): SndPhase { return this._phase; }
  get phaseTimeLeft(): number { return Math.max(0, this._timer); }
  get plantProgress01(): number { return this._plantProgress; }
  get defuseProgress01(): number { return this._defuseProgress; }
  get isPlanting(): boolean { return this._planting; }
  get isDefusing(): boolean { return this._defusing; }
  get isResolved(): boolean { return this._resolved; }
  get winner(): TeamId | null { return this._winner; }

  /** 攻撃側の対となる守備側チーム(S&Dは2チーム固定) */
  get defendTeam(): TeamId {
    return this.attackTeam === PLAYER_TEAM ? ENEMY_TEAM : PLAYER_TEAM;
  }

  /** ボム拾得(match側が近接判定後に呼ぶ) */
  pickupBomb(uid: number): void {
    this.carrierUid = uid;
  }

  /** ボムドロップ(死亡等。match側が呼ぶ)。設置ホールド中だった場合は自動中断する */
  dropBomb(): void {
    this.carrierUid = null;
    this.cancelPlant();
  }

  /** 設置ホールド開始。live フェーズ以外・解決済みでは無視する */
  beginPlant(): void {
    if (this._resolved || this._phase !== 'live') return;
    this._planting = true;
  }

  /** 設置ホールド中断(進捗はリセット。=キャンセルで最初からやり直し) */
  cancelPlant(): void {
    this._planting = false;
    this._plantProgress = 0;
  }

  /** 解除ホールド開始。planted フェーズ以外・解決済みでは無視する */
  beginDefuse(): void {
    if (this._resolved || this._phase !== 'planted') return;
    this._defusing = true;
  }

  /** 解除ホールド中断(進捗はリセット) */
  cancelDefuse(): void {
    this._defusing = false;
    this._defuseProgress = 0;
  }

  /**
   * 設置完了処理。live→planted へ遷移しヒューズを起動する。
   * update() 内部から自動的に呼ばれる他、テスト/演出用に直接呼んでもよい。
   */
  onPlanted(): void {
    if (this._resolved || this._phase !== 'live') return;
    this._phase = 'planted';
    this._timer = SND_FUSE_S;
    this._planting = false;
    this._plantProgress = 0;
  }

  /**
   * 解除完了処理。守備側勝利でラウンドを終了する。戻り値は resolveRound の結果(勝者チーム)。
   * update() 内部から自動的に呼ばれる他、テスト/演出用に直接呼んでもよい。
   */
  onDefused(): TeamId | null {
    if (this._resolved || this._phase !== 'planted') return null;
    this._defusing = false;
    this._defuseProgress = 0;
    return this.resolveRound('defuse');
  }

  /**
   * ラウンドを決着させる。timeout/detonate は update() が自動で呼ぶ。
   * attackers-dead/defenders-dead は match 側が生存者数を監視して呼ぶ。
   * BO2仕様: planted 中の attackers-dead はラウンド継続(null を返し何も変えない)。
   * 二重呼び出しは最初の結果を保持したまま無視する(idempotent)。
   */
  resolveRound(reason: SndRoundEndReason): TeamId | null {
    if (this._resolved) return this._winner;
    if (reason === 'attackers-dead' && this._phase === 'planted') return null;

    const winner: TeamId =
      reason === 'detonate' || reason === 'defenders-dead' ? this.attackTeam : this.defendTeam;

    this._resolved = true;
    this._winner = winner;
    this._phase = 'roundEnd';
    this._timer = SND_ROUND_END_S;
    this._planting = false;
    this._plantProgress = 0;
    this._defusing = false;
    this._defuseProgress = 0;
    return winner;
  }

  /** 60Hz固定ロジックの1tick分進行。発生したイベントを配列で返す */
  update(dt: number): SndEvent[] {
    const events: SndEvent[] = [];

    if (this._resolved) {
      // roundEnd の表示猶予だけ経過させる。以降のイベントは出さない(match側がタイマー切れを監視)
      if (this._phase === 'roundEnd') this._timer -= dt;
      return events;
    }

    switch (this._phase) {
      case 'buy': {
        this._timer -= dt;
        if (this._timer <= 0) {
          this._phase = 'live';
          this._timer = SND_LIVE_S;
          events.push({ kind: 'phase', phase: 'live' });
        }
        break;
      }
      case 'live': {
        if (this._planting) {
          this._plantProgress = Math.min(1, this._plantProgress + dt / SND_PLANT_HOLD_S);
          if (this._plantProgress >= 1) {
            this.onPlanted();
            events.push({ kind: 'planted' });
            events.push({ kind: 'phase', phase: 'planted' });
            break;
          }
        }
        this._timer -= dt;
        if (this._timer <= 0) {
          const winner = this.resolveRound('timeout');
          if (winner !== null) {
            events.push({ kind: 'round-win', winner, reason: 'timeout' });
            events.push({ kind: 'phase', phase: 'roundEnd' });
          }
        }
        break;
      }
      case 'planted': {
        if (this._defusing) {
          this._defuseProgress = Math.min(1, this._defuseProgress + dt / SND_DEFUSE_HOLD_S);
          if (this._defuseProgress >= 1) {
            const winner = this.onDefused();
            events.push({ kind: 'defused' });
            if (winner !== null) {
              events.push({ kind: 'round-win', winner, reason: 'defuse' });
              events.push({ kind: 'phase', phase: 'roundEnd' });
            }
            break;
          }
        }
        this._timer -= dt;
        if (this._timer <= 0) {
          events.push({ kind: 'detonate' });
          const winner = this.resolveRound('detonate');
          if (winner !== null) {
            events.push({ kind: 'round-win', winner, reason: 'detonate' });
            events.push({ kind: 'phase', phase: 'roundEnd' });
          }
        }
        break;
      }
      case 'roundEnd': {
        this._timer -= dt;
        break;
      }
    }

    return events;
  }

  snapshot(): SndRoundSnapshot {
    return {
      phase: this._phase,
      phaseTimeLeft: this.phaseTimeLeft,
      attackTeam: this.attackTeam,
      plantProgress01: this._plantProgress,
      defuseProgress01: this._defuseProgress,
      carrierUid: this.carrierUid,
      winner: this._winner,
    };
  }
}

// ── SndMatch: 先取4・4ラウンドごとの攻守交替(スコアは維持) ───────────────────
export class SndMatch {
  private readonly scores = new Map<TeamId, number>();
  private _roundsPlayed = 0;
  private _attackTeam: TeamId;

  constructor(initialAttackTeam: TeamId = PLAYER_TEAM) {
    this._attackTeam = initialAttackTeam;
  }

  get currentAttackTeam(): TeamId { return this._attackTeam; }
  get roundsPlayed(): number { return this._roundsPlayed; }

  scoreOf(team: TeamId): number {
    return this.scores.get(team) ?? 0;
  }

  /**
   * ラウンド勝者を記録する。既に勝敗が決している場合は何もしない(idempotent)。
   * SND_SIDE_SWAP_EVERY ラウンドごとに攻守を交替する(スコアはそのまま維持)。
   */
  recordRound(winner: TeamId): void {
    if (this.matchWinner() !== null) return;

    this.scores.set(winner, (this.scores.get(winner) ?? 0) + 1);
    this._roundsPlayed += 1;

    if (this.matchWinner() !== null) return; // 勝敗確定後は交替不要
    if (this._roundsPlayed % SND_SIDE_SWAP_EVERY === 0) {
      this._attackTeam = this._attackTeam === PLAYER_TEAM ? ENEMY_TEAM : PLAYER_TEAM;
    }
  }

  /** 先取 SND_ROUNDS_TO_WIN に達したチーム。未到達なら null */
  matchWinner(): TeamId | null {
    for (const [team, score] of this.scores) {
      if (score >= SND_ROUNDS_TO_WIN) return team;
    }
    return null;
  }
}
