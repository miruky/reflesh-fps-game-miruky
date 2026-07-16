// ファイナルキルカム(FK記録リングバッファ+シネマティック三人称再生CK)。
// R54-W1 F1 で match.ts から分割抽出した KillcamController。実装ロジックは移動のみ・挙動不変
// (Match への依存は KillcamDeps の遅延クロージャ経由に限定 — 循環importなし)。
// ガード(canStart)→Match側クリーンアップ→再生初期化(begin)の分割前の実行順は
// match.ts 側の startFinalKillcam ラッパーが維持する。
import * as THREE from 'three';
import type { Bot } from './bot';
import type { Player } from './player';

// ── ファイナルキルカム リングバッファ(R19) ──
const FK_MAX_FRAMES   = 90;  // 4.5 s @ 20 Hz
const FK_BUFFER_S     = FK_MAX_FRAMES / 20; // R54-W1 Q2: リングバッファの実時間窓(=4.5s)
const FK_MAX_BOTS     = 36; // V32修正: 増員(最大36体)を全記録(32だとhigh tierで被害者を取りこぼす)
const FK_TICK_INT     = 3;   // 60 Hz の何 tick おきに記録(→ 20 Hz)
const FK_WIN_PRE      = 3.5; // キル前の窓 (s) — 3.5s of pre-kill context
const FK_WIN_POST     = 1.2; // キル後の窓 (s) — 1.2s for death animation
const FK_MAX_SHOTS    = 48;
// player slot : eyeX,eyeY,eyeZ, yaw, pitch, alive, adsRatio, adsFov, isFpsView = 9 floats
// R55 W-C5 [6]: isFpsView(スロット8)はそのフレームが「生きたFPS視点」(recordFrame内の
// fpsView判定=isFpsView()またはalive代替)だったか(1)/でなかったか(0)のライブビット。
// eye/yaw/pitch/fov(スロット0-4,7)は非FPS視点の間フリーズ保持値を書くため単体では
// 「このフレームは記録が有効か」を区別できない — begin()のキル瞬間フレーム判定に使う。
const FK_P            = 9;
// bot slot    : posX,posY,posZ, headY, yaw, alive  = 6 floats
const FK_B            = 6;
const FK_FRAME_STRIDE = FK_P + FK_MAX_BOTS * FK_B; // 225
// shot slot   : from(3) + to(3) + color(1) + time(1) + playerShot(1) = 9 floats
// playerShot は一人称再生時に viewmodel の発砲・反動まで同時再現する識別ビット。
const FK_S            = 9;
// R55 W-C2 ④: recordFrame が player slot の初回記録前(まず起こらないが保険)に使う既定FOV。
// core/settings.ts DEFAULT_SETTINGS.fov(78)に合わせた仮値で、通常は最初のtickで即上書きされる。
const FK_DEFAULT_FOV  = 78;
// R55 W-C2 ④: fkSetCameraFirstPerson の防御的クランプ境界(度)。
// settings.fov 可動域[60,110](core/settings.ts)× 最小 adsFovScale 0.3(optics.ts 最強スコープ)
// × breathZoom 0.9(息止め時) ≈16.2 を下限余裕込みで12へ、
// settings.fov上限110 + FOV_SPEED_KICK(match.ts)12 ≈122 を上限余裕込みで130へ設定。
// この範囲は正規のADS/移動FOVを一切削らない「物理的にありえない値」だけを弾く保険であり、
// RC-XD固定80や旧来三人称killcamの46は範囲内のため実際の対策は主にrecordFrame側のゲート。
const FK_FP_FOV_MIN   = 12;
const FK_FP_FOV_MAX   = 130;
// ── シネマティックキルカム(CK) 再生窓・カメラ定数 ──
const CK_WIN_PRE   = 2.5;  // 再生窓: キル前(s)
const CK_WIN_POST  = 1.5;  // 再生窓: キル後(s)
const CK_FOV       = 50;   // シネマティック三人称 FOV
const CK_HEIGHT    = 3.0;  // カメラ高さオフセット(m)
const CK_DOLLY_SPD = 0.5;  // ドリー速度(m/s)
const CK_EYE_H     = 1.55; // プレイヤー眼高さオフセット(m)
// T5: キルカム再生中のポーズ適用は Bot 公開API(fkApplyLivePose/fkApplyDeathPose/
// fkResetPose)へ委譲する(旧 FkBotRig 構造型による private フィールド直接操作を撤去)。
// bot.ts KIND_DEATH_S と同じ死亡演出の全長(s)。キルカムの手続き再現に使う
const FK_DEATH_S: Record<string, number> = {
  humanoid: 0.6,
  drone: 1.1,
  tank: 1.4,
  turret: 0.5,
  zombie: 0.6,
  master: 0.6,
  giant: 0.7,
};

/**
 * シネマティックキルカム用: killer→victim線分の垂線上にカメラ位置を計算する(純粋関数)。
 * side=1 or -1 で左右を切り替え。dollyOffset は slow dolly 積分値(m)。
 */
export function ckCamPos(
  killer: THREE.Vector3,
  victim: THREE.Vector3,
  side: 1 | -1,
  height: number,
  dollyOffset = 0,
): THREE.Vector3 {
  const sx = victim.x - killer.x;
  const sz = victim.z - killer.z;
  const segLen = Math.sqrt(sx * sx + (victim.y - killer.y) ** 2 + sz * sz);
  const horizLen = Math.sqrt(sx * sx + sz * sz);
  let perpX = 0; let perpZ = 1;
  if (horizLen > 0.01) { perpX = (-sz / horizLen) * side; perpZ = (sx / horizLen) * side; }
  // V48修正: 遠距離キルでカメラが無制限に遠のき両者が点になる問題。
  // アンカーを「近距離=中点 / 遠距離(18m超)=被害者寄り」へ滑らかに移し、距離も20mでクランプ。
  // 遠距離キルは被害者の倒れ込み+着弾トレーサーを見せる構図になる。
  const anchorT = Math.min(1, Math.max(0, (segLen - 18) / 24));
  const ax = (killer.x + victim.x) * 0.5 * (1 - anchorT) + victim.x * anchorT;
  const ay = (killer.y + victim.y) * 0.5 * (1 - anchorT) + victim.y * anchorT;
  const az = (killer.z + victim.z) * 0.5 * (1 - anchorT) + victim.z * anchorT;
  const d = Math.min(segLen * 0.9 + 6, 20) + dollyOffset;
  return new THREE.Vector3(ax + perpX * d, ay + height, az + perpZ * d);
}

// ── R55 ④: ラストキルカム一人称化 ────────────────────────────────────────
/** fkFirstPersonCam の戻り値(カメラ姿勢の純データ)。THREE.Camera へは呼び出し側が適用する。 */
export interface FkFirstPersonPose {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly rotY: number; // yaw
  readonly rotX: number; // pitch
  readonly rotZ: number; // 常に0(微小leanは無視でよい設計合意)
  readonly fov: number;
}

