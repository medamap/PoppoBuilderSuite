# 月次診断レポート

**実行日時**: 2025-06-22T06:20:33.943Z
**実行時間**: 138ms
**全体ステータス**: ⚠️ 警告

## 概要

包括的なシステム監査とセキュリティチェック

- **総チェック数**: 11
- **成功**: 9
- **警告**: 2
- **失敗**: 0

## 詳細結果

### memory

**ステータス**: ✅ 正常
**結果**: メモリ使用率: 71.5%
**詳細**: {
  "heapUsed": 6,
  "heapTotal": 8,
  "external": 2,
  "rss": 43
}

### cpu

**ステータス**: ✅ 正常
**結果**: CPU使用率: 0.0%
**詳細**: {
  "percentage": "0.00%",
  "cores": 8,
  "user": 130,
  "system": 7
}

### disk

**ステータス**: ✅ 正常
**結果**: ディスク使用率: 取得不可（簡易チェック）
**詳細**: {
  "note": "ディスク使用率の詳細取得にはプラットフォーム固有の実装が必要です",
  "currentDirectory": "/Volumes/PoppoSSD2T/Projects/ClaudeCodeProjects/AIBuildSystem/PoppoBuilderSuite",
  "available": "unknown",
  "used": "unknown"
}

### load

**ステータス**: ✅ 正常
**結果**: システム負荷: 0.42
**詳細**: {
  "1m": "3.37",
  "5m": "3.29",
  "15m": "3.03",
  "cores": 8,
  "normalizedLoad": "0.42"
}

### processes

**ステータス**: ✅ 正常
**結果**: 実行中プロセス数: 324
**詳細**: {
  "processCount": 324
}

### logs

**ステータス**: ✅ 正常
**結果**: ログファイル: 41個、合計28.92MB
**詳細**: {
  "totalSize": "28.92MB",
  "fileCount": 41,
  "errorCount": 0
}

### database

**ステータス**: ✅ 正常
**結果**: データベース: 0/2個正常、合計0.00MB
**詳細**: {
  "totalSize": "0.00MB",
  "healthyDatabases": 0,
  "totalDatabases": 2
}

### cleanup

**ステータス**: ✅ 正常
**結果**: クリーンアップ完了: 3個のアクション実行
**詳細**: {
  "actions": [
    "一時ファイルの確認",
    "ログローテーション",
    "古いレポートファイルの削除"
  ]
}

### security

**ステータス**: ⚠️ 警告
**結果**: セキュリティチェック: 1個の問題検出
**詳細**: {
  "issues": [
    "config/config.json: 他のユーザーに読み取り権限があります"
  ]
}

### backup

**ステータス**: ⚠️ 警告
**結果**: バックアップ: 0個、最終バックアップから999日
**詳細**: {
  "backupCount": 0,
  "latestBackup": "なし",
  "daysSinceLastBackup": 999
}

### performance

**ステータス**: ✅ 正常
**結果**: パフォーマンススコア: 100000.00
**詳細**: {
  "iterations": 100000,
  "duration": "1ms",
  "performanceScore": "100000.00"
}

## 推奨事項

1. ファイル権限を適切に設定してください。
2. 機密情報を含むファイルのアクセス権限を確認してください。
3. バックアップが古くなっています。最新のバックアップを作成してください。

## 生成情報

- **レポート生成時刻**: 2025-06-22T06:20:34.081Z
- **PoppoBuilder Health Scheduler**: v1.0.0
