# PoppoBuilder Platform - アップグレード計画

## 🎯 ビジョン

PoppoBuilder SuiteをJenkinsのようなWebベースのマルチプロジェクト管理プラットフォームに進化させる。

### 目指す姿
- **完全Webベース管理**: インストール後は全てブラウザから操作
- **マルチプロジェクト対応**: 複数のGitHubプロジェクトを同時管理
- **環境分離**: プロジェクトごとの完全な環境分離
- **スケーラブル**: 小規模から大規模まで対応可能

## 🏗️ アーキテクチャ

```
┌─────────────────────────────────────────────────────────┐
│                   PoppoBuilder Platform                  │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ┌─────────────┐    ┌──────────────┐    ┌──────────┐  │
│  │   Web UI    │    │  API Server  │    │ Database │  │
│  │  (React)    │───▶│   (Express)  │───▶│(SQLite3) │  │
│  └─────────────┘    └──────┬───────┘    └──────────┘  │
│                            │                            │
│  ┌─────────────────────────┴────────────────────────┐  │
│  │              Agent Controller                     │  │
│  │  ┌─────────┐  ┌─────────┐  ┌─────────┐         │  │
│  │  │ Agent 1 │  │ Agent 2 │  │ Agent N │  ...    │  │
│  │  │(Project)│  │(Project)│  │(Project)│         │  │
│  │  └─────────┘  └─────────┘  └─────────┘         │  │
│  └──────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

## 📋 実装フェーズ

### Phase 1: Platform基盤構築

#### Issue #100: PoppoBuilder Platform Server - 中央管理サーバーの実装
```markdown
## 概要
Jenkinsライクな中央管理サーバーを実装し、全てのプロジェクトをWebインターフェースから管理できるようにする。

## 要件

### 1. Platform Server
- Express.jsベースのAPIサーバー
- SQLite3データベース（プロジェクト設定、実行履歴、ユーザー管理）
- WebSocket対応（リアルタイム更新）
- RESTful API設計

### 2. データモデル
\`\`\`sql
-- プロジェクト
CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  github_owner TEXT NOT NULL,
  github_repo TEXT NOT NULL,
  working_directory TEXT,
  status TEXT DEFAULT 'active',
  created_at TIMESTAMP,
  updated_at TIMESTAMP
);

-- 環境変数
CREATE TABLE project_env_vars (
  id INTEGER PRIMARY KEY,
  project_id TEXT,
  key TEXT NOT NULL,
  value TEXT,
  encrypted BOOLEAN DEFAULT false,
  FOREIGN KEY (project_id) REFERENCES projects(id)
);

-- 実行履歴
CREATE TABLE executions (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  issue_number INTEGER,
  status TEXT,
  started_at TIMESTAMP,
  completed_at TIMESTAMP,
  logs TEXT,
  FOREIGN KEY (project_id) REFERENCES projects(id)
);

-- ユーザー管理
CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT DEFAULT 'user',
  created_at TIMESTAMP
);
\`\`\`

### 3. API エンドポイント
- `GET /api/projects` - プロジェクト一覧
- `POST /api/projects` - プロジェクト作成
- `GET /api/projects/:id` - プロジェクト詳細
- `PUT /api/projects/:id` - プロジェクト更新
- `DELETE /api/projects/:id` - プロジェクト削除
- `POST /api/projects/:id/start` - プロジェクト起動
- `POST /api/projects/:id/stop` - プロジェクト停止
- `GET /api/projects/:id/logs` - ログ取得
- `GET /api/projects/:id/env` - 環境変数取得
- `PUT /api/projects/:id/env` - 環境変数更新

### 4. 認証・認可
- JWT認証
- ロールベースアクセス制御（Admin, User, Viewer）
- APIキー管理

## 実装ファイル
- `platform/server/` - Platformサーバー
  - `index.js` - メインサーバー
  - `api/` - APIルート
  - `models/` - データモデル
  - `services/` - ビジネスロジック
  - `middleware/` - 認証等
```