/**
 * 一人称ファイナルキルカム用カメラ姿勢(純粋関数)。録画済みの眼位置/yaw/pitch/実効FOVを、
 * ゲーム通常カメラの規約(rotation.order='YXZ', position=eye, rotation.y=yaw, rotation.x=pitch,
 * rotation.z=0, fov=実効fov — match.ts syncCamera の通常分岐と同一)でそのまま返す。
 * 録画値の忠実な再現のみを行い、ckFovAt 等の演出的な人工ランプは一切加えない
 * (「プレイヤーが見ていた画そのもの」を再現するため=クロスヘアは必ず被害者に乗る)。
 */
export function fkFirstPersonCam(
  eyeX: number,
  eyeY: number,
  eyeZ: number,
  yaw: number,
  pitch: number,
  fov: number,
): FkFirstPersonPose {
  return { x: eyeX, y: eyeY, z: eyeZ, rotY: yaw, rotX: pitch, rotZ: 0, fov };
}

/**
 * シネマティックキルカム再生速度ランプ(純粋関数)。
 * キル -0.4s から急減速 → 0.2× ホールド → キル後 0.6s から復帰。
 */
export function ckSpeedAt(cursor: number, killT: number): number {
  const d = cursor - killT;
  if (d < -0.4) return 1.0;
  if (d < 0.0) {
    const t = (d + 0.4) / 0.4;
    return 1.0 + (0.2 - 1.0) * t;
  }
  if (d < 0.6) return 0.2;
  const t = Math.min(1, (d - 0.6) / Math.max(1e-6, CK_WIN_POST - 0.6));
  return 0.2 + (1.0 - 0.2) * t;
}

// ── R54-F7 シネマ強化(純粋関数/定数) ─────────────────────────────────
/** キル瞬間マイクロフリーズの長さ(s)。reduceMotion 時はフリーズ自体をスキップする。 */
export const CK_FREEZE_S = 0.12;

/**
 * シネマティックキルカムの FOV ランプ(純粋関数)。
 * キル -0.5s まで 52(やや広角の接近)→ キル瞬間 46(ズームインの緊張)→
 * キル +0.3s で 50(CK基準)へ復帰。各区間 smoothstep のイージング。
 */
export function ckFovAt(cursor: number, killT: number): number {
  const d = cursor - killT;
  if (d <= -0.5) return 52;
  if (d < 0) {
    const t = (d + 0.5) / 0.5;
    const ss = t * t * (3 - 2 * t);
    return 52 + (46 - 52) * ss;
  }
  if (d < 0.3) {
    const t = d / 0.3;
    const ss = t * t * (3 - 2 * t);
    return 46 + (50 - 46) * ss;
  }
  return 50;
}

/**
 * 再生カーソルの1ステップ前進(純粋関数)。キル瞬間(killT)を跨ぐフレームでは
 * カーソルを killT へ正確に着地させ、CK_FREEZE_S の完全静止(マイクロフリーズ)を
 * 開始する。フリーズ残(freezeLeft)がある間はカーソルを進めず実時間だけ減らす。
 * reduceMotion=true ならフリーズを一切発生させない(既存挙動と同一の連続前進)。
 */
export function ckCursorStep(
  cursor: number,
  dt: number,
  speed: number,
  killT: number,
  freezeLeft: number,
  reduceMotion: boolean,
): { cursor: number; freezeLeft: number } {
  if (freezeLeft > 0) {
    return { cursor, freezeLeft: Math.max(0, freezeLeft - dt) };
  }
  const step = dt * speed;
  if (!reduceMotion && cursor < killT && cursor + step >= killT) {
    return { cursor: killT, freezeLeft: CK_FREEZE_S };
  }
  return { cursor: cursor + step, freezeLeft: 0 };
}

// R54-W1 Q2: FK鮮度ガード(純関数、モード非依存)。startFinalKillcam 呼び出し時点で
// 「最終キル」からリングバッファの実時間窓をほぼ使い切るほど経過していれば、そのキルの
// フレームはもはや信頼できる形でバッファに残っていない(Hardpoint等、over確定がキルと
// 直結しないモードで発生しうる潜在バグの保険)。skip=trueならFKを諦めて直接リザルトへ。
export function fkIsStale(elapsed: number, killElapsed: number, bufferSeconds: number): boolean {
  return elapsed - killElapsed > bufferSeconds - 1;
}

/** 前回カーソルより後、現在カーソル以下の射撃だけを一度再生する。 */
export function fkShotShouldReplay(shotT: number, prevCursor: number, cursor: number): boolean {
  return shotT > prevCursor && shotT <= cursor;
}

/** 録画20Hzの前後フレームから、再生フレーム用ADS率を安全に補間する。 */
export function fkInterpolateAds(a: number, b: number, t: number): number {
  return THREE.MathUtils.clamp(a + (b - a) * THREE.MathUtils.clamp(t, 0, 1), 0, 1);
}

// fkRecordFrame の bot 位置読み出し用スクラッチ(旧 match.ts BOT_POS_SCRATCH と同役)
const BOT_POS_SCRATCH = new THREE.Vector3();

/** Match から注入する依存(全て遅延クロージャ=フィールド初期化順に依存しない)。 */
export interface KillcamDeps {
  getScene(): THREE.Scene;
  getCamera(): THREE.PerspectiveCamera;
  getAllyColor(): number;
  getPlayer(): Player;
  getBots(): readonly Bot[];
  getAdsProgress(): number;
  isZombie(): boolean;
  playHit(): void;
  reduceMotion(): boolean;
  updateEffects(dt: number): void;
  updateAtmosphere(dt: number): void;
  tracer(from: THREE.Vector3, to: THREE.Vector3, color: number): void;
  /** rayOrg→toMid方向distまでに boundary 以外の遮蔽があるか(壁チェック)。 */
  blockedToMid(rayOrg: THREE.Vector3, toMid: THREE.Vector3, dist: number): boolean;
  /**
   * R55 ④: 武器viewmodel(カメラ子)の可視状態を切り替える。一人称キルカム(killer=プレイヤー)
   * 中は表示、三人称シネマ(killer=bot)中は非表示(viewModelはカメラの子のため、三人称の
   * カメラ位置に銃が浮いて映るのを防ぐ)。begin()で分岐設定し、再生終了/dispose で復元する。
   */
  setViewmodelVisible(v: boolean): void;
  /** 後方互換: 新しい毎フレーム再生フックが無い場合の開始時1回ポーズ復元。 */
  resetViewmodelAdsPose?(adsRatio?: number): void;
  /**
   * 一人称キルカメラの各再生フレームで、録画済みADS率へviewmodelを更新する。
   * scopeRevealは呼び出し側で0固定にし、DOMスコープへ退避した銃を凍結表示しない。
   */
  updateViewmodelReplayPose?(adsRatio: number, dt: number): void;
  /** 録画済みのプレイヤー射撃を跨いだ瞬間、銃口発光・機関部・視覚反動を再生する。 */
  replayViewmodelShot?(): void;
  /**
   * R55 W-C2/W-C3 ④: カメラが実際に一人称FPSビュー(通常プレイ/ADS)を描画中かどうか。
   * RC-XD操縦中や旧来の死亡三人称killcam中はカメラ(位置/向き/FOV)を別システムが所有し、
   * eyePosition/yaw/pitch/camera.fov はプレイヤーの実効視点ではない共有値になる。recordFrame は
   * これが false の間、player slot の eye/yaw/pitch/FOV(スロット0-4,7)を直前の有効値のまま
   * 保持し、他システム由来の値を録画しない(match.ts側は
   * `!rcxdActive && !killcamCamActive && player.alive` を実配線する)。
   * オプショナル: 未実装(undefined)の場合は getPlayer().alive のみで後方互換フォールバックする
   * (RC-XD中はalive=trueのままのため完全な判定ではないが、既存挙動を壊さず最小の防御になる)。
   */
  isFpsView?(): boolean;
}

