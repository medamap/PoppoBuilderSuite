# Issue #152: initコマンドの実装

**実装日**: 2025/6/21  
**実装者**: Claude (PoppoBuilder)  
**関連Issue**: #152

## 概要

PoppoBuilderのマルチプロジェクト対応に向けて、initコマンドを大幅に強化しました。Issue #150で実装したProjectRegistryと、Issue #149のGlobalConfigManager、Issue #151のDaemonProcess Foundationと統合し、プロジェクトの初期化時に自動的にグローバルレジストリに登録する機能を追加しました。

## 実装内容

### 1. InitCommandの強化 (`lib/commands/init.js`)

#### 新機能
- **プロジェクトディレクトリ指定**: `--dir`オプションで別のディレクトリを初期化可能
- **ProjectRegistry統合**: 初期化時に自動的にグローバルレジストリに登録
- **GlobalConfigManager統合**: グローバル設定の自動初期化
- **詳細なプロジェクト設定**: 優先度、タグ、リソース制限などの詳細設定

#### 拡張されたオプション
```bash
poppobuilder init [options]

基本オプション:
  -f, --force                    既存設定を上書き
  -l, --lang <language>          主言語 (en/ja)
  -d, --dir <directory>          初期化するディレクトリ

プロジェクト設定:
  --description <desc>           プロジェクト説明
  --priority <priority>          優先度 (0-100)
  --tags <tags>                  カンマ区切りタグ
  --disabled                     無効状態で登録

スケジュール設定:
  --check-interval <ms>          チェック間隔（ミリ秒）

リソース設定:
  --max-concurrent <num>         最大同時実行数
  --cpu-weight <weight>          CPU重み
  --memory-limit <limit>         メモリ制限 (例: 512M, 2G)

その他:
  --no-agents                    エージェント機能無効
  --no-interactive               対話式セットアップをスキップ
```

### 2. 処理フロー

```
1. 言語・環境設定初期化
2. プロジェクトディレクトリの決定
3. 開発環境セットアップ（SetupWizard）
4. 既存設定の確認
5. プロジェクト情報取得（Git情報等）
6. 設定作成（対話式または自動）
7. ディレクトリ構造作成
8. 設定ファイル保存
9. .gitignore更新
10. グローバルコンポーネント初期化 ★ 新機能
11. プロジェクトレジストリに登録 ★ 新機能
12. 完了メッセージ表示
```

### 3. 新しいメソッド

#### `initializeGlobalComponents()`
- GlobalConfigManagerの初期化
- ProjectRegistryの初期化
- エラー時の適切なフォールバック処理

#### `registerProject(projectDir, config, options)`
- プロジェクト設定の構築
- GitHub情報の統合
- スケジュール・リソース設定の適用
- 重複登録の適切な処理

### 4. CLIオプション拡張

`bin/poppobuilder.js`を更新し、新しいオプションを追加：
- プロジェクト設定関連オプション（description、priority、tags）
- リソース管理オプション（max-concurrent、cpu-weight、memory-limit）
- スケジュール設定オプション（check-interval）

### 5. テスト実装

包括的なテストスイート (`test/init-command-simple.test.js`) を作成：
- 基本機能のテスト（13テスト）
- ファイル存在チェック
- 設定生成の妥当性確認
- プロジェクト情報抽出の正確性
- Git情報パースの堅牢性

## 技術的特徴

### エラーハンドリング
- グローバルコンポーネント初期化失敗時の警告表示
- プロジェクト登録失敗時の適切なフォールバック
- 重複登録の検出と既存プロジェクト情報表示

### 設定の階層化
1. **コマンドラインオプション**（最優先）
2. **対話式入力**
3. **Git情報からの自動検出**
4. **デフォルト値**

### プロジェクト設定統合
```javascript
// 自動生成される設定例
{
  enabled: true,
  config: {
    name: "MyProject",
    description: "PoppoBuilder project: MyProject",
    priority: 50,
    tags: ["web", "api"],
    github: {
      owner: "username",
      repo: "repository"
    },
    schedule: {
      checkInterval: 300000  // 5分
    },
    resources: {
      maxConcurrent: 3,
      cpuWeight: 2.0,
      memoryLimit: "1G"
    }
  }
}
```

## 使用例

### 基本的な初期化
```bash
poppobuilder init
```

### 詳細設定での初期化
```bash
poppobuilder init \
  --description "Web API プロジェクト" \
  --priority 80 \
  --tags "web,api,production" \
  --max-concurrent 5 \
  --cpu-weight 2.0 \
  --memory-limit 2G \
  --check-interval 180000
```

### 別ディレクトリの初期化
```bash
poppobuilder init --dir /path/to/project \
  --description "別プロジェクト" \
  --no-interactive
```

### 無効状態での登録
```bash
poppobuilder init --disabled \
  --description "開発中プロジェクト"
```

## 完了メッセージの改善

新しい完了メッセージで、マルチプロジェクト管理の次のステップを案内：

```
✨ PoppoBuilder initialized successfully!

Next steps:

1. Set your GitHub token:
   export GITHUB_TOKEN=your_github_token

2. Set your Claude API key:
   export CLAUDE_API_KEY=your_claude_api_key

3. Start PoppoBuilder:
   poppobuilder start

4. Check project status:
   poppobuilder project list

5. Start daemon for multi-project management:
   poppobuilder daemon start

6. Check overall status:
   poppobuilder status

For more information:
   poppobuilder --help
```

## テスト結果

```
InitCommand Simple Tests
  constructor
    ✔ should initialize with correct default values
  fileExists
    ✔ should return true for existing file
    ✔ should return false for non-existing file
  createDefaultConfig
    ✔ should create valid default configuration
    ✔ should handle missing Git remote
    ✔ should handle agents disabled
    ✔ should include correct task labels
  getProjectInfo
    ✔ should extract project name from directory
    ✔ should detect Git and package.json
    ✔ should handle Git remote parsing for HTTPS URLs
    ✔ should handle invalid Git remote URLs
    ✔ should handle Git command failure
  integration test components
    ✔ should have the correct methods for integration

13 passing (67ms)
```

## 依存関係

この実装は以下のコンポーネントに依存しています：
- **Issue #149**: GlobalConfigManager - グローバル設定管理
- **Issue #150**: ProjectRegistry - プロジェクトレジストリ
- **Issue #151**: DaemonProcessFoundation - デーモンプロセス基盤

## 今後の展開

このinitコマンドの強化により、以下の機能がシームレスに動作可能になります：
- **Issue #153**: list（ls）コマンド - 登録済みプロジェクトの一覧表示
- **Issue #160**: デーモンAPIサーバー - CLI-デーモン間通信
- **Issue #157**: グローバルプロセスプールマネージャー - リソース管理

## ファイル一覧

- `lib/commands/init.js` - メインのInitCommandクラス（大幅更新）
- `bin/poppobuilder.js` - CLIオプション追加
- `test/init-command-simple.test.js` - テストスイート
- `docs/implementation-history/issues/issue-152-init-command.md` - 実装ドキュメント

## 破壊的変更

- 既存のinitコマンドとの互換性は維持
- 新しいオプションはすべてオプショナル
- デフォルトの動作は従来と同一