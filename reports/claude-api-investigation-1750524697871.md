# Claude API呼び出し調査レポート

## 📊 調査概要

- **調査日時**: 2025-06-21T16:51:37.865Z
- **対象プロジェクト**: /Volumes/PoppoSSD2T/Projects/ClaudeCodeProjects/AIBuildSystem/PoppoBuilderSuite
- **総合リスクレベル**: **CRITICAL**

## 🎯 調査結果サマリー

| 項目 | 件数 |
|------|------|
| 🚨 重要度: CRITICAL | 2 |
| ⚠️ 重要度: HIGH | 1 |
| 📝 重要度: MEDIUM | 34 |
| ✅ Claude CLI使用 | 732 |
| 🔍 疑わしいパターン | 324 |
| 📦 関連ライブラリ | 0 |

## 🚨 直接的なClaude API呼び出し


### HTTP Client to Anthropic (HIGH)
- **ファイル**: `scripts/claude-api-investigation.js`
- **行番号**: 150
- **内容**: `fetch.*anthropic|axios.*anthropic|request.*anthropic`
- **コンテキスト**:
```
148: },
149: {
150: pattern: /fetch.*anthropic|axios.*anthropic|request.*anthropic/gi,
151: type: 'HTTP Client to Anthropic',
152: severity: 'HIGH'
```

### API Key Environment Variable (MEDIUM)
- **ファイル**: `scripts/claude-api-investigation.js`
- **行番号**: 162
- **内容**: `ANTHROPIC_API_KEY`
- **コンテキスト**:
```
160: },
161: {
162: pattern: /ANTHROPIC_API_KEY|CLAUDE_API_KEY/gi,
163: type: 'API Key Environment Variable',
164: severity: 'MEDIUM'
```

### API Key Environment Variable (MEDIUM)
- **ファイル**: `scripts/claude-api-investigation.js`
- **行番号**: 162
- **内容**: `CLAUDE_API_KEY`
- **コンテキスト**:
```
160: },
161: {
162: pattern: /ANTHROPIC_API_KEY|CLAUDE_API_KEY/gi,
163: type: 'API Key Environment Variable',
164: severity: 'MEDIUM'
```

### API Key Environment Variable (MEDIUM)
- **ファイル**: `test/helpers/test-environment-check.js`
- **行番号**: 43
- **内容**: `CLAUDE_API_KEY`
- **コンテキスト**:
```
41: 'NODE_ENV': process.env.NODE_ENV,
42: 'GITHUB_TOKEN': process.env.GITHUB_TOKEN ? '設定済み' : '未設定',
43: 'CLAUDE_API_KEY': process.env.CLAUDE_API_KEY ? '設定済み' : '未設定',
44: 'REDIS_HOST': process.env.REDIS_HOST || 'localhost',
45: 'REDIS_PORT': process.env.REDIS_PORT || '6379',
```

### API Key Environment Variable (MEDIUM)
- **ファイル**: `test/helpers/test-environment-check.js`
- **行番号**: 43
- **内容**: `CLAUDE_API_KEY`
- **コンテキスト**:
```
41: 'NODE_ENV': process.env.NODE_ENV,
42: 'GITHUB_TOKEN': process.env.GITHUB_TOKEN ? '設定済み' : '未設定',
43: 'CLAUDE_API_KEY': process.env.CLAUDE_API_KEY ? '設定済み' : '未設定',
44: 'REDIS_HOST': process.env.REDIS_HOST || 'localhost',
45: 'REDIS_PORT': process.env.REDIS_PORT || '6379',
```

### API Key Environment Variable (MEDIUM)
- **ファイル**: `lib/templates/template-manager.js`
- **行番号**: 95
- **内容**: `CLAUDE_API_KEY`
- **コンテキスト**:
```
93: },
94: claude: {
95: apiKey: '{{CLAUDE_API_KEY}}',
96: model: 'claude-3-opus-20240229',
97: timeout: 300000,
```

