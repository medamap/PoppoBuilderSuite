# エージェント間通信プロトコル設計

## 概要

PoppoBuilderエージェント間の通信を標準化するプロトコル仕様です。

## プロトコルバージョン

- 現在: v1.0 (Phase 1 - ファイルベース)
- 将来: v2.0 (Phase 2 - メッセージキュー)

## メッセージタイプ

### 1. タスク割り当て (TASK_ASSIGNMENT)
```json
{
  "type": "TASK_ASSIGNMENT",
  "taskId": "issue-27",
  "issueNumber": 27,
  "assignedTo": "CCPM",
  "priority": "high",
  "taskType": "code-review",
  "deadline": "2025-06-16T12:00:00Z",
  "context": {
    "issueTitle": "エージェント分離アーキテクチャの実装",
    "issueBody": "...",
    "labels": ["task:dogfooding"]
  }
}
```

### 2. タスク受諾 (TASK_ACCEPTED)
```json
{
  "type": "TASK_ACCEPTED",
  "taskId": "issue-27",
  "acceptedBy": "CCPM",
  "estimatedDuration": 3600000,
  "startTime": "2025-06-16T10:00:00Z"
}
```

### 3. 進捗報告 (PROGRESS_UPDATE)
```json
{
  "type": "PROGRESS_UPDATE",
  "taskId": "issue-27",
  "agent": "CCPM",
  "progress": 50,
  "status": "processing",
  "message": "コードレビュー実施中",
  "details": {
    "filesAnalyzed": 10,
    "issuesFound": 3
  }
}
```

### 4. タスク完了 (TASK_COMPLETED)
```json
{
  "type": "TASK_COMPLETED",
  "taskId": "issue-27",
  "agent": "CCPM",
  "completionTime": "2025-06-16T11:00:00Z",
  "result": {
    "success": true,
    "output": "レビュー結果",
    "metrics": {
      "codeQuality": 85,
      "suggestions": 5
    }
  }
}
```

### 5. エラー通知 (ERROR_NOTIFICATION)
```json
{
  "type": "ERROR_NOTIFICATION",
  "taskId": "issue-27",
  "agent": "CCPM",
  "errorCode": "TIMEOUT",
  "errorMessage": "処理がタイムアウトしました",
  "retryable": true,
  "timestamp": "2025-06-16T11:00:00Z"
}
```

### 6. ハートビート (HEARTBEAT)
```json
{
  "type": "HEARTBEAT",
  "agent": "CCPM",
  "status": "healthy",
  "timestamp": "2025-06-16T10:00:00Z",
  "metrics": {
    "cpuUsage": 45,
    "memoryUsage": 60,
    "activeTasks": 2
  }
}
```

## 通信フロー

### 基本的なタスク処理フロー

1. **Core → Agent**: TASK_ASSIGNMENT
2. **Agent → Core**: TASK_ACCEPTED
3. **Agent → Core**: PROGRESS_UPDATE (複数回)
4. **Agent → Core**: TASK_COMPLETED

### エラー処理フロー

1. **Core → Agent**: TASK_ASSIGNMENT
2. **Agent → Core**: TASK_ACCEPTED
3. **Agent → Core**: ERROR_NOTIFICATION
4. **Core → Agent**: TASK_ASSIGNMENT (リトライ)

## Phase 1実装詳細（ファイルベース）

### ディレクトリ構造
```
messages/
├── core/
│   ├── inbox/
│   └── outbox/
├── ccpm/
│   ├── inbox/
│   └── outbox/
└── ccag/
    ├── inbox/
    └── outbox/
```

### メッセージファイル命名規則
```
{timestamp}_{messageId}_{type}.json

例: 20250616100000_abc123_TASK_ASSIGNMENT.json
```

### ポーリング間隔
- 通常: 5秒
- 高負荷時: 1秒
- アイドル時: 10秒

## エラーハンドリング

### エラーコード
- `TIMEOUT`: タイムアウト
- `INVALID_MESSAGE`: 不正なメッセージフォーマット
- `AGENT_UNAVAILABLE`: エージェント応答なし
- `RESOURCE_LIMIT`: リソース制限
- `INTERNAL_ERROR`: 内部エラー

### リトライポリシー
- 最大リトライ回数: 3回
- リトライ間隔: 指数バックオフ（1秒、2秒、4秒）
- リトライ可能なエラー: TIMEOUT, AGENT_UNAVAILABLE

## セキュリティ

### Phase 1
- ファイルシステムのアクセス権限による制御
- エージェントごとに専用ディレクトリ

### Phase 2以降
- メッセージ署名
- 暗号化通信
- 認証トークン

## パフォーマンス最適化

### バッチ処理
- 複数の小さなメッセージを1つにまとめる
- 最大バッチサイズ: 10メッセージ
- バッチタイムアウト: 1秒

### メッセージ圧縮
- 1KB以上のペイロードは自動圧縮
- 圧縮アルゴリズム: gzip

## モニタリング

### メトリクス
- メッセージ送信数/秒
- メッセージ処理時間
- エラー率
- キューサイズ（Phase 2）

### ログ
- すべてのメッセージ送受信をログ記録
- エラーの詳細ログ
- パフォーマンスログ