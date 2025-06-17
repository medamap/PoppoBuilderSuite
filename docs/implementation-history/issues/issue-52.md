# Issue #52: トレーサビリティPhase 3

## 概要
トレーサビリティ機能 Phase 3の実装 - GitHub連携。Issue/PRとの自動リンク、コミットメッセージからID抽出、トレーサビリティコメント投稿を実装。

## 実装日
2025年6月17日

## 実装内容

### 1. GitHub連携機能
`src/github-traceability.js`：
- Issue/PR番号の自動検出
- コミットメッセージからのID抽出
- GitHub APIを使用した情報取得
- 双方向リンクの自動作成

### 2. コミットメッセージパーサー
`src/commit-parser.js`：
- トレーサビリティID検出（PBS-XXX-000形式）
- 複数IDの抽出対応
- コミットとアイテムの関連付け
- 履歴の追跡

### 3. 自動コメント機能
`src/traceability-commenter.js`：
- Issue/PRへのトレーサビリティ情報投稿
- 関連アイテムの一覧表示
- 影響分析結果の共有
- 更新通知

### 4. CLIツールの拡張
`scripts/trace.js`：
```bash
# GitHub連携コマンド
npm run trace github sync              # GitHub情報を同期
npm run trace github link <id> <issue> # 手動リンク作成
npm run trace github analyze <issue>   # Issue影響分析
npm run trace github comment <issue>   # コメント投稿
```

### 5. Webhookハンドラー
`src/webhook-handler.js`：
- GitHub Webhookの受信
- リアルタイムでのリンク作成
- Issue/PR作成時の自動処理
- コミットプッシュ時の解析

## 実装機能の詳細

### ID抽出パターン
```javascript
// コミットメッセージ例
"feat: PBS-REQ-001 ユーザー認証機能の実装"
"fix: バグ修正 (PBS-BUG-042, PBS-TEST-015)"
"docs: PBS-DOC-003 APIドキュメント更新"
```

### 自動投稿コメント例
```markdown
## 📊 トレーサビリティ情報

このIssue/PRは以下のトレーサビリティアイテムと関連しています：

### 関連アイテム
- **PBS-REQ-001**: ユーザー認証機能 (要求定義)
  - ステータス: implemented
  - 関連実装: PBS-IMPL-005, PBS-IMPL-006
  
- **PBS-TEST-015**: 認証機能テスト (テスト)
  - ステータス: passed
  - カバレッジ: 95%

### 影響分析
このIssueの変更により、以下のアイテムに影響があります：
- PBS-SPEC-002 (High)
- PBS-DLD-008 (Medium)
- PBS-DOC-003 (Low)

### コミット履歴
- abc1234: "feat: PBS-REQ-001 初期実装"
- def5678: "test: PBS-TEST-015 テスト追加"

---
*PoppoBuilder トレーサビリティシステムによる自動投稿*
```

## 設定
`config/config.json`：
```json
"traceability": {
  "github": {
    "enabled": true,
    "autoComment": true,
    "webhookSecret": "YOUR_WEBHOOK_SECRET",
    "commentTriggers": ["opened", "edited", "closed"],
    "extractPatterns": [
      "PBS-[A-Z]+-\\d{3}",
      "#(\\d+)"
    ]
  }
}
```

## テスト結果
`test/test-github-traceability.js`：
- ✅ コミットメッセージからのID抽出
- ✅ Issue/PR番号の検出
- ✅ 自動コメント投稿
- ✅ Webhook処理
- ✅ 双方向リンクの作成

## 使用方法

### 初期設定
```bash
# GitHub Webhook設定
# Repository Settings > Webhooks > Add webhook
# URL: http://your-server/webhook/traceability
# Events: Issues, Pull requests, Pushes
```

### 手動同期
```bash
# 既存のIssue/PRを同期
npm run trace github sync

# 特定Issueの分析
npm run trace github analyze 123
```

### 自動処理
- Issue/PR作成時に自動的にトレーサビリティIDを検出
- コミットプッシュ時にメッセージを解析
- 関連情報を自動的にコメント投稿

## 成果
- 要求と実装の自動追跡
- 変更の影響を即座に可視化
- 開発プロセスの透明性向上
- ドキュメントとコードの同期

## 技術的なポイント

### パフォーマンス最適化
- バッチ処理による効率化
- キャッシュによる高速化
- 非同期処理の活用

### 信頼性
- Webhook配信の再試行
- データ整合性チェック
- エラーハンドリング

### 拡張性
- カスタムパターンの追加
- 他システムとの連携
- プラグイン機構

## 今後の拡張予定
- JIRA連携
- Slack通知
- ダッシュボードでの可視化
- AIによる関連性推測

## 関連ファイル
- **GitHub連携**: `src/github-traceability.js`
- **コミットパーサー**: `src/commit-parser.js`
- **コメント投稿**: `src/traceability-commenter.js`
- **Webhookハンドラー**: `src/webhook-handler.js`
- **テストコード**: `test/test-github-traceability.js`

## 関連Issue
- Issue #19: トレーサビリティ機能Phase 1（基本実装）
- Issue #25: トレーサビリティ機能Phase 2（影響分析）