### API Key Environment Variable (MEDIUM)
- **ファイル**: `lib/templates/template-manager.js`
- **行番号**: 95
- **内容**: `CLAUDE_API_KEY`
- **コンテキスト**:
```
93: },
94: claude: {
95: apiKey: '{{CLAUDE_API_KEY}}',
96: model: 'claude-3-opus-20240229',
97: timeout: 300000,
```

### API Key Environment Variable (MEDIUM)
- **ファイル**: `lib/templates/template-manager.js`
- **行番号**: 95
- **内容**: `CLAUDE_API_KEY`
- **コンテキスト**:
```
93: },
94: claude: {
95: apiKey: '{{CLAUDE_API_KEY}}',
96: model: 'claude-3-opus-20240229',
97: timeout: 300000,
```

### API Key Environment Variable (MEDIUM)
- **ファイル**: `lib/templates/template-manager.js`
- **行番号**: 95
- **内容**: `CLAUDE_API_KEY`
- **コンテキスト**:
```
93: },
94: claude: {
95: apiKey: '{{CLAUDE_API_KEY}}',
96: model: 'claude-3-opus-20240229',
97: timeout: 300000,
```

### API Key Environment Variable (MEDIUM)
- **ファイル**: `lib/commands/init.js`
- **行番号**: 204
- **内容**: `CLAUDE_API_KEY`
- **コンテキスト**:
```
202: config.claude.apiKey = await question('Claude API key (will be stored securely): ');
203: } else {
204: console.log(chalk.yellow('You will need to set CLAUDE_API_KEY environment variable later.'));
205: }
206: }
```

### API Key Environment Variable (MEDIUM)
- **ファイル**: `lib/commands/init.js`
- **行番号**: 204
- **内容**: `CLAUDE_API_KEY`
- **コンテキスト**:
```
202: config.claude.apiKey = await question('Claude API key (will be stored securely): ');
203: } else {
204: console.log(chalk.yellow('You will need to set CLAUDE_API_KEY environment variable later.'));
205: }
206: }
```

### API Key Environment Variable (MEDIUM)
- **ファイル**: `lib/commands/init.js`
- **行番号**: 204
- **内容**: `CLAUDE_API_KEY`
- **コンテキスト**:
```
202: config.claude.apiKey = await question('Claude API key (will be stored securely): ');
203: } else {
204: console.log(chalk.yellow('You will need to set CLAUDE_API_KEY environment variable later.'));
205: }
206: }
```

### API Key Environment Variable (MEDIUM)
- **ファイル**: `lib/commands/init.js`
- **行番号**: 204
- **内容**: `CLAUDE_API_KEY`
- **コンテキスト**:
```
202: config.claude.apiKey = await question('Claude API key (will be stored securely): ');
203: } else {
204: console.log(chalk.yellow('You will need to set CLAUDE_API_KEY environment variable later.'));
205: }
206: }
```

### API Key Environment Variable (MEDIUM)
- **ファイル**: `lib/commands/init.js`
- **行番号**: 204
- **内容**: `CLAUDE_API_KEY`
- **コンテキスト**:
```
202: config.claude.apiKey = await question('Claude API key (will be stored securely): ');
203: } else {
204: console.log(chalk.yellow('You will need to set CLAUDE_API_KEY environment variable later.'));
205: }
206: }
```

### API Key Environment Variable (MEDIUM)
- **ファイル**: `lib/commands/init.js`
- **行番号**: 471
- **内容**: `claude_api_key`
- **コンテキスト**:
```
469: if (config.claude?.enabled && !config.claude.apiKey) {
470: console.log('2. Set your Claude API key:');
471: console.log(chalk.cyan('   export CLAUDE_API_KEY=your_claude_api_key'));
472: console.log();
473: }
```

### API Key Environment Variable (MEDIUM)
- **ファイル**: `lib/commands/init.js`
- **行番号**: 204
- **内容**: `CLAUDE_API_KEY`
- **コンテキスト**:
```
202: config.claude.apiKey = await question('Claude API key (will be stored securely): ');
203: } else {
204: console.log(chalk.yellow('You will need to set CLAUDE_API_KEY environment variable later.'));
205: }
206: }
```