#### Issue #101: PoppoBuilder Web UI - Reactベースの管理画面
```markdown
## 概要
Jenkinsのような直感的なWeb UIを実装する。

## 要件

### 1. 画面構成
- **ダッシュボード**: 全プロジェクトの状態一覧
- **プロジェクト管理**: 作成・編集・削除
- **実行管理**: タスクの実行・停止・ログ表示
- **設定管理**: 環境変数、GitHub連携、Claude設定
- **ユーザー管理**: アカウント、権限設定

### 2. UI コンポーネント
\`\`\`
platform/web/
├── src/
│   ├── pages/
│   │   ├── Dashboard.jsx
│   │   ├── Projects/
│   │   │   ├── List.jsx
│   │   │   ├── Create.jsx
│   │   │   ├── Detail.jsx
│   │   │   └── Settings.jsx
│   │   ├── Executions/
│   │   │   ├── List.jsx
│   │   │   └── Detail.jsx
│   │   └── Settings/
│   │       ├── General.jsx
│   │       ├── Users.jsx
│   │       └── System.jsx
│   ├── components/
│   │   ├── ProjectCard.jsx
│   │   ├── ExecutionLog.jsx
│   │   ├── EnvVarEditor.jsx
│   │   └── StatusIndicator.jsx
│   └── services/
│       └── api.js
\`\`\`

### 3. 機能要件
- リアルタイム更新（WebSocket）
- レスポンシブデザイン
- ダークモード対応
- 多言語対応（日本語/英語）
- キーボードショートカット

### 4. プロジェクト作成ウィザード
1. 基本情報入力（名前、GitHubリポジトリ）
2. 環境変数設定
3. Claude設定（モデル、プロンプト）
4. 実行設定（ポーリング間隔、タイムアウト）
5. 確認・作成

## 技術スタック
- React 18+
- Material-UI または Ant Design
- React Router
- Redux Toolkit（状態管理）
- Socket.io-client（WebSocket）
```

### Phase 2: Agent分離とプロジェクト隔離

#### Issue #102: PoppoBuilder Agent - プロジェクト実行エージェント
```markdown
## 概要
各プロジェクトを独立したAgentプロセスで実行し、完全な環境分離を実現する。

## 要件

### 1. Agent アーキテクチャ
\`\`\`javascript
class PoppoBuilderAgent {
  constructor(projectConfig) {
    this.projectId = projectConfig.id;
    this.workingDir = projectConfig.workingDirectory;
    this.env = this.loadEnvironment(projectConfig);
    this.processManager = new IsolatedProcessManager();
  }
  
  async start() {
    // Platform Serverに接続
    this.connectToPlatform();
    
    // プロジェクト専用の環境で実行
    process.chdir(this.workingDir);
    
    // メインループ開始
    this.startMainLoop();
  }
}
\`\`\`

### 2. プロセス分離
- プロジェクトごとの独立プロセス
- 専用のポート範囲（自動割り当て）
- メモリ・CPU制限設定可能
- クラッシュ時の自動再起動

### 3. 環境分離
- プロジェクト専用の環境変数
- 独立したファイルシステム領域
- プロジェクト専用のログディレクトリ
- 個別のデータベースファイル

### 4. Platform連携
- WebSocket経由でPlatformと通信
- ステータス報告（1分ごと）
- コマンド受信（start/stop/restart）
- ログストリーミング

## 実装ファイル
- `platform/agent/` - Agentプロセス
  - `index.js` - Agentメイン
  - `platform-client.js` - Platform通信
  - `isolated-executor.js` - 隔離実行
  - `env-manager.js` - 環境管理
```

#### Issue #103: Project Isolation - 完全なプロジェクト分離機構
```markdown
## 概要
プロジェクト間の完全な分離を実現し、セキュリティと安定性を確保する。

## 要件

### 1. ファイルシステム分離
\`\`\`
/var/poppo-builder/
├── platform/          # Platform Server
├── projects/          # プロジェクトデータ
│   ├── project-001/
│   │   ├── workspace/   # 作業ディレクトリ
│   │   ├── logs/        # ログ
│   │   ├── data/        # データベース等
│   │   └── temp/        # 一時ファイル
│   └── project-002/
└── shared/            # 共有リソース
\`\`\`

### 2. ネットワーク分離
- プロジェクトごとのポート範囲
  - project-001: 4001-4010
  - project-002: 4011-4020
- 内部通信用のUNIXソケット

### 3. リソース制限
\`\`\`javascript
{
  "resources": {
    "memory": "2GB",
    "cpu": "1.0",
    "disk": "10GB",
    "processes": 10
  }
}
\`\`\`

### 4. セキュリティ
- プロジェクト間のアクセス禁止
- 環境変数の暗号化保存
- APIキーの安全な管理
```

### Phase 3: 環境変数とシークレット管理

