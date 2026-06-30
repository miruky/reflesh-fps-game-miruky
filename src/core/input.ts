import {
  AX,
  BO3_DEFAULT,
  GP,
  TRIGGER_ADS,
  TRIGGER_FIRE,
  applyCurve,
  scaledRadialDeadzone,
  type GamepadBinding,
  type GamepadBindings,
  type GamepadCfg,
  type PadAction,
} from './gamepad';

export type Action =
  | 'forward'
  | 'back'
  | 'left'
  | 'right'
  | 'jump'
  | 'crouch'
  | 'sprint'
  | 'reload'
  | 'melee'
  | 'weapon1'
  | 'weapon2'
  | 'grenade'
  | 'grenadeswitch'
  | 'leanleft'
  | 'leanright'
  | 'ultimate'
  | 'holdBreath'
  | 'scoreboard';

export const DEFAULT_BINDINGS: Record<Action, string[]> = {
  forward: ['KeyW'],
  back: ['KeyS'],
  left: ['KeyA'],
  right: ['KeyD'],
  jump: ['Space'],
  crouch: ['KeyC', 'ControlLeft'],
  sprint: ['ShiftLeft'],
  reload: ['KeyR'],
  melee: ['KeyV'],
  weapon1: ['Digit1'],
  weapon2: ['Digit2'],
  grenade: ['KeyG'],
  grenadeswitch: ['Digit3'],
  leanleft: ['KeyQ'],
  leanright: ['KeyE'],
  ultimate: ['KeyF'],
  // 息止めはスプリントキーと共有。覗き込み中のみ参照する(ADS中はスプリント不可)
  holdBreath: ['ShiftLeft'],
  scoreboard: ['Tab'],
};

// 右スティックの基準角速度(rad/s)。sens 2.5 で約150°/s
const GP_LOOK_RATE = (60 * Math.PI) / 180;

// 一部ブラウザの型に playEffect が無いため最小形で受ける
interface HapticActuatorLike {
  playEffect?: (type: string, params: Record<string, number>) => Promise<unknown>;
}

export class Input {
  mouseDX = 0;
  mouseDY = 0;
  wheelDelta = 0;

  // ── ゲームパッド(公開): match が毎フレーム読む ──
  gpMoveX = 0; // 左スティック横(-1..1)
  gpMoveZ = 0; // 左スティック前後(前=+)
  gpYawBase = 0; // 右スティック由来の素のヨー角速度*dt(rad)
  gpPitchBase = 0; // 同ピッチ(invert/adsは frame 側で適用)
  gpLookMag = 0; // 右スティック量(0..1, エイムアシスト判定)
  lastDevice: 'keyboard' | 'gamepad' = 'keyboard';

  private readonly down = new Set<string>();
  private readonly pressed = new Set<string>();
  private readonly released = new Set<string>();
  private readonly mouseDown = [false, false, false];
  private readonly mousePressed = [false, false, false];
  private bindings = DEFAULT_BINDINGS;

  // ── ゲームパッド(内部) ──
  private gpBindings: GamepadBindings = BO3_DEFAULT;
  private readonly gpActive = new Set<Action>(); // 押下中(毎ポーリング再構築)
  private readonly gpPressed = new Set<Action>(); // 立ち上がり(蓄積・読取で消費)
  private readonly gpReleased = new Set<Action>(); // 立ち下がり(蓄積・読取で消費)
  private readonly gpPrevPad = new Map<PadAction, boolean>();
  private readonly gpPrevButtons: boolean[] = [];
  private gpFire = false;
  private gpAds = false;
  private gpAdsPressed = false;
  private gpPrevPause = false;
  private gpPausePressed = false;
  private vibrationEnabled = true; // 設定で切替。false なら vibrate() は無音
  private rebindCb: ((b: GamepadBinding) => void) | null = null;