### API Key Environment Variable (MEDIUM)
- **ファイル**: `lib/commands/init.js`
- **行番号**: 204
- **内容**: `CLAUDE_API_KEY`
- **コンテキスト**:
```
202: config.claude.apiKey = await question('Claude API key (will be stored securely): ');
203: } else {
204: console.log(chalk.yellow('You will need to set CLAUDE_API_KEY environment variable later.'));
205: }
206: }
```

### API Key Environment Variable (MEDIUM)
- **ファイル**: `lib/commands/init.js`
- **行番号**: 204
- **内容**: `CLAUDE_API_KEY`
- **コンテキスト**:
```
202: config.claude.apiKey = await question('Claude API key (will be stored securely): ');
203: } else {
204: console.log(chalk.yellow('You will need to set CLAUDE_API_KEY environment variable later.'));
205: }
206: }
```

### API Key Environment Variable (MEDIUM)
- **ファイル**: `lib/commands/init.js`
- **行番号**: 204
- **内容**: `CLAUDE_API_KEY`
- **コンテキスト**:
```
202: config.claude.apiKey = await question('Claude API key (will be stored securely): ');
203: } else {
204: console.log(chalk.yellow('You will need to set CLAUDE_API_KEY environment variable later.'));
205: }
206: }
```

### API Key Environment Variable (MEDIUM)
- **ファイル**: `lib/commands/init.js`
- **行番号**: 204
- **内容**: `CLAUDE_API_KEY`
- **コンテキスト**:
```
202: config.claude.apiKey = await question('Claude API key (will be stored securely): ');
203: } else {
204: console.log(chalk.yellow('You will need to set CLAUDE_API_KEY environment variable later.'));
205: }
206: }
```

### API Key Environment Variable (MEDIUM)
- **ファイル**: `lib/commands/init.js`
- **行番号**: 471
- **内容**: `claude_api_key`
- **コンテキスト**:
```
469: if (config.claude?.enabled && !config.claude.apiKey) {
470: console.log('2. Set your Claude API key:');
471: console.log(chalk.cyan('   export CLAUDE_API_KEY=your_claude_api_key'));
472: console.log();
473: }
```

### API Key Environment Variable (MEDIUM)
- **ファイル**: `lib/templates/definitions/minimal/config/config.json`
- **行番号**: 8
- **内容**: `CLAUDE_API_KEY`
- **コンテキスト**:
```
6: },
7: "claude": {
8: "apiKey": "{{CLAUDE_API_KEY}}",
9: "model": "claude-3-opus-20240229"
10: },
```

### API Key Environment Variable (MEDIUM)
- **ファイル**: `lib/templates/definitions/default/config/config.json`
- **行番号**: 8
- **内容**: `CLAUDE_API_KEY`
- **コンテキスト**:
```
6: },
7: "claude": {
8: "apiKey": "{{CLAUDE_API_KEY}}",
9: "model": "claude-3-opus-20240229",
10: "timeout": 300000,
```

### API Key Environment Variable (MEDIUM)
- **ファイル**: `lib/templates/definitions/advanced/config/config.json`
- **行番号**: 8
- **内容**: `CLAUDE_API_KEY`
- **コンテキスト**:
```
6: },
7: "claude": {
8: "apiKey": "{{CLAUDE_API_KEY}}",
9: "model": "claude-3-opus-20240229",
10: "timeout": 300000,
```

### API Key Environment Variable (MEDIUM)
- **ファイル**: `README-npm.md`
- **行番号**: 45
- **内容**: `CLAUDE_API_KEY`
- **コンテキスト**:
```
43: ```bash
44: export GITHUB_TOKEN=your_github_token
45: export CLAUDE_API_KEY=your_claude_api_key
46: ```
47: 
```

### API Key Environment Variable (MEDIUM)
- **ファイル**: `README-npm.md`
- **行番号**: 45
- **内容**: `claude_api_key`
- **コンテキスト**:
```
43: ```bash
44: export GITHUB_TOKEN=your_github_token
45: export CLAUDE_API_KEY=your_claude_api_key
46: ```
47: 
```

