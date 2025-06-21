/**
 * Context Switcher Tests
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs').promises;
const os = require('os');
const ContextSwitcher = require('../lib/core/context-switcher');
const EnvironmentManager = require('../lib/utils/environment-manager');

describe('ContextSwitcher', function() {
  let contextSwitcher;
  let testDir;
  let originalCwd;

  before(async function() {
    // テスト用ディレクトリを作成
    testDir = path.join(os.tmpdir(), 'poppo-context-test-' + Date.now());
    await fs.mkdir(testDir, { recursive: true });
    originalCwd = process.cwd();
  });

  after(async function() {
    // クリーンアップ
    process.chdir(originalCwd);
    await fs.rm(testDir, { recursive: true, force: true });
  });

  beforeEach(function() {
    contextSwitcher = new ContextSwitcher();
    process.chdir(originalCwd);
  });

  describe('switchContext', function() {
    it('should switch working directory', async function() {
      const context = await contextSwitcher.switchContext(testDir);
      assert.strictEqual(process.cwd(), testDir);
      assert.strictEqual(context.cwd, originalCwd);
    });

    it('should handle non-existent directory', async function() {
      const nonExistentDir = path.join(testDir, 'non-existent');
      try {
        await contextSwitcher.switchContext(nonExistentDir);
        assert.fail('Should have thrown an error');
      } catch (error) {
        assert(error.message.includes('Failed to switch context'));
        assert.strictEqual(process.cwd(), originalCwd);
      }
    });

    it('should load project environment variables', async function() {
      // .envファイルを作成
      const envContent = 'TEST_VAR=test_value\nANOTHER_VAR=another_value';
      await fs.writeFile(path.join(testDir, '.env'), envContent);

      await contextSwitcher.switchContext(testDir);
      assert.strictEqual(process.env.POPPO_PROJECT_TEST_VAR, 'test_value');
      assert.strictEqual(process.env.POPPO_PROJECT_ANOTHER_VAR, 'another_value');
    });

    it('should load project config', async function() {
      // 設定ファイルを作成
      const configDir = path.join(testDir, '.poppo');
      await fs.mkdir(configDir, { recursive: true });
      const config = {
        timeout: 5000,
        maxConcurrent: 3,
        environment: {
          debug: true
        }
      };
      await fs.writeFile(
        path.join(configDir, 'config.json'),
        JSON.stringify(config, null, 2)
      );

      await contextSwitcher.switchContext(testDir);
      assert.strictEqual(process.env.POPPO_PROJECT_TIMEOUT, '5000');
      assert.strictEqual(process.env.POPPO_PROJECT_MAX_CONCURRENT, '3');
      assert.strictEqual(process.env.POPPO_CONFIG_DEBUG, 'true');
    });
  });

  describe('restoreContext', function() {
    it('should restore working directory', async function() {
      const context = await contextSwitcher.switchContext(testDir);
      await contextSwitcher.restoreContext(context);
      assert.strictEqual(process.cwd(), originalCwd);
    });

    it('should clear project-specific environment variables', async function() {
      process.env.POPPO_PROJECT_TEST = 'test';
      process.env.POPPO_CONFIG_TEST = 'test';
      
      const context = await contextSwitcher.switchContext(testDir);
      await contextSwitcher.restoreContext(context);
      
      assert.strictEqual(process.env.POPPO_PROJECT_TEST, undefined);
      assert.strictEqual(process.env.POPPO_CONFIG_TEST, undefined);
    });
  });

  describe('executeInContext', function() {
    it('should execute task in project context', async function() {
      let executedInCorrectDir = false;
      const task = async () => {
        executedInCorrectDir = process.cwd() === testDir;
        return 'task result';
      };

      const result = await contextSwitcher.executeInContext(testDir, task);
      assert.strictEqual(result, 'task result');
      assert(executedInCorrectDir);
      assert.strictEqual(process.cwd(), originalCwd);
    });

    it('should restore context even if task fails', async function() {
      const task = async () => {
        throw new Error('Task failed');
      };

      try {
        await contextSwitcher.executeInContext(testDir, task);
        assert.fail('Should have thrown an error');
      } catch (error) {
        assert.strictEqual(error.message, 'Task failed');
        assert.strictEqual(process.cwd(), originalCwd);
      }
    });
  });

  describe('executeInMultipleContexts', function() {
    it('should execute task in multiple contexts', async function() {
      // 複数のテストディレクトリを作成
      const testDir2 = path.join(os.tmpdir(), 'poppo-context-test2-' + Date.now());
      await fs.mkdir(testDir2, { recursive: true });

      try {
        const task = async () => {
          return process.cwd();
        };

        const results = await contextSwitcher.executeInMultipleContexts(
          [testDir, testDir2],
          task
        );

        assert.strictEqual(results.length, 2);
        assert(results[0].success);
        assert.strictEqual(results[0].result, testDir);
        assert(results[1].success);
        assert.strictEqual(results[1].result, testDir2);
      } finally {
        await fs.rm(testDir2, { recursive: true, force: true });
      }
    });
  });
});

describe('EnvironmentManager', function() {
  let envManager;
  let originalEnv;

  beforeEach(function() {
    envManager = new EnvironmentManager();
    originalEnv = { ...process.env };
  });

  afterEach(function() {
    // 環境変数を復元
    Object.keys(process.env).forEach(key => delete process.env[key]);
    Object.assign(process.env, originalEnv);
  });

  describe('createSnapshot and restoreSnapshot', function() {
    it('should create and restore environment snapshot', function() {
      process.env.TEST_SNAPSHOT = 'original';
      envManager.createSnapshot('test');
      
      process.env.TEST_SNAPSHOT = 'modified';
      assert.strictEqual(process.env.TEST_SNAPSHOT, 'modified');
      
      envManager.restoreSnapshot('test');
      assert.strictEqual(process.env.TEST_SNAPSHOT, 'original');
    });
  });

  describe('runInIsolatedEnvironment', function() {
    it('should run function in isolated environment', async function() {
      process.env.GLOBAL_VAR = 'global';
      
      let isolatedValue;
      await envManager.runInIsolatedEnvironment(
        'test-project',
        async () => {
          isolatedValue = process.env.POPPO_ISOLATED_ENV;
          process.env.ISOLATED_VAR = 'isolated';
        },
        { CUSTOM_VAR: 'custom' }
      );

      assert.strictEqual(isolatedValue, 'true');
      assert.strictEqual(process.env.GLOBAL_VAR, 'global');
      assert.strictEqual(process.env.ISOLATED_VAR, undefined);
      assert.strictEqual(process.env.CUSTOM_VAR, undefined);
    });
  });

  describe('getDifference', function() {
    it('should detect environment differences', function() {
      const env1 = { A: '1', B: '2', C: '3' };
      const env2 = { A: '1', B: '22', D: '4' };
      
      const diff = envManager.getDifference(env1, env2);
      
      assert.deepStrictEqual(diff.added, { D: '4' });
      assert.deepStrictEqual(diff.removed, { C: '3' });
      assert.deepStrictEqual(diff.changed, { B: { from: '2', to: '22' } });
    });
  });

  describe('merge', function() {
    it('should merge environment variables', function() {
      const base = { A: '1', B: '2' };
      const overlay = { B: '22', C: '3' };
      
      const merged = envManager.merge(base, overlay);
      assert.deepStrictEqual(merged, { A: '1', B: '22', C: '3' });
    });

    it('should merge with prefix', function() {
      const base = { A: '1' };
      const overlay = { B: '2' };
      
      const merged = envManager.merge(base, overlay, { prefix: 'TEST' });
      assert.deepStrictEqual(merged, { A: '1', TEST_B: '2' });
    });
  });

  describe('filter', function() {
    it('should filter environment variables', function() {
      const env = { 
        NODE_ENV: 'test',
        POPPO_TEST: 'value',
        OTHER_VAR: 'other'
      };

      // Function filter
      const filtered1 = envManager.filter(env, (key) => key.startsWith('POPPO_'));
      assert.deepStrictEqual(filtered1, { POPPO_TEST: 'value' });

      // RegExp filter
      const filtered2 = envManager.filter(env, /^NODE_/);
      assert.deepStrictEqual(filtered2, { NODE_ENV: 'test' });

      // Array filter
      const filtered3 = envManager.filter(env, ['NODE_ENV', 'OTHER_VAR']);
      assert.deepStrictEqual(filtered3, { NODE_ENV: 'test', OTHER_VAR: 'other' });
    });
  });

  describe('validate', function() {
    it('should validate environment variables', function() {
      const env = {
        PORT: '3000',
        DEBUG: 'true',
        ENV: 'production'
      };

      const schema = {
        PORT: { required: true, type: 'number' },
        DEBUG: { type: 'boolean' },
        ENV: { enum: ['development', 'production', 'test'] },
        API_KEY: { required: true }
      };

      const result = envManager.validate(env, schema);
      assert(!result.valid);
      assert.strictEqual(result.errors.length, 1);
      assert(result.errors[0].includes('API_KEY'));
    });
  });
});

// テストを実行
if (require.main === module) {
  require('mocha/cli').main(['--reporter', 'spec', __filename]);
}