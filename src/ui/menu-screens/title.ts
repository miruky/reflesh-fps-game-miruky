// W-ENZA FB5: タイトル画面(焔座) — 「ブラウザFPS — 熾火の系譜」の玄関。
// 契約: mountTitle(mnu, onStart) がルート要素を返す。表示/破棄と背景 setScene('title')→'top' の
// 切替はコーディネータ(menu.ts)の責務。背景情景(短剣/光柱/火の粉)は enza-bg.css 側 — ここは前景UIのみ。
// テスト方針(プロジェクト規約: jsdomなし): 選択巡回/メタ表記/遷移対応を純関数として公開し node でテスト。
import '../enza-title.css';
import { BUILD_LABEL } from '../../version';
import type { MenuScreenHost } from './host';

export interface TitleNavItem {
  readonly id: 'start' | 'options' | 'guide' | 'credits';
  readonly label: string;
  /** 視覚的減光(モック準拠: 下段の項目ほど沈む) */
  readonly dim: boolean;
}

export const TITLE_NAV: readonly TitleNavItem[] = [
  { id: 'start', label: 'ゲームスタート', dim: false },
  { id: 'options', label: 'オプション', dim: false },
  { id: 'guide', label: '操作ガイド', dim: false },
  { id: 'credits', label: 'クレジット', dim: true },
];

/** ↑↓の巡回選択(端で折り返す)。 */
export function nextTitleIndex(current: number, dir: 1 | -1, len: number): number {
  return (((current + dir) % len) + len) % len;
}

/** 右上メタ表記。日付を焼き込まず BUILD_LABEL を単一の真実とする。 */
export function titleMetaLines(buildLabel: string): [string, string] {
  return ['ENZA INTERFACE 2.0-J', `BUILD ${buildLabel} · 60FPS`];
}

/** ナビ項目→遷移先の対応(純ロジック)。'system' はMFDのシステム頁(設定+操作)。 */
export function titleActionTarget(
  id: TitleNavItem['id'],
): 'start' | 'system' | 'system-controls' | 'credits' {
  if (id === 'options') return 'system';
  if (id === 'guide') return 'system-controls';
  if (id === 'credits') return 'credits';
  return 'start';
}

export function mountTitle(mnu: MenuScreenHost, onStart: () => void): HTMLElement {
  const root = document.createElement('div');
  root.className = 'ettl-root';
  root.dataset.id = 'title-root';
  if (mnu.prefersReducedMotion) root.classList.add('ettl-reduce');
  const [metaA, metaB] = titleMetaLines(BUILD_LABEL);
  root.innerHTML = `
    <div class="ettl-meta enza-num" aria-hidden="true">${metaA}<br>${metaB}</div>
    <header class="ettl-hero">
      <p class="ettl-kicker enza-kicker"><i class="ettl-kicker-bar"></i>ブラウザFPS — 熾火の系譜</p>
      <h1 class="ettl-title"><span class="ettl-re">FPS-RE</span><span class="ettl-flesh">FLESH</span></h1>
      <div class="ettl-rule"><i class="enza-diamond ettl-rule-dia" aria-hidden="true"></i></div>
    </header>
    <nav class="ettl-nav" data-id="title-nav" aria-label="タイトルメニュー"></nav>
    <footer class="ettl-foot">
      <p class="ettl-copy enza-num">© 2026 MIRUKY WORKS · TypeScript + Three.js + Rapier · 完全ブラウザ動作</p>
      <div class="enza-hintbar"><span><kbd>A</kbd>決定</span><span><kbd>▲▼</kbd>選択</span></div>
    </footer>
    <div class="ettl-credits" data-id="title-credits" hidden>
      <div class="ettl-credits-panel enza-plate enza-plate--lg" role="dialog" aria-label="クレジット">
        <p class="enza-kicker">CREDITS — 制作</p>
        <h2 class="ettl-credits-title">FPS-reFlesh <span>焔座</span></h2>
        <p class="ettl-credits-body">企画・制作 — MIRUKY WORKS</p>
        <p class="ettl-credits-body">TypeScript · Three.js · Rapier · WebAudio — 外部アセットゼロ、全て手続き生成。</p>
        <p class="ettl-credits-body">デザイン言語「焔座 ENZA — THE EMBER THRONE」/ 神話が顔、計器が骨。</p>
        <button class="ettl-credits-close enza-btn" type="button" data-id="title-credits-close">閉じる</button>
      </div>
    </div>
  `;

  const nav = root.querySelector<HTMLElement>('[data-id="title-nav"]');
  const credits = root.querySelector<HTMLElement>('[data-id="title-credits"]');
  const creditsClose = root.querySelector<HTMLElement>('[data-id="title-credits-close"]');
  if (!nav || !credits || !creditsClose) return root; // innerHTML直後の不在はあり得ない(型ガード)

  let sel = 0;
  const buttons: HTMLButtonElement[] = [];

  function setSel(i: number): void {
    sel = i;
    buttons.forEach((b, j) => {
      b.classList.toggle('sel', j === sel);
      const dia = b.querySelector('.ettl-dia');
      dia?.classList.toggle('enza-diamond--filled', j === sel);
      dia?.classList.toggle('enza-diamond--outline', j !== sel);
    });
  }

  function closeCredits(): void {
    credits?.setAttribute('hidden', '');
    buttons[sel]?.focus({ preventScroll: true });
  }

  function openCredits(): void {
    credits?.removeAttribute('hidden');
    creditsClose?.focus({ preventScroll: true });
  }

  function act(id: TitleNavItem['id']): void {
    const target = titleActionTarget(id);
    if (target === 'credits') {
      openCredits();
      return;
    }
    onStart();
    if (target === 'system' || target === 'system-controls') {
      mnu.setMfdPage('system');
      if (target === 'system-controls') {
        // 操作ガイド: システム頁の操作グリッドまで送る(遷移後のレイアウト確定を待つ)
        requestAnimationFrame(() => {
          mnu.root.querySelector<HTMLElement>('[data-id="controls"]')?.scrollIntoView({
            block: 'start',
            behavior: mnu.prefersReducedMotion ? 'auto' : 'smooth',
          });
        });
      }
    }
  }

  for (const [i, item] of TITLE_NAV.entries()) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `ettl-item${item.dim ? ' ettl-item--dim' : ''}`;
    b.dataset.act = item.id;
    b.innerHTML = `<i class="enza-diamond ettl-dia" aria-hidden="true"></i><span class="ettl-item-label">${item.label}</span>`;
    b.addEventListener('mouseenter', () => setSel(i));
    b.addEventListener('focus', () => setSel(i));
    b.addEventListener('click', () => act(item.id));
    nav.appendChild(b);
    buttons.push(b);
  }

  credits.addEventListener('click', (e) => {
    if (e.target === credits) closeCredits();
  });
  creditsClose.addEventListener('click', closeCredits);

  root.addEventListener('keydown', (e) => {
    if (!credits.hidden) {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeCredits();
      }
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setSel(nextTitleIndex(sel, e.key === 'ArrowDown' ? 1 : -1, TITLE_NAV.length));
      buttons[sel]?.focus({ preventScroll: true });
    }
  });

  setSel(0);
  requestAnimationFrame(() => {
    if (root.isConnected) buttons[0]?.focus({ preventScroll: true });
  });
  return root;
}
