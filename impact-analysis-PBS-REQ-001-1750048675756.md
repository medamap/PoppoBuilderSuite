# 影響分析レポート

生成日時: 2025-06-16T04:37:55.753Z

## 変更対象
- ID: PBS-REQ-001
- タイトル: トレーサビリティ機能の実装
- フェーズ: REQ
- 変更種別: modify

## 影響サマリー
- 影響を受けるアイテム総数: 4
- 影響度別:
  - High: 4件
  - Medium: 0件
  - Low: 0件
- フェーズ別:
  - SPEC: 2件
  - IMP: 2件

## 影響を受けるアイテム詳細

### High影響度

#### PBS-SPEC-001: ID採番とシンプルなリンク管理
- フェーズ: SPEC
- 影響理由: PBS-REQ-001が変更されるため、PBS-REQ-001がPBS-SPEC-001をimplemented_byしている、PBS-SPEC-001がPBS-REQ-001をimplementsしている
- 更新必要: はい
- 距離: 1ステップ

#### PBS-IMP-001: トレーサビリティマネージャーの実装
- フェーズ: IMP
- 影響理由: PBS-SPEC-001が変更されるため、PBS-SPEC-001がPBS-IMP-001をimplemented_byしている、PBS-IMP-001がPBS-SPEC-001をimplementsしている
- 更新必要: はい
- 距離: 2ステップ

#### PBS-SPEC-002: 変更影響分析機能
- フェーズ: SPEC
- 影響理由: PBS-REQ-001が変更されるため、PBS-REQ-001がPBS-SPEC-002をimplemented_byしている、PBS-SPEC-002がPBS-REQ-001をimplementsしている
- 更新必要: はい
- 距離: 1ステップ

#### PBS-IMP-002: 影響分析エンジンの実装
- フェーズ: IMP
- 影響理由: PBS-SPEC-002が変更されるため、PBS-SPEC-002がPBS-IMP-002をimplemented_byしている、PBS-IMP-002がPBS-SPEC-002をimplementsしている
- 更新必要: はい
- 距離: 2ステップ

## 推奨アクション

### 1. [HIGH] 以下の高影響度アイテムを必ず確認・更新してください
- PBS-SPEC-001: ID採番とシンプルなリンク管理
- PBS-IMP-001: トレーサビリティマネージャーの実装
- PBS-SPEC-002: 変更影響分析機能
- PBS-IMP-002: 影響分析エンジンの実装

### 2. [MEDIUM] 関連ドキュメントの更新を検討してください
- PBS-SPEC-001: ID採番とシンプルなリンク管理
- PBS-SPEC-002: 変更影響分析機能

