import './hud2.css'; // W-ENZA2: 焔座HUDクローム(mock05正典)
import '../ui/rogue.css'; // 輪廻HUD(計器サブシステムは旧CSSペアを温存)
import '../mk3-phase2.css'; // キルカム武器バナー/フォト(同上)
import { RADAR_RANGE_M } from '../core/settings';
import type * as THREE from 'three';
import type { MatchSnapshot } from '../game/match-types';
import { Hud } from '../ui/hud';
import { GG_LADDER } from '../game/modes';
import {
  chargeArcDashoffset,
  clampN,
  deriveEmperorState,
  emperorThemeAttr,
  emptyMomentQueue,
  isSpecialRoundEntering,
  momentTone,
  momentWatermark,
  stepCalmLatch,
  stepMomentQueue,
  type EmperorState,
  type Mk3Snapshot,
  type R53W2Snapshot,
} from '../ui/hud-model';
export * from '../ui/hud-model';

// ゾンビモード中は同じ実績を何度も再達成するため、目立つバッジ通知(中央カード)が煩わしくなる。
// 再達成(firstUnlock=false)のみ抑止し、左フィード(pushMedalText)の軽量表示は残す。
// 初取得(firstUnlock=true)は非ゾンビと同じフル演出のまま。非ゾンビモード(inZombieMode=false)は常にfalseで既存挙動を変えない。
// R53 T6: adsKeepsCrosshair=true の武器(minigun=修羅/fan=風神扇)はADS中も腰だめクロスヘアを
// フル表示のまま維持する(R12由来の消し込み経路=擬似要素レティクル用--ads / 4本バーの
// barOpacityの両方を凍結する)。updateCrosshairから呼ぶ純関数として切り出しテスト容易化。
// 軽量化監査#8: 1フレームに生成するダメージ数値DOMノードの上限。
// 全滅ウルト等で100体超同時キル→同数のspan+rAF+setTimeoutが同一フレームに積まれ、
// 死亡FXスパイクと重なって重量化するのを防ぐ。超過分は個別ノードを作らず、
// 1個の集約バッジ(「+N KILLS」or「+合計ダメージ」)にまとめる(情報は消さず集約する)。
type Project = (world: THREE.Vector3) => { x: number; y: number; behind: boolean };

const DIRECTIONS: Array<[number, string]> = [
  [0, '北'],
  [45, '北東'],
  [90, '東'],
  [135, '南東'],
  [180, '南'],
  [225, '南西'],
  [270, '西'],
  [315, '北西'],
];

const FEED_LIFETIME_MS = 4200;
// ハードポイント/KC ミニマップ描画: ゾーン半径(match.tsの ZONE_RADIUS=3.5 と合わせる)
const ZONE_R = 3.5;

// 円形HPリングの可視弧長。r=38 の円周(2π·38≈238.76)の 240°/360°=2/3 が見える弧。
// stroke-dasharray '159.17 238.76' と対で使い、offset=ARC*(1-hp比) で満欠を描く。
// (旧HPリング弧長 159.17 はセグメントバー化で撤去 — mock05)

