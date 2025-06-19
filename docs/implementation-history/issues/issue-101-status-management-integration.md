# Issue #101: JSON ベース状態管理システムの実装

## 概要
GitHubラベルによる状態管理から、JSONファイルベースの状態管理システムに移行し、すべてのラベル操作をMirinOrphanManagerに委譲しました。

## 実装日
2025/6/19

## 実装内容

### Phase 1: StatusManagerの実装 ✅
- `src/status-manager.js`: 既に実装済み
- JSONファイル操作とロック機構: 実装済み
- ユニットテスト: `test/status-manager.test.js` 実装済み

### Phase 2: MirinOrphanManagerの拡張 ✅
- ラベル更新API: 既に実装済み（`updateLabels`メソッド）
- リクエスト処理機能: 実装済み（`processLabelRequests`メソッド）
- 状態同期機能: 実装済み（`syncWithStatusManager`メソッド）

### Phase 3: PoppoBuilderの修正 ✅

#### minimal-poppo.jsの変更:
1. MirinOrphanManagerのインポートと初期化を追加
2. StatusManagerと連携した初期化処理
3. ハートビート更新の実装（30秒ごと）
4. プロセス終了時のクリーンアップ処理

#### minimal-poppo-cron.jsの変更:
1. StatusManagerとMirinOrphanManagerのインポート
2. すべての直接的なラベル操作を削除:
   - `github.addLabels()` → `statusManager.checkout()`
   - `github.removeLabels()` → `statusManager.checkin()` または `statusManager.resetIssueStatus()`
3. 初期化処理とクリーンアップ処理の追加

### Phase 4: 統合テスト ✅
- `test/issue-101-integration.test.js`: StatusManagerとMirinOrphanManagerの連携テスト
- `test/issue-101-full-integration.test.js`: 完全統合テスト

## 主な変更点

### 1. ラベル操作の一元化
すべてのラベル操作がMirinOrphanManager経由で行われるようになりました：
- PoppoBuilder → StatusManager → ラベル更新リクエストファイル → MirinOrphanManager → GitHub API

### 2. 状態管理の改善
- JSONファイルベースの永続的な状態管理
- プロセスクラッシュ時の自動回復
- ハートビートによる生存確認

### 3. ファイル構造
```
state/
├── issue-status.json      # Issue状態
├── requests/              # ラベル更新リクエスト
│   └── label-update-*.json
└── issue-status.json.lock # ロックファイル
```

## 利点

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

## 今後の課題

1. **パフォーマンス最適化**
   - ファイルI/Oの最適化
   - キャッシュ機構の実装

2. **監視機能の強化**
   - ダッシュボードへの統合
   - メトリクスの追加

3. **エラー処理の改善**
   - MirinOrphanManager停止時の処理
   - ネットワークエラー時の再試行