  attach(target: HTMLElement): void {
    window.addEventListener('keydown', (e) => {
      this.lastDevice = 'keyboard';
      // メニュー表示中(ロック外)はTabによるフォーカス移動を妨げない
      if (e.code === 'Tab' && this.locked) e.preventDefault();
      if (!e.repeat) {
        this.down.add(e.code);
        this.pressed.add(e.code);
      }
    });
    // ロック状態の切替をまたいで単発入力を持ち越さない。
    // メニューで押したキーやクリックが復帰直後に発火するのを防ぐ。
    // 押しっぱなしのキーはkeyupで自然に消えるためdownは消さない。
    document.addEventListener('pointerlockchange', () => {
      this.pressed.clear();
      this.released.clear();
      for (let i = 0; i < 3; i += 1) this.mousePressed[i] = false;
      this.mouseDX = 0;
      this.mouseDY = 0;
      this.wheelDelta = 0;
      // ゲームパッドの単発入力もキーボードと対称に持ち越さない。
      // ポーズ/メニュー中に押したボタンが復帰直後の最初の update で暴発するのを防ぐ
      this.gpPressed.clear();
      this.gpReleased.clear();
      this.gpAdsPressed = false;
    });
    window.addEventListener('keyup', (e) => {
      if (this.down.delete(e.code)) this.released.add(e.code);
    });
    window.addEventListener('blur', () => {
      this.down.clear();
      for (let i = 0; i < 3; i += 1) this.mouseDown[i] = false;
    });
    target.addEventListener('mousedown', (e) => {
      if (!this.locked) return;
      this.lastDevice = 'keyboard';
      this.mouseDown[e.button] = true;
      this.mousePressed[e.button] = true;
    });
    window.addEventListener('mouseup', (e) => {
      this.mouseDown[e.button] = false;
    });
    window.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.mouseDX += e.movementX;
      this.mouseDY += e.movementY;
    });
    window.addEventListener(
      'wheel',
      (e) => {
        if (this.locked) this.wheelDelta += Math.sign(e.deltaY);
      },
      { passive: true },
    );
    target.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  get locked(): boolean {
    return document.pointerLockElement !== null;
  }

  requestLock(target: HTMLElement): void {
    if (!this.locked) target.requestPointerLock();
  }

  exitLock(): void {
    if (this.locked) document.exitPointerLock();
  }

  onLockChange(handler: (locked: boolean) => void): void {
    document.addEventListener('pointerlockchange', () => handler(this.locked));
  }

  isDown(action: Action): boolean {
    return this.bindings[action].some((code) => this.down.has(code)) || this.gpActive.has(action);
  }

  // 読み取りと同時に消費する。固定タイムステップ側で取りこぼしなく拾うため、
  // フレーム境界では消さない。
  wasPressed(action: Action): boolean {
    let hit = false;
    for (const code of this.bindings[action]) {
      if (this.pressed.delete(code)) hit = true;
    }
    if (this.gpPressed.delete(action)) hit = true;
    return hit;
  }

  // キーを離した立ち下がり。読み取りと同時に消費する
  wasReleased(action: Action): boolean {
    let hit = false;
    for (const code of this.bindings[action]) {
      if (this.released.delete(code)) hit = true;
    }
    if (this.gpReleased.delete(action)) hit = true;
    return hit;
  }

  consumeWheel(): number {
    const delta = this.wheelDelta;
    this.wheelDelta = 0;
    return delta;
  }

  fireDown(): boolean {
    return (this.mouseDown[0] ?? false) || this.gpFire;
  }

  adsDown(): boolean {
    return (this.mouseDown[2] ?? false) || this.gpAds;
  }

  // 右クリック/L2 の立ち上がり。読み取りと同時に消費する
  adsPressed(): boolean {
    if (this.mousePressed[2]) {
      this.mousePressed[2] = false;
      return true;
    }
    if (this.gpAdsPressed) {
      this.gpAdsPressed = false;
      return true;
    }
    return false;
  }

  // 描画フレーム末に呼ぶ。マウス相対量のみリセットする
  endFrame(): void {
    for (let i = 0; i < 3; i += 1) this.mousePressed[i] = false;
    this.mouseDX = 0;
    this.mouseDY = 0;
  }

  // ── ゲームパッド ──────────────────────────────────────────────
  setGamepadBindings(b: GamepadBindings): void {
    this.gpBindings = b;
  }

  // 次に押されたボタンを1つ捕捉してコールバックする(リバインドUI用)。捕捉中はゲームプレイへ流さない
  captureNextButton(cb: (b: GamepadBinding) => void): void {
    this.rebindCb = cb;
  }

  cancelCapture(): void {
    this.rebindCb = null;
  }

  // Options(一時停止)の立ち上がりを消費する
  consumePausePressed(): boolean {
    const v = this.gpPausePressed;
    this.gpPausePressed = false;
    return v;
  }

  // 振動の有効/無効。設定変更時に main から伝える
  setVibration(enabled: boolean): void {
    this.vibrationEnabled = enabled;
  }

  // 対応環境のみ振動。設定offや非対応は無害に無視
  vibrate(durationMs: number, weak: number, strong: number): void {
    if (!this.vibrationEnabled) return;
    const pad = this.primaryGamepad();
    const act = pad?.vibrationActuator as HapticActuatorLike | undefined;
    if (act?.playEffect) {
      void act
        .playEffect('dual-rumble', {
          duration: durationMs,
          weakMagnitude: weak,
          strongMagnitude: strong,
        })
        .catch(() => undefined);
    }
  }

  private primaryGamepad(): Gamepad | null {
    const pads = typeof navigator.getGamepads === 'function' ? navigator.getGamepads() : [];
    for (const p of pads) {
      if (p && p.mapping === 'standard') return p;
    }
    return null;
  }

  private bindingActive(gp: Gamepad, b: GamepadBinding): boolean {
    if (b.kind === 'button') return gp.buttons[b.index]?.pressed ?? false;
    return (gp.buttons[b.index]?.value ?? 0) >= b.threshold;
  }

  private neutralizeGamepad(): void {
    this.gpMoveX = 0;
    this.gpMoveZ = 0;
    this.gpYawBase = 0;
    this.gpPitchBase = 0;
    this.gpLookMag = 0;
    this.gpFire = false;
    this.gpAds = false;
    this.gpActive.clear();
    // 切断時に立ち上がり/下がりが残って復帰後に暴発しないようエッジも消す
    this.gpPressed.clear();
    this.gpReleased.clear();
    this.gpAdsPressed = false;
  }

  // 毎フレーム1回ポーリングして状態を更新する(GameLoop.preTick から呼ぶ)
  pollGamepad(dt: number, cfg: GamepadCfg): void {
    const gp = this.primaryGamepad();
    if (!gp) {
      this.neutralizeGamepad();
      return;
    }

    // リバインド捕捉中: 最初に押されたボタンを拾い、ゲームプレイへは流さない
    if (this.rebindCb) {
      for (let i = 0; i < gp.buttons.length; i += 1) {
        // OPTIONS(一時停止予約)と PS は割り当て対象外。捕捉しても二重機能になるため飛ばす
        if (i === GP.OPTIONS || i === GP.PS) continue;
        const cur = gp.buttons[i]?.pressed ?? false;
        if (cur && !(this.gpPrevButtons[i] ?? false)) {
          const binding: GamepadBinding =
            i === GP.L2 || i === GP.R2
              ? { kind: 'trigger', index: i, threshold: i === GP.R2 ? TRIGGER_FIRE : TRIGGER_ADS }
              : { kind: 'button', index: i };
          this.rebindCb(binding);
          this.rebindCb = null;
          break;
        }
      }
      this.snapshotButtons(gp);
      return;
    }

    // 左スティック → 移動(スケール付きradialデッドゾーン + 応答カーブ)
    const ld = scaledRadialDeadzone(gp.axes[AX.LX] ?? 0, gp.axes[AX.LY] ?? 0, cfg.deadzone);
    this.gpMoveX = applyCurve(ld.x, cfg.curve, cfg.exp);
    this.gpMoveZ = -applyCurve(ld.y, cfg.curve, cfg.exp); // 上=前進=+

    // 右スティック → 視点(符号/感度/反転/ADS減速は match.frame で適用)
    const rd = scaledRadialDeadzone(gp.axes[AX.RX] ?? 0, gp.axes[AX.RY] ?? 0, cfg.deadzone);
    const cx = applyCurve(rd.x, cfg.curve, cfg.exp);
    const cy = applyCurve(rd.y, cfg.curve, cfg.exp);
    this.gpLookMag = Math.hypot(cx, cy);
    this.gpYawBase = cx * cfg.sensX * GP_LOOK_RATE * dt;
    this.gpPitchBase = cy * cfg.sensY * GP_LOOK_RATE * dt;

    let anyInput = this.gpLookMag > 0 || Math.hypot(this.gpMoveX, this.gpMoveZ) > 0;

    // デジタル/トリガー → アクション束ね
    this.gpActive.clear();
    for (const key of Object.keys(this.gpBindings) as PadAction[]) {
      let active = false;
      for (const b of this.gpBindings[key]) {
        if (this.bindingActive(gp, b)) {
          active = true;
          break;
        }
      }
      const prev = this.gpPrevPad.get(key) ?? false;
      if (active) anyInput = true;
      this.applyPadAction(key, active, prev);
      this.gpPrevPad.set(key, active);
    }

    // Options(一時停止)はバインド対象外として個別に
    const opt = gp.buttons[GP.OPTIONS]?.pressed ?? false;
    if (opt && !this.gpPrevPause) this.gpPausePressed = true;
    this.gpPrevPause = opt;
    if (opt) anyInput = true;

    this.snapshotButtons(gp);
    if (anyInput) this.lastDevice = 'gamepad';
  }

  private applyPadAction(action: PadAction, active: boolean, prev: boolean): void {
    if (action === 'fire') {
      this.gpFire = active;
      return;
    }
    if (action === 'ads') {
      if (active && !prev) this.gpAdsPressed = true;
      this.gpAds = active;
      return;
    }
    if (action === 'weaponswitch') {
      if (active && !prev) this.wheelDelta += 1; // 武器巡回をホイール経路へ注入
      return;
    }
    const a = action as Action;
    if (active) this.gpActive.add(a);
    if (active && !prev) this.gpPressed.add(a);
    if (!active && prev) this.gpReleased.add(a);
  }

  private snapshotButtons(gp: Gamepad): void {
    for (let i = 0; i < gp.buttons.length; i += 1) {
      this.gpPrevButtons[i] = gp.buttons[i]?.pressed ?? false;
    }
  }
}
