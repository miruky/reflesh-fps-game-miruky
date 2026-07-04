# FPS-reFlesh — Claude Code 運用ルール

## モデル・ルーティング方針（トークンマネジメント／必ず適用）

各作業フェーズを以下のモデル×推論努力へ**自動的に**振り分けること。ユーザーが都度指示しなくても、このプロジェクトでの依頼はすべてこの方針で実行する。

| フェーズ | モデル | effort | 実行形態 |
|---|---|---|---|
| 司令塔（オーケストレーション・統合・判断） | **Fable 5** | **xhigh** | メインループ（このセッション自身。モデル指定しない＝継承） |
| 要件定義・設計・計画の統合/判定 | **Fable 5** | **xhigh** | メインループ、または Workflow の judge/synthesize ステージ（`model`省略=継承、`effort:'xhigh'`） |
| ネット検索を伴う調査・リサーチ・大量読み | **Sonnet** | **max** | サブエージェント：`model:'sonnet'` ＋ Workflow では `effort:'max'`（Agentツールは `subagent_type:'deep-research'`） |
| 実装・テスト・デプロイ・レビューのファンアウト | **Sonnet** | **max** | サブエージェント：`model:'sonnet'` ＋ Workflow では `effort:'max'`（Agentツールは `subagent_type:'builder'`） |

具体的な書き方:
- **Agentツール**: 調査は `subagent_type: 'deep-research'`、実装/テスト/デプロイは `subagent_type: 'builder'`（いずれも `.claude/agents/` で model: sonnet 固定済み）。設計系フォークは `subagent_type: 'fork'`（Fable継承）。
- **Workflowスクリプト**: 提案/調査/実装/検証ステージの `agent()` は `{model:'sonnet', effort:'max'}`。判定(judge)/統合(synthesize)/要件定義ステージは `model` 省略（メインのFable 5を継承）＋ `{effort:'xhigh'}`。
- 迷ったら「考える仕事＝Fable xhigh、手数の仕事＝Sonnet max」。

狙い: 圧倒的パフォーマンス（設計・判断は最上位モデルの深い思考）とトークン効率（大量の検索・実装・テストは高速なSonnetの全力）を両立する。

## ラウンド運用（従来どおり）

「最強のFPSにする」系の依頼は R ラウンド方式: 設計ワークフロー（大規模ファンアウト）→ 契約凍結 → 並列実装（非競合ファイル分割）→ 統合 → 敵対的レビュー → 確証findings修正 → ゲート（`npx tsc --noEmit` / `npx eslint src --max-warnings=0` / `npx vitest run` / `npx vite build` 全緑）→ main へ commit+push（自動デプロイ）→ CI+Deploy 確認（Pages一時障害は空コミットで再実行）→ メモリ更新。

## プロジェクト鉄則

- **アセットレス**: バイナリ資産ゼロ。Three.js primitives / procedural GLSL / 頂点カラー / WebAudio合成 / DOM+CSS+inline-SVG のみ。外部fetch不可。
- 固定60Hzロジック＋可変レンダ、snapshot()→DOM一方向、試合ごとdispose、コライダー不変。
- canvas上のパネルに filter/backdrop-filter を載せない。bloom閾値0.9を超える発光を足さない（白飛び再発禁止）。
- 空の明暗調整は match.ts `applySky` の可視空 scale/clamp のみ（envSky=IBLは触らない＝ステージの明るさ維持）。