const HUD2_MARKUP = `
      <!-- ════ 焔座HUD(mock05正典) クローム層 ════ -->
      <!-- 上中央: コンパス帯(万線目盛+漢字方位)+針+度数 -->
      <div class="u2h-compass-wrap" aria-hidden="true">
        <div class="u2h-compass"><div class="u2h-compass-strip" data-id="compass"></div></div>
        <i class="u2h-compass-needle"></i>
        <span class="u2h-hdg"><span data-id="hdg">000</span>°</span>
      </div>
      <!-- 上中央下: モードプレート(味方|モード名+残時間|敵)。
           R55 W-C2: 先取ラベル(u2h-mp-target)は u2h-modeplate の clip-path 描画対象に
           含まれると top:calc(100%+4px) の位置が丸ごと切り抜かれ不可視になるため、
           clip-pathの掛からないwrapの直下(modeplateの兄弟)へ退避する -->
      <div class="u2h-modeplate-wrap">
        <div class="u2h-modeplate">
          <div class="u2h-teamscore" data-id="teamscore">
            <span class="u2h-mp-cell u2h-mp-mine"><i class="u2h-dia u2h-dia--mine"></i><span data-id="scoremine">0</span></span>
            <span class="u2h-mp-cell u2h-mp-enemy"><span data-id="scoreenemy">0</span><i class="u2h-dia u2h-dia--enemy"></i></span>
          </div>
          <div class="u2h-mp-mid"><span class="u2h-mp-mode" data-id="modename">フリーフォーオール</span><strong class="u2h-mp-timer" data-id="timer">5:00</strong></div>
        </div>
        <span class="u2h-mp-target" data-id="scoretarget"></span>
      </div>
      <div class="u2h-announce" data-id="announce"></div>
      <!-- 左上: ミニマップ+主目標カード+戦績行 -->
      <div class="u2h-topleft">
        <div class="u2h-mmframe">
          <canvas class="u2h-minimap" data-id="minimap" width="236" height="236" aria-hidden="true"></canvas>
          <span class="u2h-mm-size" data-id="mmsize"></span>
          <span class="u2h-mm-uav" data-id="mmuav" hidden>UAV稼働</span>
        </div>
        <div class="u2h-objcard">
          <div class="u2h-obj-head"><span class="u2h-obj-kicker">主目標</span></div>
          <div class="u2h-mission" data-id="mission" hidden>
            <div class="u2h-obj-text" data-id="obj-text"></div>
            <div class="u2h-obj-bar"><i data-id="obj-bar"></i></div>
            <div class="u2h-obj-wave" data-id="obj-wave"></div>
          </div>
          <div class="u2h-zones" data-id="zones" hidden></div>
          ${'<!-- boss/detect/snd/training: 計器サブシステム(旧様式ペア温存) -->'}
        </div>
        <div class="u2h-kdrow">
          <span class="u2h-kd"><b data-id="kills">0</b><small>撃破</small></span>
          <span class="u2h-kd"><b data-id="deaths">0</b><small>戦死</small></span>
          <span class="u2h-streakchip" data-id="streak" hidden></span>
        </div>
        <div class="hud-boss" data-id="boss" hidden>
            <div class="hud-boss-name" data-id="boss-name">BOSS</div>
            <div class="hud-boss-bar"><i data-id="boss-bar"></i></div>
            <!-- R53-W2: ボスフェーズ菱形pips(bossPhase定義時のみ表示) -->
            <div class="w2-boss-phases" data-id="bossphases" hidden aria-hidden="true"></div>
          </div>
        <!-- R53-W2: 潜入検知メーター(detect01定義時のみ表示。目アイコン+半円弧ゲージ) -->
          <div class="w2-detect" data-id="detect" hidden aria-hidden="true">
            <svg class="w2-detect-eye" viewBox="0 0 24 14" aria-hidden="true">
              <path d="M1 7 C5 1 19 1 23 7 C19 13 5 13 1 7 Z"></path>
              <circle cx="12" cy="7" r="2.6"></circle>
            </svg>
            <svg class="w2-detect-arc" viewBox="-20 -20 40 22" aria-hidden="true">
              <path class="w2-detect-arc-track" d="M -18 0 A 18 18 0 0 1 18 0"></path>
              <path class="w2-detect-arc-fill" data-id="detectarc" d="M -18 0 A 18 18 0 0 1 18 0"></path>
            </svg>
          </div>
        <div class="w2-snd" data-id="snd" hidden>
            <div class="w2-snd-pips">
              <div class="w2-snd-pip-row w2-snd-pip-row--mine" data-id="sndpipsmine"></div>
              <div class="w2-snd-phase" data-id="sndphase"></div>
              <div class="w2-snd-pip-row w2-snd-pip-row--enemy" data-id="sndpipsenemy"></div>
            </div>
            <div class="w2-snd-bomb" data-id="sndbomb" hidden><span data-id="sndbombtime">0.0</span></div>
            <div class="w2-snd-progress" data-id="sndprogress" hidden>
              <div class="w2-snd-progress-label" data-id="sndprogresslabel"></div>
              <div class="w2-snd-progress-bar"><i data-id="sndprogressfill"></i></div>
            </div>
            <div class="w2-snd-carrier" data-id="sndcarrier" hidden>爆弾所持中</div>
          </div>
        <div class="hud-training" data-id="training" hidden>
            <div class="hud-training-row"><small>DPS</small><strong data-id="tr-dps">0.0</strong></div>
            <div class="hud-training-row"><small>命中率</small><strong data-id="tr-acc">0%</strong></div>
            <div class="hud-training-row"><small>HS率</small><strong data-id="tr-hs">0%</strong></div>
            <div class="hud-training-row"><small>連続HIT</small><strong data-id="tr-streak">0</strong></div>
          </div>
      </div>
      <!-- ゾンビ: ラウンド大数字+実績(左中) -->
      <div class="u2h-zround" data-id="zombie" hidden>
        <span class="u2h-zround-big" data-id="zround">1</span>
        <span class="u2h-zround-col">
          <span class="u2h-zround-line"><span data-id="zkills">0</span> 撃破</span>
          <span class="u2h-zround-line u2h-zround-pts"><span data-id="zpoints">0</span> pt</span>
          <span class="u2h-rogue-badge" data-id="rogue-badge" hidden>輪廻 <b data-id="rogue-cards-n">0</b> 供物</span>
        </span>
        <span class="w2-powerups" data-id="powerups" aria-hidden="true"></span>
      </div>
      <!-- R54-F5 輪廻: 供物の3-4択パネル(roguePickPending中のみ)。操作は台座へのE(照準UI) -->
          <div class="hud-rogue-pick" data-id="rogue-pick" hidden aria-hidden="true">
            <div class="rogue-pick-title">供物を選べ <span class="rogue-pick-remain"><b data-id="rogue-remain">30</b>s</span></div>
            <div class="rogue-options" data-id="rogue-options"></div>
            <div class="rogue-pick-hint">台座に近づいて <b>E</b> で受領 — 時間切れで見送り</div>
          </div>
      <!-- 右上: キルフィード -->
      <div class="u2h-feed" data-id="feed"></div>
      <!-- 状態バッジ(超鬼畜/帝王顕現バナー/チャージ・スピンゲージ) -->
      <div class="u2h-statebar" aria-hidden="true">
        <div class="hud-hell" data-id="hell" hidden>
          <span class="hud-hell-badge">超鬼畜</span>
        </div>
        <div class="hud-dark-emperor" data-id="darkemperor" hidden>
          <span class="hud-de-badge">黒帝</span>
          <span class="hud-de-timer" data-id="detimer">5:00</span>
        </div>
        <div class="hud-raitei" data-id="raitei" hidden>
          <span class="hud-raitei-badge">雷帝</span>
        </div>
        <div class="hud-kokuraitei" data-id="kokuraitei" hidden>
          <span class="hud-kokuraitei-badge">黒雷帝</span>
        </div>
        <div class="hud-charge-gauge" data-id="chargegauge" hidden>
          <div class="hud-charge-fill" data-id="chargefill"></div>
        </div>
        <div class="hud-spin-gauge" data-id="spingauge" hidden>
          <div class="hud-spin-fill" data-id="spinfill"></div>
        </div>
      </div>
      <div class="hud-crosshair" data-id="crosshair">
        <span class="ch-dot"></span>
        <span class="ch-bar ch-t" data-id="cht"></span>
        <span class="ch-bar ch-b" data-id="chb"></span>
        <span class="ch-bar ch-l" data-id="chl"></span>
        <span class="ch-bar ch-r" data-id="chr"></span>
      </div>
      <!-- R53-W3 MK.III: チャージ弧(クロスヘア直下90°。旧hud-charge-gauge棒と同一データの新表示。
           照準補助の一部として聖域内に置くが r=56px の細線のみ=クロスヘアを塞がない) -->
      <div class="mk3-charge-arc" data-id="mk3arc" hidden aria-hidden="true">
        <svg viewBox="-64 -64 128 128" aria-hidden="true">
          <path class="mk3-arc-track" d="M -39.6 39.6 A 56 56 0 0 0 39.6 39.6"></path>
          <path class="mk3-arc-fill" data-id="mk3arcfill" d="M -39.6 39.6 A 56 56 0 0 0 39.6 39.6"></path>
        </svg>
      </div>
      <!-- R53-W3 MK.III: モーメント帯(下1/3、1ノード+キュー。ラウンド/超越昇格/パーク/帝王/GGの統一演出。
           無線字幕(bottom:24%)と非衝突の bottom:31%。ADS/キルカム中は新規開始をサプレス) -->
      <div class="mk3-moment" data-id="mk3moment" hidden data-tone="ember">
        <span class="mk3-moment-mark" data-id="mk3momentmark" aria-hidden="true"></span>
        <div class="mk3-moment-title" data-id="mk3momenttitle"></div>
        <div class="mk3-moment-sub" data-id="mk3momentsub" hidden></div>
      </div>
      <div class="hud-scope" data-id="scope" hidden>
        <div class="sc-back"></div>
        <div class="sc-mask"></div>
        <div class="sc-frame">
          <div class="sc-glass"><i class="sc-grid"></i></div>
          <svg class="sc-frame-svg" viewBox="-100 -100 200 200" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
            <circle class="sc-ring" r="95"></circle>
            <circle class="sc-chroma sc-c" r="95"></circle>
            <circle class="sc-chroma sc-m" r="95"></circle>
            <g class="sc-brackets">
              <polyline points="-40,-26 -40,-40 -26,-40"></polyline>
              <polyline points="40,-26 40,-40 26,-40"></polyline>
              <polyline points="-40,26 -40,40 -26,40"></polyline>
              <polyline points="40,26 40,40 26,40"></polyline>
            </g>
            <g class="sc-cardinals">
              <line x1="0" y1="-95" x2="0" y2="-88"></line>
              <line x1="0" y1="95" x2="0" y2="88"></line>
              <line x1="-95" y1="0" x2="-88" y2="0"></line>
              <line x1="95" y1="0" x2="88" y2="0"></line>
            </g>
          </svg>
          <div class="sc-glint" data-id="scopeglint"></div>
          <div class="sc-readout"><span data-id="scoperange">0</span><i>M</i> · <span data-id="scopezoom">3.1</span><i>X</i></div>
          <div class="sc-breath"><i data-id="scopebreath"></i></div>
        </div>
        <svg class="sc-cross" viewBox="-100 -100 200 200" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
          <defs>
            <g id="sc-marks">
              <line x1="-92" y1="0" x2="-2.5" y2="0"></line>
              <line x1="2.5" y1="0" x2="92" y2="0"></line>
              <line x1="0" y1="-92" x2="0" y2="-2.5"></line>
              <line x1="0" y1="2.5" x2="0" y2="92"></line>
              <line x1="-3" y1="20" x2="3" y2="20"></line>
              <line x1="-5" y1="34" x2="5" y2="34"></line>
              <line x1="-7" y1="48" x2="7" y2="48"></line>
            </g>
          </defs>
          <!-- R13: レティクルは data-reticle で厳密に1種のみ可視。既存ミルドット十字を rk-mildot に内包 -->
          <g class="rk rk-mildot">
            <circle class="sc-refring-halo" r="60"></circle>
            <circle class="sc-refring" r="60"></circle>
            <use href="#sc-marks" class="sc-halo"></use>
            <use href="#sc-marks" class="sc-core"></use>
            <circle class="sc-dot-halo" r="1.6"></circle>
            <circle class="sc-dot" r="0.7"></circle>
          </g>
          <!-- ACOG: 中央シェブロン(▲)+下方スタジア線 -->
          <g class="rk rk-chevron">
            <path class="sc-halo" d="M0,-2 L7,10 L0,6 L-7,10 Z"></path>
            <path class="sc-core" d="M0,-2 L7,10 L0,6 L-7,10 Z"></path>
            <line class="sc-core" x1="0" y1="22" x2="0" y2="30"></line>
            <line class="sc-core" x1="0" y1="40" x2="0" y2="46"></line>
          </g>
          <!-- ハイブリッド: 外リング+中央ドット(CQB) -->
          <g class="rk rk-circle-dot">
            <circle class="sc-refring-halo" r="34" fill="none"></circle>
            <circle class="sc-refring" r="34" fill="none"></circle>
            <line class="sc-core" x1="-46" y1="0" x2="-40" y2="0"></line>
            <line class="sc-core" x1="46" y1="0" x2="40" y2="0"></line>
            <line class="sc-core" x1="0" y1="-46" x2="0" y2="-40"></line>
            <line class="sc-core" x1="0" y1="46" x2="0" y2="40"></line>
            <circle class="sc-dot-halo" r="1.8"></circle>
            <circle class="sc-dot" r="0.9"></circle>
          </g>
          <!-- サーマル: 琥珀十字+アパーチャ(色はCSSの data-reticle='thermal' で暖色化) -->
          <g class="rk rk-thermal">
            <line class="sc-halo" x1="-30" y1="0" x2="-6" y2="0"></line>
            <line class="sc-halo" x1="6" y1="0" x2="30" y2="0"></line>
            <line class="sc-halo" x1="0" y1="-30" x2="0" y2="-6"></line>
            <line class="sc-halo" x1="0" y1="6" x2="0" y2="30"></line>
            <line class="sc-core" x1="-30" y1="0" x2="-6" y2="0"></line>
            <line class="sc-core" x1="6" y1="0" x2="30" y2="0"></line>
            <line class="sc-core" x1="0" y1="-30" x2="0" y2="-6"></line>
            <line class="sc-core" x1="0" y1="6" x2="0" y2="30"></line>
            <circle class="sc-dot" r="0.9"></circle>
          </g>
          <!-- DSR精密レティクル: BO2 DSR-50風極細十字(native スナイパー専用) -->
          <g class="rk rk-dsr">
            <!-- メイン十字アーム(ハロー/薄影) -->
            <line class="sc-dsr-halo" x1="-92" y1="0" x2="-4" y2="0"></line>
            <line class="sc-dsr-halo" x1="4" y1="0" x2="92" y2="0"></line>
            <line class="sc-dsr-halo" x1="0" y1="-92" x2="0" y2="-4"></line>
            <line class="sc-dsr-halo" x1="0" y1="4" x2="0" y2="92"></line>
            <!-- メイン十字アーム(白0.85) -->
            <line class="sc-dsr-line" x1="-92" y1="0" x2="-4" y2="0"></line>
            <line class="sc-dsr-line" x1="4" y1="0" x2="92" y2="0"></line>
            <line class="sc-dsr-line" x1="0" y1="-92" x2="0" y2="-4"></line>
            <line class="sc-dsr-line" x1="0" y1="4" x2="0" y2="92"></line>
            <!-- ミル目盛り 水平左: マイナー(±10,30,50,70)・メジャー(±20,40,60) -->
            <line class="sc-dsr-tick" x1="-10" y1="-1.5" x2="-10" y2="1.5"></line>
            <line class="sc-dsr-tick" x1="-20" y1="-3" x2="-20" y2="3"></line>
            <line class="sc-dsr-tick" x1="-30" y1="-1.5" x2="-30" y2="1.5"></line>
            <line class="sc-dsr-tick" x1="-40" y1="-3" x2="-40" y2="3"></line>
            <line class="sc-dsr-tick" x1="-50" y1="-1.5" x2="-50" y2="1.5"></line>
            <line class="sc-dsr-tick" x1="-60" y1="-3" x2="-60" y2="3"></line>
            <line class="sc-dsr-tick" x1="-70" y1="-1.5" x2="-70" y2="1.5"></line>
            <line class="sc-dsr-tick" x1="-80" y1="-2" x2="-80" y2="2"></line>
            <!-- ミル目盛り 水平右(左の鏡) -->
            <line class="sc-dsr-tick" x1="10" y1="-1.5" x2="10" y2="1.5"></line>
            <line class="sc-dsr-tick" x1="20" y1="-3" x2="20" y2="3"></line>
            <line class="sc-dsr-tick" x1="30" y1="-1.5" x2="30" y2="1.5"></line>
            <line class="sc-dsr-tick" x1="40" y1="-3" x2="40" y2="3"></line>
            <line class="sc-dsr-tick" x1="50" y1="-1.5" x2="50" y2="1.5"></line>
            <line class="sc-dsr-tick" x1="60" y1="-3" x2="60" y2="3"></line>
            <line class="sc-dsr-tick" x1="70" y1="-1.5" x2="70" y2="1.5"></line>
            <line class="sc-dsr-tick" x1="80" y1="-2" x2="80" y2="2"></line>
            <!-- ホールドオーバーマーク(垂直下方・距離推定) -->
            <line class="sc-dsr-hold" x1="-4" y1="20" x2="4" y2="20"></line>
            <line class="sc-dsr-hold" x1="-6" y1="34" x2="6" y2="34"></line>
            <line class="sc-dsr-hold" x1="-8" y1="48" x2="8" y2="48"></line>
            <!-- 中央アンバー照準点(ハロー+コア) -->
            <circle class="sc-dsr-center-halo" r="2"></circle>
            <circle class="sc-dsr-center" r="1"></circle>
          </g>
          <circle class="sc-lock" r="5"></circle>
        </svg>
      </div>
      <div class="hud-hitmarker" data-id="hitmarker"><span></span><span></span><span></span><span></span><span class="hm-diamond"></span></div>
      <div class="hud-reload" data-id="reload" hidden>
        <div class="hud-reload-bar"><div data-id="reloadfill"></div></div>
        <span>リロード中</span>
      </div>
      <div class="hud-cook" data-id="cook" hidden>
        <div class="hud-cook-bar"><div data-id="cookfill"></div></div>
      </div>
      <!-- 左下: 生命(数値+セグメントバー) -->
      <div class="u2h-vitals">
        <div class="u2h-vitals-zrow" data-id="zpointsplate" hidden>
          <span class="u2h-zpp-num" data-id="zpointsbig">0</span><span class="u2h-zpp-label">ポイント</span>
        </div>
        <div class="u2h-vitals-num">
          <span class="u2h-hp" data-id="hp">100</span>
          <span class="u2h-hp-label">生命</span>
          <small class="u2h-hpmax" data-id="hpmax">/ 100</small>
        </div>
        <div class="u2h-hpbar"><i class="u2h-hpbar-fill" data-id="hpbarfill"></i><i class="u2h-hpbar-segs"></i></div>
      </div>
      <div class="hud-zperks u2h-zperks" data-id="zperks" hidden></div>
      <!-- 右下: 兵装カード -->
      <div class="u2h-weapon">
        <div class="u2h-w-title">
          <span class="u2h-w-kicker" data-id="weaponslot">主武装</span>
          <strong class="u2h-w-name" data-id="weapon"></strong>
          <span class="w2-pap-pips" data-id="pappips" aria-hidden="true"></span>
        </div>
        <div class="u2h-w-plate">
          <div class="u2h-w-modecell">
            <span class="u2h-w-pips" data-id="ammopips" aria-hidden="true"></span>
            <span class="u2h-w-mode" data-id="mode"></span>
          </div>
          <div class="u2h-w-ammocell">
            <span class="u2h-ammo" data-id="ammo">30</span>
            <span class="u2h-reserve" data-id="reserve">/ ∞</span>
          </div>
        </div>
        <div class="u2h-w-underrow">
          <span class="u2h-grenade"><i class="u2h-dia u2h-dia--util"></i><b data-id="gname"></b><span class="u2h-gcount" data-id="gcount"></span></span>
          <span class="u2h-ult" data-id="ult">
            <svg viewBox="0 0 26 26" aria-hidden="true">
              <circle class="u2h-ult-track" r="10.5" cx="13" cy="13"></circle>
              <circle class="u2h-ult-fill" data-id="ultring" r="10.5" cx="13" cy="13" stroke-dasharray="65.97" stroke-dashoffset="65.97" transform="rotate(-90 13 13)"></circle>
              <rect class="u2h-ult-dia" x="10.5" y="10.5" width="5" height="5"></rect>
            </svg>
            <span class="u2h-ult-txt"><b data-id="ultlabel">ULT</b><small data-id="ultpct">0%</small></span>
          </span>
        </div>
      </div>
      <!-- 対戦: ストリークチップ(下中央左) -->
      <div class="u2h-streaks" aria-hidden="true">
        <div class="u2h-ss-next" data-id="bo2ssnext"></div>
        <div class="u2h-ss-cauav" data-id="bo2cauav" hidden>COUNTER UAV <span data-id="bo2cauavt">30</span>s</div>
        ${[0, 1, 2, 3, 4, 5, 6]
          .map(
            (i) => `
        <div class="u2h-ss-slot" data-id="bo2slot${i}">
          <span class="u2h-ss-key">${3 + i}</span>
          <span class="u2h-ss-icon" data-id="bo2icon${i}"></span>
          <span class="u2h-ss-name" data-id="bo2name${i}"></span>
        </div>`,
          )
          .join('')}
      </div>
      <div class="hud-rcxd-overlay" data-id="rcxdoverlay" hidden>
        <div class="hud-rcxd-label">RC-XD</div>
        <div class="hud-rcxd-hint">[LClick] 起爆 · [RClick/ESC] キャンセル</div>
        <div class="hud-rcxd-timer"><span data-id="rcxdtimer">30</span>s</div>
      </div>
      <div class="hud-radar" data-id="radar" hidden>
        <div class="radar-sweep"></div>
        <svg class="radar-svg" viewBox="-50 -50 100 100" aria-hidden="true">
          <circle class="radar-ring" r="46"></circle>
          <circle class="radar-ring radar-ring-inner" r="23"></circle>
          <line class="radar-ax" x1="0" y1="-46" x2="0" y2="46"></line>
          <line class="radar-ax" x1="-46" y1="0" x2="46" y2="0"></line>
          <g data-id="radarblips"></g>
          <path class="radar-self" d="M0,-5 L4,4 L0,1.5 L-4,4 Z"></path>
        </svg>
      </div>
      <!-- ハードポイント方向インジケータ: プレイヤーヨー基準の矢印+状態チップ+カウントダウ��� -->
      <div class="hud-hp-indicator" data-id="hpindicator" hidden>
        <div class="hud-hp-arrow-wrap" data-id="hparrowwrap">
          <svg class="hud-hp-arrow-svg" viewBox="-12 -12 24 24" aria-hidden="true">
            <polygon class="hud-hp-arrow-shape" points="0,-10 6,6 0,2 -6,6" data-id="hparrowshape"/>
          </svg>
        </div>
        <div class="hud-hp-chip" data-id="hpchip">HP</div>
        <div class="hud-hp-time" data-id="hptime">60</div>
      </div>
      <!-- キルコンファーム演出バナー(CONFIRMED / DENIED) -->
      <div class="hud-kc-event" data-id="kcevent" hidden></div>
      <div class="hud-dmg-layer" data-id="dmg"></div>
      <div class="hud-incoming" data-id="incoming"></div>
      <div class="u2h-scorepops" data-id="xpribbon" aria-live="polite" aria-atomic="false"></div>
      <div class="hud-vignette" data-id="vignette"></div>
      <!-- R53-W2: 毒霧ビネット(poison01定義時のみ。既存の被弾ビネットとは別要素/別色で重畳しても破綻しない) -->
      <div class="w2-poison-vignette" data-id="poisonvign"></div>
      <div class="hud-flash" data-id="flash"></div>
      <div class="hud-ultflash" data-id="ultflash"></div>
      <div class="hud-whiteout" data-id="whiteout"></div>
      <!-- R53-W3 MK.III: 帝王プレゼンス枠(1px内枠グロー+四隅ノッチ。box-shadow insetのみ=
           backdrop-filter不使用/GPU安価。emperorState(なければ既存フィールド導出)で常灯) -->
      <div class="u2h-emp-frame" data-id="mk3emperor" hidden aria-hidden="true">
        <i class="u2h-ef-vign"></i><i class="u2h-ef-veil"></i><i class="u2h-ef-ring"></i>
        <b class="u2h-ef-c u2h-ef-tl"></b><b class="u2h-ef-c u2h-ef-tr"></b><b class="u2h-ef-c u2h-ef-bl"></b><b class="u2h-ef-c u2h-ef-br"></b>
        <span class="u2h-ef-wm" aria-hidden="true"></span>
      </div>
      <div class="hud-speedlines" data-id="speedlines"></div>
      <div class="hud-move" data-id="move" hidden>
        <span class="hud-move-state" data-id="movestate"></span>
        <div class="hud-move-bar"><div data-id="speedfill"></div></div>
      </div>
      <div class="hud-banner" data-id="banner"></div>
      <!-- R21 マルチキルバナー: 画面中央上寄り。single要素再利用・スカルピップ計数器付き -->
      <div class="hud-multikill-banner" data-id="mkbanner" hidden>
        <div class="mk-inner">
          <div class="mk-label" data-id="mklabel"></div>
          <div class="mk-pips" data-id="mkpips" aria-hidden="true"></div>
        </div>
      </div>
      <!-- R53-W2: 特殊ラウンド(餓鬼の大群)突入バナー。specialRound==='rush'突入の瞬間だけ一発表示 -->
      <div class="w2-special-banner" data-id="specialbanner" hidden>
        <div class="w2-special-banner-label">餓鬼の大群</div>
      </div>
      <!-- R53-W2: 無線字幕(radioLine非null時。クロスヘア聖域外・キルフィードと非衝突の下部) -->
      <div class="w2-radio" data-id="radio" hidden>
        <span class="w2-radio-speaker" data-id="radiospeaker"></span>
        <span class="w2-radio-text" data-id="radiotext"></span>
      </div>
      <div class="hud-medal-stack" data-id="medalstack"></div>
      <div class="hud-badge-stack" data-id="badgestack"></div>
      <div class="u2h-zbuy" data-id="zbuy" hidden></div>
      <!-- ガンゲーム: 右上にランク + 武器名 + トップ3リーダーボード -->
      <div class="hud-gg" data-id="gg" hidden>
        <div class="hud-gg-rank" data-id="ggrank">1/${GG_LADDER.length}</div>
        <div class="hud-gg-weapon" data-id="ggweapon"></div>
        <div class="hud-gg-top3" data-id="ggtop3"></div>
      </div>
      <div class="hud-death" data-id="death" hidden>
        <div class="hud-death-title">戦死</div>
        <div class="hud-death-sub">リスポーンまで <span data-id="respawn">0.0</span> 秒</div>
      </div>
      <!-- R11 キルカメラ・シネマ: #hud直下(生存時は.hud-death暗幕の外)。
           opacity と body.killcam-active のみで駆動。fixed inset:0 がビューポート解決 -->
      <div class="kc-veil" data-id="kcveil" aria-hidden="true"></div>
      <div class="kc-flash" data-id="kcflash" aria-hidden="true"></div>
      <div class="kc-vign" data-id="kcvign" aria-hidden="true"></div>
      <div class="kc-bars" aria-hidden="true"><i class="kc-bar kc-bar-t"></i><i class="kc-bar kc-bar-b"></i></div>
      <div class="kc-card" data-id="kccard" aria-hidden="true">
        <div class="kc-banner">KILLED BY</div>
        <div class="kc-name" data-id="kcname"></div>
        <div class="kc-weapon" data-id="kcweapon"></div>
        <div class="kc-dist"><span data-id="kcdist">0</span><i>M</i></div>
        <div class="kc-timer"><i data-id="kctimer"></i></div>
      </div>
      <div class="hud-scoreboard" data-id="scoreboard" hidden>
        <header><span data-id="scoremode"></span><strong data-id="scoregoal"></strong></header>
        <table>
          <thead><tr><th>名前</th><th>キル</th><th>デス</th></tr></thead>
          <tbody data-id="scorerows"></tbody>
        </table>
      </div>
      <div class="hud-zrevive-flash" data-id="zreviveflash"></div>
      <div class="hud-zboss-flash" data-id="zbossflash"></div>
    `;

