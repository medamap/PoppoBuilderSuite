# PoppoBuilder Suite 設定ドキュメント

このディレクトリにはPoppoBuilder Suiteの各種設定に関するドキュメントが含まれています。

## 設定ファイル一覧

### [multi-project-executor.md](./multi-project-executor.md)
複数プロジェクトの実行管理スクリプトの設定方法について説明しています。

- 環境変数の設定とデフォルト値
- PIDファイル管理
- タイムアウトとヘルスチェック設定
- 実行戦略の選択

## 環境変数の基本

PoppoBuilder Suiteでは、環境変数を使用して動作をカスタマイズできます。

### 重要な原則

1. **デフォルト値の自動適用**
   - 環境変数が設定されていない場合、システムは自動的にデフォルト値を使用します
   - ユーザーは必要な設定のみを変更すれば良く、全ての環境変数を設定する必要はありません

2. **設定の優先順位**
   ```
   環境変数 > プロジェクト設定 > グローバル設定 > デフォルト値
   ```

3. **設定の確認方法**
   ```bash
   # 現在の設定値を確認
   echo ${VARIABLE_NAME:-default_value}
   ```

## 共通の環境変数

### GITHUB_TOKEN
- **必須**: はい
- **説明**: GitHub APIへのアクセストークン
- **設定例**:
  ```bash
  export GITHUB_TOKEN="ghp_xxxxxxxxxxxxxxxxxxxx"
  ```

### POPPO_LANGUAGE_PRIMARY
- **必須**: いいえ
- **デフォルト**: `ja`
- **説明**: 主要言語設定
- **設定例**:
  ```bash
  export POPPO_LANGUAGE_PRIMARY=en
  ```

## 設定のベストプラクティス

1. **永続的な設定**
   ```bash
   # ~/.bashrc または ~/.zshrc に追加
   export POPPOBUILDER_TIMEOUT=600
   export GITHUB_TOKEN="your_token_here"
   ```

2. **一時的な設定**
   ```bash
   # コマンド実行時のみ有効
   POPPOBUILDER_TIMEOUT=30 bash scripts/multi-project-executor.sh
   ```

3. **設定ファイルの使用**
   ```bash
   # .env ファイルを作成
   cat > .env << EOF
   POPPOBUILDER_TIMEOUT=600
   POPPOBUILDER_WAIT_TIME=30
   EOF
   
   # 読み込んで実行
   source .env
   bash scripts/multi-project-executor.sh
   ```

## トラブルシューティング

### 設定が反映されない場合

1. 環境変数が正しくエクスポートされているか確認
   ```bash
   env | grep POPPOBUILDER
   ```

2. シェルを再起動するか、設定ファイルを再読み込み
   ```bash
   source ~/.bashrc
   ```

3. スクリプトのデバッグモードで確認
   ```bash
   DEBUG=1 bash scripts/multi-project-executor.sh
   ```

## 関連リンク

- [インストールガイド](../INSTALL.md)
- [アーキテクチャ概要](../architecture/system-overview.md)
- [CLAUDEセッションガイド](../../CLAUDE.md)