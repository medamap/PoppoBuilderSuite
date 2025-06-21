#!/usr/bin/env node

const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const JWTAuthManager = require('../src/security/jwt-auth');
const RBACManager = require('../src/security/rbac');
const SecurityConfig = require('../src/security/security-config');

console.log('🔐 PoppoBuilder Suite セキュリティ初期化');
console.log('=====================================\n');

async function initializeSecurity() {
    try {
        // セキュリティディレクトリの作成
        const securityDir = path.join(process.cwd(), 'config', 'security');
        const keysDir = path.join(securityDir, 'keys');
        
        await fs.mkdir(securityDir, { recursive: true });
        await fs.mkdir(keysDir, { recursive: true });
        
        console.log('✅ セキュリティディレクトリを作成しました');

        // JWT認証マネージャーの初期化
        console.log('\n📋 JWT認証システムを初期化中...');
        const jwtAuth = new JWTAuthManager();
        await jwtAuth.initialize();
        
        // 各エージェントのAPIキーを生成・保存
        const apiKeys = {};
        const agents = Object.keys(jwtAuth.agentCredentials);
        
        console.log(`\n🔑 ${agents.length}個のエージェントのAPIキーを生成中...\n`);
        
        for (const agentId of agents) {
            const agent = jwtAuth.agentCredentials[agentId];
            if (!agent.active) continue;
            
            // APIキーの生成
            const apiKey = crypto.randomBytes(32).toString('hex');
            apiKeys[agentId] = apiKey;
            
            // キーファイルの保存
            const keyPath = path.join(keysDir, `${agentId}.key`);
            await fs.writeFile(keyPath, apiKey, { mode: 0o600 });
            
            console.log(`✅ ${agent.name} (${agentId})`);
            console.log(`   APIキー: ${apiKey}`);
            console.log(`   ロール: ${agent.role}`);
            console.log(`   権限: ${agent.permissions.join(', ')}`);
            console.log('');
        }

        // RBAC設定の初期化
        console.log('🎭 ロールベースアクセス制御を初期化中...');
        const rbac = new RBACManager();
        await rbac.initialize();
        console.log('✅ RBACシステムを初期化しました');

        // セキュリティポリシーの初期化
        console.log('\n📜 セキュリティポリシーを初期化中...');
        const securityConfig = new SecurityConfig();
        await securityConfig.initialize();
        
        const validation = securityConfig.validateConfig();
        if (validation.errors.length > 0) {
            console.error('❌ セキュリティポリシーにエラーがあります:');
            validation.errors.forEach(err => console.error(`   - ${err}`));
        } else {
            console.log('✅ セキュリティポリシーを初期化しました');
        }
        
        if (validation.warnings.length > 0) {
            console.warn('\n⚠️  セキュリティポリシーの警告:');
            validation.warnings.forEach(warn => console.warn(`   - ${warn}`));
        }

        // 環境変数設定の出力
        console.log('\n📝 環境変数の設定例:');
        console.log('=====================================');
        console.log('# .envファイルまたはシェルで以下を設定してください:\n');
        
        for (const [agentId, apiKey] of Object.entries(apiKeys)) {
            const envVarName = agentId.toUpperCase().replace(/-/g, '_') + '_API_KEY';
            console.log(`export ${envVarName}="${apiKey}"`);
        }

        // 設定ファイルのバックアップ
        const backupDir = path.join(securityDir, 'backup');
        await fs.mkdir(backupDir, { recursive: true });
        
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const backupPath = path.join(backupDir, `security-init-${timestamp}.json`);
        
        await fs.writeFile(backupPath, JSON.stringify({
            timestamp: new Date().toISOString(),
            agents: Object.keys(apiKeys),
            apiKeysGenerated: true,
            rbacInitialized: true,
            policyInitialized: true
        }, null, 2));
        
        console.log(`\n✅ バックアップを作成しました: ${backupPath}`);

        // 次のステップの案内
        console.log('\n🚀 次のステップ:');
        console.log('=====================================');
        console.log('1. 上記の環境変数を設定してください');
        console.log('2. エージェントを再起動してください:');
        console.log('   npm run start:agents');
        console.log('3. セキュリティレポートを確認してください:');
        console.log('   node scripts/security-report.js');
        console.log('\n⚠️  重要: APIキーは安全に保管し、Gitにコミットしないでください！');

        // セキュリティチェックリスト
        console.log('\n📋 セキュリティチェックリスト:');
        console.log('=====================================');
        console.log('□ APIキーを環境変数に設定');
        console.log('□ config/securityディレクトリの権限を確認 (600)');
        console.log('□ .gitignoreにセキュリティ関連ファイルを追加');
        console.log('□ 定期的なAPIキーローテーションのスケジュール設定');
        console.log('□ 監査ログの監視体制の構築');

    } catch (error) {
        console.error('\n❌ エラーが発生しました:', error.message);
        console.error(error.stack);
        process.exit(1);
    }
}

// 実行確認
const readline = require('readline');
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

console.log('⚠️  警告: この操作は既存のセキュリティ設定を上書きします。');
rl.question('\n続行しますか？ (yes/no): ', async (answer) => {
    if (answer.toLowerCase() === 'yes' || answer.toLowerCase() === 'y') {
        rl.close();
        await initializeSecurity();
        console.log('\n✅ セキュリティ初期化が完了しました！');
    } else {
        console.log('\n❌ 初期化をキャンセルしました。');
        rl.close();
        process.exit(0);
    }
});