export class Hud2 extends Hud {
  constructor(root: HTMLElement) {
    super(root, { className: 'u2-hud', markup: HUD2_MARKUP });
  }

  private ggFlashTimerId = 0;

  private ggSetbackTimerId = 0;

  private kcEventTimerId = 0;

  private kcEventOutTimerId = 0;

  override setupMinimap(
    boxes: ReadonlyArray<{ x: number; z: number; w: number; d: number }>,
    stageSize: number,
  ): void {
    this.minimapStageSize = stageSize;
    this.minimapBoxes = Array.from(boxes);
    const sizeEl = this.el['mmsize'];
    if (sizeEl) sizeEl.textContent = `${Math.round(stageSize)}m四方`;
    // minimap canvas の 2D コンテキストを取得(ボックスは毎フレーム直接描画するためoffscreenは不要)
    const canvas = this.el['minimap'] as HTMLCanvasElement | undefined;
    if (canvas) {
      this.minimapCtx = canvas.getContext('2d');
    }
  }

  protected override buildCompass(): void {
    const strip = this.el['compass'];
    if (!strip) return;
    this.compassMarks = DIRECTIONS.map(([bearing, label]) => {
      const mark = document.createElement('span');
      mark.className = bearing % 90 === 0 ? 'u2h-cm-major' : 'u2h-cm-minor';
      mark.textContent = label;
      strip.appendChild(mark);
      return { bearing, el: mark };
    });
  }

