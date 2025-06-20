# エラーハンドリングとリカバリー戦略

PoppoBuilder Suiteの統一的なエラーハンドリングフレームワークとリカバリー戦略について説明します。

## 概要

このシステムは以下の主要コンポーネントで構成されています：

- **ErrorHandler**: 統一的なエラーハンドリング
- **CircuitBreaker**: サーキットブレーカーパターンの実装
- **ErrorRecoveryManager**: 自動リカバリー戦略
- **ErrorReporter**: エラーレポート生成

## エラーの分類

### エラーコード体系

エラーは以下のカテゴリに分類されます：

#### ネットワーク関連
- `E_NETWORK_TIMEOUT`: ネットワークタイムアウト
- `E_NETWORK_CONNECTION`: 接続エラー
- `E_API_RATE_LIMIT`: APIレート制限
- `E_API_UNAUTHORIZED`: 認証エラー
- `E_API_NOT_FOUND`: リソース未発見

#### システム関連
- `E_SYSTEM_RESOURCE`: システムリソース不足
- `E_SYSTEM_PERMISSION`: 権限エラー
- `E_SYSTEM_FILE_NOT_FOUND`: ファイル未発見
- `E_SYSTEM_DISK_FULL`: ディスク容量不足

#### プロセス関連
- `E_PROCESS_TIMEOUT`: プロセスタイムアウト
- `E_PROCESS_CRASHED`: プロセスクラッシュ
- `E_PROCESS_KILLED`: プロセス強制終了

#### 設定関連
- `E_CONFIG_INVALID`: 無効な設定
- `E_CONFIG_MISSING`: 設定ファイル未発見

#### データ関連
- `E_DATA_CORRUPTION`: データ破損
- `E_DATA_VALIDATION`: データ検証エラー

### エラー重要度

- `critical`: 致命的（即座の対応が必要）
- `high`: 重要（早急な対応が必要）
- `medium`: 中程度（通常の対応）
- `low`: 軽微（後で対応可能）

### エラーカテゴリ

- `transient`: 一時的エラー（リトライ可能）
- `permanent`: 永続的エラー（設定修正等が必要）
- `recoverable`: リカバリー可能エラー
- `fatal`: 致命的エラー（手動介入が必要）

## 基本的な使用方法

### エラーハンドリング

```javascript
const { ErrorHandler, NetworkError, ErrorCodes } = require('./src/error-handler');

// ErrorHandlerの初期化
const logger = new Logger('logs');
const errorHandler = new ErrorHandler(logger, {
  maxErrorHistory: 1000,
  errorFile: 'logs/errors.json',
  enableStackTrace: true
});

// エラーの処理
try {
  // 何らかの処理
  await riskyOperation();
} catch (error) {
  await errorHandler.handleError(error);
}

// カスタムエラーの作成
const networkError = new NetworkError('Connection failed', {
  context: { url: 'https://api.example.com' }
});
await errorHandler.handleError(networkError);
```

### サーキットブレーカー

```javascript
const { CircuitBreakerFactory } = require('./src/circuit-breaker');

const factory = new CircuitBreakerFactory();
const breaker = factory.create('github-api', {
  failureThreshold: 5,    // 5回失敗したら開く
  successThreshold: 3,    // 3回成功したら閉じる
  timeout: 30000,         // 30秒タイムアウト
  resetTimeout: 60000     // 1分後に半開に移行
});

// サーキットブレーカー付きでAPI呼び出し
try {
  const result = await breaker.execute(
    () => apiCall(),
    () => cachedResponse() // フォールバック
  );
} catch (error) {
  // エラーハンドリング
}
```

### 自動リカバリー

