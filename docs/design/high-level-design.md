# 概要設計書

## 概要
このドキュメントは、要件定義書に基づいてPoppoBuilder Suiteのシステム全体の設計を定義したものです。

**作成日**: 2025/6/15
**ブランチ**: feature/requirements-definition-framework
**ステータス**: 概要設計中

## システムアーキテクチャ

### 全体構成図
```
┌─────────────────────────────────────────────────────────────┐
│                        GitHub                                 │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────────┐   │
│  │ Issues  │  │   PRs   │  │  Wiki   │  │ Repository  │   │
│  └────┬────┘  └────┬────┘  └────┬────┘  └──────┬──────┘   │
│       │            │            │              │            │
└───────┼────────────┼────────────┼──────────────┼────────────┘
        │            │            │              │
        ▼            ▼            ▼              ▼
┌─────────────────────────────────────────────────────────────┐
│                   PoppoBuilder Suite                          │
│  ┌─────────────────────────────────────────────────────┐   │
│  │                 Core Components                       │   │
│  │  ┌─────────────┐  ┌──────────────┐  ┌────────────┐ │   │
│  │  │Issue Manager│  │Process Manager│  │State Manager│ │   │
│  │  └─────────────┘  └──────────────┘  └────────────┘ │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │                 Phase Processors                      │   │
│  │  ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐       │   │
│  │  │Require-│ │Require-│ │ Design │ │Implement│       │   │
│  │  │ ments  │ │ ments  │ │        │ │ & Test  │ ···   │   │
│  │  │Analysis│ │  Spec  │ │Processor│ │Processor│       │   │
│  │  └────────┘ └────────┘ └────────┘ └────────┘       │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
        │                                               │
        ▼                                               ▼
┌──────────────┐                              ┌──────────────┐
│ Claude Code  │                              │File System   │
│ Subprocess   │                              │(Config/Logs) │
└──────────────┘                              └──────────────┘
```

## 主要コンポーネント

### 1. Issue Manager
**責務**: GitHub Issueとの双方向通信
- Issue読み取り・解析
- Issue作成・更新
- ラベル管理
- コメント追加
- 承認待ちIssue管理

### 2. Process Manager
**責務**: Claude Codeプロセスの管理
- プロセススポーン
- プロセス監視
- タイムアウト管理
- リソース制御
- エラーハンドリング

### 3. State Manager
**責務**: システム状態の永続化
- タスクキュー管理
- 実行状態追跡
- フェーズ進捗管理
- ブランチ状態管理
- 設定管理

### 4. Phase Processors
**責務**: 各開発フェーズの実行
- Requirements Analysis: 要求定義
- Requirements Spec: 要件定義
- Design Processor: 概要・詳細設計
- Implementation Processor: 実装・テスト
- PR Processor: PR作成・管理

## データフロー

### 1. Issue受信フロー
```
GitHub Issue → gh CLI → Issue Manager → State Manager → Task Queue
```

### 2. フェーズ実行フロー
```
Task Queue → Phase Processor → Process Manager → Claude Code
                    ↓
              State Update → Issue Update
```

### 3. ブランチ管理フロー
```
Issue Analysis → Branch Strategy → git commands → GitHub
```

## インターフェース定義

### 1. GitHub API インターフェース
- `gh issue list`: Issue一覧取得
- `gh issue create`: Issue作成
- `gh issue comment`: コメント追加
- `gh pr create`: PR作成
- `gh api`: その他のAPI操作

### 2. プロセス間通信
- **入力**: JSON形式の指示書
- **出力**: 実行結果とステータス
- **エラー**: 構造化されたエラー情報

### 3. 設定ファイル形式
```json
{
  "github": {
    "owner": "string",
    "repo": "string"
  },
  "phases": {
    "autoApprove": ["requirements", "design"],
    "requireApproval": ["implementation"]
  },
  "process": {
    "timeout": 300000,
    "maxConcurrent": 3
  }
}
```

## セキュリティ考慮事項
1. GitHub認証はgh CLIに委譲
2. プロセス実行は`--dangerously-skip-permissions`使用
3. ファイルアクセスは作業ディレクトリに制限
4. 環境変数による機密情報管理

## エラーハンドリング戦略
1. **リトライ可能エラー**: 3回まで自動リトライ
2. **ユーザー介入必要エラー**: Issue作成して待機
3. **致命的エラー**: 安全に停止してログ記録

## スケーラビリティ考慮事項
1. 並行実行タスク数の制限
2. キューによる非同期処理
3. 状態の原子性保証
4. リソース使用量の監視

## 次のステップ
- 詳細設計書の作成
- 各コンポーネントのAPI仕様定義
- テストケースの設計