  override hide(): void {
    this.root.hidden = true;
    // 帝王転調テーマの解除(三重保証その2)
    delete document.documentElement.dataset.emperor;
    // R57修正2: 書込み抑止キャッシュも同時に無効化しないと、帝王状態不変のまま
    // show()へ戻った際にupdateMk3()の empKey===mk3EmperorApplied 判定でスキップされ、
    // data-emperor が永久に復元されない(枠線だけ帝王色でHUD全体は無転調のまま)
    this.mk3EmperorApplied = '';
  }

  override reset(): void {
    const feed = this.el['feed'];
    if (feed) feed.innerHTML = '';
    const dmg = this.el['dmg'];
    if (dmg) dmg.innerHTML = '';
    this.lastStreak = 0;
    this.lastMoveState = '';
    this.lastUltActive = false;
    this.scopeOn = false;
    this.wasSteady = false;
    this.lastZombiePerks = '';
    // ガンゲームのランクアップ/セットバック・フラッシュタイマーも前試合から持ち越さない
    if (this.ggFlashTimerId) {
      window.clearTimeout(this.ggFlashTimerId);
      this.ggFlashTimerId = 0;
    }
    if (this.ggSetbackTimerId) {
      window.clearTimeout(this.ggSetbackTimerId);
      this.ggSetbackTimerId = 0;
    }
    // ★W4C C-1: MK.III状態の完全リセット。前試合の終了間際に発行されたモーメント
    // (キュー上限4件)が次試合の開幕へ流出するのを根治する
    this.mk3Moments = emptyMomentQueue();
    this.mk3Calm = { calm: false, quietS: 0 };
    this.mk3CalmApplied = false;
    delete this.root.dataset.calm;
    this.mk3PrevT = null;
    this.mk3CountUpTarget = null;
    this.mk3EmperorApplied = '';
    this.mk3ArcVisible = false;
    const mk3moment = this.el['mk3moment'];
    if (mk3moment) {
      mk3moment.hidden = true;
      mk3moment.classList.remove('mk3-show', 'mk3-leave');
    }
    const mk3emperor = this.el['mk3emperor'];
    if (mk3emperor) mk3emperor.hidden = true;
    const mk3arc = this.el['mk3arc'];
    if (mk3arc) mk3arc.hidden = true;
    const zperks = this.el['zperks'];
    if (zperks) {
      zperks.innerHTML = '';
      zperks.hidden = true;
    }
    const zbuy = this.el['zbuy'];
    if (zbuy) {
      zbuy.hidden = true;
      zbuy.textContent = '';
    }
    const deEl = this.el['darkemperor'];
    if (deEl) deEl.hidden = true;
    const raiteiEl = this.el['raitei'];
    if (raiteiEl) raiteiEl.hidden = true;
    const kokuraiteiEl = this.el['kokuraitei'];
    if (kokuraiteiEl) kokuraiteiEl.hidden = true;
    const chargeEl = this.el['chargegauge'];
    if (chargeEl) chargeEl.hidden = true;
    const spinEl = this.el['spingauge'];
    if (spinEl) spinEl.hidden = true;
    // R21 マルチキルバナーのリセット(前試合の残表示・タイマーを完全クリア)
    if (this.mkTimerId) {
      window.clearTimeout(this.mkTimerId);
      this.mkTimerId = 0;
    }
    this.mkBannerMs = 0;
    const mkbanner = this.el['mkbanner'];
    if (mkbanner) {
      mkbanner.hidden = true;
      mkbanner.classList.remove('mk-enter', 'mk-punch', 'mk-exit');
    }
    // R55 W-C6 [9]: キルコンファームバナーのリセット(前試合の残表示・タイマーを完全クリア)
    if (this.kcEventTimerId) {
      window.clearTimeout(this.kcEventTimerId);
      this.kcEventTimerId = 0;
    }
    if (this.kcEventOutTimerId) {
      window.clearTimeout(this.kcEventOutTimerId);
      this.kcEventOutTimerId = 0;
    }
    const kcEventEl = this.el['kcevent'];
    if (kcEventEl) {
      kcEventEl.hidden = true;
      kcEventEl.classList.remove('kc-show', 'kc-out');
    }
    // R11 キルカメラ状態の完全クリア(試合開始/離脱で黒幕やビネットを残さない)
    document.body.classList.remove('killcam-active');
    // ファイナルキルカム オーバーレイもクリア
    this.fkcRoot.classList.remove('fkc-active');
    document.body.classList.remove('killcam-active'); // R59-W2 FIX: 退避解除(showと対称)
    for (const id of ['kcveil', 'kcflash'] as const) {
      const n = this.el[id];
      if (n) n.style.opacity = '0';
    }
    const vign = this.el['kcvign'];
    if (vign) vign.classList.remove('final');
    // R30: スコアイベントはXPリボン(右下)へ一本化。試合ごとに残留行をクリア
    const ribbon = this.el['xpribbon'];
    if (ribbon) ribbon.innerHTML = '';
    const badges = this.el['badgestack'];
    if (badges) badges.innerHTML = '';
    const medalStack = this.el['medalstack'];
    if (medalStack) medalStack.innerHTML = '';
    // バッジキューリセット
    this.badgeQueue.length = 0;
    if (this.badgeQueueTimer) {
      window.clearInterval(this.badgeQueueTimer);
      this.badgeQueueTimer = 0;
    }
    // ミニマップ: 試合ごとにクリア(前試合のキャッシュを持ち越さない)
    if (this.minimapCtx) {
      const c = this.el['minimap'] as HTMLCanvasElement | undefined;
      this.minimapCtx.clearRect(0, 0, c?.width ?? 236, c?.height ?? 236);
    }
    // 帝王転調テーマの解除(三重保証: reset/hide/状態消滅)
    delete document.documentElement.dataset.emperor;
    // ── R53-W2: 新規状態の完全クリア(前試合の残表示・キャッシュキーを持ち越さない) ──
    this.lastPapTier = -1;
    const pappips = this.el['pappips'];
    if (pappips) pappips.innerHTML = '';
    this.lastPowerUpKey = '';
    this.powerUpEls.clear();
    const powerups = this.el['powerups'];
    if (powerups) powerups.innerHTML = '';
    this.lastSpecialRound = undefined;
    const specialbanner = this.el['specialbanner'];
    if (specialbanner) {
      specialbanner.hidden = true;
      specialbanner.classList.remove('w2-show', 'w2-out');
    }
    const zroundEl = this.el['zround'];
    if (zroundEl) zroundEl.classList.remove('w2-round-special', 'w2-round-pulse');
    this.lastRadioLine = null;
    const radio = this.el['radio'];
    if (radio) radio.hidden = true;
    const detect = this.el['detect'];
    if (detect) detect.hidden = true;
    this.lastBossPhaseTotal = -1;
    const bossphases = this.el['bossphases'];
    if (bossphases) {
      bossphases.innerHTML = '';
      bossphases.hidden = true;
    }
    this.lastSndPipTarget = -1;
    const snd = this.el['snd'];
    if (snd) snd.hidden = true;
  }

  override update(
    snap: MatchSnapshot,
    width: number,
    height: number,
    project: Project,
    showScoreboard: boolean,
  ): void {
    this.text('kills', String(snap.kills));
    this.text('deaths', String(snap.deaths));
    this.text('modename', snap.modeName);

    // R16: ゾンビモードはタイマー/チームスコアを隠し、ラウンド/キル/ポイントを表示する
    const zombie = this.el['zombie'];
    const inZombie = snap.zombieRound !== undefined;
    if (zombie) zombie.hidden = !inZombie;

    // R56③: ゾンビのみキルストリークを左上戦績行に「キルストリーク ×N」のコンパクト表示にする
    // (中央大演出=updateBannerはゾンビ時のみ抑止)。通常モードは従来の「連続キル N」を維持する。
    const streak = this.el['streak'];
    if (streak) {
      if (inZombie) {
        streak.hidden = snap.streak <= 0;
        streak.textContent = `キルストリーク ×${snap.streak}`;
      } else {
        streak.hidden = snap.streak < 2;
        streak.textContent = `連続キル ${snap.streak}`;
      }
    }

    // 焔座クロームのモード出し分け(CSSが参照: modeplate/streaks/金経済プレート)
    if (inZombie) this.root.dataset.zombie = '';
    else delete this.root.dataset.zombie;
    if (inZombie) {
      this.setTeamscoreHidden(true);
    }

    // 訓練場: タイマー/チームスコア/ミニマップを隠し、計測HUDを表示する
    const inTraining = snap.trainingStats !== undefined;
    const trainingEl = this.el['training'];
    if (trainingEl) trainingEl.hidden = !inTraining;
    if (inTraining) this.root.dataset.training = '';
    else delete this.root.dataset.training;
    if (inTraining && snap.trainingStats) {
      const ts = snap.trainingStats;
      this.text('tr-dps', ts.dps.toFixed(1));
      this.text('tr-acc', `${Math.round(ts.accuracy * 100)}%`);
      this.text('tr-hs', `${Math.round(ts.hsRate * 100)}%`);
      this.text('tr-streak', String(ts.streak));
      this.setTeamscoreHidden(true);
    }

    // ミニマップ: ゾンビ/訓練場モードでは非表示にしてK/Dパネルとの重なりを解消する。
    // 非表示時、CSS側の .u2h-mmframe:has(> canvas[hidden]) がフレームごと畳む(主目標カードが上に詰まる)。
    const minimapEl = this.el['minimap'];
    if (minimapEl) minimapEl.hidden = inZombie || inTraining;
    const timerEl = this.el['timer'];
    if (timerEl && timerEl.parentElement) {
      (timerEl.parentElement as HTMLElement).style.display = inZombie || inTraining ? 'none' : '';
    }
    const zplate = this.el['zpointsplate'];
    if (zplate) zplate.hidden = !inZombie;
    if (inZombie) {
      this.text('zround', String(snap.zombieRound ?? 1));
      this.text('zkills', String(snap.zombieKills ?? 0));
      const pts = (snap.zombiePoints ?? 0).toLocaleString('en-US');
      this.text('zpoints', pts);
      this.text('zpointsbig', pts);
    } else if (!inTraining) {
      const minutes = Math.floor(snap.timeLeft / 60);
      const seconds = Math.floor(snap.timeLeft % 60);
      this.text('timer', `${minutes}:${String(seconds).padStart(2, '0')}`);
    }

    this.updateRogue(inZombie ? snap.rogue : undefined);
    this.updateCompass(snap.yaw, width);
    this.updateCrosshair(snap, height);
    this.updateScope(snap, width, height);
    this.updateAmmo(snap);
    this.updateGrenade(snap);
    this.updateObjective(snap);
    this.updateHp(snap);
    this.pushFeed(snap);
    this.pushHits(snap);
    this.pushDamageNumbers(snap, project);
    this.pushXpRibbon(snap);
    this.pushMedals(snap);
    this.updateRadar(snap);
    this.pushIncoming(snap);
    this.updateDeath(snap);
    this.updateMovement(snap);
    this.updateBanner(snap);
    this.updateUlt(snap);
    this.updateBO2Streaks(snap);
    this.updateZombieShopHud(snap);
    this.pushZombiePointFloats(snap, project);
    this.updateZombieReviveFlash(snap);
    this.updateZombieBossFlash(snap);
    this.updateDarkEmperorHud(snap);
    this.updateRaiteiHud(snap);
    this.updateKokuraiteiHud(snap);
    const hellEl = this.el['hell'];
    if (hellEl) hellEl.hidden = !snap.hellMode;
    this.updateChargeGauge(snap);
    this.updateSpinGauge(snap);
    this.drawMinimap(snap);
    this.updateGunGameHud(snap);

    // ── R53-W2: M2a/M2b配線待ちの拡張フィールド(全optional。ローカル交差型で先行消費) ──
    const snapW2 = snap as R53W2Snapshot;
    this.updatePapPips(snapW2);
    this.updatePowerUps(snapW2);
    this.updatePoisonVignette(snapW2);
    this.updateSpecialRound(snapW2);
    this.updateRadioLine(snapW2);
    this.updateDetectMeter(snapW2);
    this.updateBossPhases(snapW2);
    this.updateSndHud(snapW2);

    // ── R53-W3 MK.III: Adaptive Presence / モーメント / 帝王枠 / チャージ弧 ──
    this.updateMk3(snap as Mk3Snapshot);

    const scoreboard = this.el['scoreboard'];
    if (scoreboard) {
      scoreboard.hidden = !showScoreboard;
      if (showScoreboard) this.renderScoreboard(snap);
    }
  }

