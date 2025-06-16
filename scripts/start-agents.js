#!/usr/bin/env node

const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs').promises;

/**
 * エージェントモードでPoppoBuilderを起動するスクリプト
 */
async function startAgentsMode() {
  console.log('🚀 エージェントモードでPoppoBuilderを起動します...');
  
  try {
    // config.jsonを読み込んで、エージェントモードを有効化
    const configPath = path.join(__dirname, '../config/config.json');
    const configContent = await fs.readFile(configPath, 'utf8');
    const config = JSON.parse(configContent);
    
    // エージェントモードを有効化
    config.agentMode.enabled = true;
    
    // 一時的な設定ファイルを作成
    const tempConfigPath = path.join(__dirname, '../config/config.agent.json');
    await fs.writeFile(tempConfigPath, JSON.stringify(config, null, 2));
    
    console.log('✅ エージェントモード設定を有効化しました');
    
    // PoppoBuilderを起動
    const poppoProcess = spawn('node', [
      path.join(__dirname, '../src/minimal-poppo.js')
    ], {
      env: {
        ...process.env,
        POPPO_CONFIG_PATH: tempConfigPath
      },
      stdio: 'inherit'
    });
    
    // プロセス終了時の処理
    poppoProcess.on('exit', async (code) => {
      console.log(`\nPoppoBuilderが終了しました (code: ${code})`);
      
      // 一時設定ファイルを削除
      try {
        await fs.unlink(tempConfigPath);
      } catch (error) {
        // ファイルが既に削除されている場合は無視
      }
    });
    
    // シグナルハンドリング
    process.on('SIGINT', () => {
      console.log('\n⏹️  エージェントモードを停止中...');
      poppoProcess.kill('SIGINT');
    });
    
    process.on('SIGTERM', () => {
      poppoProcess.kill('SIGTERM');
    });
    
  } catch (error) {
    console.error('❌ エラー:', error.message);
    process.exit(1);
  }
}

// メイン実行
if (require.main === module) {
  startAgentsMode();
}

module.exports = { startAgentsMode };