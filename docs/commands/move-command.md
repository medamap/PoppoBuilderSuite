# Move Command

## 概要
`poppobuilder move` コマンドは、PoppoBuilderプロジェクトを別のディレクトリに安全に移動するための機能を提供します。プロジェクトの設定、状態、履歴を保持したまま移動を行い、レジストリも自動的に更新されます。

## 使用方法

```bash
poppobuilder move <project-id|project-path> <new-path> [options]
```

### 引数
- `project-id|project-path`: 移動するプロジェクトのIDまたは現在のパス
- `new-path`: 移動先のパス

### オプション
- `--symlink`: 元の場所にシンボリックリンクを作成
- `--force`: 確認プロンプトをスキップし、未コミットの変更があっても強制的に移動
- `--parents`: 移動先の親ディレクトリが存在しない場合、自動的に作成
- `--merge`: 移動先ディレクトリが既に存在する場合、その中に移動
- `--verbose`: 詳細なログを表示

## 機能詳細

### 1. 基本的な移動操作
プロジェクトを新しい場所に移動し、すべての設定とデータを保持します。

```bash
# プロジェクトIDを使用
poppobuilder move my-project /new/location/my-project

# 現在のパスを使用
poppobuilder move ./my-project /new/location/my-project
```

### 2. シンボリックリンクの作成
`--symlink` オプションを使用すると、元の場所にシンボリックリンクを作成します。これにより、既存のスクリプトやショートカットが引き続き動作します。

```bash
poppobuilder move my-project /new/location/my-project --symlink
```

### 3. 親ディレクトリの自動作成
移動先の親ディレクトリが存在しない場合、`--parents` オプションで自動作成できます。

```bash
poppobuilder move my-project /new/deep/path/my-project --parents
```

### 4. Git統合
Gitリポジトリの場合、未コミットの変更を検出し、警告を表示します。

```bash
# 未コミット変更がある場合の強制移動
poppobuilder move my-project /new/location --force
```

### 5. クロスデバイス移動
異なるファイルシステム間の移動も自動的に処理されます。内部的にコピー＆削除操作が行われます。

## エラーハンドリング

### よくあるエラーと対処法

1. **プロジェクトが見つからない**
   ```
   Project not found: my-project
   ```
   - プロジェクトIDまたはパスを確認してください
   - `poppobuilder list` でプロジェクト一覧を確認

2. **移動先が既に存在する**
   ```
   Target path already exists: /new/location
   ```
   - `--merge` オプションを使用して既存ディレクトリ内に移動
   - または別の移動先を指定

3. **実行中のタスクがある**
   ```
   Cannot move project with 2 running tasks
   ```
   - すべてのタスクを停止してから再試行
   - `poppobuilder status` でタスク状態を確認

4. **権限エラー**
   ```
   Permission denied
   ```
   - 移動先ディレクトリへの書き込み権限を確認
   - 必要に応じて `sudo` を使用

## 安全機能

### ロールバック
移動中にエラーが発生した場合、自動的にロールバックを試みます。

### 検証
移動前に以下の検証を行います：
- ソースパスの存在確認
- 移動先の重複チェック
- 実行中タスクの確認
- Git状態の確認

### 設定の更新
プロジェクト内の絶対パスは自動的に新しいパスに更新されます。

## 使用例

### 例1: プロジェクトの整理
```bash
# 散在するプロジェクトを一箇所に集める
poppobuilder move old-project ~/projects/poppobuilder/old-project --parents
```

### 例2: バックアップからの復元
```bash
# バックアップから元の場所に復元し、バックアップ場所にシンボリックリンクを作成
poppobuilder move /backup/my-project ~/work/my-project --symlink
```

### 例3: 大規模なプロジェクトの移動
```bash
# 詳細ログを表示しながら移動
poppobuilder move large-project /mnt/ssd/large-project --verbose
```

## 注意事項

1. **Git Hooks**: Git hooksやCI/CD設定で絶対パスを使用している場合は、手動で更新が必要です

2. **外部参照**: プロジェクト外から参照されているパスは自動更新されません

3. **シンボリックリンク**: Windowsでシンボリックリンクを作成するには管理者権限が必要です

4. **大規模プロジェクト**: 大きなプロジェクトの移動には時間がかかる場合があります

## テスト

moveコマンドは包括的なテストスイートでカバーされています：

```bash
# 単体テスト
npm test test/poppobuilder-move.test.js

# 統合テスト
npm test test/integration/move-command-integration.test.js
```

## 関連コマンド
- `poppobuilder list` - プロジェクト一覧の表示
- `poppobuilder status` - プロジェクトの状態確認
- `poppobuilder remove` - プロジェクトの削除