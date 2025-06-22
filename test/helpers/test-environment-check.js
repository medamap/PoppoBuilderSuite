#!/usr/bin/env node

/**
 * テスト環境のチェックスクリプト
 * 必要な依存関係とサービスが利用可能か確認
 */

const { isRedisAvailable } = require('./redis-test-helper');
const fs = require('fs');
const path = require('path');

async function checkEnvironment() {
  console.log('🔍 テスト環境をチェックしています...\n');

  const checks = [];

  // Node.jsバージョン
  const nodeVersion = process.version;
  const majorVersion = parseInt(nodeVersion.split('.')[0].substring(1));
  checks.push({
    name: 'Node.js バージョン',
    status: majorVersion >= 18,
    message: `${nodeVersion} (推奨: 18.x以上)`,
    required: true
  });

  // 必要なディレクトリ
  const requiredDirs = ['logs', 'state', '.poppo/locks', 'test'];
  requiredDirs.forEach(dir => {
    const exists = fs.existsSync(path.join(__dirname, '../../', dir));
    checks.push({
      name: `ディレクトリ: ${dir}`,
      status: exists,
      message: exists ? '存在' : '不在',
      required: true
    });
  });

  // 環境変数
  const envVars = {
    'NODE_ENV': process.env.NODE_ENV,
    'GITHUB_TOKEN': process.env.GITHUB_TOKEN ? '設定済み' : '未設定',
    'CLAUDE_API_KEY': process.env.CLAUDE_API_KEY ? '設定済み' : '未設定',
    'REDIS_HOST': process.env.REDIS_HOST || 'localhost',
    'REDIS_PORT': process.env.REDIS_PORT || '6379',
    'REDIS_TEST_DB': process.env.REDIS_TEST_DB || '15'
  };

  Object.entries(envVars).forEach(([key, value]) => {
    checks.push({
      name: `環境変数: ${key}`,
      status: value !== '未設定',
      message: value || '未設定',
      required: key === 'NODE_ENV'
    });
  });

  // Redis接続
  const redisAvailable = await isRedisAvailable();
  checks.push({
    name: 'Redis接続',
    status: redisAvailable,
    message: redisAvailable ? '接続可能' : '接続不可（一部のテストがスキップされます）',
    required: false
  });

  // 依存パッケージ
  const requiredPackages = [
    'mocha',
    'chai',
    'sinon',
    'chai-as-promised',
    'sinon-chai'
  ];

  requiredPackages.forEach(pkg => {
    try {
      require.resolve(pkg);
      checks.push({
        name: `パッケージ: ${pkg}`,
        status: true,
        message: 'インストール済み',
        required: true
      });
    } catch (e) {
      checks.push({
        name: `パッケージ: ${pkg}`,
        status: false,
        message: '未インストール',
        required: true
      });
    }
  });

  // 結果の表示
  console.log('📋 チェック結果:\n');
  
  let hasRequiredFailure = false;
  
  checks.forEach(check => {
    const icon = check.status ? '✅' : (check.required ? '❌' : '⚠️');
    console.log(`${icon} ${check.name}: ${check.message}`);
    
    if (!check.status && check.required) {
      hasRequiredFailure = true;
    }
  });

  console.log('\n' + '='.repeat(50) + '\n');

  if (hasRequiredFailure) {
    console.log('❌ 必須要件を満たしていません。');
    console.log('以下のコマンドを実行してください:');
    console.log('  npm install');
    console.log('  mkdir -p logs state .poppo/locks');
    return false;
  } else {
    console.log('✅ テスト実行の準備が整っています！');
    
    if (!redisAvailable) {
      console.log('\n⚠️  注意: Redisが利用できないため、一部のテストがスキップされます。');
      console.log('Redisを起動するには: docker-compose up -d redis');
    }
    
    return true;
  }
}

// CLIとして実行された場合
if (require.main === module) {
  checkEnvironment().then(success => {
    process.exit(success ? 0 : 1);
  });
}

module.exports = checkEnvironment;