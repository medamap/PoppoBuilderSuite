# Issue #162: マルチプロジェクトログ管理の実装

## 概要
PoppoBuilder Suiteの各コンポーネントのログを効率的に管理するための包括的なログ管理システムを実装しました。グローバルログとプロジェクト別ログの分離、ログローテーション、検索・集約機能を提供します。

## 実装日
2025/6/21

## 実装内容

### 1. MultiLogger (`lib/utils/multi-logger.js`)
- **階層的ログ管理**
  - グローバルログ: `~/.poppobuilder/logs/`
    - `global.log`: すべてのコンポーネントの一般ログ
    - `daemon.log`: デーモンプロセス専用ログ
  - プロジェクトログ: `project/.poppobuilder/logs/`
    - `project.log`: プロジェクト固有のログ

- **ログローテーション**
  - サイズベース（デフォルト: 100MB）
  - 日付ベース（日次）
  - 自動圧縮（gzip）
  - 古いファイルの自動削除

- **高度な機能**
  - 5段階のログレベル（error, warn, info, debug, trace）
  - JSON/テキスト形式のサポート
  - ストリームベースの高速書き込み
  - イベント発行によるモニタリング
  - メタデータとエラー詳細の記録

### 2. LogAggregator (`lib/utils/log-aggregator.js`)
- **統合検索機能**
  - 複数ソースの横断検索
  - レベル、時間範囲、プロジェクト、コンポーネントでのフィルタリング
  - クエリベースのテキスト検索
  - 圧縮ファイル（.gz）の自動展開

- **集約・分析**
  - レベル別、プロジェクト別、時間別の集約
  - エラーサマリーとトップエラーの抽出
  - 統計情報の生成
  - タイムライン分析

- **エクスポート機能**
  - JSON形式
  - CSV形式
  - プレーンテキスト形式

- **リアルタイムストリーミング**
  - ファイル監視によるリアルタイム更新
  - tail -f 相当の機能
  - フィルタリング付きストリーム

### 3. CLIコマンド (`lib/commands/logs.js`)
```bash
# 基本的な使用方法
poppobuilder logs                    # 最新ログを表示
poppobuilder logs -f                 # リアルタイムストリーミング
poppobuilder logs --level error      # エラーのみ表示
poppobuilder logs --project my-proj  # 特定プロジェクトのログ

# 検索機能
poppobuilder logs "error message"    # クエリ検索
poppobuilder logs --since "1 hour ago"  # 時間範囲指定
poppobuilder logs --component builder    # コンポーネントフィルタ

# 集約・分析
poppobuilder logs --aggregate         # ログ統計表示
poppobuilder logs --errors           # エラーサマリー
poppobuilder logs --group-by project # プロジェクト別集計

# エクスポート
poppobuilder logs --export logs.json      # JSON形式
poppobuilder logs --export logs.csv --format csv  # CSV形式
```

### 4. Daemon API統合 (`lib/daemon/api-server.js`)
- **RESTエンドポイント**
  - `GET /api/logs` - ログ検索
  - `GET /api/logs/aggregate` - ログ集約
  - `GET /api/logs/errors` - エラーサマリー

### 5. 統合とテスト
- **MultiLoggerテスト** (`test/multi-logger.test.js`)
  - 47個のテストケース
  - 初期化、ログ記録、ローテーション、クリーンアップ

- **LogAggregatorテスト** (`test/log-aggregator.test.js`)
  - 29個のテストケース
  - 検索、集約、エクスポート、ストリーミング

## 技術的特徴

### パフォーマンス最適化
- ストリームベースの非同期I/O
- バックプレッシャー処理
- 検索結果のキャッシング
- 並列ファイル読み取り

### 信頼性
- アトミックなファイル操作
- エラー時の自動回復
- ログ欠損の防止
- 圧縮ファイルの整合性保証

### 拡張性
- シングルトンパターンによる統一管理
- イベント駆動アーキテクチャ
- プラグイン可能なフォーマット

## 設定例

```javascript
// config.json
{
  "logging": {
    "level": "info",
    "maxFileSize": "100MB",
    "maxFiles": 10,
    "enableRotation": true,
    "enableCompression": true,
    "format": "json"
  }
}
```

## 使用例

```javascript
// プログラムでの使用
const { getInstance } = require('./lib/utils/multi-logger');
const logger = getInstance();

// プロジェクトの登録
await logger.registerProject('my-project', '/path/to/project');

// ログ記録
await logger.info('Task completed', { 
  projectId: 'my-project',
  component: 'task-processor',
  metadata: { taskId: 123 }
});

// エラーログ
await logger.error('Task failed', {
  error: new Error('Connection timeout'),
  projectId: 'my-project'
});

// ブロードキャスト
await logger.info('System update', { broadcast: true });
```

## イベント

### MultiLoggerイベント
- `initialized`: 初期化完了
- `project-registered`: プロジェクト登録
- `log-written`: ログ書き込み
- `log-rotated`: ログローテーション
- `log-deleted`: 古いログ削除

### LogAggregatorイベント
- `initialized`: 初期化完了
- `search-completed`: 検索完了
- `cache-cleared`: キャッシュクリア
- `logs-exported`: ログエクスポート

## ログファイル構造

```
~/.poppobuilder/
├── logs/
│   ├── global.log               # 現在のグローバルログ
│   ├── global.2024-06-21.log.gz # ローテーション済みログ
│   ├── daemon.log               # デーモンログ
│   └── daemon.2024-06-21.log.gz

project/.poppobuilder/
└── logs/
    ├── project.log              # プロジェクトログ
    └── project.2024-06-21.log.gz
```

## 今後の拡張予定

1. **メトリクス統合**: Prometheusフォーマットのサポート
2. **アラート機能**: エラーレート監視とアラート
3. **ログフォワーディング**: 外部ログサービスへの転送
4. **ダッシュボード**: Web UIでのログ可視化
5. **構造化ログ**: OpenTelemetryフォーマット対応

## 関連Issue
- Issue #161: プロジェクト間状態同期の実装（完了）
- 今後の実装候補:
  - run/executeコマンドの実装
  - ワーカープロセスの実装