### API Key Environment Variable (MEDIUM)
- **ファイル**: `README-npm.md`
- **行番号**: 45
- **内容**: `CLAUDE_API_KEY`
- **コンテキスト**:
```
43: ```bash
44: export GITHUB_TOKEN=your_github_token
45: export CLAUDE_API_KEY=your_claude_api_key
46: ```
47: 
```

### API Key Environment Variable (MEDIUM)
- **ファイル**: `README-npm.md`
- **行番号**: 45
- **内容**: `claude_api_key`
- **コンテキスト**:
```
43: ```bash
44: export GITHUB_TOKEN=your_github_token
45: export CLAUDE_API_KEY=your_claude_api_key
46: ```
47: 
```

### API Key Environment Variable (MEDIUM)
- **ファイル**: `docs/troubleshooting.md`
- **行番号**: 158
- **内容**: `CLAUDE_API_KEY`
- **コンテキスト**:
```
156: ```bash
157: # 環境変数を確認
158: echo $CLAUDE_API_KEY
159: 
160: # CLIの設定を確認
```

### API Key Environment Variable (MEDIUM)
- **ファイル**: `docs/templates.md`
- **行番号**: 94
- **内容**: `CLAUDE_API_KEY`
- **コンテキスト**:
```
92: - `{{GITHUB_REPO}}` - GitHubリポジトリ名
93: - `{{GITHUB_TOKEN}}` - GitHubトークン
94: - `{{CLAUDE_API_KEY}}` - Claude APIキー
95: - `{{DASHBOARD_PASSWORD}}` - ダッシュボードパスワード
96: - `{{DISCORD_WEBHOOK_URL}}` - Discord Webhook URL
```

### Anthropic API Key (CRITICAL)
- **ファイル**: `docs/best-practices.md`
- **行番号**: 119
- **内容**: `sk-ant-xxxxxxxxxxxx`
- **コンテキスト**:
```
117: # 環境変数で管理（.envファイルは.gitignoreに追加）
118: GITHUB_TOKEN=ghp_xxxxxxxxxxxx
119: CLAUDE_API_KEY=sk-ant-xxxxxxxxxxxx
120: 
121: # 本番環境では環境変数を暗号化
```

### Anthropic API Key (CRITICAL)
- **ファイル**: `docs/best-practices.md`
- **行番号**: 119
- **内容**: `sk-ant-xxxxxxxxxxxx`
- **コンテキスト**:
```
117: # 環境変数で管理（.envファイルは.gitignoreに追加）
118: GITHUB_TOKEN=ghp_xxxxxxxxxxxx
119: CLAUDE_API_KEY=sk-ant-xxxxxxxxxxxx
120: 
121: # 本番環境では環境変数を暗号化
```

### API Key Environment Variable (MEDIUM)
- **ファイル**: `docs/best-practices.md`
- **行番号**: 119
- **内容**: `CLAUDE_API_KEY`
- **コンテキスト**:
```
117: # 環境変数で管理（.envファイルは.gitignoreに追加）
118: GITHUB_TOKEN=ghp_xxxxxxxxxxxx
119: CLAUDE_API_KEY=sk-ant-xxxxxxxxxxxx
120: 
121: # 本番環境では環境変数を暗号化
```

### API Key Environment Variable (MEDIUM)
- **ファイル**: `docs/features/testing-guide.md`
- **行番号**: 553
- **内容**: `CLAUDE_API_KEY`
- **コンテキスト**:
```
551: TEST_TIMEOUT=30000
552: GITHUB_TOKEN=test-token
553: CLAUDE_API_KEY=test-key
554: ```
555: 
```

### API Key Environment Variable (MEDIUM)
- **ファイル**: `docs/api/cli-reference.md`
- **行番号**: 542
- **内容**: `CLAUDE_API_KEY`
- **コンテキスト**:
```
540: | `PORT` | ダッシュボードポート | `3001` |
541: | `GITHUB_TOKEN` | GitHub認証トークン | - |
542: | `CLAUDE_API_KEY` | Claude APIキー | - |
543: 
544: ## 🎯 使用例とベストプラクティス
```

