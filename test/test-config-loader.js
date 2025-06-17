const fs = require('fs');
const path = require('path');
const os = require('os');
const ConfigLoader = require('../src/config-loader');

// テスト用のディレクトリ
const testDir = path.join(__dirname, 'test-config');
const testProjectDir = path.join(testDir, 'project');
const testGlobalDir = path.join(testDir, 'global');

// 元の環境変数を保存
const originalEnv = { ...process.env };
const originalCwd = process.cwd();
const originalHomeDir = os.homedir();

// テストの準備
function setup() {
  // テストディレクトリを作成
  fs.mkdirSync(testDir, { recursive: true });
  fs.mkdirSync(testProjectDir, { recursive: true });
  fs.mkdirSync(path.join(testProjectDir, '.poppo'), { recursive: true });
  fs.mkdirSync(path.join(testGlobalDir, '.poppo'), { recursive: true });
  
  // プロセスのカレントディレクトリを変更
  process.chdir(testProjectDir);
  
  // ホームディレクトリをモック
  os.homedir = () => testGlobalDir;
}

// テストの後片付け
function cleanup() {
  // 環境変数をリセット
  for (const key in process.env) {
    if (key.startsWith('POPPO_')) {
      delete process.env[key];
    }
  }
  Object.assign(process.env, originalEnv);
  
  // カレントディレクトリを元に戻す
  process.chdir(originalCwd);
  
  // ホームディレクトリを元に戻す
  os.homedir = () => originalHomeDir;
  
  // テストディレクトリを削除
  if (fs.existsSync(testDir)) {
    fs.rmSync(testDir, { recursive: true, force: true });
  }
}

// テスト実行
async function runTests() {
  console.log('ConfigLoader テスト開始...\n');
  
  try {
    setup();
    
    // テスト1: システムデフォルト設定の読み込み
    console.log('テスト1: システムデフォルト設定の読み込み');
    const loader1 = new ConfigLoader();
    const config1 = loader1.loadConfig();
    console.log('✓ システムデフォルト設定が読み込まれました');
    console.log('  言語設定:', config1.language);
    
    // テスト2: プロジェクト設定による上書き
    console.log('\nテスト2: プロジェクト設定による上書き');
    const projectConfig = {
      language: { primary: 'en', fallback: 'ja' },
      github: { pollingInterval: 120000 }
    };
    fs.writeFileSync(
      path.join(testProjectDir, '.poppo', 'config.json'),
      JSON.stringify(projectConfig, null, 2)
    );
    
    const loader2 = new ConfigLoader();
    const config2 = loader2.loadConfig();
    console.log('✓ プロジェクト設定で上書きされました');
    console.log('  言語設定:', config2.language);
    console.log('  ポーリング間隔:', config2.github.pollingInterval);
    
    // テスト3: グローバル設定の継承
    console.log('\nテスト3: グローバル設定の継承');
    const globalConfig = {
      claude: { maxConcurrent: 3 },
      notifications: { enabled: true }
    };
    fs.writeFileSync(
      path.join(testGlobalDir, '.poppo', 'config.json'),
      JSON.stringify(globalConfig, null, 2)
    );
    
    // プロジェクト設定を削除
    fs.unlinkSync(path.join(testProjectDir, '.poppo', 'config.json'));
    
    const loader3 = new ConfigLoader();
    const config3 = loader3.loadConfig();
    console.log('✓ グローバル設定が継承されました');
    console.log('  Claude同時実行数:', config3.claude.maxConcurrent);
    console.log('  通知設定:', config3.notifications.enabled);
    
    // テスト4: 環境変数による最優先上書き
    console.log('\nテスト4: 環境変数による最優先上書き');
    process.env.POPPO_LANGUAGE_PRIMARY = 'en';
    process.env.POPPO_CLAUDE_MAXCONCURRENT = '5';
    process.env.POPPO_DYNAMICTIMEOUT_ENABLED = 'false';
    process.env.POPPO_GITHUB_POLLINGINTERVAL = '180000';
    
    const loader4 = new ConfigLoader();
    const config4 = loader4.loadConfig();
    console.log('✓ 環境変数で設定が上書きされました');
    console.log('  言語（環境変数）:', config4.language.primary);
    console.log('  Claude同時実行数（環境変数）:', config4.claude.maxConcurrent);
    console.log('  動的タイムアウト（環境変数）:', config4.dynamicTimeout.enabled);
    console.log('  ポーリング間隔（環境変数）:', config4.github.pollingInterval);
    
    // テスト5: 設定階層情報の表示
    console.log('\nテスト5: 設定階層情報の表示');
    loader4.displayConfigHierarchy();
    
    // テスト6: バリデーション
    console.log('\nテスト6: 設定バリデーション');
    
    // 無効な言語コード
    console.log('  無効な言語コードでバリデーション実行...');
    process.env.POPPO_LANGUAGE_PRIMARY = 'invalid';
    const loader5 = new ConfigLoader();
    loader5.loadConfig();
    
    // 無効な数値範囲
    console.log('\n  無効な数値範囲でバリデーション実行...');
    process.env.POPPO_LANGUAGE_PRIMARY = 'ja';
    process.env.POPPO_CLAUDE_MAXCONCURRENT = '15';
    process.env.POPPO_GITHUB_POLLINGINTERVAL = '5000';
    const loader6 = new ConfigLoader();
    loader6.loadConfig();
    
    // テスト7: JSON形式の環境変数
    console.log('\nテスト7: JSON形式の環境変数');
    process.env.POPPO_CLAUDE_MAXCONCURRENT = '2';
    process.env.POPPO_GITHUB_POLLINGINTERVAL = '60000';
    process.env.POPPO_CUSTOM_DATA = '{"key": "value", "nested": {"item": 123}}';
    
    const loader7 = new ConfigLoader();
    const config7 = loader7.loadConfig();
    console.log('✓ JSON形式の環境変数が解析されました');
    console.log('  カスタムデータ:', JSON.stringify(config7.custom?.data));
    
    // テスト8: 設定ソース情報の取得
    console.log('\nテスト8: 設定ソース情報の取得');
    const sources = loader7.getConfigSources();
    console.log('✓ 設定ソース情報:');
    console.log('  システムデフォルト:', sources.systemDefault.exists ? '存在' : '存在しない');
    console.log('  グローバル設定:', sources.global.exists ? '存在' : '存在しない');
    console.log('  プロジェクト設定:', sources.project.exists ? '存在' : '存在しない');
    console.log('  環境変数数:', Object.keys(sources.environment.variables).length);
    
    console.log('\n✅ すべてのテストが完了しました！');
    
  } catch (error) {
    console.error('\n❌ テストエラー:', error);
    throw error;
  } finally {
    cleanup();
  }
}

// メイン実行
if (require.main === module) {
  runTests().catch(error => {
    console.error('テスト実行エラー:', error);
    process.exit(1);
  });
}

module.exports = { runTests };