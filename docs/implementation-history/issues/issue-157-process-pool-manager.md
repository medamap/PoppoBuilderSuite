# Issue #157: Global Process Pool Manager実装

## 概要
PoppoBuilder Suiteに複数プロジェクト間でプロセスを共有・管理するグローバルプロセスプールマネージャーを実装しました。

## 実装日
2025/6/21

## 実装内容

### 1. ProcessPoolManager (`lib/core/process-pool-manager.js`)
- **ワーカースレッドプール管理**
  - Node.js `worker_threads`を使用した効率的なプロセス管理
  - ワーカーの作成、監視、リサイクル、終了のライフサイクル管理
  - ハートビートによる死活監視と自動復旧

- **タスクキューシステム**
  - 優先度ベースのタスク処理（0-10のスケール）
  - プロジェクト単位のプロセス制限
  - 失敗タスクの自動リトライ（指数バックオフ）
  - タイムアウト処理

- **自動スケーリング**
  - 負荷に応じた動的なワーカー数調整
  - スケールアップ閾値: 80%、スケールダウン閾値: 20%
  - スムーズなスケーリングでリソーススパイクを回避

### 2. WorkerProcess (`lib/core/worker-process.js`)
- **マルチタスクタイプサポート**
  - `execute-code`: JavaScriptコードの直接実行
  - `execute-function`: 関数実行（引数付き）
  - `execute-module`: モジュールのロードと実行
  - `http-request`: HTTP/HTTPSリクエスト
  - `shell-command`: シェルコマンド実行

- **セキュリティ機能**
  - VMコンテキストでの隔離実行
  - リソース制限（CPU、メモリ）
  - コマンド検証

### 3. DaemonWorker統合 (`lib/daemon/worker-implementation.js`)
- デーモンワーカーとプロセスプールの統合
- マスタープロセスからのタスク受信と実行
- メトリクスとステータスの報告
- 設定の動的リロード対応

### 4. API拡張 (`lib/daemon/api-server.js`)
- `/api/process-pool/stats` - プール統計情報の取得
- `/api/process-pool/project-limit` - プロジェクト制限の設定
- `/api/process-pool/project-usage` - プロジェクト使用状況の取得

### 5. CLI拡張 (`lib/commands/daemon.js`)
- `poppo daemon status`でプロセスプール情報を表示
- プロジェクト別使用状況の可視化
- 詳細な統計情報の表示

## 技術的特徴

### パフォーマンス最適化
- ワーカーの再利用によるオーバーヘッド削減
- タスクキューによる効率的なリソース利用
- 非同期処理による高スループット

### 信頼性
- ワーカークラッシュからの自動復旧
- タスクの確実な実行保証
- グレースフルシャットダウン

### 拡張性
- プラグイン可能なタスクハンドラー
- カスタムメトリクスのサポート
- 将来的な分散ワーカー対応を考慮した設計

## 設定例

```json
{
  "daemon": {
    "worker": {
      "minProcesses": 1,
      "maxProcesses": 4,
      "autoScale": true,
      "scaleUpThreshold": 0.8,
      "scaleDownThreshold": 0.2,
      "maxTasksPerWorker": 100,
      "workerIdleTimeout": 60000
    }
  }
}
```

## 使用例

```javascript
// プロセスプールの作成
const pool = new ProcessPoolManager({
  minWorkers: 2,
  maxWorkers: 4,
  autoScale: true
});

// 初期化
await pool.initialize();

// プロジェクト制限の設定
pool.setProjectLimit('my-project', 5);

// タスクの送信
const result = await pool.submitTask({
  type: 'execute-code',
  code: 'return "Hello from worker";'
}, {
  projectId: 'my-project',
  priority: 5
});
```

## テスト

- **単体テスト**: `test/process-pool-manager.test.js`
  - 初期化、ワーカー管理、タスク管理、メトリクス、シングルトンパターンのテスト
  - 全11テストケースが成功

- **統合テスト**: `test/daemon-integration.test.js`
  - デーモンとプロセスプールの統合動作確認
  - APIエンドポイントのテスト
  - エラーハンドリングの検証

- **デモスクリプト**: `examples/process-pool-demo.js`
  - 実際の動作を確認できるデモ実装
  - 各タスクタイプの実行例

## 今後の拡張予定

1. **分散ワーカー**: 複数マシン上でのワーカー実行
2. **GPU対応**: GPU加速タスクの実行
3. **カスタムタスクタイプ**: プラグインシステム
4. **高度なメトリクス**: 詳細なパフォーマンス分析
5. **リソースクォータ**: プロジェクト別のCPU/メモリクォータ

## 関連Issue
- Issue #161: run/executeコマンドの実装（次の実装予定）
- Issue #162: ワーカープロセスの実装（次の実装予定）