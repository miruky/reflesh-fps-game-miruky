/* 実画面監査PNGを、目視しやすい複数のコンタクトシートへ無音headlessで整列する。 */
import { chromium } from 'playwright';
import { mkdirSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { SILENT_BROWSER_ARGS } from './silence-audio.mjs';

const args = process.argv.slice(2);
const val = (key, fallback) =>
  (args.find((arg) => arg.startsWith(`${key}=`)) ?? '').split('=').slice(1).join('=') || fallback;
const input = path.resolve(val('--input', '/tmp/hibana-weapon-arm-final'));
const output = path.resolve(val('--output', path.join(input, 'contact-sheets')));
const pattern = val('--pattern', '-idle.png');
const columns = Number(val('--columns', '3'));
const perSheet = Number(val('--per-sheet', '12'));
const cellWidth = Number(val('--cell-width', '480'));
if (!Number.isInteger(columns) || columns < 1 || columns > 6) throw new Error('bad columns');
if (!Number.isInteger(perSheet) || perSheet < 1 || perSheet > 30) throw new Error('bad per-sheet');

const files = readdirSync(input)
  .filter((name) => name.endsWith('.png') && name.includes(pattern))
  .sort((a, b) => a.localeCompare(b));
if (files.length === 0) throw new Error(`no PNG matched ${pattern}`);
mkdirSync(output, { recursive: true });

const browser = await chromium.launch({ channel: 'chromium', headless: true, args: SILENT_BROWSER_ARGS });
try {
  for (let offset = 0; offset < files.length; offset += perSheet) {
    const chunk = files.slice(offset, offset + perSheet);
    const cards = chunk.map((name) => {
      const bytes = readFileSync(path.join(input, name)).toString('base64');
      return `<figure><img src="data:image/png;base64,${bytes}"><figcaption>${name}</figcaption></figure>`;
    }).join('');
    const page = await browser.newPage({
      viewport: { width: columns * cellWidth, height: 900 },
      deviceScaleFactor: 1,
    });
    await page.setContent(`<!doctype html><style>
      *{box-sizing:border-box}html,body{margin:0;background:#080b10;color:#dbe6ef;font:12px ui-monospace,monospace}
      main{display:grid;grid-template-columns:repeat(${columns},${cellWidth}px);gap:2px;padding:2px}
      figure{margin:0;background:#111722;border:1px solid #273342;overflow:hidden}
      img{display:block;width:100%;height:auto}
      figcaption{padding:5px 7px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    </style><main>${cards}</main>`);
    await page.waitForFunction(() => Array.from(document.images).every((image) => image.complete));
    const index = String(Math.floor(offset / perSheet) + 1).padStart(2, '0');
    await page.screenshot({ path: path.join(output, `sheet-${index}.png`), fullPage: true });
    await page.close();
  }
} finally {
  await browser.close();
}
console.log(JSON.stringify({ input, output, pattern, files: files.length, sheets: Math.ceil(files.length / perSheet) }));
