# hibana

[![CI](https://github.com/miruky/hibana/actions/workflows/ci.yml/badge.svg)](https://github.com/miruky/hibana/actions/workflows/ci.yml)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Three.js](https://img.shields.io/badge/Three.js-r170-000000?logo=threedotjs&logoColor=white)](https://threejs.org/)
[![Test](https://img.shields.io/badge/Test-Vitest-6E9F18?logo=vitest&logoColor=white)](https://vitest.dev/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**Three.js と Rapier で構築した、インストール不要でブラウザからそのまま遊べる 3D FPS です。**

## 概要

シード生成された 10 ステージを舞台に、BOT を相手に 5 分間のスコアアタックを行う一人称シューターです。リコイルパターン、射撃ブルーム、ADS、タクティカル / 空リロード、部位ダメージ、距離減衰といった FPS の中核メカニクスを、ゲームエンジンに頼らず TypeScript で実装しています。3D モデル・画像・音声のアセットファイルを一切持たず、ジオメトリはプリミティブの合成、効果音は Web Audio によるリアルタイム合成、画像は SVG のみで構成しているのが特徴です。

遊ぶ: https://miruky.github.io/hibana/

### なぜ作ったのか

リアルタイム 3D・物理シミュレーション・ゲーム AI・HUD 設計を 1 つの題材で横断するポートフォリオとして作成しました。FPS は「気持ちよく動いて当たり前」のジャンルであり、入力遅延、固定タイムステップ、レイキャスト判定、反動制御といった低レイヤーの品質がそのまま体験に出ます。エンジンを使わずに組むことで、その全てを自分の責任範囲に置いています。

### 開発状況

現在は P0(コア戦闘ループ)が完成した状態です。移動・射撃・BOT 戦・10 ステージ・HUD・設定までを実装済みで、投擲物、対人マルチプレイヤー、メタゲームなどは段階的に追加します。全要求機能の一覧と実装フェーズは [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md) に記録しています。

## 操作

| 操作 | キー |
|:--|:--|
| 移動 | W A S D |
| 視点 | マウス |
| 射撃 | 左クリック |
| ADS(覗き込み) | 右クリック(トグル設定あり) |
| ジャンプ | Space |
| しゃがみ | C / 左 Ctrl |
| スプリント | 左 Shift |
| リロード | R |
| 武器切替 | 1 / 2 / ホイール |
| 近接攻撃 | V |
| スコアボード | Tab |
| ポーズ | Esc |

## アーキテクチャ

![hibanaのアーキテクチャ](docs/architecture.svg)

物理とゲームロジックは固定 60Hz で更新し、描画と視点操作はディスプレイのリフレッシュレートに追従させています。HUD は DOM で構築し、毎フレームのスナップショット(イミュータブルな状態の写し)だけを受け取るため、ゲームロジックから UI への参照は一方向です。

## 技術スタック

| カテゴリ | 技術 |
|:--|:--|
| 言語 | TypeScript 5(strict) |
| 描画 | Three.js(WebGL) |
| 物理 | Rapier(Rust 製 / WASM) |
| ビルド | Vite |
| テスト | Vitest(32 テスト) |
| リンタ | ESLint + Prettier |
| CI / CD | GitHub Actions |
| 配信 | GitHub Pages |

## 実装済みの機能

移動系は WASD・スプリント・しゃがみ・ジャンプに加え、コヨーテタイム、ジャンプ入力バッファ、落下ダメージ、移動状態に連動する足音まで実装しています。射撃系はヒットスキャン、武器ごとのリコイルパターン、連射で増えるブルーム、ADS による精度・速度・FOV の変化、タクティカル / 空リロードの使い分け、武器切替、近接攻撃を備えます。

戦闘ルールはヘッドショット倍率つきの部位ダメージ、距離減衰、自動回復、敵との距離を考慮したリスポーンを実装。BOT は視野と遮蔽を考慮した索敵、発砲音への警戒反応、交戦距離を保つストレイフ移動を行い、3 段階の腕前を選べます。HUD はスプレッド連動で開閉するクロスヘア、ヒットマーカー、キルフィード、コンパス、被弾方向インジケータ、ダメージ数値、スコアボード、リザルト画面を持ちます。

## プロジェクト構成

- `src/core` — 入力、ゲームループ、シード付き乱数、音合成、設定の永続化
- `src/game` — 弾道計算、武器、弾倉、反動、プレイヤー、BOT、ステージ生成、試合進行
- `src/render` — トレーサーや弾痕などのエフェクト、一人称ビューモデル
- `src/ui` — HUD、メニュー画面
- `docs` — 要件定義書、アーキテクチャ図
- `.github/workflows` — CI と GitHub Pages デプロイ

## はじめ方

### 前提条件

- Node.js 20 以上

### セットアップ

```bash
git clone https://github.com/miruky/hibana.git
cd hibana
npm install
npm run dev
```

### テストの実行

```bash
npm test
```

### Lint の実行

```bash
npm run lint
```

### デプロイ

`main` ブランチへのプッシュで GitHub Actions がビルドし、GitHub Pages へ自動デプロイします。手元での本番ビルドは `npm run build` で `dist/` に出力されます。

## 設計方針

- **アセットレス** — モデルはプリミティブ合成、効果音は Web Audio で合成、画像は SVG のみ。リポジトリにバイナリを置かない
- **決定論的ステージ生成** — シード付き PRNG(mulberry32)で 10 ステージを生成し、同一性をテストで保証
- **固定タイムステップ** — 物理・ロジックは 60Hz 固定、視点操作と描画はリフレッシュレート追従で入力遅延を最小化
- **純粋ロジックの分離** — 弾道・反動・弾倉・ステージ生成は DOM / GPU 非依存のモジュールとして切り出し、Vitest で検証
- **データ駆動の武器バランス** — 武器の挙動は WeaponDef の数値定義に集約し、調整がコード変更なしで完結

## ライセンス

[MIT](LICENSE)