```javascript
const { ErrorRecoveryManager, RecoveryStrategy, RecoveryActions } = require('./src/error-recovery');

const recoveryManager = new ErrorRecoveryManager(logger);

// カスタムリカバリー戦略の登録
recoveryManager.registerStrategy('E_API_RATE_LIMIT', new RecoveryStrategy([
  {
    action: RecoveryActions.EXPONENTIAL_BACKOFF,
    params: {
      maxRetries: 5,
      initialDelay: 60000,
      multiplier: 1.5
    }
  }
]));

// エラーからの自動リカバリー
const error = new APIError('Rate limited', 429);
const recovered = await recoveryManager.recover(error);
```

## 設定

`config/config.json`にエラーハンドリング設定を追加：

```json
{
  "errorHandling": {
    "enabled": true,
    "maxErrorHistory": 1000,
    "errorFile": "logs/errors.json",
    "enableStackTrace": true,
    "autoRecovery": {
      "enabled": true,
      "maxAttempts": 3,
      "timeout": 300000
    },
    "circuitBreaker": {
      "defaultConfig": {
        "failureThreshold": 5,
        "successThreshold": 3,
        "timeout": 30000,
        "resetTimeout": 60000
      }
    },
    "notifications": {
      "enabled": true,
      "channels": ["log", "webhook"],
      "severityThreshold": "high"
    }
  }
}
```

## CLIツール

### 基本コマンド

```bash
# エラー統計の表示
npm run errors:stats

# エラーレポートの生成
npm run errors:report

# リカバリー統計の表示
npm run errors:recovery

# エラー履歴のクリア
npm run errors:clear errors

# エラーコード一覧の表示
npm run errors:codes
```

### 詳細なレポート生成

```bash
# Markdownレポート（週次）
poppo-errors report -f markdown -p weekly --show

# HTMLレポート（カスタム期間）
poppo-errors report -f html -s 2025-01-01 -e 2025-01-31

# サマリーレポート（推奨事項なし）
poppo-errors report --summary --no-recommendations
```

## リカバリー戦略

### デフォルト戦略

システムは以下のデフォルトリカバリー戦略を提供します：

#### ネットワークエラー
- 指数バックオフでリトライ
- 接続リセット

#### APIレート制限
- 指数バックオフ（長めの初期遅延）
- レート制限が解除されるまで待機

#### システムリソース
- リソースクリーンアップ
- ガベージコレクション実行
- 一時ファイル削除

#### プロセスエラー
- プロセス再起動
- 管理者通知

### カスタム戦略の作成

```javascript
// カスタムリカバリーアクション
const customRecoveryAction = async (error, context, params) => {
  // カスタムリカバリーロジック
  await customCleanup();
  return { success: true };
};

// 戦略の登録
recoveryManager.registerHandler('custom_action', customRecoveryAction);

const customStrategy = new RecoveryStrategy([
  { action: 'custom_action', params: { /* パラメータ */ } },
  { action: RecoveryActions.NOTIFY_ADMIN, params: { priority: 'high' } }
]);

recoveryManager.registerStrategy('E_CUSTOM_ERROR', customStrategy);
```

## 監視と分析

### エラーメトリクス

システムは以下のメトリクスを自動収集します：

- エラー発生率（時間別、重要度別）
- リカバリー成功率
- サーキットブレーカー状態変化
- エラーパターンとトレンド

### アラート

重要なエラーに対して自動アラートを設定できます：

```javascript
// エラーハンドラーにイベントリスナーを追加
errorHandler.on('error:E_SYSTEM_DISK_FULL', async (error) => {
  await notificationManager.send('critical', {
    title: 'Disk Full Alert',
    message: error.message,
    urgency: 'high'
  });
});

// サーキットブレーカーの状態変化を監視
breaker.on('open', ({ name }) => {
  console.warn(`Circuit breaker opened for ${name}`);
});
```

### レポート機能

詳細なエラーレポートには以下が含まれます：

- **サマリー**: 総エラー数、エラー率、リカバリー率
- **トレンド分析**: エラー傾向、増加/減少パターン
- **トップエラー**: 最も頻繁なエラーとその詳細
- **リカバリー性能**: 戦略別成功率、平均時間
- **推奨事項**: 自動生成されたアクション提案

