# プラグイン開発ガイド

PoppoBuilder Suite のプラグインシステムを使用して、機能を拡張する方法を説明します。

## 🎯 プラグインシステム概要

PoppoBuilder のプラグインシステムは、コア機能に影響を与えることなく新しい機能を追加できる柔軟な拡張メカニズムを提供します。

### プラグインの基本構造

```javascript
// plugins/my-plugin/index.js
module.exports = {
  // プラグインメタデータ
  name: 'my-plugin',
  version: '1.0.0',
  description: 'My awesome PoppoBuilder plugin',
  author: 'Your Name',
  
  // 初期化関数
  initialize(context) {
    this.logger = context.logger;
    this.config = context.config.plugins['my-plugin'] || {};
    this.setupPlugin();
  },
  
  // フックハンドラー
  hooks: {
    beforeIssueProcess: async (data) => {
      // Issue処理前のロジック
      return data;
    }
  },
  
  // イベントハンドラー
  events: {
    'system.ready': function() {
      this.logger.info('My plugin is ready!');
    }
  },
  
  // クリーンアップ
  destroy() {
    // リソースの解放
  }
};
```

## 📁 プラグインの構成

### ディレクトリ構造

```
plugins/
└── my-plugin/
    ├── index.js           # メインエントリーポイント
    ├── package.json       # プラグインの依存関係
    ├── config.schema.json # 設定スキーマ
    ├── README.md          # プラグインドキュメント
    ├── lib/              # プラグインのソースコード
    │   ├── handlers.js
    │   └── utils.js
    └── test/             # テストファイル
        └── plugin.test.js
```

### package.json の例

```json
{
  "name": "poppo-plugin-example",
  "version": "1.0.0",
  "description": "Example plugin for PoppoBuilder",
  "main": "index.js",
  "keywords": ["poppo-plugin"],
  "author": "Your Name",
  "license": "MIT",
  "peerDependencies": {
    "poppo-builder": "^1.0.0"
  },
  "dependencies": {
    "axios": "^1.6.0"
  },
  "poppoPlugin": {
    "displayName": "Example Plugin",
    "category": "utility",
    "configSchema": "./config.schema.json"
  }
}
```

## 🔧 プラグインAPI

### Context オブジェクト

初期化時に提供される context オブジェクト：

```javascript
{
  // ロガーインスタンス
  logger: Logger,
  
  // 設定オブジェクト
  config: Config,
  
  // イベントエミッター
  events: EventEmitter,
  
  // データストア
  store: DataStore,
  
  // ユーティリティ
  utils: {
    github: GitHubClient,
    claude: ClaudeClient,
    http: HttpClient
  },
  
  // プラグイン間通信
  plugins: PluginManager,
  
  // システム情報
  system: {
    version: string,
    platform: string,
    nodeVersion: string
  }
}
```

### データストア API

```javascript
// プラグイン専用のデータストア
class PluginDataStore {
  // データの保存
  async set(key, value, options = {}) {
    const data = {
      value,
      timestamp: Date.now(),
      ttl: options.ttl || null
    };
    await this.store.put(`${this.namespace}:${key}`, data);
  }
  
  // データの取得
  async get(key) {
    const data = await this.store.get(`${this.namespace}:${key}`);
    if (data && data.ttl && Date.now() > data.timestamp + data.ttl) {
      await this.delete(key);
      return null;
    }
    return data?.value;
  }
  
  // データの削除
  async delete(key) {
    await this.store.delete(`${this.namespace}:${key}`);
  }
  
  // 複数データの取得
  async list(pattern = '*') {
    const keys = await this.store.keys(`${this.namespace}:${pattern}`);
    return Promise.all(keys.map(key => this.get(key)));
  }
}
```

## 📝 実装例

### 1. Slack 通知プラグイン

