/*
  W-ENZA2 スモーク一括実行(F10)
  ─────────────────────────────
  e2e/smoke.mjs を 2ビューポート × (classic / ui2) で順に走らせて集計する。
  UI変更の出荷ゲート: これが FAIL 0 であること(SKIPは未実装画面なので可)。

  使い方:
    node scripts/ui2-smoke.mjs                 # classic + ui2 の全マトリクス
    node scripts/ui2-smoke.mjs --classic-only  # 旧UIのみ(ハーネス自体の健全性確認)
    node scripts/ui2-smoke.mjs --ui2-only      # 新UIのみ
    UI2_SHOT_DIR=/path/to/shots node scripts/ui2-smoke.mjs

  それぞれの実行は独立プロセス(vite devの起動/終了込み)なので、失敗しても後続は走る。
*/
import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
const profiles = args.includes('--classic-only')
  ? ['classic']
  : args.includes('--ui2-only')
    ? ['ui2']
    : ['classic', 'ui2'];
const viewports = ['1280x720', '1920x1080'];

let failed = 0;
const summary = [];
for (const profile of profiles) {
  for (const vp of viewports) {
    const a = ['e2e/smoke.mjs', `--viewport=${vp}`];
    if (profile === 'ui2') a.push('--ui2');
    console.log(`\n──── smoke: ${profile} @ ${vp} ────`);
    const r = spawnSync('node', a, { stdio: 'inherit', env: process.env });
    summary.push({ profile, vp, code: r.status });
    if (r.status !== 0) failed++;
  }
}

console.log('\n════ ui2-smoke 総括 ════');
for (const s of summary) console.log(` ${s.code === 0 ? 'OK ' : 'NG '} ${s.profile} @ ${s.vp}`);
process.exit(failed > 0 ? 1 : 0);