### API Key Environment Variable (MEDIUM)
- **ファイル**: `docs/implementation-history/issues/issue-152-init-command.md`
- **行番号**: 179
- **内容**: `CLAUDE_API_KEY`
- **コンテキスト**:
```
177: 
178: 2. Set your Claude API key:
179: export CLAUDE_API_KEY=your_claude_api_key
180: 
181: 3. Start PoppoBuilder:
```

### API Key Environment Variable (MEDIUM)
- **ファイル**: `docs/implementation-history/issues/issue-152-init-command.md`
- **行番号**: 179
- **内容**: `claude_api_key`
- **コンテキスト**:
```
177: 
178: 2. Set your Claude API key:
179: export CLAUDE_API_KEY=your_claude_api_key
180: 
181: 3. Start PoppoBuilder:
```


## ✅ Claude CLI使用箇所


- **ファイル**: `test/test-rate-limiting.js` (行: 100)
- **タイプ**: Claude CLI Command
- **内容**: `Claude API`

- **ファイル**: `test/test-rate-limiting.js` (行: 101)
- **タイプ**: Claude CLI Path Reference
- **内容**: `.claude`

- **ファイル**: `test/test-multi-logger-integration.js` (行: 206)
- **タイプ**: Claude CLI Command
- **内容**: `Claude Code`

- **ファイル**: `test/test-multi-logger-integration.js` (行: 206)
- **タイプ**: Claude CLI Path Reference
- **内容**: `/claude`

- **ファイル**: `test/test-independent-process.js` (行: 36)
- **タイプ**: Claude CLI Path Reference
- **内容**: `.claude`

- **ファイル**: `test/test-emergency-stop.js` (行: 4)
- **タイプ**: Claude CLI Command
- **内容**: `Claude API`

- **ファイル**: `test/test-config-loader.js` (行: 101)
- **タイプ**: Claude CLI Path Reference
- **内容**: `.claude`

- **ファイル**: `test/test-config-loader.js` (行: 101)
- **タイプ**: Claude CLI Path Reference
- **内容**: `.claude`

- **ファイル**: `test/test-ccla-phase2.js` (行: 138)
- **タイプ**: Claude CLI Command
- **内容**: `Claude API`

- **ファイル**: `test/simple-functionality.test.js` (行: 77)
- **タイプ**: Claude CLI Path Reference
- **内容**: `.claude`


... 他 722 件

## 📦 依存関係ライブラリ

✅ Claude/Anthropic関連ライブラリは見つかりませんでした。

## 🔍 疑わしいパターン


- **ファイル**: `test/test-rate-limiting.js` (行: 100)
- **タイプ**: Claude API Reference
- **リスク**: MEDIUM
- **内容**: `Claude API`

- **ファイル**: `test/test-emergency-stop.js` (行: 4)
- **タイプ**: Claude API Reference
- **リスク**: MEDIUM
- **内容**: `Claude API`

- **ファイル**: `test/test-ccla-phase2.js` (行: 138)
- **タイプ**: Claude API Reference
- **リスク**: MEDIUM
- **内容**: `Claude API`

- **ファイル**: `test/pr-command.test.js` (行: 126)
- **タイプ**: Claude Response Pattern
- **リスク**: LOW
- **内容**: `ClaudeResponse`

- **ファイル**: `test/pr-command.test.js` (行: 140)
- **タイプ**: Claude Response Pattern
- **リスク**: LOW
- **内容**: `ClaudeResponse(response`

- **ファイル**: `test/pr-command.test.js` (行: 140)
- **タイプ**: Claude Response Pattern
- **リスク**: LOW
- **内容**: `ClaudeResponse(response`

- **ファイル**: `test/pr-command.test.js` (行: 140)
- **タイプ**: Claude Response Pattern
- **リスク**: LOW
- **内容**: `ClaudeResponse(response`