```javascript
// plugins/slack-notifier/index.js
const { WebClient } = require('@slack/web-api');

module.exports = {
  name: 'slack-notifier',
  version: '1.0.0',
  
  initialize(context) {
    this.logger = context.logger;
    this.config = context.config.plugins['slack-notifier'];
    
    if (!this.config?.token) {
      this.logger.warn('Slack token not configured');
      return;
    }
    
    this.slack = new WebClient(this.config.token);
    this.channel = this.config.channel || '#general';
  },
  
  hooks: {
    afterIssueProcess: async (data) => {
      const { issue, result } = data;
      
      if (result.success) {
        await this.sendNotification({
          text: `✅ Issue #${issue.number} processed successfully`,
          attachments: [{
            color: 'good',
            fields: [
              { title: 'Title', value: issue.title, short: true },
              { title: 'Repository', value: issue.repository, short: true }
            ]
          }]
        });
      }
      
      return data;
    }
  },
  
  events: {
    'error': async function(error) {
      if (error.severity === 'critical') {
        await this.sendNotification({
          text: `🚨 Critical Error: ${error.message}`,
          attachments: [{
            color: 'danger',
            fields: [
              { title: 'Error Type', value: error.name },
              { title: 'Stack Trace', value: '```' + error.stack + '```' }
            ]
          }]
        });
      }
    }
  },
  
  async sendNotification(message) {
    try {
      await this.slack.chat.postMessage({
        channel: this.channel,
        ...message
      });
    } catch (error) {
      this.logger.error('Failed to send Slack notification:', error);
    }
  }
};
```

### 2. カスタムレート制限プラグイン

```javascript
// plugins/rate-limiter/index.js
module.exports = {
  name: 'advanced-rate-limiter',
  version: '1.0.0',
  
  initialize(context) {
    this.store = context.store;
    this.config = context.config.plugins['advanced-rate-limiter'] || {
      windowSize: 60000,  // 1分
      maxRequests: 30
    };
    this.requests = new Map();
  },
  
  hooks: {
    beforeApiCall: async (data) => {
      const { api, endpoint } = data;
      const key = `${api}:${endpoint}`;
      const now = Date.now();
      
      // 古いエントリをクリーンアップ
      const requests = this.requests.get(key) || [];
      const validRequests = requests.filter(
        timestamp => now - timestamp < this.config.windowSize
      );
      
      // レート制限チェック
      if (validRequests.length >= this.config.maxRequests) {
        const oldestRequest = Math.min(...validRequests);
        const waitTime = this.config.windowSize - (now - oldestRequest);
        
        throw new Error(`Rate limit exceeded. Please wait ${waitTime}ms`);
      }
      
      // リクエストを記録
      validRequests.push(now);
      this.requests.set(key, validRequests);
      
      return data;
    }
  },
  
  // 定期的なクリーンアップ
  startCleanupTimer() {
    setInterval(() => {
      const now = Date.now();
      for (const [key, requests] of this.requests.entries()) {
        const validRequests = requests.filter(
          timestamp => now - timestamp < this.config.windowSize
        );
        if (validRequests.length === 0) {
          this.requests.delete(key);
        } else {
          this.requests.set(key, validRequests);
        }
      }
    }, this.config.windowSize);
  }
};
```

### 3. Issue 自動ラベリングプラグイン

```javascript
// plugins/auto-labeler/index.js
module.exports = {
  name: 'auto-labeler',
  version: '1.0.0',
  
  initialize(context) {
    this.github = context.utils.github;
    this.config = context.config.plugins['auto-labeler'] || {};
    this.rules = this.loadRules();
  },
  
  hooks: {
    afterIssueCreated: async (data) => {
      const { issue } = data;
      const labels = await this.determineLabels(issue);
      
      if (labels.length > 0) {
        await this.github.addLabels(issue.number, labels);
        this.logger.info(`Added labels to issue #${issue.number}:`, labels);
      }
      
      return data;
    }
  },
  
  loadRules() {
    return this.config.rules || [
      {
        pattern: /bug|error|issue|problem/i,
        labels: ['bug']
      },
      {
        pattern: /feature|enhancement|request/i,
        labels: ['enhancement']
      },
      {
        pattern: /doc|document|readme/i,
        labels: ['documentation']
      },
      {
        pattern: /test|spec|unit/i,
        labels: ['test']
      }
    ];
  },
  
  async determineLabels(issue) {
    const labels = new Set();
    const text = `${issue.title} ${issue.body}`;
    
    // ルールベースのマッチング
    for (const rule of this.rules) {
      if (rule.pattern.test(text)) {
        rule.labels.forEach(label => labels.add(label));
      }
    }
    
    // AI ベースの分類（オプション）
    if (this.config.useAI) {
      const aiLabels = await this.classifyWithAI(text);
      aiLabels.forEach(label => labels.add(label));
    }
    
    return Array.from(labels);
  }
};
```

## 🧪 プラグインのテスト

### ユニットテスト

```javascript
// test/plugin.test.js
const { describe, it, expect, beforeEach } = require('@jest/globals');
const MyPlugin = require('../index');

describe('MyPlugin', () => {
  let plugin;
  let mockContext;
  
  beforeEach(() => {
    mockContext = {
      logger: {
        info: jest.fn(),
        error: jest.fn()
      },
      config: {
        plugins: {
          'my-plugin': {
            enabled: true
          }
        }
      },
      store: {
        set: jest.fn(),
        get: jest.fn()
      }
    };
    
    plugin = Object.create(MyPlugin);
    plugin.initialize(mockContext);
  });
  
  describe('hooks', () => {
    it('should process beforeIssueProcess hook', async () => {
      const data = { issue: { number: 123 } };
      const result = await plugin.hooks.beforeIssueProcess(data);
      
      expect(result).toBeDefined();
      expect(mockContext.logger.info).toHaveBeenCalled();
    });
  });
  
  describe('events', () => {
    it('should handle system.ready event', () => {
      plugin.events['system.ready'].call(plugin);
      
      expect(mockContext.logger.info).toHaveBeenCalledWith(
        expect.stringContaining('ready')
      );
    });
  });
});
```

### 統合テスト

```javascript
// test/integration.test.js
const PoppoBuilder = require('poppo-builder');
const MyPlugin = require('../index');

