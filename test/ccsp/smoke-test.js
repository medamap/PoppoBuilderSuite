#!/usr/bin/env node

/**
 * CCSP スモークテスト
 * 
 * 基本的な動作確認のための軽量テスト
 */

const path = require('path');

class CCSPSmokeTest {
  constructor() {
    this.results = [];
  }
  
  async run() {
    console.log('🚀 CCSP スモークテスト開始\n');
    
    try {
      // 1. ファイル存在確認
      await this.testFileExistence();
      
      // 2. モジュール読み込み確認
      await this.testModuleLoading();
      
      // 3. 基本設定確認
      await this.testBasicConfiguration();
      
      // 結果表示
      this.displayResults();
      
    } catch (error) {
      console.error('💥 スモークテストでエラーが発生:', error.message);
      process.exit(1);
    }
  }
  
  async testFileExistence() {
    console.log('📁 ファイル存在確認...');
    
    const requiredFiles = [
      'agents/ccsp/index.js',
      'agents/ccsp/claude-executor.js',
      'agents/ccsp/queue-manager.js',
      'agents/ccsp/session-monitor.js',
      'test/ccsp/framework/test-framework.js',
      'test/ccsp/framework/mocks/mock-claude-cli.js',
      'test/ccsp/framework/mocks/mock-redis.js',
      'test/ccsp/framework/mocks/mock-github-api.js'
    ];
    
    const fs = require('fs').promises;
    const baseDir = path.join(__dirname, '../..');
    
    for (const file of requiredFiles) {
      try {
        const filePath = path.join(baseDir, file);
        await fs.access(filePath);
        this.results.push({ test: `ファイル存在: ${file}`, status: '✅ PASS' });
      } catch (error) {
        this.results.push({ test: `ファイル存在: ${file}`, status: '❌ FAIL', error: error.message });
      }
    }
  }
  
  async testModuleLoading() {
    console.log('📦 モジュール読み込み確認...');
    
    const modules = [
      { name: 'CCSPTestFramework', path: './framework/test-framework' },
      { name: 'MockClaude', path: './framework/mocks/mock-claude-cli' },
      { name: 'MockRedis', path: './framework/mocks/mock-redis' },
      { name: 'MockGitHub', path: './framework/mocks/mock-github-api' }
    ];
    
    for (const module of modules) {
      try {
        require(module.path);
        this.results.push({ test: `モジュール読み込み: ${module.name}`, status: '✅ PASS' });
      } catch (error) {
        this.results.push({ test: `モジュール読み込み: ${module.name}`, status: '❌ FAIL', error: error.message });
      }
    }
  }
  
  async testBasicConfiguration() {
    console.log('⚙️  基本設定確認...');
    
    try {
      // CCSPエージェント設定確認
      const CCSPAgent = require('../../agents/ccsp/index');
      this.results.push({ test: 'CCSPエージェント設定', status: '✅ PASS' });
      
      // テストフレームワーク設定確認
      const CCSPTestFramework = require('./framework/test-framework');
      const framework = new CCSPTestFramework();
      this.results.push({ test: 'テストフレームワーク設定', status: '✅ PASS' });
      
    } catch (error) {
      this.results.push({ test: '基本設定確認', status: '❌ FAIL', error: error.message });
    }
  }
  
  displayResults() {
    console.log('\n📋 スモークテスト結果:');
    console.log('='.repeat(60));
    
    const passed = this.results.filter(r => r.status.includes('PASS')).length;
    const failed = this.results.filter(r => r.status.includes('FAIL')).length;
    
    for (const result of this.results) {
      console.log(`${result.status} ${result.test}`);
      if (result.error) {
        console.log(`     💥 ${result.error}`);
      }
    }
    
    console.log('\n📊 サマリー:');
    console.log(`✅ 成功: ${passed}件`);
    console.log(`❌ 失敗: ${failed}件`);
    
    if (failed === 0) {
      console.log('\n🎉 すべてのスモークテストが成功しました！');
      console.log('📦 CCSP テストフレームワークは正常にセットアップされています。');
    } else {
      console.log('\n⚠️  一部のスモークテストが失敗しました。');
      console.log('🔧 問題を修正してから本格的なテストを実行してください。');
      process.exit(1);
    }
  }
}

// CLI実行
if (require.main === module) {
  const smokeTest = new CCSPSmokeTest();
  smokeTest.run();
}

module.exports = CCSPSmokeTest;