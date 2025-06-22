# Issue #150: Project Registry Implementation

**実装日**: 2025/6/21  
**実装者**: Claude (PoppoBuilder)  
**関連Issue**: #150

## 概要

PoppoBuilderが複数のプロジェクトを効率的に管理するためのプロジェクトレジストリシステムを実装しました。このシステムにより、ユーザーは複数のプロジェクトを登録し、それぞれに個別の設定や統計情報を管理できるようになりました。

## 実装内容

### 1. Project Schema (`lib/schemas/project-schema.js`)
- Ajvを使用したJSON Schema validation
- プロジェクトエントリとレジストリ全体の構造定義
- プロジェクト設定項目：
  - **基本情報**: パス、有効化状態、作成・更新時刻
  - **設定**: 名前、説明、GitHub情報、優先度、タグ
  - **スケジュール**: チェック間隔、アクティブ時間、タイムゾーン
  - **リソース**: 最大同時実行数、CPU重み、メモリ制限
  - **統計**: 処理済みIssue数、エラー数、平均処理時間

### 2. ProjectRegistry Core (`lib/core/project-registry.js`)
- EventEmitterベースのプロジェクト管理クラス
- Singletonパターンによるインスタンス管理
- 主要機能：
  - **CRUD操作**: register(), unregister(), updateProject()
  - **クエリ機能**: getProject(), getProjectByPath(), getEnabledProjects()
  - **統計管理**: updateStats()
  - **データ永続化**: load(), save(), export(), import()
  - **レジストリ管理**: `~/.poppobuilder/projects.json`

### 3. CLI Commands (`lib/commands/project.js`)
包括的なプロジェクト管理コマンド：

```bash
# プロジェクト登録
poppobuilder project register <path> [options]
  --name <name>           # プロジェクト名
  --description <desc>    # 説明
  --owner <owner>         # GitHub owner
  --repo <repo>           # GitHub repository
  --priority <priority>   # 優先度 (0-100)
  --disabled              # 無効状態で登録

# プロジェクト管理
poppobuilder project list                    # 一覧表示
poppobuilder project show <project-id>      # 詳細表示
poppobuilder project enable <project-id>    # 有効化
poppobuilder project disable <project-id>   # 無効化
poppobuilder project unregister <project-id> # 登録解除

# 設定更新
poppobuilder project update <project-id> [options]

# データ管理
poppobuilder project export <file>          # エクスポート
poppobuilder project import <file>          # インポート
```

### 4. CLI Integration
- `bin/poppobuilder.js`にprojectコマンドを統合
- ヘルプにプロジェクト管理コマンドの例を追加
- i18n対応（英語・日本語）

## 技術的特徴

### プロジェクトID生成
- パスの最後2セグメントから生成
- SHA256ハッシュによる一意性保証
- 無効文字の自動サニタイズ
```javascript
generateProjectId('/home/user/my-project') 
// => 'user-my-project-a1b2c3'
```

### データ永続化
- `~/.poppobuilder/projects.json`での管理
- アトミックな書き込み処理（一時ファイル→rename）
- デバウンス付き自動保存（1秒間隔）
- バックアップ機能

### バリデーション
- JSON Schemaによる厳密な検証
- 必須フィールドチェック
- データ型・値範囲の検証
- GitHub情報の形式チェック

### イベント駆動アーキテクチャ
- EventEmitterによるイベント発行
- プロジェクト操作時の通知：
  - `project-registered`
  - `project-updated`
  - `project-unregistered`
  - `loaded`, `saved`, `imported`

## レジストリファイル構造

```json
{
  "version": "1.0.0",
  "projects": {
    "my-project-a1b2c3": {
      "path": "/path/to/project",
      "enabled": true,
      "createdAt": "2025-06-21T07:30:00.000Z",
      "updatedAt": "2025-06-21T07:30:00.000Z",
      "config": {
        "name": "My Project",
        "description": "A sample project",
        "github": {
          "owner": "username",
          "repo": "repository"
        },
        "priority": 50,
        "tags": ["web", "api"]
      },
      "stats": {
        "totalIssuesProcessed": 0,
        "totalErrors": 0,
        "averageProcessingTime": 0
      }
    }
  },
  "metadata": {
    "createdAt": "2025-06-21T07:30:00.000Z",
    "updatedAt": "2025-06-21T07:30:00.000Z",
    "totalProjects": 1
  }
}
```

## テスト結果

```
ProjectRegistry
  initialize
    ✔ should initialize and create default registry
    ✔ should load existing registry
  register
    ✔ should register a new project
    ✔ should throw error for non-directory path
    ✔ should throw error for already registered project
  unregister
    ✔ should unregister a project
    ✔ should throw error for non-existent project
  updateProject
    ✔ should update project configuration
    ✔ should preserve immutable fields
  setEnabled
    ✔ should enable project
    ✔ should disable project
  getProject
    ✔ should return project by ID
    ✔ should return undefined for non-existent project
  getProjectByPath
    ✔ should return project by path
    ✔ should return null for non-existent path
  getEnabledProjects
    ✔ should return only enabled projects
  generateProjectId
    ✔ should generate consistent ID for same path
    ✔ should generate different IDs for different paths
    ✔ should sanitize invalid characters
  updateStats
    ✔ should update project statistics

20 passing (70ms)
```

## 使用例

```bash
# プロジェクト登録
poppobuilder project register . \
  --name "My App" \
  --description "Web application" \
  --owner myusername \
  --repo myapp \
  --priority 80

# 一覧表示
poppobuilder project list
# Output:
# my-app-a1b2c3 ✓ enabled
#   Path: /current/directory
#   Name: My App
#   GitHub: myusername/myapp

# 詳細表示
poppobuilder project show my-app-a1b2c3

# プロジェクト無効化
poppobuilder project disable my-app-a1b2c3
```

## 今後の展開

このプロジェクトレジストリは、以下の機能の基盤となります：
- Issue #151で実装したデーモンプロセスとの統合
- 複数プロジェクトの並行処理
- プロジェクト別リソース制限
- 優先度ベースのスケジューリング
- プロジェクト横断的な統計・レポート機能

## ファイル一覧

- `lib/schemas/project-schema.js` - プロジェクトスキーマ定義
- `lib/core/project-registry.js` - プロジェクトレジストリクラス
- `lib/commands/project.js` - CLI コマンド実装
- `test/project-registry.test.js` - テストスイート
- `bin/poppobuilder.js` - CLI統合
- `docs/implementation-history/issues/issue-150-project-registry.md` - 実装ドキュメント