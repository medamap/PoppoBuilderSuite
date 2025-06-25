# Multi-Project Executor 設定ガイド

## 概要

`multi-project-executor.sh` は複数のプロジェクトでPoppoBuilderを実行管理するスクリプトです。プロセスの重複実行防止、タイムアウト管理、ヘルスチェック機能を備えています。

## 環境変数の設定

環境変数を使用してスクリプトの動作をカスタマイズできます。**環境変数が設定されていない場合は、自動的にデフォルト値が使用されます。**

### プロセス管理設定

#### POPPOBUILDER_TIMEOUT
- **説明**: PoppoBuilderプロセスの最大実行時間（秒）
- **デフォルト値**: `300`（5分）
- **使用例**:
  ```bash
  # 10分に設定
  export POPPOBUILDER_TIMEOUT=600
  bash scripts/multi-project-executor.sh
  ```

#### POPPOBUILDER_HEALTH_CHECK_INTERVAL
- **説明**: プロセスの健全性チェック間隔（秒）
- **デフォルト値**: `30`（30秒）
- **使用例**:
  ```bash
  # 1分ごとにチェック
  export POPPOBUILDER_HEALTH_CHECK_INTERVAL=60
  bash scripts/multi-project-executor.sh
  ```


### 実行戦略設定

#### POPPOBUILDER_STRATEGY
- **説明**: プロジェクトの処理順序戦略
- **デフォルト値**: `round-robin`
- **利用可能な値**:
  - `round-robin`: 順番に処理（デフォルト）
  - `priority`: 優先度の高い順に処理
  - `weighted`: 重み付けに基づいて処理（未実装）
  - `fair-share`: 公平なリソース配分（未実装）
- **使用例**:
  ```bash
  # 優先度順に処理
  export POPPOBUILDER_STRATEGY=priority
  bash scripts/multi-project-executor.sh
  ```

#### POPPOBUILDER_WAIT_TIME
- **説明**: プロジェクト処理間の待機時間（秒）
- **デフォルト値**: `60`（1分）
- **使用例**:
  ```bash
  # 2分待機
  export POPPOBUILDER_WAIT_TIME=120
  bash scripts/multi-project-executor.sh
  ```

## 使用例

### 基本的な使用（デフォルト設定）
```bash
# 全てデフォルト値で実行
bash scripts/multi-project-executor.sh
```

### カスタム設定での実行
```bash
# タイムアウトを10分、チェック間隔を1分に設定
export POPPOBUILDER_TIMEOUT=600
export POPPOBUILDER_HEALTH_CHECK_INTERVAL=60
export POPPOBUILDER_WAIT_TIME=30
bash scripts/multi-project-executor.sh
```

### テスト用の短い設定
```bash
# テスト用に短い時間設定
export POPPOBUILDER_TIMEOUT=30      # 30秒でタイムアウト
export POPPOBUILDER_WAIT_TIME=10    # 10秒待機
export POPPOBUILDER_HEALTH_CHECK_INTERVAL=5  # 5秒ごとにチェック
bash scripts/multi-project-executor.sh
```

## PIDファイル管理

スクリプトは自動的にPIDファイルを管理し、プロセスの重複実行を防ぎます。

- **PIDファイルの場所**: `/tmp/poppo-builder/pids/`
- **ファイル名形式**: `poppo-builder-{プロジェクト名}.pid`

### 手動でのPIDファイル確認
```bash
# PIDファイルの一覧
ls -la /tmp/poppo-builder/pids/

# 実行中のプロセス確認
ps aux | grep poppo-builder
```

### トラブルシューティング
```bash
# 古いPIDファイルの削除（必要な場合のみ）
rm -f /tmp/poppo-builder/pids/*.pid

# ログの確認
tail -f /tmp/poppo-builder/logs/multi-project-executor-*.log
```

## 設定値の確認

現在の設定値を確認するには：
```bash
# 環境変数の確認
echo "POPPOBUILDER_TIMEOUT=${POPPOBUILDER_TIMEOUT:-300}"
echo "POPPOBUILDER_HEALTH_CHECK_INTERVAL=${POPPOBUILDER_HEALTH_CHECK_INTERVAL:-30}"
echo "POPPOBUILDER_WAIT_TIME=${POPPOBUILDER_WAIT_TIME:-60}"
echo "POPPOBUILDER_STRATEGY=${POPPOBUILDER_STRATEGY:-round-robin}"
```

## 注意事項

1. **環境変数は実行前に設定してください** - スクリプト実行中の変更は反映されません
2. **タイムアウト値は処理内容に応じて調整してください** - 大きなプロジェクトでは長めの設定が必要かもしれません
3. **ヘルスチェック間隔はタイムアウトより短く設定してください** - 適切な監視のため

## 関連ドキュメント

- [PoppoBuilder Suite 設定ガイド](../INSTALL.md)
- [トラブルシューティング](../troubleshooting.md)