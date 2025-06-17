# Issue #30, #32: エラーログ収集Phase 1

## 概要
エラーログ収集機能Phase 1の実装。PoppoBuilderの実行中に発生するエラーログを自動的に収集・分析し、GitHub Issueとして登録する機能を実装。Issue #32では統合テストと最終調整を実施。

## 実装日
2025年6月16日

## 実装内容

### 1. CCLAエージェント
`agents/ccla/index.js` - Code Change Log Analyzer（エラーログ収集・分析専門）：

#### 機能
- `logs/poppo-*.log`から ERROR, FATAL レベルのログを抽出
- 5分間隔でログファイルを監視
- エラーパターンのマッチング
- 重複防止機構（エラーハッシュ管理）
- GitHub Issue自動作成要求

#### エラーパターン
- Type Error (bug/high) - `TypeError.*cannot read property`
- Reference Error (bug/high) - `ReferenceError.*is not defined`
- Syntax Error (bug/critical) - `SyntaxError`
- File Not Found (defect/medium) - `ENOENT.*no such file or directory`
- Rate Limit (defect/low) - `GitHub API.*rate limit`
- Timeout (defect/medium) - `timeout|ETIMEDOUT`
- Specification Issue (specIssue/medium) - `spec.*conflict|specification.*mismatch`

### 2. エージェントコーディネーターの拡張
`agents/core/agent-coordinator.js`：
- CCLAエージェントの登録と管理
- `CREATE_ISSUE`メッセージハンドラーの追加
- エラー情報からIssue本文の自動生成
- Issue作成イベントの発火

### 3. エージェント統合の拡張
`src/agent-integration.js`：
- `create:issue`イベントハンドラーの追加
- GitHubクライアントを使用したIssue作成
- CCLAエージェントへのIssue URL通知
- GitHubクライアントインスタンスの適切な管理

### 4. GitHubクライアントの拡張
`src/github-client.js`：
- `createIssue(title, body, labels)`メソッドの追加
- ファイル経由でのIssue作成（特殊文字対応）

### 5. minimal-poppo.jsの統合
`src/minimal-poppo.js`：
- AgentIntegrationの追加とGitHubクライアントの受け渡し
- エージェントモード初期化の実装
- シャットダウン処理でのエージェント停止

### 6. 設定追加
`config/config.json`：
```json
"errorLogCollection": {
  "enabled": true,
  "pollingInterval": 300000,  // 5分
  "logSources": ["poppo-*.log"],
  "errorLevels": ["ERROR", "FATAL"],
  "labels": {
    "bug": "task:bug",
    "defect": "task:defect",
    "specIssue": "task:spec-issue"
  }
}
```

## データ管理
- `.poppo/processed-errors.json` - 処理済みエラーのハッシュとIssue URLを記録
- 重複エラーの検出と防止
- エラーハッシュ生成: `MD5(level:message:stackTrace前3行)`

## 動作フロー
1. CCLAエージェントが5分ごとにログファイルを監視
2. ERROR/FATALレベルのログを検出
3. エラーパターンマッチングで分類
4. 重複チェック（ハッシュ確認）
5. 新規エラーの場合、コーディネーターにIssue作成要求
6. エージェント統合がGitHub Issueを作成
7. Issue URLを記録して重複防止

## 自動作成されるIssueの例
```markdown
## エラー概要
- **カテゴリ**: Type Error
- **タイプ**: bug
- **重要度**: high
- **エラーハッシュ**: e605f04d
- **発生日時**: 2025-06-16 10:00:01
- **ログレベル**: ERROR

## エラーメッセージ
```
TypeError: Cannot read property 'name' of undefined
```

## スタックトレース
```
    at processIssue (/src/minimal-poppo.js:123:45)
    at async main (/src/minimal-poppo.js:456:5)
```

## 自動分析結果
このエラーは自動的に検出・分類されました。
パターンマッチング: 成功

## 対処方法
このエラーの調査と修正が必要です。

---
*このIssueはCCLAエージェントによって自動的に作成されました*
```

## テスト結果
- `test/test-error-log-collection.js` - 基本機能テスト
- `test/test-ccla-integration.js` - 統合テスト
- 以下を確認：
  - ✅ エラーパターンの正しい分類
  - ✅ エラーハッシュの生成
  - ✅ Issue本文の適切なフォーマット
  - ✅ メッセージディレクトリの作成
  - ✅ 処理済みエラーの記録

## 実装上の課題と対処
- **課題**: エージェントモードがデフォルトで無効
- **対処**: `npm run start:agents`コマンドで有効化可能
- **注意**: 完全な統合にはエージェントモード有効化が必要

## 使用方法
```bash
# エージェントモードで起動
npm run start:agents

# 通常モードでエラーログ収集を有効化
# config.jsonで errorLogCollection.enabled: true に設定
npm start
```

## 成果
- エラーの自動検出と分類
- 問題の早期発見と対応
- 運用負荷の軽減
- エラー対応の体系化

## 技術的なポイント
- パターンマッチングによる自動分類
- ハッシュによる重複防止
- エージェントアーキテクチャによる拡張性

## 今後の拡張（Phase 2-3）
- Claudeによる高度なエラー分析
- 類似エラーのグループ化
- 自動修復機能の追加
- ログローテーション機能の実装

## 関連ドキュメント
- **要求定義**: `docs/requirements/error-log-collection.md`
- **テストスクリプト**: `test/test-error-log-collection.js`
- **統合テスト**: `test/test-ccla-integration.js`

## 関連Issue
- Issue #27: エージェント分離アーキテクチャ（基盤）
- Issue #34: エラーログ収集Phase 3基本（自動修復）
- Issue #37: エラーログ収集Phase 2（高度な分析）