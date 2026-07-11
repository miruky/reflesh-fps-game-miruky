// R56根治の回帰テスト: requestStageThumb のキャッシュ命中コールバックは
// 「同期」ではなく「マイクロタスク」で発火しなければならない。
//
// 背景: 呼び出し元(deploy.ts / menu.ts)は <img> を DOM へ挿入する前に
// requestStageThumb を呼ぶ。同期でコールバックすると deploy.ts の
// `if (img.isConnected) img.src = url` ガードが握り潰し、キャッシュ命中の
// 再訪時にサムネが二度と貼られず空→床グラデ(プレースホルダ)だけが残る。
// このテストは修正が無い(同期コールバック)状態では最初の expect で落ちる。
//
// 環境は node(WebGL 不可)のため THREE.WebGLRenderer だけを偽装し、
// generateStage・全ジオメトリ/マテリアルは実物のまま走らせる。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('three', async (importActual) => {
  const actual = await importActual<typeof import('three')>();
  // toDataURL が非空(>200 文字)を返す最小の偽レンダラ。これで thumbCache に載る。
  class FakeWebGLRenderer {
    domElement = {
      width: 320,
      height: 184,
      toDataURL: (): string => 'data:image/webp;base64,' + 'A'.repeat(512),
    };
    toneMapping = 0;
    outputColorSpace = '';
    toneMappingExposure = 1;
    setPixelRatio(): void {}
    setSize(w: number, h: number): void {
      this.domElement.width = w;
      this.domElement.height = h;
    }
    render(): void {}
    dispose(): void {}
  }
  return { ...actual, WebGLRenderer: FakeWebGLRenderer };
});

// getRenderer() の document.createElement('canvas') 用の最小 DOM スタブ。
const origDocument = (globalThis as { document?: unknown }).document;
beforeEach(() => {
  (globalThis as { document?: unknown }).document = {
    createElement: (): { width: number; height: number } => ({ width: 0, height: 0 }),
  };
});
afterEach(() => {
  (globalThis as { document?: unknown }).document = origDocument;
  vi.resetModules();
});

describe('requestStageThumb キャッシュ命中コールバックの遅延契約(R56根治)', () => {
  it('キャッシュ命中時、コールバックは同期ではなくマイクロタスクで発火する', async () => {
    const { renderStageThumb, requestStageThumb } = await import('./stage-thumbs');
    const { STAGES } = await import('../game/stages');
    const def = STAGES[0]!;

    // 1) 同期レンダでキャッシュを温める(偽レンダラで非空 dataURL → thumbCache に載る)
    const url = renderStageThumb(def);
    expect(url.length).toBeGreaterThan(200);

    // 2) キャッシュ命中の requestStageThumb: 同期実行中にコールバックが呼ばれてはならない
    let called = false;
    let deliveredUrl = '';
    requestStageThumb(def, (u) => {
      called = true;
      deliveredUrl = u;
    });
    // ★根治の核心: この時点(呼び出し元の <img> がまだ DOM 未接続の瞬間に相当)では未発火
    expect(called).toBe(false);

    // 3) マイクロタスク境界を跨ぐと発火し、キャッシュ済み URL が届く
    await Promise.resolve();
    expect(called).toBe(true);
    expect(deliveredUrl).toBe(url);
  });

  it('同一ステージへの複数リクエストも各コールバックへ非同期に配送される', async () => {
    const { renderStageThumb, requestStageThumb } = await import('./stage-thumbs');
    const { STAGES } = await import('../game/stages');
    const def = STAGES[0]!;
    renderStageThumb(def); // キャッシュを温める

    const hits: number[] = [];
    requestStageThumb(def, () => hits.push(1));
    requestStageThumb(def, () => hits.push(2));
    expect(hits).toEqual([]); // どちらも同期では呼ばれない
    await Promise.resolve();
    expect(hits.sort()).toEqual([1, 2]);
  });
});
