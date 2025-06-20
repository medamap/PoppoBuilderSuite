#!/usr/bin/env node
/**
 * GitHub Projects統合テスト
 */

const GitHubProjectsClient = require('../src/github-projects-client');
const GitHubProjectsSync = require('../src/github-projects-sync');

// テスト用のロガー
const logger = {
  info: console.log,
  error: console.error,
  warn: console.warn
};

// テスト用の設定
const config = {
  githubProjects: {
    enabled: true,
    token: process.env.GITHUB_TOKEN,
    syncInterval: 60000,
    projects: [
      {
        id: process.env.GITHUB_PROJECT_ID || 'PVT_kwDOBq5-Ys4Aj5Xv',
        name: 'Test Project',
        autoAdd: true,
        autoArchive: false,
        statusMapping: {
          'pending': 'Todo',
          'processing': 'In Progress',
          'awaiting-response': 'In Review',
          'completed': 'Done',
          'error': 'Blocked'
        }
      }
    ]
  }
};

// GitHub設定
const githubConfig = {
  owner: 'medamap',
  repo: 'PoppoBuilderSuite'
};

// StatusManagerのモック
class MockStatusManager {
  constructor() {
    this.statuses = new Map();
    this.listeners = new Map();
  }
  
  on(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event).push(callback);
  }
  
  emit(event, ...args) {
    const callbacks = this.listeners.get(event) || [];
    callbacks.forEach(cb => cb(...args));
  }
  
  async updateStatus(issueNumber, status, metadata) {
    const oldStatus = this.statuses.get(issueNumber);
    this.statuses.set(issueNumber, status);
    this.emit('status-changed', issueNumber, status, oldStatus);
    console.log(`📝 StatusManager: Issue #${issueNumber} を ${status} に更新`);
  }
}

async function runTests() {
  console.log('GitHub Projects統合テストを開始します...\n');
  
  if (!process.env.GITHUB_TOKEN) {
    console.error('❌ GITHUB_TOKEN環境変数が設定されていません');
    process.exit(1);
  }
  
  // 1. GitHubProjectsClientのテスト
  console.log('1️⃣ GitHubProjectsClientのテスト');
  const projectsClient = new GitHubProjectsClient(process.env.GITHUB_TOKEN, logger);
  
  try {
    // プロジェクト一覧を取得
    console.log('\n📋 プロジェクト一覧を取得中...');
    const projects = await projectsClient.listProjects('medamap', false);
    console.log(`見つかったプロジェクト: ${projects.length}件`);
    
    if (projects.length > 0) {
      projects.forEach(p => {
        console.log(`  - ${p.title} (ID: ${p.id}, Number: #${p.number})`);
      });
      
      // 最初のプロジェクトの詳細を取得
      const projectId = projects[0].id;
      console.log(`\n📊 プロジェクト '${projects[0].title}' の詳細を取得中...`);
      const project = await projectsClient.getProject(projectId);
      
      // ステータスフィールドを確認
      const statusField = project.fields.nodes.find(f => f.name === 'Status' && f.options);
      if (statusField) {
        console.log('ステータスフィールドが見つかりました:');
        statusField.options.forEach(opt => {
          console.log(`  - ${opt.name} (ID: ${opt.id})`);
        });
      }
      
      // プロジェクトアイテムを取得
      console.log(`\n📌 プロジェクトアイテムを取得中...`);
      const items = await projectsClient.getProjectItems(projectId, 10);
      console.log(`アイテム数: ${items.length}`);
      
      if (items.length > 0) {
        items.slice(0, 3).forEach(item => {
          if (item.content) {
            console.log(`  - Issue #${item.content.number}: ${item.content.title}`);
          }
        });
      }
    }
    
  } catch (error) {
    console.error('❌ GitHubProjectsClientテストエラー:', error.message);
  }
  
  // 2. GitHubProjectsSyncのテスト
  console.log('\n\n2️⃣ GitHubProjectsSyncのテスト');
  const statusManager = new MockStatusManager();
  const projectsSync = new GitHubProjectsSync(config, githubConfig, statusManager, logger);
  
  try {
    // 初期化
    console.log('\n🚀 GitHub Projects同期を初期化中...');
    await projectsSync.initialize();
    console.log('✅ 初期化完了');
    
    // イベントリスナーを設定
    projectsSync.on('item-added', (data) => {
      console.log(`📥 アイテム追加: Issue #${data.issueNumber}`);
    });
    
    projectsSync.on('status-updated', (data) => {
      console.log(`🔄 ステータス更新: Issue #${data.issueNumber} → ${data.newStatus}`);
    });
    
    projectsSync.on('item-archived', (data) => {
      console.log(`📦 アーカイブ: Issue #${data.issueNumber}`);
    });
    
    // ステータス同期のテスト
    console.log('\n🔄 ステータス同期のテスト');
    console.log('Issue #92 のステータスを processing に変更...');
    await statusManager.updateStatus(92, 'processing');
    
    // 少し待つ
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // プロジェクトからの同期テスト
    if (config.githubProjects.projects.length > 0) {
      console.log('\n🔃 プロジェクトからの逆同期テスト');
      try {
        await projectsSync.syncFromProject(config.githubProjects.projects[0].id);
        console.log('✅ 逆同期完了');
      } catch (error) {
        console.log('⚠️ 逆同期エラー（プロジェクトが存在しない可能性）:', error.message);
      }
    }
    
    // 進捗レポート生成
    if (config.githubProjects.projects.length > 0) {
      console.log('\n📊 進捗レポート生成テスト');
      try {
        const report = await projectsSync.generateProgressReport(config.githubProjects.projects[0].id);
        console.log('進捗レポート:');
        console.log(`  プロジェクト: ${report.projectTitle}`);
        console.log(`  総アイテム数: ${report.totalItems}`);
        console.log(`  完了数: ${report.completedCount}`);
        console.log(`  進捗率: ${report.progressRate}`);
        console.log(`  ステータス別:`, report.statusCount);
      } catch (error) {
        console.log('⚠️ レポート生成エラー:', error.message);
      }
    }
    
    // クリーンアップ
    await projectsSync.cleanup();
    console.log('\n✅ テスト完了');
    
  } catch (error) {
    console.error('❌ GitHubProjectsSyncテストエラー:', error.message);
  }
}

// テスト実行
runTests().catch(console.error);