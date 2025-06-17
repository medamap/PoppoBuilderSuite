# PoppoBuilder 設定管理ガイド

## 概要

PoppoBuilderは階層的な設定管理システムを採用しており、柔軟な設定のカスタマイズが可能です。

## 設定の優先順位

設定は以下の優先順位で適用されます（上位が優先）：

1. **環境変数** (`POPPO_*`)
2. **プロジェクト設定** (`.poppo/config.json`)
3. **グローバル設定** (`~/.poppo/config.json`)
4. **システムデフォルト** (`config/defaults.json`)

## 設定管理CLI

### 基本的な使い方

```bash
# 現在の設定を表示
npm run config:show

# 設定階層情報を表示
npm run config:hierarchy

# 設定のバリデーション
npm run config:validate

# 環境変数の一覧を表示
npm run config:env

# 特定の設定値を取得
npm run config get language.primary

# プロジェクト設定を更新
npm run config set language.primary en
npm run config set claude.maxConcurrent 3
```

### コマンド一覧

| コマンド | 説明 |
|---------|------|
| `show` | 現在の設定を表示 |
| `hierarchy` | 設定階層情報を表示 |
| `get <key>` | 特定の設定値を取得 |
| `set <key> <value>` | プロジェクト設定を更新 |
| `validate` | 設定のバリデーション |
| `sources` | 設定ソース情報を表示 |
| `env` | 環境変数の一覧を表示 |
| `help` | ヘルプを表示 |

## 環境変数による設定

環境変数を使用して設定を上書きできます：

```bash
# 言語設定
export POPPO_LANGUAGE_PRIMARY=en
export POPPO_LANGUAGE_FALLBACK=ja

# Claude設定
export POPPO_CLAUDE_MAXCONCURRENT=3
export POPPO_CLAUDE_DEFAULTTIMEOUT=600000

# GitHub設定
export POPPO_GITHUB_POLLINGINTERVAL=120000
export POPPO_GITHUB_MAXCOMMENTSPERISSUE=50

# 動的タイムアウト
export POPPO_DYNAMICTIMEOUT_ENABLED=false
export POPPO_DYNAMICTIMEOUT_MINTIMEOUT=300000
export POPPO_DYNAMICTIMEOUT_MAXTIMEOUT=1800000

# ログ設定
export POPPO_LOGGING_LEVEL=debug
export POPPO_LOGGING_MAXFILES=30

# エラー収集
export POPPO_ERRORCOLLECTION_ENABLED=true
export POPPO_ERRORCOLLECTION_COLLECTINTERVAL=300000
```

### 環境変数の命名規則

- プレフィックス: `POPPO_`
- 階層はアンダースコアで区切る: `POPPO_CATEGORY_SUBCATEGORY_KEY`
- すべて大文字を使用

### 値の型

環境変数の値は自動的に適切な型に変換されます：

- `true`/`false` → 真偽値
- 数値 → Number型
- JSON形式 → オブジェクトまたは配列
- その他 → 文字列

## プロジェクト設定

プロジェクト固有の設定は `.poppo/config.json` に保存されます：

```json
{
  "language": {
    "primary": "ja",
    "fallback": "en"
  },
  "systemPrompt": {
    "enforceLanguage": true,
    "customInstructions": "プロジェクト固有の指示"
  },
  "github": {
    "pollingInterval": 120000
  }
}
```

## グローバル設定

ユーザー全体の設定は `~/.poppo/config.json` に保存されます：

```json
{
  "claude": {
    "maxConcurrent": 3
  },
  "notifications": {
    "enabled": true,
    "providers": ["discord"]
  }
}
```

## システムデフォルト設定

システムデフォルト設定は `config/defaults.json` で定義されています。この設定は変更せず、プロジェクト設定や環境変数で上書きしてください。

## 設定のバリデーション

設定値は以下のルールでバリデーションされます：

### 必須項目
- `language.primary`: 必須

### 値の制約
- `language.primary`: `ja` または `en`
- `claude.maxConcurrent`: 1〜10の範囲
- `github.pollingInterval`: 10000ms以上
- `dynamicTimeout.minTimeout`: `maxTimeout`以下

## 設定の確認方法

### 1. 階層情報の表示

```bash
npm run config:hierarchy
```

出力例：
```
PoppoBuilder設定階層情報:
========================
優先順位（高→低）:
1. 環境変数:
   POPPO_LANGUAGE_PRIMARY = en
2. プロジェクト設定: /path/to/project/.poppo/config.json
   ✓ 存在
3. グローバル設定: /home/user/.poppo/config.json
   ✗ 存在しない
4. システムデフォルト: /path/to/project/config/defaults.json
   ✓ 存在
========================
```

### 2. 現在の設定確認

```bash
npm run config:show
```

### 3. 特定の設定値確認

```bash
npm run config get language.primary
# 出力: language.primary: "ja"
```

## トラブルシューティング

### 設定が反映されない場合

1. 設定の優先順位を確認
   ```bash
   npm run config:hierarchy
   ```

2. 環境変数を確認
   ```bash
   npm run config:env
   ```

3. 設定のバリデーション
   ```bash
   npm run config:validate
   ```

### 環境変数が認識されない場合

- プレフィックス `POPPO_` が付いているか確認
- 大文字で記述されているか確認
- シェルで `export` されているか確認

### 設定ファイルが読み込まれない場合

- ファイルパスが正しいか確認
- JSON形式が正しいか確認（カンマ、括弧など）
- ファイルの読み取り権限を確認

## ベストプラクティス

1. **プロジェクト固有の設定**はプロジェクト設定に記述
2. **個人的な好み**はグローバル設定に記述
3. **一時的な変更**は環境変数を使用
4. **本番環境の設定**は環境変数で管理
5. **デフォルト設定**は変更しない

## 設定例

### 開発環境

```bash
# 開発用の設定
export POPPO_LOGGING_LEVEL=debug
export POPPO_CLAUDE_MAXCONCURRENT=1
export POPPO_GITHUB_POLLINGINTERVAL=30000
```

### 本番環境

```bash
# 本番用の設定
export POPPO_LOGGING_LEVEL=info
export POPPO_CLAUDE_MAXCONCURRENT=2
export POPPO_GITHUB_POLLINGINTERVAL=60000
export POPPO_NOTIFICATIONS_ENABLED=true
```

### 多言語プロジェクト

`.poppo/config.json`:
```json
{
  "language": {
    "primary": "en",
    "fallback": "ja"
  },
  "systemPrompt": {
    "customInstructions": "Use technical terminology appropriate for an international audience."
  }
}
```