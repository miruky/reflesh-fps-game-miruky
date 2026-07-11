import { describe, expect, it } from 'vitest';
// ソースを文字列として取り込む(?raw は vite/client.d.ts の型宣言でtsc上も安全。
// 本リポジトリに @types/node は無く node:fs は使えないため、Vite の raw import を使う)
import matchSrc from './match.ts?raw';

// R57 ⑥修正1 回帰テスト: ファイナルキルカム開始時の humanoid 群InstancedMesh 解放。
//
// 背景(main.ts の実フロー、コード追跡で確認済み):
//   main.ts のフレームコールバックは
//     1) `mode === 'playing' && match.over` を検出
//     2) `match.startFinalKillcam()` を呼び、true なら `mode = 'finalkillcam'`
//     3) 直後に `if (mode !== 'finalkillcam' && mode !== 'photo') match.frame(dt, ...)`
//   という順で実行される。1)→2) が同一コールバック内で完結するため、
//   startFinalKillcam() が true を返した瞬間に mode はもう 'finalkillcam' になっており、
//   3) の条件は偽になって **その回も、以後二度も** match.frame() は呼ばれない
//   (main.ts のコメントにも明記: 「finalkillcam 中は frame() が呼ばれない」)。
//
//   match.frame() 内には `if (this.over) this.releaseHumanoidCrowdAll();` という
//   安全網があるが、上記の理由でキルカム経路ではこの安全網は一度も実行されない。
//   さらに、時間切れ(match.ts update() 冒頭)や ?fkdemo(debugForceFinalKill、update()の
//   外から直接 this.over=true を立てる)は feedHumanoidCrowd() 到達前に over を立てて
//   return するため、humanoid群の crowdSlot が解放されないまま残る。
//   結果、bot.rig.visible=false のまま(setCrowdSlot(slot>=0)の効果)キルカムへ入り、
//   群像は終了時点の位置で凍結表示され、fkApplyLivePose が bot.group.visible=true を
//   立てても子の rig が非表示のため再現リグ(killer/victim)が見えない。
//
// 修正: startFinalKillcam() 自身が `this.releaseHumanoidCrowdAll()`(idempotent)を
// `this.killcam.begin()` より前に呼ぶことで、mode切替経路に関わらず必ず群を解放する
// (score-victory等、既に解放済みの経路では単なる無害な再確認になる)。
//
// 実 Match の構築は THREE.WebGLRenderer / RAPIER.World の実初期化を要し、本リポジトリの
// match.ts テストは一貫してこれを避けている(src/game/prop-visual-wiring.test.ts 冒頭コメント
// 「このリポジトリに Match を直接構築するテストは無い」)。そのため、この回帰は
// startFinalKillcam() メソッド本体のソース上の呼び出し順を機械的に固定するゴールデン
// テストとして守る(match-golden.test.ts と同種の「構造を凍結する」パターン)。
describe('startFinalKillcam: humanoid群InstancedMesh解放の呼び出し順(R57 ⑥修正1)', () => {
  const src = matchSrc;
  const methodStart = src.indexOf('startFinalKillcam(): boolean {');
  // 次のクラスメンバ定義(2スペースインデントのJSDocかメンバ宣言)の手前までを本体とみなす
  const bodyEnd = src.indexOf('\n  /**\n   * R56 W3 #2:', methodStart);
  const body = methodStart >= 0 && bodyEnd > methodStart ? src.slice(methodStart, bodyEnd) : '';

  it('startFinalKillcam のメソッド本体を抽出できる(周辺コード変更で空文字にならない)', () => {
    expect(body.length).toBeGreaterThan(100);
  });

  it('this.releaseHumanoidCrowdAll() を this.killcam.begin() より前に呼ぶ', () => {
    const releaseIdx = body.indexOf('this.releaseHumanoidCrowdAll();');
    const beginIdx = body.indexOf('this.killcam.begin();');
    expect(releaseIdx).toBeGreaterThan(-1);
    expect(beginIdx).toBeGreaterThan(-1);
    expect(releaseIdx).toBeLessThan(beginIdx);
  });

  it('releaseHumanoidCrowdAll は idempotent(全slot=-1なら何もしない)実装のまま', () => {
    // releaseHumanoidCrowdAll 自体の実装(呼び出し側であるstartFinalKillcamからは変更不可)が
    // 「changed フラグで無変化時は crowd.commit() すら呼ばない」idempotent設計であることを
    // 固定する。score-victory等、既に解放済みの経路からstartFinalKillcam経由で再度呼ばれても
    // 無害であるという修正の前提(冪等性)を裏付ける。
    const relStart = src.indexOf('private releaseHumanoidCrowdAll(): void {');
    expect(relStart).toBeGreaterThan(-1);
    const relEnd = src.indexOf('\n  }', relStart);
    const relBody = src.slice(relStart, relEnd);
    expect(relBody).toContain('let changed = false;');
    expect(relBody).toContain('if (changed) crowd.commit();');
  });
});
