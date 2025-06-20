# 統一状態管理システム設計書

## 概要
PoppoBuilder Suiteの全コンポーネントで統一された状態管理システムを実装し、データの一貫性とシステムの信頼性を向上させます。

## 現状分析

### 現在の状態管理
1. **FileStateManager** (`src/file-state-manager.js`)
   - processed-issues.json - 処理済みIssue
   - processed-comments.json - 処理済みコメント
   - running-tasks.json - 実行中タスク
   - last-run.json - 最終実行情報
   - pending-tasks.json - 保留中タスク

2. **StatusManager** (`src/status-manager.js`)
   - issue-status.json - Issue別の詳細ステータス

3. **ProcessStateManager** (`src/process-state-manager.js`)
   - プロセスのリアルタイム状態管理（メモリベース）

4. **IndependentProcessManager** (`src/independent-process-manager.js`)
   - running-tasks.json（FileStateManager経由）

5. **各エージェント**
   - 独自の状態ファイル（統一されていない）

### 問題点
- 状態ファイルが分散している
- 同じ情報が複数箇所に存在（running-tasks.json等）
- コンポーネント間でインターフェースが異なる
- トランザクション処理がない

## 設計方針

### 1. 統一インターフェース
```javascript
class UnifiedStateManager {
  // 基本操作
  async get(namespace, key)
  async set(namespace, key, value)
  async delete(namespace, key)
  async has(namespace, key)
  
  // トランザクション
  async transaction(callback)
  
  // 監視
  watch(namespace, callback)
  unwatch(namespace, callback)
  
  // バルク操作
  async getAll(namespace)
  async setAll(namespace, data)
  async clear(namespace)
}
```

### 2. 名前空間の定義
- `issues` - Issue関連の状態
- `comments` - コメント関連の状態
- `tasks` - タスク実行状態
- `processes` - プロセス管理
- `agents` - エージェント固有データ
- `config` - 動的設定

### 3. データスキーマ
```javascript
// issues名前空間
{
  "issues": {
    "<issueNumber>": {
      "status": "pending|processing|completed|awaiting-response|error",
      "processId": "string",
      "taskType": "string",
      "startTime": "ISO8601",
      "endTime": "ISO8601",
      "metadata": {},
      "result": {}
    }
  }
}

// tasks名前空間
{
  "tasks": {
    "<taskId>": {
      "type": "issue|comment|agent",
      "status": "queued|running|completed|failed",
      "issueNumber": number,
      "priority": number,
      "created": "ISO8601",
      "started": "ISO8601",
      "completed": "ISO8601",
      "pid": number,
      "result": {}
    }
  }
}
```

## 実装計画

### Phase 1: 基盤実装
1. UnifiedStateManagerクラスの実装
2. FileStateManagerを基盤として利用
3. トランザクション機能の追加
4. 監視機能（EventEmitter）の実装

### Phase 2: 既存コンポーネントの移行
1. minimal-poppo.js（完了済み - Issue #119）
2. StatusManager → UnifiedStateManager統合
3. ProcessStateManager → UnifiedStateManager統合
4. IndependentProcessManager → UnifiedStateManager統合

### Phase 3: エージェントの移行
1. 各エージェントの状態管理を統一
2. エージェント共通基盤の更新

### Phase 4: 高度な機能
1. スキーマバリデーション
2. マイグレーション機能
3. バックアップ・リストア統合
4. パフォーマンス最適化

## 移行戦略

### 後方互換性の維持
- 既存のFileStateManagerメソッドをラップ
- 段階的な移行をサポート
- 旧形式のファイルを自動変換

### データマイグレーション
```javascript
class StateMigrator {
  async migrate() {
    // 1. 既存ファイルの読み込み
    // 2. 新形式への変換
    // 3. UnifiedStateManagerへの保存
    // 4. 旧ファイルのバックアップ
  }
}
```

## 期待される効果
1. **一貫性**: すべてのコンポーネントが同じインターフェースを使用
2. **保守性**: 状態管理ロジックの一元化
3. **拡張性**: 新機能の追加が容易
4. **信頼性**: トランザクション処理による整合性保証
5. **可視性**: 統一されたデバッグ・監視機能

## テスト計画
1. UnifiedStateManagerの単体テスト
2. 既存コンポーネントとの統合テスト
3. パフォーマンステスト
4. 移行テスト（既存データの互換性）