export { FK_WIN_POST };

export class KillcamController {
  // ── リングバッファ + ステートマシン(旧 Match フィールドの移動) ──
  private readonly fkBuf     = new Float32Array(FK_MAX_FRAMES * FK_FRAME_STRIDE);
  private readonly fkTimeArr = new Float32Array(FK_MAX_FRAMES);
  private readonly fkBotCnt  = new Uint8Array(FK_MAX_FRAMES);
  private fkHead = 0;
  private fkFill = 0;
  private fkTick = 0;
  private readonly fkShotBuf = new Float32Array(FK_MAX_SHOTS * FK_S);
  private fkShotHead = 0;
  private fkShotFill = 0;
  private fkKillerIsPlayer    = false;
  // R55 W-C5 [6]: 実際にこの再生セッションが一人称カメラで再生されているか。noteKill直後は
  // fkKillerIsPlayer(生の「誰が倒したか」)をそのまま反映するが、begin()でキル瞬間フレームの
  // ライブビット(isFpsView)を検査した結果、非FPS視点(RC-XD操縦中の決着キル等)だったと判明
  // した場合はfalseへ確定し、三人称シネマへフォールバックする。getter firstPerson / fkSetCamera
  // の実際のカメラ分岐はこのフィールドを見る(fkKillerIsPlayer生値はavatar配置等の
  // 「誰が撃ったか」判定に引き続き使う=カメラモードとは独立)。
  private fkFirstPersonActive = false;
  private fkKillerBotIdx      = -1;
  private fkVictimBotIdx      = -1; // キルカムの被害者BOT index(-1=プレイヤーが被害者)
  private fkKillElapsed       = -Infinity;
  // R55 W-C2 ④: recordFrame が player slot の FOV(スロット7)を最後に「一人称FPSビュー中」に
  // 記録した値。isFpsView()===false の間はこの値を保持して録画する(他システム所有fov排除)。
  private fkLastFov           = FK_DEFAULT_FOV;
  // R55 W-C3 [26]: fkLastFov と同じ理由で eye/yaw/pitch(スロット0-4)も直前の一人称有効値を
  // 保持する。isFpsView()===false の間(RC-XD操縦中/旧来の死亡三人称killcam中)は
  // カメラが別システム所有のため、プレイヤーの eyePosition/yaw/pitch を録画してしまうと
  // 「見ていた画」と無関係な壊れフレームが一人称キルカム再生に混入する(fovだけの保護では
  // 不十分だった=RC-XDキル等で位置/向きは腕誤差ではなく別物理エンティティ由来になり得る)。
  private fkLastEyeX          = 0;
  private fkLastEyeY          = 0;
  private fkLastEyeZ          = 0;
  private fkLastYaw           = 0;
  private fkLastPitch         = 0;
  private fkPlaying           = false;
  fkFlash                     = 0;
  private fkCursor            = 0; // 再生中のゲーム時刻カーソル(begin で窓先頭へ初期化)
  private fkWinKill           = 0;
  private fkWinEnd            = 0;
  private fkPrevCursor        = -Infinity;
  // ── シネマティックキルカム専用フィールド ──
  private fkAvatarGroup: THREE.Group | null = null;
  private readonly _ckCamBase  = new THREE.Vector3();
  private readonly _ckDollyDir = new THREE.Vector3();
  private _ckDollyDist = 0;
  private _ckHitSoundPlayed = false;
  private readonly _kcLook = new THREE.Vector3();
  private _ckFreezeLeft = 0; // R54-F7: キル瞬間マイクロフリーズの残秒(0=非フリーズ)
  private fkWeaponName: string | null = null; // R54-F7: 最終キルの武器名(シネマ帯バナー用)
  private fkKillDistM = 0; // R54-F7: 最終キルの水平距離(m, round済み)

  constructor(private readonly deps: KillcamDeps) {}

  /** 再生中か(スナップショットの fkCinematicActive)。 */
  get playing(): boolean {
    return this.fkPlaying;
  }

  /**
   * R55 ④: 現在(直近)の再生が一人称か(killer=プレイヤー)。hud2のクロスヘア表示制御に使う。
   * R55 W-C5 [6]: noteKill直後(begin()前)はfkKillerIsPlayer相当の即時値を返し、begin()後は
   * 実際に採用されたカメラモード(キル瞬間フレームが非FPS視点だった場合の三人称フォールバック
   * を含む)を返す(fkFirstPersonActive参照)。
   */
  get firstPerson(): boolean {
    return this.fkFirstPersonActive;
  }

  /** 最終キルのゲーム時刻(-Infinity=未発生)。trailing window 判定に使う。 */
  get killElapsed(): number {
    return this.fkKillElapsed;
  }

  /** R54-F7: 最終キルの武器名(未供給=null)。snapshot.fkWeaponName とシネマ帯バナーが読む。 */
  get weaponName(): string | null {
    return this.fkWeaponName;
  }

  /** R54-F7: 最終キルの水平距離(m)。0=未供給。 */
  get killDistM(): number {
    return this.fkKillDistM;
  }

  /** キル発生をマーキングする(旧: Match が fk フィールドへ直接代入していた2サイトの置換)。
   * R54-F7: 武器名/距離(m)を任意受け取り(シネマ帯の「武器名 — 距離m」バナー用)。 */
  noteKill(
    killerIsPlayer: boolean,
    killerBotIdx: number,
    victimBotIdx: number,
    elapsed: number,
    weaponName?: string,
    distM?: number,
  ): void {
    this.fkKillerIsPlayer = killerIsPlayer;
    // R55 W-C5 [6]: begin()前の即時反映(既存契約を維持)。begin()がキル瞬間フレームの
    // ライブビットを検査した結果、非FPS視点だった場合はこの値をfalseへ上書きする。
    this.fkFirstPersonActive = killerIsPlayer;
    this.fkKillerBotIdx   = killerBotIdx;
    this.fkVictimBotIdx   = victimBotIdx;
    this.fkKillElapsed    = elapsed;
    this.fkWeaponName     = weaponName ?? null;
    this.fkKillDistM      = distM ?? 0;
  }

