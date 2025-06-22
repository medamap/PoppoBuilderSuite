# Issue #161: プロジェクト間状態同期の実装

## 概要
グローバル状態とプロジェクトローカル状態を適切に管理・同期する機能を実装しました。競合状態の防止、トランザクション的な状態更新、柔軟な競合解決戦略を提供します。

## 実装日
2025/6/21

## 実装内容

### 1. LockManager (`lib/utils/lock-manager.js`)
- **ファイルベースのロック機構**
  - アトミックなロック取得（O_EXCLフラグ使用）
  - タイムアウト保護（自動ロック解放）
  - 古いロックの検出と削除
  - ウェイトキューによる公平な順序制御

- **高度な機能**
  - デッドロック防止（タイムアウトベース）
  - ロック待機キュー
  - 強制ロック解放
  - withLockヘルパーによる簡潔な使用

### 2. StateSynchronizer (`lib/core/state-synchronizer.js`)
- **階層的な状態管理**
  - グローバル状態: `~/.poppobuilder/state/`
  - ローカル状態: `project/.poppobuilder/state/`
  - 名前空間の分離（プロジェクトIDプレフィックス）

- **双方向同期**
  - グローバル→ローカル同期
  - ローカル→グローバル同期
  - 自動同期（設定可能な間隔）
  - ファイル監視による即時同期

- **競合解決戦略**
  - `last-write-wins`: 最新の更新を採用（デフォルト）
  - `version-wins`: バージョン番号が高い方を採用
  - `merge`: オブジェクト値のディープマージ
  - `callback`: カスタム解決関数

- **トランザクションサポート**
  - ACID特性の保証
  - タイムアウト処理
  - エラー時の自動ロールバック

### 3. 状態ファイル構造
```
~/.poppobuilder/
├── state/
│   ├── processes.json    # プロセス関連の状態
│   ├── queue.json       # キュー関連の状態
│   └── .locks/          # ロックファイル
│       └── *.lock

project/.poppobuilder/
└── state/
    ├── tasks.json       # プロジェクトのタスク
    ├── history.json     # プロジェクトの履歴
    └── config.json      # プロジェクト設定
```

## 技術的特徴

### パフォーマンス最適化
- ロックの細分化による競合の削減
- メモリキャッシュによる読み取り高速化
- 非同期I/Oによる並行処理

### 信頼性
- アトミックな状態更新
- データ破損の防止
- クラッシュ時の自動回復

### 拡張性
- イベント駆動アーキテクチャ
- プラグイン可能な競合解決
- カスタムトランザクション処理

## 設定例

```javascript
const synchronizer = new StateSynchronizer({
  globalStateDir: '~/.poppobuilder/state',
  syncInterval: 5000,           // 5秒ごとに同期
  conflictResolution: 'last-write-wins',
  enableAutoSync: true,
  transactionTimeout: 30000     // 30秒
});
```

## 使用例

```javascript
// 初期化
await synchronizer.initialize();

// プロジェクト登録
await synchronizer.registerProject('my-project', '/path/to/project');

// グローバル状態の設定
await synchronizer.setGlobalState('shared-config', {
  apiUrl: 'https://api.example.com'
});

// ローカル状態の設定
await synchronizer.setLocalState('my-project', 'tasks', [
  { id: 1, name: 'Task 1' }
]);

// 手動同期
await synchronizer.syncProject('my-project');

// ロックを使用した安全な更新
await lockManager.withLock('critical-resource', async () => {
  // クリティカルセクション
  await performCriticalOperation();
});
```

## テスト

- **LockManagerテスト**: `test/lock-manager.test.js`
  - 20個のテストケース全て成功
  - ロック取得、解放、タイムアウト、競合処理のテスト

- **StateSynchronizerテスト**: `test/state-synchronizer.test.js`
  - 20個のテストケース全て成功
  - 同期、競合解決、トランザクションのテスト

- **統合デモ**: `examples/state-sync-demo.js`
  - 実際の動作を確認できるデモスクリプト

## イベント

### StateSynchronizerイベント
- `initialized`: 初期化完了
- `project-registered`: プロジェクト登録
- `state-changed`: 状態変更
- `project-synced`: プロジェクト同期完了
- `transaction-timeout`: トランザクションタイムアウト

### LockManagerイベント
- `lock-acquired`: ロック取得
- `lock-released`: ロック解放
- `lock-timeout`: ロックタイムアウト
- `stale-lock-cleaned`: 古いロックのクリーンアップ

## 今後の拡張予定

1. **Redis対応**: 分散環境でのロック管理
2. **暗号化**: 機密データの暗号化保存
3. **圧縮**: 大きな状態データの圧縮
4. **監査ログ**: 状態変更の完全な履歴
5. **WebSocket同期**: リアルタイム状態同期

## 関連Issue
- Issue #157: Global Process Pool Manager実装（完了）
- 今後の実装候補:
  - run/executeコマンドの実装
  - ワーカープロセスの実装