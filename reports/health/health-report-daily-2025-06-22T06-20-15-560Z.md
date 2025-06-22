# 日次診断レポート

**実行日時**: 2025-06-22T06:20:15.424Z
**実行時間**: 136ms
**全体ステータス**: ✅ 正常

## 概要

基本的なシステムヘルスチェック

- **総チェック数**: 5
- **成功**: 5
- **警告**: 0
- **失敗**: 0

## 詳細結果

### memory

**ステータス**: ✅ 正常
**結果**: メモリ使用率: 71.4%
**詳細**: {
  "heapUsed": 6,
  "heapTotal": 8,
  "external": 2,
  "rss": 42
}

### cpu

**ステータス**: ✅ 正常
**結果**: CPU使用率: 0.0%
**詳細**: {
  "percentage": "0.00%",
  "cores": 8,
  "user": 188,
  "system": 11
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
**結果**: システム負荷: 0.50
**詳細**: {
  "1m": "4.04",
  "5m": "3.40",
  "15m": "3.06",
  "cores": 8,
  "normalizedLoad": "0.50"
}

### processes

**ステータス**: ✅ 正常
**結果**: 実行中プロセス数: 324
**詳細**: {
  "processCount": 324
}

## 生成情報

- **レポート生成時刻**: 2025-06-22T06:20:15.560Z
- **PoppoBuilder Health Scheduler**: v1.0.0