describe('MyPlugin Integration', () => {
  let poppo;
  
  beforeAll(async () => {
    poppo = new PoppoBuilder({
      plugins: [MyPlugin]
    });
    await poppo.initialize();
  });
  
  afterAll(async () => {
    await poppo.shutdown();
  });
  
  it('should integrate with PoppoBuilder', async () => {
    // プラグインが登録されているか確認
    expect(poppo.plugins.has('my-plugin')).toBe(true);
    
    // Issue処理をシミュレート
    const result = await poppo.processIssue({
      number: 123,
      title: 'Test Issue'
    });
    
    expect(result.success).toBe(true);
  });
});
```

## 📦 プラグインの配布

### NPM パッケージとして公開

```bash
# パッケージの準備
npm init
npm test
npm version patch

# NPMに公開
npm publish --access public

# ユーザーのインストール方法
npm install poppo-plugin-example
```

### プラグインレジストリへの登録

```json
// plugins-registry.json
{
  "plugins": [
    {
      "name": "poppo-plugin-example",
      "version": "1.0.0",
      "description": "Example plugin",
      "npm": "poppo-plugin-example",
      "repository": "https://github.com/user/poppo-plugin-example",
      "compatibility": {
        "poppo-builder": ">=1.0.0"
      },
      "tags": ["utility", "example"]
    }
  ]
}
```

## 🔒 セキュリティガイドライン

### 1. 入力検証

```javascript
// 常に入力を検証
hooks: {
  beforeIssueProcess: async (data) => {
    // 入力検証
    if (!data.issue || typeof data.issue.number !== 'number') {
      throw new Error('Invalid issue data');
    }
    
    // XSS対策
    data.issue.title = this.sanitizeHtml(data.issue.title);
    data.issue.body = this.sanitizeHtml(data.issue.body);
    
    return data;
  }
}
```

### 2. 権限の最小化

```javascript
// 必要最小限の権限のみ要求
initialize(context) {
  // 読み取り専用アクセス
  this.readOnlyGithub = context.utils.github.readonly();
  
  // 特定のスコープのみ
  this.limitedStore = context.store.scoped('my-plugin');
}
```

### 3. エラーハンドリング

```javascript
// 適切なエラーハンドリング
async processData(data) {
  try {
    return await this.riskyOperation(data);
  } catch (error) {
    // 機密情報を含まないエラーメッセージ
    this.logger.error('Operation failed', {
      error: error.message,
      code: error.code
    });
    
    // エラーを再スロー（スタックトレースなし）
    throw new Error('Processing failed');
  }
}
```

## 🎯 ベストプラクティス

### 1. プラグインの命名

```javascript
// 良い例: 明確で説明的な名前
'slack-notifier'
'github-auto-labeler'
'performance-monitor'

// 悪い例: 曖昧または一般的すぎる名前
'plugin1'
'helper'
'utils'
```

### 2. 設定の検証

```javascript
// config.schema.json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "required": ["apiKey"],
  "properties": {
    "apiKey": {
      "type": "string",
      "minLength": 10
    },
    "timeout": {
      "type": "number",
      "minimum": 1000,
      "maximum": 60000,
      "default": 5000
    },
    "retries": {
      "type": "integer",
      "minimum": 0,
      "maximum": 5,
      "default": 3
    }
  }
}
```

### 3. パフォーマンス考慮

```javascript
// 重い処理は非同期で実行
events: {
  'issue.created': function(issue) {
    // ブロッキングを避ける
    setImmediate(() => {
      this.processInBackground(issue);
    });
  }
}

// キャッシュの活用
async getData(key) {
  const cached = await this.cache.get(key);
  if (cached) return cached;
  
  const data = await this.fetchData(key);
  await this.cache.set(key, data, { ttl: 300000 }); // 5分
  return data;
}
```

### 4. ログの適切な使用

```javascript
// ログレベルの使い分け
this.logger.debug('Detailed information for debugging');
this.logger.info('General information');
this.logger.warn('Warning: non-critical issue');
this.logger.error('Error occurred:', error);

// 構造化ログ
this.logger.info('Processing completed', {
  duration: endTime - startTime,
  issueNumber: issue.number,
  resultCount: results.length
});
```

プラグイン開発により、PoppoBuilder Suite を組織の特定のニーズに合わせてカスタマイズできます。上記のガイドラインに従って、安全で効率的なプラグインを作成してください。