  private formatScoreGoal(scoreTarget: number): string {
    return Number.isFinite(scoreTarget) ? `先取 ${scoreTarget}` : '';
  }

  private setTeamscoreHidden(hidden: boolean): void {
    const teamscore = this.el['teamscore'];
    if (teamscore) teamscore.hidden = hidden;
    const target = this.el['scoretarget'];
    if (target) target.hidden = hidden;
  }

  protected override updateAmmo(snap: MatchSnapshot): void {
    this.text('weapon', snap.weaponName);
    // W-ENZA2 U3: match.ts(共有)は 'PRIMARY'/'SECONDARY' のまま(変更不可)。
    // 表示直前にHud2側だけ明朝儀式命名へ置換する
    this.text('weaponslot', snap.weaponSlot === 'PRIMARY' ? '主武装' : '副武装');
    this.text('ammo', String(snap.ammo));
    // リザーブ弾は無限。有限値が来た場合のみ数値を表示する
    this.text('reserve', Number.isFinite(snap.reserve) ? `/ ${snap.reserve}` : '/ ∞');
    this.text('mode', snap.fireMode);
    const ammoEl = this.el['ammo'];
    if (ammoEl) ammoEl.classList.toggle('hud-ammo-low', snap.ammo <= 5);
    this.updateAmmoPips(snap);

    const reload = this.el['reload'];
    if (reload) reload.hidden = !snap.reloading;
    const fill = this.el['reloadfill'];
    if (fill && snap.reloading) fill.style.width = `${snap.reloadRatio * 100}%`;
  }

