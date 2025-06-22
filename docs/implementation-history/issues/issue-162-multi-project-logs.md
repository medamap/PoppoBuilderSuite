# Issue #162: マルチプロジェクトログ管理の実装

## 概要
グローバルログとプロジェクト別ログを効率的に管理するシステムを実装する。

## 実装内容
- グローバルログとプロジェクトログの分離
- ログローテーション機能
- ログ集約ビュー（全プロジェクト横断）
- ログレベルフィルタリング

## ログ構造
```
~/.poppobuilder/logs/
  ├── daemon.log        # デーモンログ
  └── global.log        # 全体ログ

project/.poppobuilder/logs/
  └── project.log       # プロジェクトログ
```

## 実装ファイル
- `lib/utils/multi-logger.js` ✅ (実装済み)
- `lib/utils/log-aggregator.js` ✅ (実装済み)

## 実装状況

### Phase 1: 基本実装 ✅
1. **MultiLogger** (`lib/utils/multi-logger.js`)
   - グローバルログとプロジェクトログの分離管理
   - ログローテーション（サイズ・日付ベース）
   - 圧縮機能（gzip）
   - ストリーミング書き込み
   - イベントベースの通知

2. **LogAggregator** (`lib/utils/log-aggregator.js`)
   - 複数ログファイルの横断検索
   - フィルタリング（レベル、時間、プロジェクト、コンポーネント）
   - 集約とグループ化
   - リアルタイムストリーミング
   - エクスポート機能（JSON/CSV/Text）

### Phase 2: 統合作業 🚧
1. **DaemonManagerへの統合**
   - ✅ MultiLogger初期化済み
   - ⬜ 各コンポーネントへのlogger配布

2. **WorkerProcessへの統合**
   - ⬜ プロジェクト実行時のログ分離
   - ⬜ タスク別ログファイル生成

3. **PoppoBuilderへの統合**
   - ⬜ 既存Loggerクラスの置き換え
   - ⬜ プロジェクト登録時のログ設定

4. **CLIコマンドの実装**
   - ⬜ `poppo logs search` - ログ検索
   - ⬜ `poppo logs tail` - リアルタイム表示
   - ⬜ `poppo logs export` - ログエクスポート

## 次のステップ
1. WorkerProcessでMultiLoggerを使用するように修正
2. PoppoBuilderクラスでプロジェクト登録時にログを設定
3. CLIコマンドの実装
4. 既存のLoggerクラスを段階的に置き換え

## 実装完了日
2025-06-21（予定）

🤖 Generated with [Claude Code](https://claude.ai/code)

Co-Authored-By: Claude <noreply@anthropic.com>