## パフォーマンス考慮事項

### メモリ使用量

- エラー履歴は最大1000件に制限
- サーキットブレーカーの統計は1分間のローリングウィンドウ
- 自動ガベージコレクションによるメモリクリーンアップ

### CPU負荷

- 非同期処理による負荷分散
- バックグラウンドでのレポート生成
- 効率的な統計計算アルゴリズム

### ストレージ

- JSON形式でのコンパクトな保存
- 自動ローテーションによるディスク使用量管理
- 設定可能な保存期間

## トラブルシューティング

### よくある問題

#### エラーファイルが作成されない
```bash
# ディレクトリの権限を確認
ls -la logs/
# 手動でディレクトリを作成
mkdir -p logs
```

#### リカバリーが動作しない
```javascript
// 設定でリカバリーが有効になっているか確認
const config = {
  errorHandling: {
    autoRecovery: {
      enabled: true  // この設定を確認
    }
  }
};
```

#### サーキットブレーカーが期待通りに動作しない
```javascript
// 閾値設定を確認
const breaker = factory.create('service', {
  failureThreshold: 5,     // 失敗回数
  volumeThreshold: 10,     // 最小リクエスト数
  errorThresholdPercentage: 50  // エラー率
});
```

### デバッグ

```bash
# 詳細ログを有効化
DEBUG=error-handler npm start

# エラー統計の確認
poppo-errors stats

# 特定のエラーコードの詳細
poppo-errors report -f json | jq '.topErrors[] | select(.code == "E_NETWORK_TIMEOUT")'
```

## ベストプラクティス

### エラーハンドリング

1. **具体的なエラーメッセージ**: 問題の特定が容易になるよう、詳細な情報を含める
2. **適切な分類**: エラーの性質に応じて正しいエラークラスを使用
3. **コンテキスト情報**: エラー発生時の状況を記録
4. **ログレベル**: 重要度に応じて適切なログレベルを設定

### リカバリー戦略

1. **段階的アプローチ**: 軽い対処から重い対処へ段階的に実行
2. **タイムアウト設定**: 無限リトライを避けるためのタイムアウト
3. **フォールバック**: 機能縮退した状態でもサービス継続
4. **監視**: リカバリー成功率を定期的に確認

### サーキットブレーカー

1. **適切な閾値**: サービスの特性に応じた閾値設定
2. **フォールバック**: サーキットが開いた時の代替手段
3. **リセット時間**: 依存サービスの回復時間を考慮
4. **監視**: 状態変化の追跡と分析

## 拡張

### カスタムエラークラス

```javascript
class CustomBusinessError extends BaseError {
  constructor(message, businessCode, options = {}) {
    super(message, `E_BUSINESS_${businessCode}`, {
      severity: ErrorSeverity.MEDIUM,
      category: ErrorCategory.PERMANENT,
      ...options
    });
    this.businessCode = businessCode;
  }
}
```

### カスタムリカバリーアクション

```javascript
const RecoveryActions = {
  ...RecoveryActions,
  CUSTOM_RESTART: 'custom_restart'
};

// アクションハンドラーの実装
recoveryManager.registerHandler(RecoveryActions.CUSTOM_RESTART, async (error, context, params) => {
  // カスタムリスタートロジック
  await performCustomRestart(params);
  return { restarted: true };
});
```

### カスタムレポート形式

```javascript
class CustomReporter extends ErrorReporter {
  async saveCustomReport(report) {
    // カスタムフォーマットでレポート生成
    const customFormat = this.generateCustomFormat(report);
    // 外部サービスに送信など
    await this.sendToExternalService(customFormat);
  }
}
```

## 参考資料

- [Circuit Breaker Pattern](https://martinfowler.com/bliki/CircuitBreaker.html)
- [Error Handling Best Practices](https://docs.microsoft.com/en-us/azure/architecture/best-practices/transient-faults)
- [Reliability Patterns](https://docs.microsoft.com/en-us/azure/architecture/patterns/category/resiliency)