  /** 20Hz 記録カデンス(旧: fkTick インクリメント+fkRecordFrame の2サイトの置換)。 */
  tickRecord(elapsed: number): void {
    this.fkTick = (this.fkTick + 1) % FK_TICK_INT;
    if (this.fkTick === 0) this.recordFrame(elapsed);
  }

  /**
   * 再生開始できるか(副作用なしの純ガード)。zombie除外/記録有無/鮮度/バッファ窓の
   * 4条件は分割前 startFinalKillcam のガード1-3と同一。
   */
  canStart(elapsed: number): boolean {
    if (this.deps.isZombie()) return false;
    if (this.fkFill === 0 || this.fkKillElapsed === -Infinity) return false;
    if (fkIsStale(elapsed, this.fkKillElapsed, FK_BUFFER_S)) return false;
    const killT  = this.fkKillElapsed;
    const oldIdx = (this.fkHead - this.fkFill + FK_MAX_FRAMES) % FK_MAX_FRAMES;
    const oldest = this.fkTimeArr[oldIdx]!;
    if (oldest > killT - FK_WIN_PRE + 0.5) return false;
    return true;
  }

  /** 再生状態の初期化(canStart 通過後、Match 側クリーンアップの後に呼ぶ)。 */
  begin(): void {
    const killT  = this.fkKillElapsed;
    const oldIdx = (this.fkHead - this.fkFill + FK_MAX_FRAMES) % FK_MAX_FRAMES;
    const oldest = this.fkTimeArr[oldIdx]!;
    this.fkWinKill    = killT;
    this.fkWinEnd     = killT + CK_WIN_POST;
    // カーソルはバッファの実際の先頭(oldest)と窓先頭の大きい方から開始する。
    // oldest > killT-CK_WIN_PRE のとき先頭フレームが存在しないため、
    // fkFindFrames が iA<0 を返して再生が即終了するバグ(kill瞬間カット)の根治。
    this.fkCursor     = Math.max(oldest, killT - CK_WIN_PRE);
    // R56 W3 #4: fkPrevCursor を -Infinity のままにすると、begin() 直後の初回 advance() で
    // fkReplayShots(this.fkPrevCursor, cursor) が「バッファ中の全ショット(再生窓開始=fkCursor
    // より前の古いトレーサーも含む)」を対象にしてしまい、初フレームで一斉再発火するバグがあった。
    // fkCursor(再生窓の開始カーソル、直前行で確定済み)を初期値にすることで、初回 replay 範囲は
    // 常に [fkCursor, cursor] に限定される(窓外の古いショットは対象外)。
    this.fkPrevCursor = this.fkCursor;
    this.fkFlash      = 0;
    // ── シネマティックキルカム初期化 ──
    this._ckDollyDist = 0;
    this._ckHitSoundPlayed = false;
    this._ckFreezeLeft = 0;
    this.fkDisposePlayerAvatar();

    // R55 W-C5 [6]: killer=プレイヤーでも、キル瞬間フレームが「生きたFPS視点」でなかった場合
    // (RC-XD操縦中の決着キル等、recordFrameが録画したeye/yaw/pitch/fovはfkLast*の凍結保持値の
    // ままで「実際に見ていた画」と無関係)は一人称パスへ分岐しない。fkFindFrames(killT)で
    // キル瞬間を挟む記録フレームのライブビット(スロット8)を検査し、両フレームともFPS視点
    // だったときだけ一人称を確定する(安全側=フォールバックは常に三人称シネマ)。
    const [kfA, kfB] = this.fkFindFrames(killT);
    const killFrameWasFpsView = this.fkFrameIsFpsView(kfA) && this.fkFrameIsFpsView(kfB);
    // R55 ④: killer=プレイヤーかつキル瞬間が一人称視点だったときは一人称(fkSetCamera が
    // 毎フレーム録画値から直接カメラ姿勢を組む)。三人称基底(ckCamPos/ドリー方向/壁チェック)と
    // アバター生成は一切不要なためスキップし、武器viewmodelを表示して即 return する。
    if (this.fkKillerIsPlayer && killFrameWasFpsView) {
      this.fkFirstPersonActive = true;
      this.deps.getCamera().rotation.order = 'YXZ';
      // キル瞬間の静止値ではなく、再生窓の先頭フレームのADS姿勢から始める。
      // advance() が以後毎フレーム更新するため「決着時スコープ姿勢のまま固定」を起こさない。
      const [sfA, sfB, sfT] = this.fkFindFrames(this.fkCursor);
      const offSA = sfA * FK_FRAME_STRIDE; const offSB = sfB * FK_FRAME_STRIDE;
      const adsAtStart = fkInterpolateAds(this.fkBuf[offSA + 6]!, this.fkBuf[offSB + 6]!, sfT);
      if (this.deps.updateViewmodelReplayPose) {
        this.deps.updateViewmodelReplayPose(adsAtStart, 0);
      } else {
        this.deps.resetViewmodelAdsPose?.(adsAtStart);
      }
      this.deps.setViewmodelVisible(true);
      this.fkPlaying = true;
      return;
    }
    this.fkFirstPersonActive = false;
    this.deps.setViewmodelVisible(false);

    // キラー/ビクティム位置を初期フレームから取得してカメラ基底を計算する
    const [iA0, iB0, t0] = this.fkFindFrames(this.fkCursor);
    if (iA0 >= 0) {
      const offA0 = iA0 * FK_FRAME_STRIDE; const offB0 = iB0 * FK_FRAME_STRIDE;
      let kx: number; let ky: number; let kz: number;
      let vx: number; let vy: number; let vz: number;
      if (this.fkKillerIsPlayer) {
        kx = this.fkBuf[offA0]! + (this.fkBuf[offB0]! - this.fkBuf[offA0]!) * t0;
        ky = this.fkBuf[offA0+1]! + (this.fkBuf[offB0+1]! - this.fkBuf[offA0+1]!) * t0 - CK_EYE_H;
        kz = this.fkBuf[offA0+2]! + (this.fkBuf[offB0+2]! - this.fkBuf[offA0+2]!) * t0;
      } else {
        const ki = this.fkKillerBotIdx;
        if (ki >= 0 && ki < this.fkBotCnt[iA0]!) {
          const boA = offA0+FK_P+ki*FK_B; const boB = offB0+FK_P+ki*FK_B;
          kx = this.fkBuf[boA]!+(this.fkBuf[boB]!-this.fkBuf[boA]!)*t0;
          ky = this.fkBuf[boA+3]!+(this.fkBuf[boB+3]!-this.fkBuf[boA+3]!)*t0;
          kz = this.fkBuf[boA+2]!+(this.fkBuf[boB+2]!-this.fkBuf[boA+2]!)*t0;
        } else { kx = 0; ky = 0; kz = 0; }
      }
      if (this.fkVictimBotIdx >= 0) {
        const vi = this.fkVictimBotIdx;
        if (vi < this.fkBotCnt[iA0]!) {
          const boA = offA0+FK_P+vi*FK_B; const boB = offB0+FK_P+vi*FK_B;
          vx = this.fkBuf[boA]!+(this.fkBuf[boB]!-this.fkBuf[boA]!)*t0;
          vy = this.fkBuf[boA+3]!+(this.fkBuf[boB+3]!-this.fkBuf[boA+3]!)*t0;
          vz = this.fkBuf[boA+2]!+(this.fkBuf[boB+2]!-this.fkBuf[boA+2]!)*t0;
        } else { vx = kx; vy = ky+1.5; vz = kz; }
      } else {
        vx = this.fkBuf[offA0]!+(this.fkBuf[offB0]!-this.fkBuf[offA0]!)*t0;
        vy = this.fkBuf[offA0+1]!+(this.fkBuf[offB0+1]!-this.fkBuf[offA0+1]!)*t0;
        vz = this.fkBuf[offA0+2]!+(this.fkBuf[offB0+2]!-this.fkBuf[offA0+2]!)*t0;
      }
      const kVec = new THREE.Vector3(kx, ky, kz);
      const vVec = new THREE.Vector3(vx, vy, vz);
      // 壁チェック: サイド1→サイド-1→高さ+2 のフォールバック
      let camP = ckCamPos(kVec, vVec, 1, CK_HEIGHT);
      const rayOrg = new THREE.Vector3(camP.x, camP.y, camP.z);
      const midP = new THREE.Vector3((kx+vx)*0.5, (ky+vy)*0.5, (kz+vz)*0.5);
      const toMid = new THREE.Vector3().subVectors(midP, rayOrg).normalize();
      if (this.deps.blockedToMid(rayOrg, toMid, camP.distanceTo(midP) * 0.9)) {
        const camP2 = ckCamPos(kVec, vVec, -1, CK_HEIGHT);
        const rayOrg2 = new THREE.Vector3(camP2.x, camP2.y, camP2.z);
        const toMid2 = new THREE.Vector3().subVectors(midP, rayOrg2).normalize();
        if (this.deps.blockedToMid(rayOrg2, toMid2, camP2.distanceTo(midP) * 0.9)) {
          // 両サイドとも壁: 高さ+2m
          camP = ckCamPos(kVec, vVec, 1, CK_HEIGHT + 2);
        } else {
          camP = camP2;
        }
      }
      this._ckCamBase.copy(camP);
      // ドリー方向: kill-line の水平方向(単位ベクトル)
      const dx = vx - kx; const dz = vz - kz;
      const horizLen2 = Math.sqrt(dx*dx + dz*dz);
      if (horizLen2 > 0.01) {
        this._ckDollyDir.set(dx/horizLen2, 0, dz/horizLen2);
      } else {
        this._ckDollyDir.set(0, 0, 1);
      }
    } else {
      this._ckCamBase.set(0, CK_HEIGHT, 10);
      this._ckDollyDir.set(0, 0, 1);
    }
    // プレイヤーアバター(三人称=killerがbotのときのみ到達。victimは常にプレイヤー — R55 ④で
    // killer=プレイヤーの一人称パスは上の early-return へ分離済み)
    this.fkAvatarGroup = this.fkCreatePlayerAvatar();
    this.fkAvatarGroup.visible = false;
    this.deps.getScene().add(this.fkAvatarGroup);
    this.fkPlaying    = true;
  }

