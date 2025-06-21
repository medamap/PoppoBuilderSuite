/**
 * Context Switcher Demo
 * プロジェクトコンテキストスイッチャーの使用例
 */

const ContextSwitcher = require('../lib/core/context-switcher');
const EnvironmentManager = require('../lib/utils/environment-manager');
const path = require('path');

async function demonstrateContextSwitcher() {
  const contextSwitcher = new ContextSwitcher();
  const envManager = new EnvironmentManager();

  console.log('=== Context Switcher Demo ===\n');

  // 1. 基本的なコンテキスト切り替え
  console.log('1. Basic context switching:');
  console.log('Current directory:', process.cwd());
  
  const projectPath = path.join(__dirname, '..');
  const context = await contextSwitcher.switchContext(projectPath);
  console.log('Switched to:', process.cwd());
  
  await contextSwitcher.restoreContext(context);
  console.log('Restored to:', process.cwd());
  console.log();

  // 2. コンテキスト内でのタスク実行
  console.log('2. Execute task in context:');
  const result = await contextSwitcher.executeInContext(projectPath, async () => {
    console.log('Executing in:', process.cwd());
    console.log('Project-specific env vars:', 
      Object.keys(process.env).filter(k => k.startsWith('POPPO_PROJECT_'))
    );
    return 'Task completed successfully';
  });
  console.log('Result:', result);
  console.log('Back in:', process.cwd());
  console.log();

  // 3. 環境変数の分離
  console.log('3. Environment isolation:');
  const originalValue = process.env.TEST_VAR;
  
  await envManager.runInIsolatedEnvironment('demo-project', async () => {
    process.env.TEST_VAR = 'isolated_value';
    console.log('In isolated env - TEST_VAR:', process.env.TEST_VAR);
    console.log('Project ID:', process.env.POPPO_PROJECT_ID);
  });
  
  console.log('After isolation - TEST_VAR:', process.env.TEST_VAR || 'undefined');
  console.log();

  // 4. 複数プロジェクトでの実行
  console.log('4. Execute in multiple contexts:');
  const projects = [
    path.join(__dirname, '..'),
    __dirname
  ];
  
  const results = await contextSwitcher.executeInMultipleContexts(
    projects,
    async () => {
      return {
        cwd: process.cwd(),
        files: require('fs').readdirSync('.').slice(0, 5)
      };
    }
  );
  
  results.forEach((result, index) => {
    console.log(`Project ${index + 1}:`, result.success ? 'Success' : 'Failed');
    if (result.success) {
      console.log('  Directory:', result.result.cwd);
      console.log('  Files:', result.result.files.join(', '));
    }
  });
  console.log();

  // 5. 環境変数の管理
  console.log('5. Environment management:');
  
  // スナップショット作成
  process.env.DEMO_VAR = 'original_value';
  envManager.createSnapshot('demo');
  
  // 環境変数を変更
  process.env.DEMO_VAR = 'modified_value';
  process.env.NEW_VAR = 'new_value';
  
  // 差分を確認
  const currentEnv = { ...process.env };
  envManager.restoreSnapshot('demo');
  const diff = envManager.getDifference(process.env, currentEnv);
  
  console.log('Environment changes:');
  console.log('  Added:', Object.keys(diff.added));
  console.log('  Changed:', Object.keys(diff.changed));
  console.log();

  // 6. 環境変数のフィルタリングと検証
  console.log('6. Environment filtering and validation:');
  
  const filtered = envManager.filter(process.env, key => key.startsWith('NODE_'));
  console.log('NODE_* variables:', Object.keys(filtered));
  
  const schema = {
    NODE_ENV: { required: true, enum: ['development', 'production', 'test'] },
    PORT: { type: 'number' },
    POPPO_PROJECT_ID: { pattern: '^[a-zA-Z0-9-]+$' }
  };
  
  const validation = envManager.validate(process.env, schema);
  console.log('Validation result:', validation.valid ? 'Valid' : 'Invalid');
  if (!validation.valid) {
    console.log('Errors:', validation.errors);
  }
}

// エラーハンドリング例
async function demonstrateErrorHandling() {
  console.log('\n=== Error Handling Demo ===\n');
  
  const contextSwitcher = new ContextSwitcher();
  
  try {
    // 存在しないディレクトリへの切り替えを試みる
    await contextSwitcher.switchContext('/non/existent/path');
  } catch (error) {
    console.log('Expected error:', error.message);
  }
  
  // タスク実行中のエラーハンドリング
  try {
    await contextSwitcher.executeInContext(process.cwd(), async () => {
      throw new Error('Task failed!');
    });
  } catch (error) {
    console.log('Task error handled:', error.message);
    console.log('Context properly restored:', process.cwd());
  }
}

// 実用的な使用例
async function practicalExample() {
  console.log('\n=== Practical Example ===\n');
  
  const contextSwitcher = new ContextSwitcher();
  
  // 複数のプロジェクトでテストを実行
  const projectPaths = [
    '/path/to/project1',
    '/path/to/project2'
  ];
  
  console.log('Running tests in multiple projects...');
  
  const testResults = await contextSwitcher.executeInMultipleContexts(
    projectPaths.filter(p => require('fs').existsSync(p)),
    async () => {
      // プロジェクト固有の設定を読み込み
      const hasTestScript = require('fs').existsSync('package.json');
      
      if (hasTestScript) {
        const pkg = require(path.join(process.cwd(), 'package.json'));
        return {
          name: pkg.name,
          hasTests: !!pkg.scripts?.test,
          testCommand: pkg.scripts?.test || 'No test script'
        };
      }
      
      return { error: 'No package.json found' };
    }
  );
  
  console.log('Test results:', JSON.stringify(testResults, null, 2));
}

// メイン実行
async function main() {
  try {
    await demonstrateContextSwitcher();
    await demonstrateErrorHandling();
    // await practicalExample(); // 実際のプロジェクトパスが必要
  } catch (error) {
    console.error('Demo error:', error);
  }
}

if (require.main === module) {
  main();
}

module.exports = { demonstrateContextSwitcher, demonstrateErrorHandling, practicalExample };