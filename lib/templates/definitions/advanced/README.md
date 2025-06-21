# {{PROJECT_NAME}}

高度な機能を備えたPoppoBuilderプロジェクトです。

## 機能

- 複数エージェントによる自動処理
- マルチプロジェクト対応
- 自動バックアップ
- ヘルスチェック
- 通知機能
- Redis統合

## セットアップ

1. Redisの起動:
   ```bash
   docker-compose up -d
   ```

2. 依存関係のインストール:
   ```bash
   npm install
   ```

3. 設定ファイルの編集:
   - `config/config.json` を環境に合わせて編集
   - 環境変数の設定

4. PoppoBuilderの起動:
   ```bash
   npm start:agents
   ```

## 管理

- ダッシュボード: http://localhost:3001
- Redis Commander: http://localhost:8081

詳細は [PoppoBuilder Documentation](https://github.com/medamap/PoppoBuilderSuite) を参照してください。