  protected override readonly BO2_SVG_ICONS = [
    // RC-XD: ラジコン車 (車体+アンテナ)
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect x="4" y="13" width="16" height="6" rx="1"/><circle cx="8" cy="20" r="1.8"/><circle cx="16" cy="20" r="1.8"/><line x1="15" y1="13" x2="17" y2="8"/><line x1="17" y1="8" x2="17" y2="5"/></svg>`,
    // UAV: レーダーディッシュ (円 + 放射線)
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><circle cx="12" cy="14" r="3"/><path d="M5 20 C5 12 19 12 19 20"/><line x1="12" y1="11" x2="12" y2="4"/><line x1="12" y1="4" x2="7" y2="8"/><line x1="12" y1="4" x2="17" y2="8"/></svg>`,
    // Hunter-Killer: ドローン (六角 + 線)
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><polygon points="12,4 19,8 19,16 12,20 5,16 5,8"/><line x1="5" y1="8" x2="1" y2="6"/><line x1="19" y1="8" x2="23" y2="6"/><line x1="5" y1="16" x2="1" y2="18"/><line x1="19" y1="16" x2="23" y2="18"/></svg>`,
    // Care Package: 落下クレート (箱+降下線)
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect x="6" y="13" width="12" height="8" rx="1"/><line x1="12" y1="2" x2="12" y2="13"/><line x1="8" y1="6" x2="12" y2="2"/><line x1="16" y1="6" x2="12" y2="2"/><line x1="6" y1="17" x2="18" y2="17"/></svg>`,
    // Counter UAV: 妨害アンテナ (電波遮断)
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><line x1="12" y1="4" x2="12" y2="20"/><path d="M6 8 C6 4 18 4 18 8"/><path d="M4 12 C4 6 20 6 20 12"/><line x1="4" y1="4" x2="20" y2="20"/></svg>`,
    // Lightning Strike: 稲妻ボルト
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><polyline points="13,2 7,13 12,13 11,22 17,11 12,11 13,2"/></svg>`,
    // Sensor Turret: 砲台
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect x="7" y="14" width="10" height="6" rx="1"/><rect x="9" y="10" width="6" height="4"/><line x1="12" y1="10" x2="12" y2="4"/><line x1="12" y1="4" x2="17" y2="7"/></svg>`,
  ];

  protected override readonly BO2_NAMES = ['火車', '天眼', '羅刹', '天賜', '結界', '雷撃', '番人'];

  protected override readonly BO2_COSTS = [325, 425, 525, 550, 600, 750, 800];

  protected override readonly BO2_SLOT_COUNT = 7;

  protected override updateBO2Streaks(snap: MatchSnapshot): void {
    // ゾンビモードではパネルを隠す
    const panel = this.root.querySelector<HTMLElement>('.u2h-streaks');
    // V31修正: ガンゲームでもストリークパネルを隠す(ストリーク無効モード)
    const ssHidden = snap.zombieRound !== undefined || snap.ggRank !== undefined;
    if (panel) panel.hidden = ssHidden;
    // F-01: BO3縦3段パネルは BO2 7スロットと排他。どちらのモードでも非表示
    const ssPanel = this.root.querySelector<HTMLElement>('.hud-ss-panel');
    if (ssPanel) ssPanel.hidden = true;
    if (ssHidden) return;

    // 各スロットのリット状態更新
    for (let i = 0; i < this.BO2_SLOT_COUNT; i += 1) {
      const slot = this.el[`bo2slot${i}`];
      if (!slot) continue;
      const banked = snap.streakBanked[i] ?? false;
      slot.classList.toggle('bo2-banked', banked);
      // アイコン: 初回のみ設定
      const iconEl = this.el[`bo2icon${i}`];
      if (iconEl && !iconEl.firstChild) {
        iconEl.innerHTML = this.BO2_SVG_ICONS[i] ?? '';
      }
      const nameEl = this.el[`bo2name${i}`];
      if (nameEl && !nameEl.textContent) {
        nameEl.textContent = this.BO2_NAMES[i] ?? '';
      }
    }
    // 次の未バンクストリークまでの残り pts
    const nextEl = this.el['bo2ssnext'];
    if (nextEl) {
      let nextLabel = '';
      for (let i = 0; i < this.BO2_SLOT_COUNT; i += 1) {
        if (!(snap.streakBanked[i] ?? false)) {
          const cost = this.BO2_COSTS[i] ?? 0;
          const rem = Math.max(0, cost - snap.streakProgress);
          nextLabel = rem === 0 ? '' : `${rem} 点`;
          break;
        }
      }
      if (nextEl.textContent !== nextLabel) nextEl.textContent = nextLabel;
    }
    // Counter UAV アクティブ表示
    const cauavEl = this.el['bo2cauav'];
    if (cauavEl) {
      cauavEl.hidden = !snap.streakCauavActive;
      if (snap.streakCauavActive) {
        const tEl = this.el['bo2cauavt'];
        if (tEl) {
          const t = String(Math.ceil(snap.streakCauavTimeLeft));
          if (tEl.textContent !== t) tEl.textContent = t;
        }
      }
    }
    // RC-XD 操縦オーバーレイ
    const rcxdOverlay = this.el['rcxdoverlay'];
    if (rcxdOverlay) {
      rcxdOverlay.hidden = !snap.streakRcxdActive;
      if (snap.streakRcxdActive) {
        const tEl = this.el['rcxdtimer'];
        if (tEl) {
          const t = String(Math.ceil(snap.streakRcxdTimeLeft));
          if (tEl.textContent !== t) tEl.textContent = t;
        }
      }
    }
  }

  protected override drawMinimap(snap: MatchSnapshot): void {
    const ctx = this.minimapCtx;
    if (!ctx) return;
    const MAP = (this.el['minimap'] as HTMLCanvasElement | undefined)?.width ?? 236;
    const CX = MAP / 2;
    const CY = MAP / 2;
    const scale = (MAP * 0.82) / this.minimapStageSize;
    const yaw = snap.yaw;

    ctx.clearRect(0, 0, MAP, MAP);

    // 地(mock05: 漆黒プレート。枠/罫はフレーム側DOMが持つ)
    ctx.fillStyle = 'rgba(7,8,11,0.9)';
    ctx.fillRect(0, 0, MAP, MAP);
    // 方眼(38px周期)
    ctx.strokeStyle = 'rgba(232,227,216,0.055)';
    ctx.lineWidth = 1;
    for (let g = 38; g < MAP; g += 38) {
      ctx.beginPath();
      ctx.moveTo(g + 0.5, 0);
      ctx.lineTo(g + 0.5, MAP);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, g + 0.5);
      ctx.lineTo(MAP, g + 0.5);
      ctx.stroke();
    }
    // 距離リング(mock: 内=橙0.2/外=白鋼0.08)+視界コーン(自機は常に上向き)
    ctx.strokeStyle = 'rgba(255,107,43,0.2)';
    ctx.beginPath();
    ctx.arc(CX, CY, MAP * 0.246, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(232,227,216,0.08)';
    ctx.beginPath();
    ctx.arc(CX, CY, MAP * 0.44, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,150,80,0.12)';
    ctx.beginPath();
    ctx.moveTo(CX, CY);
    ctx.lineTo(CX - MAP * 0.144, CY - MAP * 0.314);
    ctx.lineTo(CX + MAP * 0.144, CY - MAP * 0.314);
    ctx.closePath();
    ctx.fill();

    // ── 回転コンテキスト: プレイヤー中心・ヨー回転 ──
    ctx.save();
    ctx.translate(CX, CY);
    ctx.rotate(-yaw);

    // 障害物ボックス
    // R57修正1: ボックスはワールド絶対座標のため、敵/味方ドットと同じくプレイヤー相対化してから描く
    // (相対化しないとプレイヤーがワールド原点から離れるほど平行移動でズレる)
    ctx.strokeStyle = 'rgba(232,227,216,0.14)';
    ctx.lineWidth = 0.7;
    for (const b of this.minimapBoxes) {
      // V31: 破壊済みプロップはミニマップからも消す
      if (b.handle !== undefined && snap.destroyedPropHandles?.has(b.handle)) continue;
      const relBX = (b.x - snap.playerX) * scale;
      const relBZ = (b.z - snap.playerZ) * scale;
      ctx.strokeRect(
        relBX - (b.w * scale) / 2,
        relBZ - (b.d * scale) / 2,
        b.w * scale,
        b.d * scale,
      );
    }

    // 味方ドット(装甲青=sofu)
    ctx.fillStyle = '#8FDBFF';
    for (const ally of snap.minimapAllies) {
      ctx.beginPath();
      ctx.arc(ally.relX * scale, ally.relZ * scale, 2.6, 0, Math.PI * 2);
      ctx.fill();
    }

    // 敵ドット (赤, UAV スナップ, opacity フェード)
    for (const enemy of snap.minimapEnemies) {
      ctx.globalAlpha = enemy.opacity;
      ctx.fillStyle = '#D24545';
      ctx.beginPath();
      ctx.arc(enemy.relX * scale, enemy.relZ * scale, 3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // ── ハードポイントゾーン(回転コンテキスト内) ──
    if (snap.hardpointZoneRelX !== undefined && snap.hardpointZoneRelZ !== undefined) {
      const zx = snap.hardpointZoneRelX * scale;
      const zz = snap.hardpointZoneRelZ * scale;
      const zr = ZONE_R * scale;
      const hpColor =
        snap.hardpointOwner === 'mine'
          ? 'rgba(255,107,43,0.9)'
          : snap.hardpointOwner === 'enemy'
            ? 'rgba(210,69,69,0.9)'
            : 'rgba(245,208,107,0.9)';
      ctx.strokeStyle = hpColor;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(zx, zz, zr, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = hpColor;
      ctx.font = 'bold 7px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('HP', zx, zz);
    }

    // ── キルコンファーム ドッグタグ(回転コンテキスト内) ──
    if (snap.kcTagPositions) {
      for (const tag of snap.kcTagPositions) {
        ctx.fillStyle = tag.isEnemy ? 'rgba(245,208,107,0.9)' : 'rgba(210,69,69,0.9)';
        ctx.beginPath();
        ctx.arc(tag.relX * scale, tag.relZ * scale, 2.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // 発砲ブリップ(BO2本物仕様: 敵発砲位置を1秒間赤点表示。UAV赤点とは別レイヤ)
    if (snap.fireBlips) {
      for (const blip of snap.fireBlips) {
        const alpha = (1 - blip.age01) * 0.9;
        if (alpha <= 0) continue;
        ctx.globalAlpha = alpha;
        ctx.fillStyle = '#D24545';
        ctx.beginPath();
        ctx.arc(blip.relX * scale, blip.relZ * scale, 1.8, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    ctx.restore();

    // プレイヤーアロー(中心固定・常に上向き。mock=熾火)
    ctx.fillStyle = '#FFA061';
    ctx.strokeStyle = 'rgba(0,0,0,0.7)';
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(CX, CY - 6);
    ctx.lineTo(CX + 4, CY + 4);
    ctx.lineTo(CX, CY + 1);
    ctx.lineTo(CX - 4, CY + 4);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // UAVアクティブ表示はDOMラベル(mock05: 右下「UAV稼働」緑)
    const uavEl = this.el['mmuav'];
    if (uavEl) {
      uavEl.hidden = !snap.streakUavActive;
      if (snap.streakUavActive) {
        const t = `UAV稼働 ${Math.floor(snap.streakUavTimeLeft)}s`;
        if (uavEl.textContent !== t) uavEl.textContent = t;
      }
    }
  }

  protected override updateObjective(snap: MatchSnapshot): void {
    // ── ハードポイント方向インジケータ ──
    const hpInd = this.el['hpindicator'];
    if (hpInd) {
      const hasHp = snap.hardpointTimeLeft !== undefined;
      hpInd.hidden = !hasHp;
      if (hasHp) {
        // 矢印の回転(0=前方)
        const wrap = this.el['hparrowwrap'];
        if (wrap && snap.hardpointZoneAngle !== undefined) {
          wrap.style.transform = `rotate(${(snap.hardpointZoneAngle * 180) / Math.PI}deg)`;
        }
        // 占拠チップの色クラス
        const chip = this.el['hpchip'];
        if (chip) {
          chip.classList.toggle('hp-mine', snap.hardpointOwner === 'mine');
          chip.classList.toggle('hp-enemy', snap.hardpointOwner === 'enemy');
          chip.classList.toggle('hp-contested', snap.hardpointContested === true);
          const label = snap.hardpointContested
            ? 'CONTEST'
            : snap.hardpointOwner === 'mine'
              ? 'SECURE'
              : snap.hardpointOwner === 'enemy'
                ? 'LOSING'
                : 'EMPTY';
          if (chip.textContent !== label) chip.textContent = label;
        }
        // カウントダウン
        const timeEl = this.el['hptime'];
        if (timeEl) {
          const t = Math.ceil(snap.hardpointTimeLeft ?? 60);
          const txt = String(t);
          if (timeEl.textContent !== txt) timeEl.textContent = txt;
          timeEl.classList.toggle('hp-time-warn', (snap.hardpointTimeLeft ?? 60) <= 10);
        }
        // 矢印形状の色(SVG fill は style 経由でも効く)
        const shape = this.el['hparrowshape'];
        if (shape) {
          const col = snap.hardpointContested
            ? '#ffffff'
            : snap.hardpointOwner === 'mine'
              ? 'var(--accent)'
              : snap.hardpointOwner === 'enemy'
                ? '#ff4040'
                : '#ffd700';
          shape.style.fill = col;
        }
      }
    }

    // ── キルコンファーム演出 ──
    if (snap.kcEvent) this.pushKcEvent(snap.kcEvent);

    const isMission = snap.missionId !== undefined;
    // ストーリーは先取スコアを隠し、目的・進捗・波・ボスHPを出す
    this.setTeamscoreHidden(isMission);
    this.text('scoremine', String(snap.scoreMine));
    this.text('scoreenemy', String(snap.scoreEnemy));
    // 先取ラベルは有限のときだけ('先取 Infinity'の壊れ表示を防ぐ)
    this.text('scoretarget', this.formatScoreGoal(snap.scoreTarget));

    const mission = this.el['mission'];
    if (mission) {
      mission.hidden = !isMission;
      if (isMission) {
        this.text('obj-text', snap.objectiveText ?? '');
        const bar = this.el['obj-bar'];
        if (bar)
          bar.style.transform = `scaleX(${Math.max(0, Math.min(1, snap.objectiveProgress01 ?? 0))})`;
        const total = snap.waveTotal ?? 0;
        this.text('obj-wave', total > 1 ? `WAVE ${snap.waveIndex ?? 0}/${total}` : '');
      }
    }
    const boss = this.el['boss'];
    if (boss) {
      const showBoss = snap.bossHp01 !== undefined;
      boss.hidden = !showBoss;
      if (showBoss) {
        const bb = this.el['boss-bar'];
        if (bb) bb.style.transform = `scaleX(${Math.max(0, Math.min(1, snap.bossHp01 ?? 0))})`;
        const nameEl = this.el['boss-name'];
        if (nameEl) {
          const label = snap.zombieRound !== undefined ? '巨躯' : 'BOSS';
          if (nameEl.textContent !== label) nameEl.textContent = label;
        }
        if (snap.zombieRound !== undefined) {
          boss.classList.add('hud-boss--zombie');
        } else {
          boss.classList.remove('hud-boss--zombie');
        }
      }
    }

    const zones = this.el['zones'];
    if (zones) {
      zones.hidden = snap.zones.length === 0;
      if (snap.zones.length > 0) {
        // 拠点ピルは数が固定なので毎フレーム作り直さず属性だけ更新する
        if (zones.childElementCount !== snap.zones.length) {
          zones.innerHTML = '';
          for (const zone of snap.zones) {
            const pill = document.createElement('span');
            pill.className = 'hud-zone-pill';
            pill.textContent = zone.id;
            zones.appendChild(pill);
          }
        }
        snap.zones.forEach((zone, i) => {
          const pill = zones.children[i] as HTMLElement;
          pill.classList.toggle('zone-mine', zone.owner === 'mine');
          pill.classList.toggle('zone-enemy', zone.owner === 'enemy');
          pill.classList.toggle('zone-contested', zone.contested || zone.capturing !== null);
        });
      }
    }

    const announce = this.el['announce'];
    if (announce) {
      for (const message of snap.announcements) {
        const node = document.createElement('div');
        node.className = 'hud-announce-row';
        node.textContent = message;
        announce.appendChild(node);
        window.setTimeout(() => {
          node.classList.add('announce-out');
          window.setTimeout(() => node.remove(), 400);
        }, 2600);
      }
      while (announce.childElementCount > 3) announce.firstElementChild?.remove();
    }
  }

  protected override updateHp(snap: MatchSnapshot): void {
    this.text('hp', String(snap.hp));
    this.text('hpmax', `/ ${snap.maxHp}`);
    const fill = this.el['hpbarfill'];
    if (fill) {
      const ratio = clampN(snap.hp / snap.maxHp, 0, 1);
      // mock05: 360×9px 片刃バー。scaleXのみ(transform規約)。書込みは変化フレームのみ
      const sx = ratio.toFixed(3);
      if (sx !== this.lastHpOff) {
        fill.style.transform = `scaleX(${sx})`;
        this.lastHpOff = sx;
      }
      fill.classList.toggle('hp-low', ratio < 0.35);
    }
    const vignette = this.el['vignette'];
    if (vignette) {
      const ratio = snap.hp / snap.maxHp;
      // 瀕死(25%未満)は赤いビネットを脈動させる。脈動中はopacityをCSSアニメに委ねる
      const lowPulse = snap.alive && ratio < 0.25 && !snap.reduceMotion;
      vignette.classList.toggle('low', lowPulse);
      if (lowPulse) vignette.style.removeProperty('opacity');
      // V18修正: 絶対HP40固定だと maxHp=300(ニンジャ)で13%まで警告が出ない(reduceMotion層は特に)。
      // maxHp比率(40%窓)へ較正して maxHp に追従させる
      else {
        const dmgWindow = snap.maxHp * 0.4;
        vignette.style.opacity = String(
          Math.min(0.85, Math.max(0, (dmgWindow - snap.hp) / dmgWindow)),
        );
      }
    }
    if (snap.tookDamage) this.restartAnimation('flash', 'show');
  }

  protected override pushFeed(snap: MatchSnapshot): void {
    const feed = this.el['feed'];
    if (!feed) return;
    // 帝王状態は行生成時に固定(mock05: 帝王キル=状態色の銘行)
    const emp = deriveEmperorState(snap as Mk3Snapshot);
    for (const entry of snap.feed) {
      const row = document.createElement('div');
      const youKill = entry.killer === 'あなた';
      row.className = 'u2h-feed-row';
      if (youKill) row.classList.add('u2h-feed-row--you');
      if (youKill && emp) {
        row.classList.add('u2h-feed-row--emp');
        row.dataset.emp = emperorThemeAttr(emp);
      }
      row.dataset.kind = entry.headshot ? 'hs' : entry.weapon === '近接' ? 'melee' : '';
      const killer = document.createElement('span');
      killer.className = youKill ? 'u2h-feed-you' : 'u2h-feed-name';
      killer.textContent = entry.killer;
      const weapon = document.createElement('span');
      weapon.className = 'u2h-feed-weapon';
      if (youKill && emp) {
        weapon.classList.add('u2h-feed-weapon--emp');
        weapon.textContent = `〔${entry.weapon}${entry.headshot ? ' · 頭部' : ''}〕`;
      } else {
        weapon.textContent = `[${entry.weapon}${entry.headshot ? ' · 頭部' : ''}]`;
      }
      const victim = document.createElement('span');
      victim.className = entry.victim === 'あなた' ? 'u2h-feed-you' : 'u2h-feed-name';
      victim.textContent = entry.victim;
      row.append(killer, weapon, victim);
      feed.appendChild(row);
      window.setTimeout(() => {
        row.classList.add('feed-out');
        window.setTimeout(() => row.remove(), 400);
      }, FEED_LIFETIME_MS);
    }
    while (feed.childElementCount > 6) feed.firstElementChild?.remove();
  }

  protected override updateRadar(snap: MatchSnapshot): void {
    const radar = this.el['radar'];
    const group = this.el['radarblips'];
    if (!radar || !group) return;
    // R58: ゾンビモードでは左下の簡易レーダーを畳む。
    //  ① 実機報告「画面左下の謎の赤い矢印」= 本レーダー(赤環境光+至近ゾンビの赤ブリップ多数+
    //     自機ポインタ矢印 radar-self)がゾンビ戦では文脈のない赤い矢印に見えていた。
    //  ② 実機報告「UAVミニマップとzpointsが重なる」= ゾンビ戦は生命プレート上に金ポイント
    //     プレート(u2h-vitals-zrow)が積まれ左下スタックが高くなり、bottom:140px固定の本レーダー
    //     下端(≈bottom:140-181px帯)へ食い込んでいた。
    //  ゾンビ戦は左上ミニマップも既に非表示(inZombie)であり、至近のゾンビ群は常に可視=レーダー情報は
    //  冗長。ここで畳むことで両バグを根絶する(FFA/TDM等ではレーダーは従来どおり表示=機能維持)。
    const inZombie = snap.zombieRound !== undefined;
    const on = snap.radarEnabled && snap.alive && !inZombie;
    radar.hidden = !on;
    if (!on) return;
    const blips = group.children;
    for (let i = 0; i < blips.length; i += 1) {
      const blip = blips[i] as unknown as {
        setAttribute: (k: string, v: string) => void;
        style: CSSStyleDeclaration;
      };
      const bearing = snap.enemyBearings[i];
      if (!bearing) {
        blip.style.display = 'none';
        continue;
      }
      const rr = Math.min(44, (bearing.dist / RADAR_RANGE_M) * 44);
      blip.setAttribute('cx', (Math.sin(bearing.angle) * rr).toFixed(1));
      blip.setAttribute('cy', (-Math.cos(bearing.angle) * rr).toFixed(1));
      blip.style.display = '';
    }
  }

  protected override pushXpRibbon(snap: MatchSnapshot): void {
    const layer = this.el['xpribbon'];
    if (!layer || snap.scoreEvents.length === 0) return;
    for (const ev of snap.scoreEvents) {
      const row = document.createElement('div');
      row.className = /頭部|ヘッド/.test(ev.label) ? 'u2h-pop u2h-pop--sub' : 'u2h-pop';
      row.innerHTML = `<b>+${ev.xp}</b><span>${ev.label}</span>`;
      layer.appendChild(row);
      requestAnimationFrame(() => row.classList.add('show'));
      window.setTimeout(() => {
        row.classList.add('out');
        window.setTimeout(() => row.remove(), 350);
      }, 2150);
    }
    while (layer.childElementCount > 4) layer.firstElementChild?.remove();
  }

  protected override updateUlt(snap: MatchSnapshot): void {
    const ring = this.el['ultring'];
    const c01 = Math.min(1, snap.ultCharge);
    if (ring) ring.setAttribute('stroke-dashoffset', (65.97 * (1 - c01)).toFixed(2));
    this.text('ultpct', `${Math.floor(c01 * 100)}%`);
    const ult = this.el['ult'];
    if (ult) {
      ult.hidden = !snap.alive;
      ult.classList.toggle('ult-ready', snap.ultCharge >= 1 && !snap.ultActive);
      ult.classList.toggle('ult-active', snap.ultActive);
    }
    const label = this.el['ultlabel'];
    if (label) {
      const text = snap.ultActive ? 'OVERDRIVE' : snap.ultCharge >= 1 ? 'ULT 準備完了 [F]' : 'ULT';
      if (label.textContent !== text) label.textContent = text;
    }
    // 発動の瞬間に画面側の閃光を一度だけ出す(ワールド側の炸裂はカメラ内側で
    // 見えないため)。単発のソフトパルスでreduceMotion時は出さない
    if (snap.ultActive && !this.lastUltActive && !snap.reduceMotion) {
      this.restartAnimation('ultflash', 'show');
    }
    this.lastUltActive = snap.ultActive;
  }

  protected override updateBanner(snap: MatchSnapshot): void {
    const banner = this.el['banner'];
    if (!banner) return;
    const inZombie = snap.zombieRound !== undefined;
    if (!inZombie && snap.streak > this.lastStreak && snap.streak >= 3) {
      const labels: Record<number, string> = {
        3: 'TRIPLE KILL',
        4: 'MULTI KILL',
        5: 'RAMPAGE',
        7: 'UNSTOPPABLE',
        10: 'GODLIKE',
      };
      const label = labels[snap.streak] ?? `KILLSTREAK ×${snap.streak}`;
      const node = document.createElement('div');
      node.className = 'hud-banner-row';
      node.textContent = label;
      banner.appendChild(node);
      window.setTimeout(() => {
        node.classList.add('banner-out');
        window.setTimeout(() => node.remove(), 400);
      }, 1400);
      while (banner.childElementCount > 2) banner.firstElementChild?.remove();
    }
    this.lastStreak = snap.streak;
  }

  protected override renderScoreboard(snap: MatchSnapshot): void {
    const body = this.el['scorerows'];
    if (!body) return;
    this.text('scoremode', snap.modeName);
    // 無限先取(zombie等)では target が Infinity のため生文字列化しない(scoretargetと同じガード)
    this.text('scoregoal', this.formatScoreGoal(snap.scoreTarget));
    body.innerHTML = '';
    for (const row of snap.scoreboard) {
      const tr = document.createElement('tr');
      if (row.isPlayer) tr.className = 'score-you';
      else if (snap.teamBased && row.isAlly) tr.className = 'score-ally';
      const name = document.createElement('td');
      name.textContent = row.name;
      const kills = document.createElement('td');
      kills.textContent = String(row.kills);
      const deaths = document.createElement('td');
      deaths.textContent = String(row.deaths);
      tr.append(name, kills, deaths);
      body.appendChild(tr);
    }
  }

  protected override pushKcEvent(ev: 'confirmed' | 'denied'): void {
    const el = this.el['kcevent'];
    if (!el) return;
    // R55 W-C6 [9]: 単一要素使い回しのため、直前の消去タイマー(out遷移/hidden化とも)を
    // 必ずキャンセルしてから再スケジュールする(mkTimerId方式に統一)
    if (this.kcEventTimerId) {
      window.clearTimeout(this.kcEventTimerId);
      this.kcEventTimerId = 0;
    }
    if (this.kcEventOutTimerId) {
      window.clearTimeout(this.kcEventOutTimerId);
      this.kcEventOutTimerId = 0;
    }
    el.textContent = ev === 'confirmed' ? 'CONFIRMED' : 'DENIED';
    el.dataset.kind = ev;
    el.hidden = false;
    el.classList.remove('kc-show', 'kc-out');
    void (el as HTMLElement).offsetWidth;
    el.classList.add('kc-show');
    this.kcEventTimerId = window.setTimeout(() => {
      this.kcEventTimerId = 0;
      el.classList.add('kc-out');
      this.kcEventOutTimerId = window.setTimeout(() => {
        this.kcEventOutTimerId = 0;
        el.hidden = true;
        el.classList.remove('kc-show', 'kc-out');
      }, 350);
    }, 900);
  }

  override showFinalKillcam(weaponName?: string | null, distM?: number): void {
    this.fkcRoot.classList.add('fkc-active');
    // R59-W2 FIX: クロームHUD退避(body.killcam-active)は従来 update() 内トグルのみで、
    // ファイナルキルカム中は update() が呼ばれず恒久不発だった(タイマー/弾数がシネマ帯と重なる)。
    // show/hide で直接付け外しし、既存の退避CSSをそのまま効かせる。
    document.body.classList.add('killcam-active');
    // R54-F7: シネマ帯下部の武器バナー(mono)。武器名未供給(旧試合互換/素手系)は非表示
    if (weaponName) {
      this.fkcWeaponEl.textContent = distM && distM > 0 ? `${weaponName} — ${distM}m` : weaponName;
      this.fkcWeaponEl.hidden = false;
    } else {
      this.fkcWeaponEl.hidden = true;
    }
    // R55 W-C3 [14]: killcam中は hud.update() が呼ばれない(main.ts)ため、直前の
    // 'playing' フレームでスコープが開いていた場合、DOMスコープオーバーレイ(倍率/開度)が
    // 再生映像に同期せず凍結表示され続ける。一人称killcamはADS/スコープFOVを再生カメラ側で
    // 再現するため、DOM側の古いオーバーレイと二重表示になり「広角→超望遠へ説明なくジャンプ」
    // する画になる。hideFinalKillcam() と対称に、killcam開始時点で強制クローズし、
    // killcam再生中は常に素の画(オーバーレイなし)にする
    const scope = this.el['scope'];
    if (scope) {
      scope.hidden = true;
      this.scopeOn = false;
    }
  }

  setFinalKillcamFirstPerson(firstPerson: boolean): void {
    if (!firstPerson) return;
    const crosshair = this.el['crosshair'];
    if (!crosshair) return;
    crosshair.style.opacity = '1';
    crosshair.style.setProperty('--ads', '0');
  }

  protected override updateZombieShopHud(snap: MatchSnapshot): void {
    const inZombie = snap.zombieRound !== undefined;

    // ── パーク所持アイコン ──
    const zperks = this.el['zperks'];
    if (zperks) {
      zperks.hidden = !inZombie;
      const stacks = snap.zombiePerkStacks ?? {};
      // V23: quick-reviveはスタックMapに入らない(チャージ制)ため、チャージ数をキー/描画に含める
      const revCharges = snap.zombieQuickReviveCharges ?? 0;
      const key =
        (snap.zombiePerks ?? []).map((pid) => `${pid}:${stacks[pid] ?? 1}`).join(',') +
        `|rev:${revCharges}`;
      if (inZombie && key !== this.lastZombiePerks) {
        this.lastZombiePerks = key;
        zperks.innerHTML = '';
        const PERK_COLORS: Record<string, string> = {
          juggernog: '#ff3333',
          'speed-cola': '#33ffee',
          'double-tap': '#ff9933',
          'stamin-up': '#ffee33',
          'quick-revive': '#3355ff',
          'ext-mag': '#88ff44',
        };
        const PERK_LABELS: Record<string, string> = {
          juggernog: 'JUG',
          'speed-cola': 'SPD',
          'double-tap': 'DBL',
          'stamin-up': 'STM',
          'quick-revive': 'REV',
          'ext-mag': 'MAG',
        };
        const PERK_ARIA: Record<string, string> = {
          juggernog: 'ジャガーノグ: 最大HP増加',
          'speed-cola': 'スピードコーラ: リロード速度上昇',
          'double-tap': 'ダブルタップ: 射速2倍',
          'stamin-up': 'スタミンアップ: 移動速度上昇',
          'quick-revive': 'クイックリバイブ: 高速復活',
          'ext-mag': '拡張マガジン: 装弾数増加',
        };
        for (const pid of snap.zombiePerks ?? []) {
          const chip = document.createElement('div');
          chip.className = 'zp-icon';
          chip.title = PERK_ARIA[pid] ?? pid;
          chip.setAttribute('aria-label', PERK_ARIA[pid] ?? pid);
          chip.style.setProperty('--zp-color', PERK_COLORS[pid] ?? '#fff');
          const abbr = document.createElement('span');
          abbr.textContent = PERK_LABELS[pid] ?? pid.slice(0, 3).toUpperCase();
          chip.appendChild(abbr);
          const n = stacks[pid] ?? 1;
          if (n > 1) {
            const stackEl = document.createElement('span');
            stackEl.className = 'zp-stack';
            stackEl.textContent = `×${n}`;
            chip.appendChild(stackEl);
          }
          zperks.appendChild(chip);
        }
        // V23: quick-revive所持チップ(チャージ制のためスタックMap外。所持中のみ表示)
        if (revCharges > 0) {
          const chip = document.createElement('div');
          chip.className = 'zp-icon';
          chip.title = 'クイックリバイブ: 高速復活';
          chip.setAttribute('aria-label', 'クイックリバイブ: 高速復活');
          chip.style.setProperty('--zp-color', '#3355ff');
          const abbr = document.createElement('span');
          abbr.textContent = 'REV';
          chip.appendChild(abbr);
          if (revCharges > 1) {
            const stackEl = document.createElement('span');
            stackEl.className = 'zp-stack';
            stackEl.textContent = `×${revCharges}`;
            chip.appendChild(stackEl);
          }
          zperks.appendChild(chip);
        }
      }
    }

    // ── 購入プロンプト ──
    const zbuy = this.el['zbuy'];
    if (zbuy) {
      const prompt = snap.zombieShopPrompt;
      zbuy.hidden = !inZombie || !prompt;
      if (inZombie && prompt) {
        const text = prompt.label;
        if (zbuy.dataset.label !== text || zbuy.dataset.afford !== String(prompt.canAfford)) {
          zbuy.dataset.label = text;
          zbuy.dataset.afford = String(prompt.canAfford);
          zbuy.replaceChildren();
          const key = document.createElement('span');
          key.className = 'u2h-zbuy-key';
          key.textContent = 'E';
          const label = document.createElement('span');
          label.className = 'u2h-zbuy-label';
          label.textContent = text;
          zbuy.append(key, label);
          zbuy.classList.toggle('zbuy-broke', !prompt.canAfford);
        }
      }
    }
  }

  protected override updateGunGameHud(snap: MatchSnapshot): void {
    const el = this.el['gg'];
    if (!el) return;
    const inGG = snap.ggRank !== undefined;
    el.hidden = !inGG;
    if (!inGG) return;

    const rank = snap.ggRank!;
    this.text('ggrank', `${rank} / ${GG_LADDER.length}`);
    this.text('ggweapon', snap.ggWeaponName ?? '');

    // ランクアップフラッシュ(1フレームだけ演出クラスを付与)。連続発火時は既存タイマーを
    // clearTimeoutしてから張り直す(他イベントのタイマーに巻き込まれて早期消灯しないように
    // ハンドルを個別保持する)
    if (snap.ggRankUpFlash) {
      el.classList.add('gg-rankup');
      if (this.ggFlashTimerId) clearTimeout(this.ggFlashTimerId);
      this.ggFlashTimerId = window.setTimeout(() => {
        el.classList.remove('gg-rankup');
        this.ggFlashTimerId = 0;
      }, 600);
    }
    if (snap.ggSetback) {
      el.classList.add('gg-setback');
      if (this.ggSetbackTimerId) clearTimeout(this.ggSetbackTimerId);
      this.ggSetbackTimerId = window.setTimeout(() => {
        el.classList.remove('gg-setback');
        this.ggSetbackTimerId = 0;
      }, 600);
    }

    // トップ3リーダーボード
    const top3El = this.el['ggtop3'];
    if (top3El && snap.ggTop3) {
      top3El.innerHTML = snap.ggTop3
        .map(
          (e, i) =>
            `<div class="gg-top3-row${e.isPlayer ? ' gg-top3-you' : ''}">` +
            `<span class="gg-top3-pos">${i + 1}</span>` +
            `<span class="gg-top3-name">${e.isPlayer ? 'YOU' : e.name}</span>` +
            `<span class="gg-top3-rank">${e.rank}</span>` +
            `</div>`,
        )
        .join('');
    }
  }

  protected override updateSpecialRound(snap: R53W2Snapshot): void {
    const special = snap.specialRound ?? null;
    if (isSpecialRoundEntering(this.lastSpecialRound, special)) {
      const banner = this.el['specialbanner'];
      if (banner) {
        const reduceMotion = snap.reduceMotion;
        banner.classList.remove('w2-show', 'w2-out');
        banner.hidden = false;
        // R57修正3: reduce-motion時もw2-show(=唯一opacity:1を付与するクラス)を付ける。
        // @media(prefers-reduced-motion)側はtransition:noneのみでopacity保険が無いため、
        // このクラスを付けないと基底 .w2-special-banner{opacity:0} のまま全期間不可視になる
        if (!reduceMotion) {
          void banner.offsetWidth; // reflow でスラムインを再起動
        }
        banner.classList.add('w2-show');
        window.setTimeout(() => {
          if (reduceMotion) {
            banner.hidden = true;
          } else {
            banner.classList.add('w2-out');
            window.setTimeout(() => {
              banner.hidden = true;
              banner.classList.remove('w2-show', 'w2-out');
            }, 500);
          }
        }, 2200);
      }
    }
    this.lastSpecialRound = special;
    const zroundEl = this.el['zround'];
    if (zroundEl) {
      const active = special === 'rush';
      zroundEl.classList.toggle('w2-round-special', active);
      // 点滅/脈動はreduceMotion時に付与しない(JS側ゲート。CSS側の@mediaと二重で止める)
      zroundEl.classList.toggle('w2-round-pulse', active && !snap.reduceMotion);
    }
  }

  protected override updateMk3(snap: Mk3Snapshot): void {
    const now = performance.now();
    const dt = this.mk3PrevT === null ? 0 : clampN((now - this.mk3PrevT) / 1000, 0, 0.1);
    this.mk3PrevT = now;

    // ── P0-1 Adaptive Presence(calm時に計器が沈む) ──
    const hpRatio = snap.maxHp > 0 ? snap.hp / snap.maxHp : 1;
    this.mk3Calm = stepCalmLatch(this.mk3Calm, snap.uiHeat, hpRatio, snap.alive, dt);
    if (this.mk3Calm.calm !== this.mk3CalmApplied) {
      this.mk3CalmApplied = this.mk3Calm.calm;
      if (this.mk3Calm.calm) this.root.dataset.calm = '';
      else delete this.root.dataset.calm;
    }

    // ── P0-2 モーメント帯 ──
    const suppressed = snap.adsProgress > 0.5 || snap.killcamCamActive || !snap.alive;
    const step = stepMomentQueue(this.mk3Moments, snap.moments, suppressed, dt);
    this.mk3Moments = step.state;
    const momentEl = this.el['mk3moment'];
    if (momentEl) {
      if (step.change === 'show' && step.state.current) {
        const m = step.state.current;
        momentEl.dataset.tone = momentTone(m);
        this.text('mk3momentmark', momentWatermark(m));
        const sub = this.el['mk3momentsub'];
        if (sub) {
          sub.textContent = m.sub ?? '';
          sub.hidden = !m.sub;
        }
        const n = Number(m.title);
        this.mk3CountUpTarget = m.title !== '' && Number.isFinite(n) && n > 0 ? n : null;
        this.text('mk3momenttitle', this.mk3CountUpTarget !== null ? '0' : m.title);
        momentEl.hidden = false;
        momentEl.classList.remove('mk3-leave');
        this.restartAnimation('mk3moment', 'mk3-show');
      } else if (step.change === 'hide') {
        momentEl.classList.add('mk3-leave');
        this.mk3CountUpTarget = null;
      } else if (step.change === 'end') {
        momentEl.hidden = true;
        momentEl.classList.remove('mk3-leave', 'mk3-show');
      }
      // 数値タイトルのカウントアップ(表示開始0.5sのみ。text()は同値書込みをスキップする)
      if (this.mk3CountUpTarget !== null && step.state.phase === 'show') {
        const k = Math.min(1, step.state.t / 0.5);
        this.text('mk3momenttitle', String(Math.round(this.mk3CountUpTarget * k)));
        if (k >= 1) this.mk3CountUpTarget = null;
      }
    }

    // ── P1-1 帝王プレゼンス枠 ──
    const emperor = deriveEmperorState(snap);
    const empKey = emperor ?? '';
    if (empKey !== this.mk3EmperorApplied) {
      this.mk3EmperorApplied = empKey;
      const frame = this.el['mk3emperor'];
      if (frame) {
        frame.hidden = empKey === '';
        if (empKey !== '') frame.dataset.state = empKey;
      }
      // UI全転調(enza-core契約): :root[data-emperor] を状態変化フレームのみ書換
      if (empKey === '') delete document.documentElement.dataset.emperor;
      else document.documentElement.dataset.emperor = emperorThemeAttr(empKey as EmperorState);
    }

    // ── チャージ弧(旧hud-charge-gauge棒はmk3レイヤCSSで非表示化=同一データの二重表示回避) ──
    const arcWrap = this.el['mk3arc'];
    const arcFill = this.el['mk3arcfill'];
    if (arcWrap && arcFill) {
      const ratio = snap.chargeRatio ?? 0;
      const visible = ratio > 0 && snap.alive;
      if (visible !== this.mk3ArcVisible) {
        this.mk3ArcVisible = visible;
        arcWrap.hidden = !visible;
        if (!visible) this.mk3LastArcOffset = '';
      }
      if (visible) {
        const off = chargeArcDashoffset(ratio).toFixed(1);
        if (off !== this.mk3LastArcOffset) {
          this.mk3LastArcOffset = off;
          arcFill.style.strokeDashoffset = off;
          arcWrap.classList.toggle('mk3-arc-full', ratio >= 1);
        }
        if (arcWrap.dataset.state !== empKey) arcWrap.dataset.state = empKey;
      }
    }
  }
}
