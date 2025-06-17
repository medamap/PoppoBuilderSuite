#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const Logger = require('../src/logger');
const NotificationManager = require('../src/notification-manager');

/**
 * 通知機能のテストスクリプト
 */
async function testNotifications() {
  console.log('=== スマホ通知機能テスト ===\n');
  
  // テスト用設定を作成
  const testConfig = {
    notifications: {
      enabled: true,
      providers: {
        discord: {
          enabled: process.env.DISCORD_WEBHOOK_URL ? true : false,
          webhookUrl: process.env.DISCORD_WEBHOOK_URL || '',
          retryCount: 3,
          retryDelay: 1000
        },
        pushover: {
          enabled: process.env.PUSHOVER_API_TOKEN && process.env.PUSHOVER_USER_KEY ? true : false,
          apiToken: process.env.PUSHOVER_API_TOKEN || '',
          userKey: process.env.PUSHOVER_USER_KEY || '',
          retryCount: 3,
          retryDelay: 1000
        },
        telegram: {
          enabled: process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID ? true : false,
          botToken: process.env.TELEGRAM_BOT_TOKEN || '',
          chatId: process.env.TELEGRAM_CHAT_ID || '',
          retryCount: 3,
          retryDelay: 1000
        }
      },
      templates: {
        test: {
          title: 'PoppoBuilder テスト通知',
          body: 'これはテスト通知です: {{message}}'
        },
        task_completed: {
          title: 'タスク処理完了',
          body: 'Issue #{{issueNumber}} の処理が完了しました'
        }
      },
      options: {
        timeout: 5000,
        maxRetries: 3
      }
    }
  };
  
  // ロガーと通知マネージャーを初期化
  const logger = new Logger();
  const notificationManager = new NotificationManager(testConfig, logger);
  
  try {
    // 初期化
    console.log('1. 通知マネージャーを初期化中...');
    await notificationManager.initialize();
    
    // ステータス表示
    const status = notificationManager.getStatus();
    console.log('\n初期化完了:');
    console.log('- 初期化状態:', status.initialized);
    
    const enabledProviders = Object.entries(status.providers)
      .filter(([_, p]) => p.enabled)
      .map(([name, _]) => name);
    
    if (enabledProviders.length === 0) {
      console.log('\n⚠️ 有効なプロバイダがありません！');
      console.log('\n環境変数を設定してください:');
      console.log('- Discord: DISCORD_WEBHOOK_URL');
      console.log('- Pushover: PUSHOVER_API_TOKEN, PUSHOVER_USER_KEY');
      console.log('- Telegram: TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID');
      return;
    }
    
    console.log('- 有効なプロバイダ:', enabledProviders.join(', '));
    
    // テスト通知を送信
    console.log('\n2. テスト通知を送信中...');
    const result = await notificationManager.sendTestNotification();
    
    console.log('\n送信結果:');
    console.log('- 成功:', result.sent);
    console.log('- 失敗:', result.failed);
    
    if (result.errors.length > 0) {
      console.log('- エラー:');
      result.errors.forEach(error => {
        console.log(`  - ${error.provider}: ${error.error}`);
      });
    }
    
    // カスタム通知のテスト
    if (result.sent > 0) {
      console.log('\n3. カスタム通知を送信中...');
      
      const customResult = await notificationManager.notify('task_completed', {
        issueNumber: 999,
        repository: 'medamap/PoppoBuilderSuite',
        url: 'https://github.com/medamap/PoppoBuilderSuite/issues/999',
        message: 'テストタスクが完了しました'
      });
      
      console.log('\nカスタム通知の結果:');
      console.log('- 成功:', customResult.sent);
      console.log('- 失敗:', customResult.failed);
    }
    
  } catch (error) {
    console.error('\nテストエラー:', error.message);
    console.error(error.stack);
  } finally {
    // クリーンアップ
    console.log('\n4. クリーンアップ中...');
    await notificationManager.shutdown();
    console.log('完了');
  }
}

// 環境変数の設定例を表示
function showUsage() {
  console.log('\n使用方法:');
  console.log('1. 環境変数を設定:');
  console.log('   export DISCORD_WEBHOOK_URL="https://discord.com/api/webhooks/..."');
  console.log('   export PUSHOVER_API_TOKEN="your-api-token"');
  console.log('   export PUSHOVER_USER_KEY="your-user-key"');
  console.log('   export TELEGRAM_BOT_TOKEN="your-bot-token"');
  console.log('   export TELEGRAM_CHAT_ID="your-chat-id"');
  console.log('\n2. テストを実行:');
  console.log('   node test/test-notifications.js');
  console.log('\n複数のプロバイダを同時にテストすることも可能です。');
}

// メイン実行
if (require.main === module) {
  testNotifications()
    .then(() => {
      console.log('\n=== テスト完了 ===');
      showUsage();
    })
    .catch(error => {
      console.error('テスト失敗:', error);
      showUsage();
      process.exit(1);
    });
}