  // ── ファイナルキルカム: 記録メソッド ──────────────────────────────

  private fkCreatePlayerAvatar(): THREE.Group {
    const mat = new THREE.MeshStandardMaterial({ color: this.deps.getAllyColor(), roughness: 0.65, metalness: 0.15 });
    const g = new THREE.Group();
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.60, 0.24), mat);
    torso.position.y = 0.95; torso.castShadow = true; g.add(torso);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.27, 0.28, 0.27), mat);
    head.position.y = 1.49; head.castShadow = true; g.add(head);
    const legGeo = new THREE.BoxGeometry(0.18, 0.50, 0.20);
    for (const sx of [-0.13, 0.13] as const) {
      const leg = new THREE.Mesh(legGeo, mat);
      leg.position.set(sx, 0.50, 0); leg.castShadow = true; g.add(leg);
    }
    const armGeo = new THREE.BoxGeometry(0.14, 0.50, 0.18);
    for (const sx of [-0.33, 0.33] as const) {
      const arm = new THREE.Mesh(armGeo, mat);
      arm.position.set(sx, 0.95, 0); arm.castShadow = true; g.add(arm);
    }
    return g;
  }

  private fkDisposePlayerAvatar(): void {
    if (!this.fkAvatarGroup) return;
    this.deps.getScene().remove(this.fkAvatarGroup);
    this.fkAvatarGroup.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry.dispose();
        (obj.material as THREE.Material).dispose();
      }
    });
    this.fkAvatarGroup = null;
  }

  recordFrame(elapsed: number): void {
    const bots = this.deps.getBots();
    const h   = this.fkHead;
    const off = h * FK_FRAME_STRIDE;
    // R55 W-C3 [26]: eye/yaw/pitch/fov(スロット0-4,7)はRC-XD操縦中/旧来の死亡三人称killcam中に
    // 他システムが一時的にカメラを所有するフレームで、プレイヤーの実効視点とは無関係な値になり
    // 得る。isFpsView()(未実装なら getPlayer().alive で代替=後方互換フォールバック)が true の
    // 間だけ最新値を fkLast* へ記録し、false の間は直前の一人称有効値を保持する
    // (fkSetCameraFirstPersonが他システム由来の姿勢を再生してしまうFrankensteinフレーム防止。
    // 従来はfovのみ保護対象で、eye/yaw/pitchは未保護だった)。
    const fpsView = this.deps.isFpsView ? this.deps.isFpsView() : this.deps.getPlayer().alive;
    if (fpsView) {
      const pe = this.deps.getPlayer().eyePosition;
      this.fkLastEyeX  = pe.x;
      this.fkLastEyeY  = pe.y;
      this.fkLastEyeZ  = pe.z;
      this.fkLastYaw   = this.deps.getPlayer().yaw;
      this.fkLastPitch = this.deps.getPlayer().pitch;
      this.fkLastFov   = this.deps.getCamera().fov;
    }
    this.fkBuf[off    ] = this.fkLastEyeX;
    this.fkBuf[off + 1] = this.fkLastEyeY;
    this.fkBuf[off + 2] = this.fkLastEyeZ;
    this.fkBuf[off + 3] = this.fkLastYaw;
    this.fkBuf[off + 4] = this.fkLastPitch;
    this.fkBuf[off + 5] = this.deps.getPlayer().alive ? 1 : 0;
    this.fkBuf[off + 6] = this.deps.getAdsProgress();    // ADS率(0..1)
    this.fkBuf[off + 7] = this.fkLastFov;                              // 実効FOV(ADS縮小を含む)
    this.fkBuf[off + 8] = fpsView ? 1 : 0;               // R55 W-C5 [6]: ライブビット(このフレームがFPS視点だったか)
    const nb = Math.min(bots.length, FK_MAX_BOTS);
    this.fkBotCnt[h] = nb;
    for (let i = 0; i < nb; i++) {
      const bot  = bots[i]!;
      const bpos = bot.getPositionInto(BOT_POS_SCRATCH); // ★5 割り当てゼロ(旧: new×2/bot)
      const bo = off + FK_P + i * FK_B;
      this.fkBuf[bo    ] = bpos.x;
      this.fkBuf[bo + 1] = bpos.y;
      this.fkBuf[bo + 2] = bpos.z;
      this.fkBuf[bo + 3] = bpos.y + bot.headOffsetY; // = headPosition().y
      this.fkBuf[bo + 4] = Math.atan2(-bot.aimDir.x, -bot.aimDir.z);
      this.fkBuf[bo + 5] = bot.alive ? 1 : 0;
    }
    this.fkTimeArr[h] = elapsed;
    this.fkHead = (h + 1) % FK_MAX_FRAMES;
    if (this.fkFill < FK_MAX_FRAMES) this.fkFill++;
  }

  recordShot(
    from: THREE.Vector3,
    to: THREE.Vector3,
    color: number,
    elapsed: number,
    playerShot = false,
  ): void {
    if (this.deps.isZombie()) return;
    const h   = this.fkShotHead;
    const off = h * FK_S;
    this.fkShotBuf[off    ] = from.x;
    this.fkShotBuf[off + 1] = from.y;
    this.fkShotBuf[off + 2] = from.z;
    this.fkShotBuf[off + 3] = to.x;
    this.fkShotBuf[off + 4] = to.y;
    this.fkShotBuf[off + 5] = to.z;
    this.fkShotBuf[off + 6] = color;
    this.fkShotBuf[off + 7] = elapsed;
    this.fkShotBuf[off + 8] = playerShot ? 1 : 0;
    this.fkShotHead = (h + 1) % FK_MAX_SHOTS;
    if (this.fkShotFill < FK_MAX_SHOTS) this.fkShotFill++;
  }

  // ── ファイナルキルカム: 再生メソッド ──────────────────────────────


  advance(dt: number): boolean {
    if (!this.fkPlaying) return true;
    // シネマティックランプ速度: ckSpeedAt はモジュールレベル純粋関数
    const speed  = ckSpeedAt(this.fkCursor, this.fkWinKill);
    // R54-F7 マイクロフリーズ: キル瞬間を跨ぐフレームで killT へ正確に着地→0.12s 完全静止。
    // 省モーション時はフリーズなし(ckCursorStep 内で分岐、従来の連続前進と同一)
    const stepped = ckCursorStep(
      this.fkCursor, dt, speed, this.fkWinKill, this._ckFreezeLeft, this.deps.reduceMotion(),
    );
    this.fkCursor = stepped.cursor;
    this._ckFreezeLeft = stepped.freezeLeft;
    // ドリー前進(スロー中も同じレートで動かして映画的なヌルっと感を出す)。
    // フリーズ中のみ freeze frame の意図どおり完全静止させる
    if (this._ckFreezeLeft <= 0) this._ckDollyDist += dt * CK_DOLLY_SPD;
    const cursor = this.fkCursor;
    if (cursor >= this.fkWinEnd) {
      this.fkPlaying = false;
      this.fkDisposePlayerAvatar();
      this.deps.setViewmodelVisible(true); // R55 ④: 一人称/三人称どちらでも通常表示へ復元
      return true;
    }
    const [iA, iB, t] = this.fkFindFrames(cursor);
    // iA<0 = カーソルがまだ最初の記録フレーム前(バッファ先頭に到達していない)。
    // 古い実装では即終了していた(kill瞬間カットの旧バグ)が、startFinalKillcam の
    // cursor=max(oldest,…) クランプで通常は発生しない。防衛的に継続する。
    if (iA < 0) return false;
    this.fkApplyFrame(iA, iB, t);
    this.fkSetCamera(iA, iB, t);
    if (this.fkFirstPersonActive) {
      const offA = iA * FK_FRAME_STRIDE;
      const offB = iB * FK_FRAME_STRIDE;
      const ads = fkInterpolateAds(this.fkBuf[offA + 6]!, this.fkBuf[offB + 6]!, t);
      // viewmodelの反動・機関部もキルカメラのゲーム時間で進める。実時間dtを使うと
      // 0.2倍スロー中だけ銃の反動が通常速度で戻り、背景と銃の時間軸が分離してしまう。
      this.deps.updateViewmodelReplayPose?.(ads, Math.max(0, cursor - this.fkPrevCursor));
    }
    // キル瞬間: 白フラッシュ小 + ヒット音(1回のみ)
    const afterKill = cursor - this.fkWinKill;
    if (afterKill >= 0) {
      if (!this._ckHitSoundPlayed) {
        this._ckHitSoundPlayed = true;
        this.deps.playHit();
      }
      if (!this.deps.reduceMotion() && afterKill < 0.05) {
        this.fkFlash = Math.max(this.fkFlash, (1 - afterKill / 0.05) * 0.4);
      }
    }
    this.fkFlash = Math.max(0, this.fkFlash - dt * 4);
    // ショット再生(prevCursor..cursor の範囲のみ。重複なし)
    this.fkReplayShots(this.fkPrevCursor, cursor);
    this.fkPrevCursor = cursor;
    // エフェクト・アトモスフィアを前進(トレーサー消滅 / 草揺れ維持)
    this.deps.updateEffects(dt);
    this.deps.updateAtmosphere(dt);
    return false;
  }


  /** R55 W-C5 [6]: フレームindex(fkFindFrames由来)のライブビット(スロット8)を読む。idx<0はfalse。 */
  private fkFrameIsFpsView(idx: number): boolean {
    if (idx < 0) return false;
    return this.fkBuf[idx * FK_FRAME_STRIDE + 8]! > 0.5;
  }

  private fkFindFrames(cursor: number): [number, number, number] {
    if (this.fkFill === 0) return [-1, -1, 0];
    let bestA = -1; let bestATime = -Infinity;
    let bestB = -1; let bestBTime =  Infinity;
    for (let i = 0; i < this.fkFill; i++) {
      const idx = (this.fkHead - this.fkFill + i + FK_MAX_FRAMES) % FK_MAX_FRAMES;
      const ft  = this.fkTimeArr[idx]!;
      if (ft <= cursor && ft > bestATime) { bestATime = ft; bestA = idx; }
      if (ft >  cursor && ft < bestBTime) { bestBTime = ft; bestB = idx; }
    }
    if (bestA < 0) return [-1, -1, 0];
    if (bestB < 0) return [bestA, bestA, 0];
    const span = Math.max(1e-6, bestBTime - bestATime);
    return [bestA, bestB, Math.min(1, Math.max(0, (cursor - bestATime) / span))];
  }

  private fkApplyFrame(iA: number, iB: number, t: number): void {
    const bots = this.deps.getBots();
    const offA   = iA * FK_FRAME_STRIDE;
    const offB   = iB * FK_FRAME_STRIDE;
    const nbA    = this.fkBotCnt[iA]!;
    const nbB    = this.fkBotCnt[iB]!;
    const nb     = Math.min(nbA, nbB, bots.length);
    const cursor = this.fkCursor;
    const killT  = this.fkWinKill;

    for (let i = 0; i < bots.length; i++) {
      const bot = bots[i]!;
      if (i < nb) {
        const boA = offA + FK_P + i * FK_B;
        const boB = offB + FK_P + i * FK_B;
        const bx  = this.fkBuf[boA    ]! + (this.fkBuf[boB    ]! - this.fkBuf[boA    ]!) * t;
        const by  = this.fkBuf[boA + 1]! + (this.fkBuf[boB + 1]! - this.fkBuf[boA + 1]!) * t;
        const bz  = this.fkBuf[boA + 2]! + (this.fkBuf[boB + 2]! - this.fkBuf[boA + 2]!) * t;
        const ya  = this.fkBuf[boA + 4]!;
        const yb  = this.fkBuf[boB + 4]!;
        let   yd  = yb - ya;
        if (yd >  Math.PI) yd -= Math.PI * 2;
        if (yd < -Math.PI) yd += Math.PI * 2;
        const byaw = ya + yd * t;

        if (i === this.fkVictimBotIdx) {
          // 被害者ボット: キル前はalive姿勢で表示、キル後は死亡アニメを手続き再現
          bot.group.visible = true;
          // T5: 位置/回転の適用+死亡演出トランスフォームのalive姿勢への巻き戻しは
          // Bot公開APIへ委譲(旧 FkBotRig 経由の private フィールド直接操作を撤去)
          bot.fkApplyLivePose(bx, by, bz, byaw);
          if (cursor >= killT) {
            // キル後: 経過時間を正規化(0..1)して死亡ポーズを手続き的に再現(倒れる瞬間を見せる)
            const totalS = FK_DEATH_S[bot.kind] ?? 0.6;
            const t01 = Math.min(1, Math.max(0, (cursor - killT) / totalS));
            bot.fkApplyDeathPose(t01);
          }
        } else {
          // 非被害者ボット: バッファのaliveフラグに従う
          const balive = (this.fkBuf[boA + 5]! > 0.5) || (this.fkBuf[boB + 5]! > 0.5);
          if (balive) {
            // alive表示時は位置/回転の適用+死亡演出トランスフォームのリセットをBot側で行う
            // (fkApplyLivePose内でvisible=trueも設定される)
            bot.fkApplyLivePose(bx, by, bz, byaw);
          } else {
            // 非alive表示: fkApplyLivePose は呼ばない(pose強制リセット+visible=trueを避ける)。
            // 位置/回転は公開フィールドのgroupへ直接同期し、visibleのみfalseにする(bot.ts契約)
            bot.group.position.set(bx, by, bz);
            bot.group.rotation.y = byaw;
            bot.group.visible = false;
          }
        }
      } else {
        bot.group.visible = false;
      }
    }
  }

  /**
   * R55 ④: 一人称ファイナルキルカムのカメラ姿勢適用(killer=プレイヤーのときのみ)。
   * 録画済みの眼位置/yaw/pitch/実効FOVを fkFirstPersonCam(純粋関数)へ渡し、その戻り値を
   * そのままカメラへ適用する。lookAt は使わない(rotation直接=通常カメラ規約と同一)。
   */
  private fkSetCameraFirstPerson(offA: number, offB: number, t: number): void {
    const eyeX = this.fkBuf[offA]!     + (this.fkBuf[offB]!     - this.fkBuf[offA]!)     * t;
    const eyeY = this.fkBuf[offA + 1]! + (this.fkBuf[offB + 1]! - this.fkBuf[offA + 1]!) * t;
    const eyeZ = this.fkBuf[offA + 2]! + (this.fkBuf[offB + 2]! - this.fkBuf[offA + 2]!) * t;
    const ya = this.fkBuf[offA + 3]!; const yb = this.fkBuf[offB + 3]!;
    let yd = yb - ya;
    if (yd >  Math.PI) yd -= Math.PI * 2;
    if (yd < -Math.PI) yd += Math.PI * 2;
    const yaw   = ya + yd * t;
    const pitch = this.fkBuf[offA + 4]! + (this.fkBuf[offB + 4]! - this.fkBuf[offA + 4]!) * t;
    const fovRaw = this.fkBuf[offA + 7]! + (this.fkBuf[offB + 7]! - this.fkBuf[offA + 7]!) * t;
    // R55 W-C2 ④: 防御的クランプ(recordFrame側のisFpsViewゲートが主対策)。物理的にありえない
    // 範囲外の値(将来の未知バグ等)だけを弾く保険で、正規のADS/移動FOV(12-130度)は削らない。
    const fov = THREE.MathUtils.clamp(fovRaw, FK_FP_FOV_MIN, FK_FP_FOV_MAX);
    const pose = fkFirstPersonCam(eyeX, eyeY, eyeZ, yaw, pitch, fov);
    const camera = this.deps.getCamera();
    camera.rotation.order = 'YXZ';
    camera.position.set(pose.x, pose.y, pose.z);
    camera.rotation.y = pose.rotY;
    camera.rotation.x = pose.rotX;
    camera.rotation.z = pose.rotZ;
    if (Math.abs(camera.fov - pose.fov) > 0.01) {
      camera.fov = pose.fov;
      camera.updateProjectionMatrix();
    }
  }

  private fkSetCamera(iA: number, iB: number, t: number): void {
    const offA = iA * FK_FRAME_STRIDE;
    const offB = iB * FK_FRAME_STRIDE;

    // R55 ④/W-C5 [6]: 一人称専用パスへは実際に採用されたカメラモード(fkFirstPersonActive)で
    // 分岐する(fkKillerIsPlayer生値ではない — begin()がキル瞬間フレームの非FPS視点を検出した
    // 場合、fkKillerIsPlayer===trueのまま三人称シネマへフォールバックしているため)。
    if (this.fkFirstPersonActive) {
      this.fkSetCameraFirstPerson(offA, offB, t);
      return;
    }
    const cursor = this.fkCursor;

    // ── キラー位置を補間 ──
    let killerX: number; let killerY: number; let killerZ: number; let killerYaw = 0;
    if (this.fkKillerIsPlayer) {
      killerX = this.fkBuf[offA]! + (this.fkBuf[offB]! - this.fkBuf[offA]!) * t;
      killerY = this.fkBuf[offA+1]! + (this.fkBuf[offB+1]! - this.fkBuf[offA+1]!) * t - CK_EYE_H;
      killerZ = this.fkBuf[offA+2]! + (this.fkBuf[offB+2]! - this.fkBuf[offA+2]!) * t;
      const ya = this.fkBuf[offA+3]!; const yb = this.fkBuf[offB+3]!;
      let yd = yb - ya;
      if (yd >  Math.PI) yd -= Math.PI * 2;
      if (yd < -Math.PI) yd += Math.PI * 2;
      killerYaw = ya + yd * t;
    } else {
      const ki = this.fkKillerBotIdx;
      const nbA = this.fkBotCnt[iA]!;
      if (ki >= 0 && ki < nbA) {
        const boA = offA+FK_P+ki*FK_B; const boB = offB+FK_P+ki*FK_B;
        killerX = this.fkBuf[boA]! + (this.fkBuf[boB]! - this.fkBuf[boA]!) * t;
        killerY = this.fkBuf[boA+3]! + (this.fkBuf[boB+3]! - this.fkBuf[boA+3]!) * t;
        killerZ = this.fkBuf[boA+2]! + (this.fkBuf[boB+2]! - this.fkBuf[boA+2]!) * t;
        const ya = this.fkBuf[boA+4]!; const yb = this.fkBuf[boB+4]!;
        let yd = yb - ya;
        if (yd >  Math.PI) yd -= Math.PI * 2;
        if (yd < -Math.PI) yd += Math.PI * 2;
        killerYaw = ya + yd * t;
      } else {
        killerX = this._ckCamBase.x; killerY = this._ckCamBase.y; killerZ = this._ckCamBase.z;
      }
    }

    // ── ビクティム位置を補間 ──
    let victimX: number; let victimY: number; let victimZ: number;
    if (this.fkVictimBotIdx >= 0) {
      const vi = this.fkVictimBotIdx;
      if (vi < this.fkBotCnt[iA]!) {
        const boA = offA+FK_P+vi*FK_B; const boB = offB+FK_P+vi*FK_B;
        victimX = this.fkBuf[boA]! + (this.fkBuf[boB]! - this.fkBuf[boA]!) * t;
        victimY = this.fkBuf[boA+3]! + (this.fkBuf[boB+3]! - this.fkBuf[boA+3]!) * t;
        victimZ = this.fkBuf[boA+2]! + (this.fkBuf[boB+2]! - this.fkBuf[boA+2]!) * t;
      } else {
        victimX = this._ckCamBase.x; victimY = this._ckCamBase.y + 1.5; victimZ = this._ckCamBase.z;
      }
    } else {
      victimX = this.fkBuf[offA]! + (this.fkBuf[offB]! - this.fkBuf[offA]!) * t;
      victimY = this.fkBuf[offA+1]! + (this.fkBuf[offB+1]! - this.fkBuf[offA+1]!) * t;
      victimZ = this.fkBuf[offA+2]! + (this.fkBuf[offB+2]! - this.fkBuf[offA+2]!) * t;
    }

    // ── プレイヤーアバター更新(3人称) ──
    if (this.fkAvatarGroup) {
      if (this.fkKillerIsPlayer) {
        // killerがプレイヤー → アバターをkiller位置へ
        this.fkAvatarGroup.position.set(killerX, killerY, killerZ);
        this.fkAvatarGroup.rotation.y = killerYaw;
        this.fkAvatarGroup.rotation.x = 0;
      } else {
        // victimがプレイヤー → アバターをvictim位置へ(死亡倒れアニメ付き)
        const va = this.fkBuf[offA+3]!; const vb = this.fkBuf[offB+3]!;
        let vyd = vb - va;
        if (vyd >  Math.PI) vyd -= Math.PI * 2;
        if (vyd < -Math.PI) vyd += Math.PI * 2;
        this.fkAvatarGroup.position.set(victimX, victimY - CK_EYE_H, victimZ);
        this.fkAvatarGroup.rotation.y = va + vyd * t;
        if (cursor >= this.fkWinKill) {
          const dpT = Math.min(1, (cursor - this.fkWinKill) / 0.6);
          const dpSS = dpT * dpT * (3 - 2 * dpT);
          this.fkAvatarGroup.rotation.x = dpSS * (Math.PI / 2) * 0.95;
        } else {
          this.fkAvatarGroup.rotation.x = 0;
        }
      }
      this.fkAvatarGroup.visible = true;
    }

    // ── シネマティックカメラ ──
    // V48修正: 近距離は中点寄りを注視して両者をフレームイン、遠距離は被害者を注視
    {
      const dx = victimX - killerX; const dz = victimZ - killerZ;
      const segL = Math.sqrt(dx * dx + dz * dz);
      const lookT = Math.min(1, Math.max(0, (segL - 18) / 24)); // 0=中点寄り, 1=被害者
      const mixV = 0.55 + 0.45 * lookT; // 被害者の重み 0.55..1.0
      this._kcLook.set(
        victimX * mixV + (killerX + victimX) * 0.5 * (1 - mixV),
        victimY * mixV + (killerY + victimY) * 0.5 * (1 - mixV),
        victimZ * mixV + (killerZ + victimZ) * 0.5 * (1 - mixV),
      );
    }
    this.deps.getCamera().position.copy(this._ckCamBase).addScaledVector(this._ckDollyDir, this._ckDollyDist);
    this.deps.getCamera().lookAt(this._kcLook);
    // R54-F7 FOVランプ: 52(接近)→46(キル瞬間ズームイン)→50(基準)。省モーション時は固定50
    const targetFov = this.deps.reduceMotion() ? CK_FOV : ckFovAt(cursor, this.fkWinKill);
    if (Math.abs(this.deps.getCamera().fov - targetFov) > 0.01) {
      this.deps.getCamera().fov = targetFov;
      this.deps.getCamera().updateProjectionMatrix();
    }
  }

  private fkReplayShots(prevCursor: number, cursor: number): void {
    for (let i = 0; i < this.fkShotFill; i++) {
      const h   = (this.fkShotHead - this.fkShotFill + i + FK_MAX_SHOTS) % FK_MAX_SHOTS;
      const off = h * FK_S;
      const st  = this.fkShotBuf[off + 7]!;
      if (fkShotShouldReplay(st, prevCursor, cursor)) {
        this.deps.tracer(
          new THREE.Vector3(this.fkShotBuf[off    ]!, this.fkShotBuf[off + 1]!, this.fkShotBuf[off + 2]!),
          new THREE.Vector3(this.fkShotBuf[off + 3]!, this.fkShotBuf[off + 4]!, this.fkShotBuf[off + 5]!),
          this.fkShotBuf[off + 6]!,
        );
        if (this.fkFirstPersonActive && this.fkShotBuf[off + 8]! > 0.5) {
          this.deps.replayViewmodelShot?.();
        }
      }
    }
  }

  /** アバター等の解放(Match.dispose から)。 */
  dispose(): void {
    this.fkDisposePlayerAvatar();
    this.deps.setViewmodelVisible(true); // R55 ④: 三人称キルカム中の非表示上書き(false)を通常表示へ復元(一人称時は既にtrue)
  }
}