#### Issue #104: Environment Manager - 環境変数の統合管理
```markdown
## 概要
プロジェクトごとの環境変数を安全かつ効率的に管理する。

## 要件

### 1. 環境変数管理UI
- Web UIから環境変数を設定
- 変数のグループ化（開発/本番）
- 継承機能（グローバル→プロジェクト）
- 変数の暗号化表示

### 2. シークレット管理
- APIキーの暗号化保存
- ローテーション機能
- アクセスログ
- 有効期限管理

### 3. 変数の種類
- **グローバル変数**: 全プロジェクト共通
- **プロジェクト変数**: 特定プロジェクト専用
- **ランタイム変数**: 実行時に動的生成

### 4. 環境変数テンプレート
\`\`\`javascript
{
  "templates": {
    "github-project": {
      "GITHUB_TOKEN": "${secrets.github_token}",
      "GITHUB_OWNER": "${project.github_owner}",
      "GITHUB_REPO": "${project.github_repo}"
    },
    "claude-api": {
      "ANTHROPIC_API_KEY": "${secrets.anthropic_key}",
      "CLAUDE_MODEL": "claude-3-opus-20240229"
    }
  }
}
\`\`\`

## セキュリティ機能
- AES-256暗号化
- キー管理サービス統合
- 監査ログ
- 最小権限の原則
```

### Phase 4: スケーラビリティと高可用性

#### Issue #105: Scalability - 水平スケーリング対応
```markdown
## 概要
複数のAgentノードに負荷分散し、大規模運用に対応する。

## 要件

### 1. Agent Pool管理
- 複数Agentノードの管理
- 動的なAgent追加/削除
- ヘルスチェック
- 自動フェイルオーバー

### 2. ロードバランシング
- プロジェクトの負荷分散
- リソース使用率に基づく配置
- 地理的分散対応

### 3. 高可用性
- Platform Serverの冗長化
- データベースレプリケーション
- 自動バックアップ
- 災害復旧計画

### 4. モニタリング
- Prometheus連携
- Grafanaダッシュボード
- アラート設定
- SLI/SLO管理
```

### Phase 5: 移行とデプロイメント

#### Issue #106: Migration Tool - 既存プロジェクトの移行
```markdown
## 概要
現在のPoppoBuilder Suiteプロジェクトを新Platform環境に移行する。

## 要件

### 1. 移行ツール
\`\`\`bash
poppo-migrate analyze     # 現状分析
poppo-migrate prepare     # 移行準備
poppo-migrate execute     # 移行実行
poppo-migrate verify      # 移行検証
\`\`\`

### 2. データ移行
- Issue処理履歴
- ログファイル
- 設定ファイル
- 環境変数

### 3. 互換性維持
- 既存APIの互換レイヤー
- 設定ファイルの自動変換
- 段階的移行サポート
```

#### Issue #107: Deployment - インストーラーとデプロイメント
```markdown
## 概要
ワンクリックインストールとアップデート機能を提供する。

## 要件

### 1. インストーラー
\`\`\`bash
# ワンライナーインストール
curl -fsSL https://poppobuilder.dev/install.sh | bash

# または
npm install -g @poppobuilder/platform
poppo-platform init
\`\`\`

### 2. Docker対応
\`\`\`yaml
version: '3.8'
services:
  platform:
    image: poppobuilder/platform:latest
    ports:
      - "3000:3000"
    volumes:
      - ./data:/data
      - ./projects:/projects
  
  agent:
    image: poppobuilder/agent:latest
    scale: 3
    environment:
      - PLATFORM_URL=http://platform:3000
\`\`\`

### 3. クラウド対応
- AWS/GCP/Azure テンプレート
- Kubernetes Helm Chart
- Terraform モジュール

### 4. アップデート機能
- Web UIからアップデート実行
- ローリングアップデート
- ロールバック機能
- アップデート通知
```

## 📅 実装スケジュール

### 2025年Q1
- Phase 1: Platform基盤構築
- Phase 2: Agent分離（一部）

### 2025年Q2
- Phase 2: Agent分離（完了）
- Phase 3: 環境変数管理
- Phase 4: スケーラビリティ（開始）

### 2025年Q3
- Phase 4: スケーラビリティ（完了）
- Phase 5: 移行ツール
- ベータリリース

### 2025年Q4
- Phase 5: デプロイメント
- 正式リリース
- ドキュメント整備

## 🎯 成功指標

1. **使いやすさ**
   - セットアップ時間: 5分以内
   - プロジェクト追加: 1分以内
   - 学習曲線: 30分で基本操作習得

2. **パフォーマンス**
   - 100プロジェクト同時実行
   - 1000タスク/日の処理能力
   - 99.9%の可用性

3. **採用率**
   - 1000+ GitHub Stars
   - 100+ アクティブユーザー
   - 10+ エンタープライズ導入

## 🚀 将来の拡張

- **マーケットプレイス**: プラグイン・テンプレート共有
- **SaaS版**: クラウドホスティングサービス
- **AI最適化**: 実行パターンの学習と最適化
- **統合強化**: CI/CD、モニタリングツールとの連携

---

このアップグレード計画により、PoppoBuilder SuiteはJenkinsのような企業レベルの自動化プラットフォームに進化し、個人開発者から大規模チームまで幅広く利用できるツールとなります。