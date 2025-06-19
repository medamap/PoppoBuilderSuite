# Issue #101: ステータス管理システムの実装 - ラベル依存からJSONベース管理への移行

## 実装完了日
2025/6/19

## 概要
GitHubラベルベースのステータス管理から、JSONファイルベースの確実なステータス管理システムに移行しました。すべてのラベル操作はMirinOrphanManagerを通じて一元化されます。

## 背景と問題点
- GitHubラベルは「表示」であり、真実の情報源として不適切
- プロセス異常終了時にラベルが残り、孤児Issueが発生しやすい
- tmux移行により、プロセス管理が複雑化
- 手動操作による不整合が起きやすい

## 実装内容

### 1. StatusManager (`src/status-manager.js`)
新しいステータス管理コンポーネントを実装しました。

**主な機能**:
- **チェックアウト/チェックイン**: Issueの処理開始/終了を管理
- **ハートビート管理**: 定期的なプロセス生存確認
- **状態の永続化**: JSONファイル（`state/issue-status.json`）での管理
- **ラベル更新リクエスト**: MirinOrphanManagerへの非同期リクエスト
- **孤児検出**: タイムアウトとプロセス生存確認による検出
- **統計情報**: ステータス別、タスクタイプ別の集計

**技術的詳細**:
```javascript
// 状態ファイルの構造
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

### 2. MirinOrphanManager (`src/mirin-orphan-manager.js`)
孤児Issue管理とラベル操作の一元化を行うコンポーネントです。

**主な機能**:
- **ラベル操作の一元化**: すべてのラベル更新はこのコンポーネントを経由
- **孤児Issue検出**: StatusManagerとGitHubラベルの両方から検出
- **自動修復**: 孤児Issueのステータスリセットとラベル削除
- **状態同期**: StatusManagerのJSONとGitHubラベルの同期
- **非同期リクエスト処理**: ファイルベースのキューシステム

**ラベル更新リクエストの流れ**:
1. StatusManagerがリクエストファイルを作成（`state/requests/label-update-*.json`）
2. MirinOrphanManagerが定期的にリクエストを処理（5秒間隔）
3. GitHub APIでラベルを更新
4. 処理済みリクエストファイルを削除

### 3. PoppoBuilderの修正 (`src/minimal-poppo.js`)
GitHubClient経由の直接的なラベル操作をすべてStatusManager経由に変更しました。

**変更箇所**:
- `github.addLabels()` → `statusManager.checkout()`
- `github.removeLabels()` → `statusManager.checkin()` または `statusManager.resetIssueStatus()`
- `github.updateLabels()` → `statusManager.updateStatus()`

**具体的な変更**:
```javascript
// 変更前
await github.addLabels(issueNumber, ['processing']);

// 変更後
await statusManager.checkout(issueNumber, `issue-${issueNumber}`, 'claude-cli');
```

### 4. テストコード
- `test/status-manager.test.js`: StatusManagerの単体テスト（11テストケース）
- `test/issue-101-integration.test.js`: 統合テスト（3シナリオ）

**テストシナリオ**:
1. 正常なチェックアウト/チェックインとラベル更新
2. 孤児Issueの検出と自動修復
3. ステータスとラベルの同期

### 5. スクリプト
- `scripts/start-mirin.js`: MirinOrphanManagerのスタンドアロン起動スクリプト
  - cron実行用の`--once`オプション対応
  - 毎時3分・33分に実行を想定

## メリット

1. **信頼性の向上**
   - プロセスクラッシュ時の自動回復
   - 孤児Issueの自動検出と修復
   - データの永続化による状態の保証

2. **一貫性の保証**
   - すべてのラベル操作が単一のコンポーネントを経由
   - 競合状態の回避
   - アトミックな状態更新

3. **可視性の向上**
   - JSON形式で状態を確認可能
   - 状態変更の履歴追跡
   - 統計情報の提供

4. **保守性の向上**
   - ラベル操作ロジックの一元化
   - テストの容易化
   - デバッグ情報の充実

## 使用方法

### PoppoBuilder起動時
StatusManagerは自動的に初期化され、Issue処理時に透過的に使用されます。

### MirinOrphanManagerの定期実行
```bash
# crontabに追加（毎時3分と33分に実行）
3,33 * * * * cd /path/to/PoppoBuilderSuite && node scripts/start-mirin.js --once >> logs/mirin-cron.log 2>&1
```

### 状態の確認
```bash
# 現在のIssue状態を確認
cat state/issue-status.json | jq

# ラベル更新リクエストを確認
ls -la state/requests/

# 統計情報を取得（実装予定）
node scripts/status-report.js
```

## 技術的な工夫

1. **ファイルロック機構**
   - 排他制御によるデータ整合性の保証
   - タイムアウトによるデッドロック回避

2. **非同期処理**
   - ラベル更新を非同期化してパフォーマンスを維持
   - リクエストファイルによる疎結合

3. **後方互換性**
   - 既存のGitHubラベルとの同期機能
   - 段階的な移行が可能

4. **エラー処理**
   - 古いリクエストの自動削除
   - プロセス生存確認による確実な孤児検出

## 今後の拡張案

1. **ダッシュボード統合**
   - StatusManagerの状態をダッシュボードで可視化
   - リアルタイムステータス更新

2. **メトリクス収集**
   - Issue処理時間の統計
   - エラー率の追跡

3. **通知機能**
   - 孤児Issue検出時の通知
   - ステータス変更の通知

4. **バックアップ機能**
   - 状態ファイルの定期バックアップ
   - 履歴の保存

## 関連ファイル
- `src/status-manager.js` - StatusManagerの実装
- `src/mirin-orphan-manager.js` - MirinOrphanManagerの実装
- `src/minimal-poppo.js` - PoppoBuilderの修正
- `test/status-manager.test.js` - StatusManagerのテスト
- `test/issue-101-integration.test.js` - 統合テスト
- `scripts/start-mirin.js` - MirinOrphanManager起動スクリプト
- `docs/design/issue-101-status-management.md` - 設計書