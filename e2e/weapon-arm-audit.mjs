/*
 * 全武器の一人称腕／射撃／ADS／リロードと、クナイ4形態を実ブラウザで直列監査する。
 * GPU競合を避けるため試合は必ず1つずつ起動し、visual-audit の無音・headless契約を継承する。
 *
 * 例:
 *   node e2e/weapon-arm-audit.mjs --output=/tmp/hibana-weapon-arms
 */
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const val = (key, fallback) =>
  (args.find((arg) => arg.startsWith(`${key}=`)) ?? '').split('=').slice(1).join('=') || fallback;

const output = path.resolve(val('--output', '/tmp/hibana-weapon-arm-audit'));
const port = Number(val('--port', '5231'));
const quality = val('--quality', 'high');
const viewport = val('--viewport', '1440x900');
const reloadFrames = Number(val('--reload-frames', '6'));
const reloadFrameMs = Number(val('--reload-frame-ms', '180'));
const settleMs = Number(val('--settle-ms', '900'));
const sampleFrames = Number(val('--frames', '10'));

const weaponSource = readFileSync(path.resolve('src/game/weapons.ts'), 'utf8');
const weaponIds = Array.from(
  weaponSource.matchAll(/^\s+id:\s*'([^']+)',/gm),
  (match) => match[1],
);
const kunaiStates = ['normal', 'dark', 'raitei', 'kokuraitei'];
mkdirSync(output, { recursive: true });

function run(command, commandArgs, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, {
      cwd: process.cwd(),
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      ...options,
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk) => { stdout += String(chunk); });
    child.stderr?.on('data', (chunk) => { stderr += String(chunk); });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${command} exited ${code}\n${stderr}\n${stdout}`));
    });
  });
}

async function waitForServer(url, proc) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (proc.exitCode !== null) throw new Error(`vite exited before ready: ${proc.exitCode}`);
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // 起動待ち
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error('vite dev did not start');
}

const vite = spawn('npx', ['vite', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
  cwd: process.cwd(),
  stdio: ['ignore', 'pipe', 'pipe'],
});
const base = `http://127.0.0.1:${port}`;
const reports = [];
const failures = [];

try {
  await waitForServer(base, vite);
  const cases = weaponIds.flatMap((weaponId) =>
    weaponId === 'fists'
      ? kunaiStates.map((kunaiState) => ({ weaponId, kunaiState }))
      : [{ weaponId, kunaiState: 'normal' }],
  );
  for (const [index, auditCase] of cases.entries()) {
    const { weaponId, kunaiState } = auditCase;
    process.stdout.write(`[${index + 1}/${cases.length}] ${weaponId}:${kunaiState}\n`);
    try {
      await run('node', [
        'e2e/visual-audit.mjs',
        `--base=${base}`,
        `--port=${port}`,
        `--weapon=${weaponId}`,
        `--kunai-state=${kunaiState}`,
        '--camo=gold',
        '--stage=kunren',
        '--mode=training',
        `--quality=${quality}`,
        `--viewport=${viewport}`,
        `--settle-ms=${settleMs}`,
        `--frames=${sampleFrames}`,
        `--reload-frames=${reloadFrames}`,
        `--reload-frame-ms=${reloadFrameMs}`,
      ], { env: { ...process.env, AUDIT_SHOT_DIR: output } });
      const reportName = `kunren-training-${weaponId}-${kunaiState}-${quality}-${viewport}-report.json`;
      const report = JSON.parse(readFileSync(path.join(output, reportName), 'utf8'));
      reports.push(report);
      if (weaponId !== 'fists' && report.reloadObserved !== true) {
        failures.push(`${weaponId}: reload input was not observed`);
      }
      if (report.errors?.length) failures.push(`${weaponId}:${kunaiState}: ${report.errors.join('; ')}`);
    } catch (error) {
      failures.push(`${weaponId}:${kunaiState}: ${String(error)}`);
    }
  }
} finally {
  vite.kill('SIGTERM');
}

const summary = {
  generatedAt: new Date().toISOString(),
  weaponCount: weaponIds.length,
  caseCount: reports.length,
  expectedCaseCount: weaponIds.length + kunaiStates.length - 1,
  reloadChecked: reports.filter((report) => report.weaponId !== 'fists').length,
  kunaiStatesChecked: reports
    .filter((report) => report.weaponId === 'fists')
    .map((report) => report.kunaiState),
  quality,
  viewport,
  reloadFrames,
  reloadFrameMs,
  failures,
};
writeFileSync(path.join(output, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
console.log(JSON.stringify(summary, null, 2));
if (failures.length > 0 || summary.caseCount !== summary.expectedCaseCount) process.exitCode = 1;