- **ファイル**: `test/notification-integration.test.js` (行: 546)
- **タイプ**: Claude API Reference
- **リスク**: MEDIUM
- **内容**: `Claude API`

- **ファイル**: `test/agent-integration-ccsp.test.js` (行: 131)
- **タイプ**: Claude API Reference
- **リスク**: MEDIUM
- **内容**: `Claude API`

- **ファイル**: `test/agent-integration-ccsp.test.js` (行: 221)
- **タイプ**: Claude Request Pattern
- **リスク**: LOW
- **内容**: `requestId: 'issue-123-claude`

- **ファイル**: `src/prometheus-exporter.js` (行: 165)
- **タイプ**: Claude API Reference
- **リスク**: MEDIUM
- **内容**: `Claude API`

- **ファイル**: `src/prometheus-exporter.js` (行: 166)
- **タイプ**: Claude API Reference
- **リスク**: MEDIUM
- **内容**: `claudeApi`

- **ファイル**: `src/prometheus-exporter.js` (行: 167)
- **タイプ**: Claude API Reference
- **リスク**: MEDIUM
- **内容**: `claude_api`

- **ファイル**: `src/prometheus-exporter.js` (行: 165)
- **タイプ**: Claude API Reference
- **リスク**: MEDIUM
- **内容**: `Claude API`

- **ファイル**: `src/prometheus-exporter.js` (行: 166)
- **タイプ**: Claude API Reference
- **リスク**: MEDIUM
- **内容**: `claudeApi`

- **ファイル**: `src/prometheus-exporter.js` (行: 167)
- **タイプ**: Claude API Reference
- **リスク**: MEDIUM
- **内容**: `claude_api`

- **ファイル**: `src/prometheus-exporter.js` (行: 165)
- **タイプ**: Claude API Reference
- **リスク**: MEDIUM
- **内容**: `Claude API`

- **ファイル**: `src/prometheus-exporter.js` (行: 166)
- **タイプ**: Claude API Reference
- **リスク**: MEDIUM
- **内容**: `claudeApi`

- **ファイル**: `src/prometheus-exporter.js` (行: 166)
- **タイプ**: Claude API Reference
- **リスク**: MEDIUM
- **内容**: `claudeApi`

- **ファイル**: `src/prometheus-exporter.js` (行: 165)
- **タイプ**: Claude API Reference
- **リスク**: MEDIUM
- **内容**: `Claude API`


... 他 304 件

## 💡 推奨事項

- 直接的なClaude API呼び出しが発見されました。即座に削除または無効化してください。
- 高リスクのAPI呼び出しパターンが見つかりました。CCSP経由に移行してください。
- Claude CLIの使用は適切です。引き続きClaude Codeの機能のみを使用してください。

## 📋 詳細分析

### ファイル別分析結果


#### `scripts/claude-api-investigation.js`
- 発見事項: 78件
- 最高リスク: HIGH

#### `test/helpers/test-environment-check.js`
- 発見事項: 4件
- 最高リスク: MEDIUM

#### `lib/templates/template-manager.js`
- 発見事項: 11件
- 最高リスク: MEDIUM

#### `lib/commands/init.js`
- 発見事項: 48件
- 最高リスク: MEDIUM

#### `lib/templates/definitions/minimal/config/config.json`
- 発見事項: 2件
- 最高リスク: MEDIUM

#### `lib/templates/definitions/default/config/config.json`
- 発見事項: 2件
- 最高リスク: MEDIUM

#### `lib/templates/definitions/advanced/config/config.json`
- 発見事項: 2件
- 最高リスク: MEDIUM

#### `README-npm.md`
- 発見事項: 20件
- 最高リスク: MEDIUM

#### `docs/troubleshooting.md`
- 発見事項: 9件
- 最高リスク: MEDIUM

#### `docs/templates.md`
- 発見事項: 5件
- 最高リスク: MEDIUM


... 他 135 ファイル

---
*調査完了時刻: 2025-06-21T16:51:37.865Z*
*調査ツールバージョン: 1.0.0*
