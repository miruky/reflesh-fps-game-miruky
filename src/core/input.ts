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
  scoreboard: ['Tab'],
};

export class Input {
  mouseDX = 0;
  mouseDY = 0;
  wheelDelta = 0;

  private readonly down = new Set<string>();
  private readonly pressed = new Set<string>();
  private readonly released = new Set<string>();
  private readonly mouseDown = [false, false, false];
  private readonly mousePressed = [false, false, false];
  private bindings = DEFAULT_BINDINGS;

  attach(target: HTMLElement): void {
    window.addEventListener('keydown', (e) => {
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
    return this.bindings[action].some((code) => this.down.has(code));
  }

  // 読み取りと同時に消費する。固定タイムステップ側で取りこぼしなく拾うため、
  // フレーム境界では消さない。
  wasPressed(action: Action): boolean {
    let hit = false;
    for (const code of this.bindings[action]) {
      if (this.pressed.delete(code)) hit = true;
    }
    return hit;
  }

  // キーを離した立ち下がり。読み取りと同時に消費する
  wasReleased(action: Action): boolean {
    let hit = false;
    for (const code of this.bindings[action]) {
      if (this.released.delete(code)) hit = true;
    }
    return hit;
  }

  consumeWheel(): number {
    const delta = this.wheelDelta;
    this.wheelDelta = 0;
    return delta;
  }

  fireDown(): boolean {
    return this.mouseDown[0] ?? false;
  }

  adsDown(): boolean {
    return this.mouseDown[2] ?? false;
  }

  // 右クリックの立ち上がり。読み取りと同時に消費する
  adsPressed(): boolean {
    if (this.mousePressed[2]) {
      this.mousePressed[2] = false;
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
}
