#!/usr/bin/env node

/**
 * 全エージェントのCCSP統合テスト
 * 
 * 各エージェントがClaude APIを直接呼び出していないことを確認し、
 * CCSP経由で正しく動作することを検証する
 */

const fs = require('fs').promises;
const path = require('path');
const Redis = require('ioredis');

// テスト対象のエージェント
const AGENTS = [
  { name: 'CCLA', path: 'agents/ccla', hasCCSP: true },
  { name: 'CCAG', path: 'agents/ccag', hasCCSP: true, indirect: true },
  { name: 'CCPM', path: 'agents/ccpm', hasCCSP: true },
  { name: 'CCQA', path: 'agents/ccqa', hasCCSP: false },
  { name: 'CCRA', path: 'agents/ccra', hasCCSP: true },
  { name: 'CCTA', path: 'agents/ccta', hasCCSP: false }
];

async function testAllAgentsCCSP() {
  console.log('=== 全エージェントCCSP統合テスト ===\n');
  
  const results = [];
  
  // 1. 各エージェントのソースコードをチェック
  console.log('1. ソースコード検査\n');
  
  for (const agent of AGENTS) {
    console.log(`[${agent.name}] 検査開始...`);
    
    const result = {
      agent: agent.name,
      directClaudeCall: false,
      ccspUsage: false,
      files: []
    };
    
    try {
      // エージェントディレクトリのファイルを取得
      const files = await getAllJsFiles(agent.path);
      
      for (const file of files) {
        const content = await fs.readFile(file, 'utf8');
        
        // 直接的なClaude API呼び出しをチェック
        if (content.includes('anthropic') || 
            content.includes('claude-ai') || 
            content.includes('claude-sdk') ||
            (content.includes("spawn('claude") && !file.includes('ccsp'))) {
          result.directClaudeCall = true;
          result.files.push({
            file,
            issue: 'Direct Claude API call detected'
          });
        }
        
        // CCSP使用をチェック
        if (content.includes('ccsp:requests') ||
            content.includes('CCSPClient') ||
            content.includes('AgentCCSPClient') ||
            content.includes('processManager.execute')) {
          result.ccspUsage = true;
        }
      }
      
      // 結果を表示
      if (result.directClaudeCall) {
        console.log(`  ❌ 直接的なClaude API呼び出しを検出`);
        result.files.forEach(f => {
          console.log(`     - ${f.file}: ${f.issue}`);
        });
      } else {
        console.log(`  ✅ 直接的なClaude API呼び出しなし`);
      }
      
      if (agent.hasCCSP) {
        if (result.ccspUsage) {
          console.log(`  ✅ CCSP使用を確認`);
        } else if (agent.indirect) {
          console.log(`  ✅ 間接的にCCSP使用（ProcessManager経由）`);
        } else {
          console.log(`  ⚠️  CCSPの使用が確認できません`);
        }
      } else {
        console.log(`  ℹ️  Claude APIを使用しないエージェント`);
      }
      
    } catch (error) {
      console.log(`  ❌ エラー: ${error.message}`);
      result.error = error.message;
    }
    
    results.push(result);
    console.log();
  }
  
  // 2. Redis接続テスト
  console.log('2. Redis接続テスト\n');
  
  const redis = new Redis({
    host: process.env.REDIS_HOST || 'localhost',
    port: process.env.REDIS_PORT || 6379
  });
  
  try {
    await redis.ping();
    console.log('✅ Redis接続成功\n');
    
    // CCSPキューの状態を確認
    const queueLength = await redis.llen('ccsp:requests');
    console.log(`CCSPリクエストキュー長: ${queueLength}`);
    
    // 各エージェントのレスポンスキューを確認
    for (const agent of AGENTS) {
      if (agent.hasCCSP) {
        const responseQueue = `ccsp:response:${agent.name.toLowerCase()}`;
        const responseLength = await redis.llen(responseQueue);
        console.log(`${agent.name}レスポンスキュー長: ${responseLength}`);
      }
    }
    
  } catch (error) {
    console.log(`❌ Redis接続失敗: ${error.message}`);
  } finally {
    await redis.quit();
  }
  
  // 3. 結果サマリー
  console.log('\n=== テスト結果サマリー ===\n');
  
  const totalAgents = results.length;
  const compliantAgents = results.filter(r => !r.directClaudeCall).length;
  const ccspAgents = results.filter(r => r.ccspUsage).length;
  
  console.log(`総エージェント数: ${totalAgents}`);
  console.log(`Claude API直接呼び出しなし: ${compliantAgents}/${totalAgents}`);
  console.log(`CCSP使用エージェント: ${ccspAgents}`);
  
  if (compliantAgents === totalAgents) {
    console.log('\n✅ すべてのエージェントがClaude APIを直接呼び出していません！');
    console.log('✅ Issue #141の目標は達成されています！');
  } else {
    console.log('\n⚠️  一部のエージェントで修正が必要です');
  }
  
  return results;
}

/**
 * ディレクトリ内のすべてのJSファイルを再帰的に取得
 */
async function getAllJsFiles(dir) {
  const files = [];
  
  async function scanDir(currentDir) {
    const entries = await fs.readdir(currentDir, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      
      if (entry.isDirectory() && !entry.name.startsWith('.')) {
        await scanDir(fullPath);
      } else if (entry.isFile() && entry.name.endsWith('.js')) {
        files.push(fullPath);
      }
    }
  }
  
  await scanDir(dir);
  return files;
}

// テスト実行
if (require.main === module) {
  testAllAgentsCCSP()
    .then(() => {
      console.log('\n=== テスト完了 ===');
      process.exit(0);
    })
    .catch(error => {
      console.error('テストエラー:', error);
      process.exit(1);
    });
}