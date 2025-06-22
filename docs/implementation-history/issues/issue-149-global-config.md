# Issue #149: Global Configuration Management System Implementation

**実装日**: 2025/6/21  
**実装者**: Claude (PoppoBuilder)  
**関連Issue**: #149

## 概要
PoppoBuilderのマルチプロジェクト対応の基盤となるグローバル設定管理システムを実装しました。このシステムは`~/.poppobuilder/config.json`に設定を保存し、複数のプロジェクト間で共有される設定を管理します。

## 実装内容

### 1. GlobalConfigManager (`lib/core/global-config-manager.js`)
- 設定ファイルの作成・読み込み・更新・削除機能
- イベントベースの変更通知（EventEmitterを継承）
- アトミックなファイル書き込み（一時ファイル経由）
- 外部変更の監視機能（fs.watchFile）
- 設定のエクスポート/インポート機能
- シングルトンパターンによる一元管理

### 2. 設定スキーマ (`lib/schemas/global-config-schema.js`)
- JSON Schemaによる厳密な設定検証
- Ajvを使用したバリデーション
- デフォルト値の自動適用
- 以下の設定カテゴリを定義：
  - **daemon**: デーモンモード設定（maxProcesses、schedulingStrategy、port等）
  - **defaults**: デフォルト値（checkInterval、timeout、language等）
  - **registry**: プロジェクトレジストリ設定
  - **logging**: ログ設定
  - **telemetry**: テレメトリ設定
  - **updates**: アップデート設定

### 3. CLIコマンド (`lib/commands/global-config.js`)
```bash
poppobuilder global-config init      # 初期化
poppobuilder global-config show      # 表示
poppobuilder global-config set       # 値設定
poppobuilder global-config reset     # リセット
poppobuilder global-config export    # エクスポート
poppobuilder global-config import    # インポート
poppobuilder global-config validate  # 検証
poppobuilder global-config path      # パス表示
```

### 4. i18n対応
- 英語と日本語の両方に対応
- `lib/i18n/locales/en/cli.json`と`lib/i18n/locales/ja/cli.json`に翻訳を追加

### 5. テストスイート (`test/global-config-manager.test.js`)
- 16個の包括的なテストケース
- 初期化、読み書き、バリデーション、イベント処理をカバー
- Mocha + Chai + Sinonを使用

## 技術的特徴

### 設定の階層構造
```
1. 環境変数 (POPPO_*)         ← 最優先
2. プロジェクト設定 (.poppo/config.json)
3. グローバル設定 (~/.poppobuilder/config.json)
4. システムデフォルト
```

### ディレクトリ構造
```
~/.poppobuilder/
├── config.json      # グローバル設定
├── logs/           # グローバルログ
└── projects/       # プロジェクトレジストリ
```

### 主要機能
- **get/set**: ドット記法によるネストされた値へのアクセス
- **update**: 複数値の一括更新
- **validation**: スキーマベースの厳密な検証
- **events**: 変更通知（initialized、changed、updated、error等）
- **atomic writes**: 一時ファイル経由の安全な書き込み
- **file watching**: 外部変更の自動検出

## 使用例

### CLI使用例
```bash
# 初期化
poppobuilder global-config init

# 設定表示
poppobuilder global-config show
poppobuilder global-config show daemon.maxProcesses

# 値設定
poppobuilder global-config set daemon.maxProcesses 4
poppobuilder global-config set daemon.enabled false

# エクスポート/インポート
poppobuilder global-config export backup.json
poppobuilder global-config import backup.json
```

### API使用例
```javascript
const { getInstance } = require('poppobuilder/lib/core/global-config-manager');
const configManager = getInstance();

await configManager.initialize();
const maxProcesses = configManager.get('daemon.maxProcesses');
await configManager.set('daemon.maxProcesses', 4);
```

## 今後の展開
このグローバル設定システムは、以下の機能の基盤となります：
- Issue #151: Daemon Process Foundation（デーモンプロセス基盤）
- Issue #150: Project Registry（プロジェクトレジストリ）
- マルチプロジェクト管理機能
- リソース管理とスケジューリング

## テスト結果
```
GlobalConfigManager
  initialize
    ✔ should create config directory and file if they do not exist
    ✔ should load existing config file
  get/set
    ✔ should get configuration value by path
    ✔ should return undefined for non-existent path
    ✔ should set configuration value by path
    ✔ should validate configuration after setting
  validation
    ✔ should validate correct configuration
    ✔ should reject invalid configuration
  update
    ✔ should update multiple configuration values
    ✔ should rollback on validation failure
  reset
    ✔ should reset configuration to defaults
  export/import
    ✔ should export configuration as JSON string
    ✔ should import configuration from JSON string
    ✔ should reject invalid import
  events
    ✔ should emit initialized event
    ✔ should emit changed event on set

16 passing (14ms)
```