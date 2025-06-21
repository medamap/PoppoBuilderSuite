# Issue #101: JSON ベース状態管理システム設計書

## 概要
GitHubラベルによる状態管理から、JSONファイルベースの状態管理システムに移行し、すべてのラベル操作をMirinOrphanManagerに委譲する。

## 現状の問題点

1. **ラベル操作の分散**
   - PoppoBuilder、各エージェント、cleanup-issue-statusなど複数の場所でラベル操作
   - 統一的な管理がない

2. **エラー時の不整合**
   - プロセスクラッシュ時に`processing`ラベルが残る
   - 手動での清掃が必要

3. **並行処理の問題**
   - 複数プロセスが同時にラベルを操作すると競合状態が発生

## 新しいアーキテクチャ

### 1. StatusManager（新規実装）
```javascript
class StatusManager {
  constructor(stateFile = 'state/issue-status.json') {
    this.stateFile = stateFile;
    this.mirinClient = null; // MirinOrphanManagerとの通信
  }

  // Issue状態の取得
  async getStatus(issueNumber) {
    // JSONファイルから状態を取得
  }

  // Issue状態の更新
  async updateStatus(issueNumber, status, metadata = {}) {
    // 1. JSONファイルを更新
    // 2. MirinOrphanManagerにラベル更新を依頼
  }

  // チェックアウト（処理開始）
  async checkout(issueNumber, processId, taskType) {
    // 1. 状態を"processing"に更新
    // 2. プロセス情報を記録
    // 3. MirinOrphanManagerに通知
  }

  // チェックイン（処理完了）
  async checkin(issueNumber, status = 'completed') {
    // 1. 状態を更新
    // 2. プロセス情報をクリア
    // 3. MirinOrphanManagerに通知
  }
}
```

### 2. MirinOrphanManager の拡張

```javascript
// 既存のMirinOrphanManagerに追加
class MirinOrphanManager {
  // ラベル更新APIの追加
  async updateLabels(request) {
    const { issueNumber, addLabels = [], removeLabels = [] } = request;
    
    // 1. リクエストの検証
    // 2. GitHubラベルの更新
    // 3. 結果の返却
  }

  // 状態同期機能
  async syncWithStatusManager() {
    // StatusManagerのJSONと実際のGitHubラベルを同期
  }
}
```

### 3. JSONステートファイル構造

```json
{
  "issues": {
    "123": {
      "status": "processing",
      "processId": "issue-123",
      "pid": 12345,
      "startTime": "2025-06-19T10:00:00Z",
      "lastHeartbeat": "2025-06-19T10:05:00Z",
      "taskType": "claude-cli",
      "metadata": {
        "retryCount": 0,
        "errorCount": 0
      }
    }
  },
  "lastSync": "2025-06-19T10:05:00Z"
}
```

### 4. 通信プロトコル

#### PoppoBuilder → StatusManager
```javascript
// チェックアウト
await statusManager.checkout(issueNumber, processId, taskType);

// ステータス更新
await statusManager.updateStatus(issueNumber, 'awaiting-response', {
  reason: 'need_user_input'
});

// チェックイン
await statusManager.checkin(issueNumber, 'completed');
```

#### StatusManager → MirinOrphanManager（ファイルベース通信）
```json
// requests/label-update-{timestamp}.json
{
  "requestId": "req-123456",
  "timestamp": "2025-06-19T10:00:00Z",
  "issueNumber": 123,
  "action": "update",
  "addLabels": ["processing"],
  "removeLabels": ["awaiting-response"],
  "requestedBy": "PoppoBuilder",
  "processId": "issue-123"
}
```

## 実装手順

### Phase 1: StatusManagerの実装
1. `src/status-manager.js`の作成
2. JSONファイル操作の実装
3. ロック機構の実装
4. ユニットテストの作成

### Phase 2: MirinOrphanManagerの拡張
1. ラベル更新APIの追加
2. リクエスト処理機能の実装
3. 状態同期機能の実装
4. テストの追加

### Phase 3: PoppoBuilderの修正
1. GitHubClient経由のラベル操作を削除
2. StatusManagerへの置き換え
3. エラーハンドリングの更新
4. 統合テスト

### Phase 4: 移行とテスト
1. 既存のラベル状態をJSONに移行
2. 並行処理のテスト
3. エラー回復のテスト
4. パフォーマンステスト

## 期待される効果

1. **信頼性の向上**
   - プロセスクラッシュ時の自動回復
   - 孤児Issueの自動検出と修復

2. **一貫性の保証**
   - すべてのラベル操作が単一のコンポーネントを経由
   - 競合状態の回避

3. **可視性の向上**
   - JSON形式で状態を確認可能
   - 状態変更の履歴追跡

4. **保守性の向上**
   - ラベル操作ロジックの一元化
   - テストの容易化

## 注意事項

1. **後方互換性**
   - 移行期間中は既存のラベルベースの動作も維持
   - 段階的な移行計画

2. **パフォーマンス**
   - ファイルI/Oの最適化
   - キャッシュ機構の検討

3. **エラー処理**
   - MirinOrphanManagerが停止している場合の処理
   - ネットワークエラー時の再試行

## スケジュール

- Phase 1: 2日
- Phase 2: 2日
- Phase 3: 3日
- Phase 4: 2日
- 合計: 約9日

## 関連Issue

- Issue #37: エラーログ収集機能（完了）
- Issue #100: 状態管理統合（完了）
- Issue #101: 本Issue