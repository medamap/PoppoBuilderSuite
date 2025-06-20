#!/usr/bin/env node
/**
 * GitHub Projects統合テスト
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs').promises;
const TestHelper = require('./test-helper');

async function runTests() {
  const helper = new TestHelper();
  let passed = 0;
  let failed = 0;

  console.log('🔗 GitHub Projects統合テストを開始します...\n');

  try {
    // テスト1: GitHubProjectsClientの基本動作
    console.log('📋 テスト1: GitHubProjectsClientの基本動作');
    try {
      const GitHubProjectsClient = require('../../src/github-projects-client');
      
      // モッククライアントを作成
      const mockClient = {
        graphql: async (query, variables) => {
          // プロジェクト一覧のクエリ
          if (query.includes('user(login:')) {
            return {
              user: {
                projectsV2: {
                  nodes: [
                    {
                      id: 'PVT_test_project_1',
                      title: 'Test Project 1',
                      number: 1,
                      fields: {
                        nodes: [
                          {
                            __typename: 'ProjectV2SingleSelectField',
                            id: 'PVTF_status_field',
                            name: 'Status',
                            options: [
                              { id: 'PVTO_todo', name: 'Todo' },
                              { id: 'PVTO_in_progress', name: 'In Progress' },
                              { id: 'PVTO_done', name: 'Done' }
                            ]
                          }
                        ]
                      }
                    }
                  ]
                }
              }
            };
          }
          
          // プロジェクト詳細のクエリ
          if (query.includes('node(id:')) {
            return {
              node: {
                id: variables.projectId,
                title: 'Test Project',
                number: 1,
                fields: {
                  nodes: [
                    {
                      __typename: 'ProjectV2SingleSelectField',
                      id: 'PVTF_status_field',
                      name: 'Status',
                      options: [
                        { id: 'PVTO_todo', name: 'Todo' },
                        { id: 'PVTO_done', name: 'Done' }
                      ]
                    }
                  ]
                }
              }
            };
          }
          
          return {};
        }
      };

      const client = new GitHubProjectsClient('test-token', console);
      client.octokit = mockClient;

      // プロジェクト一覧を取得
      const projects = await client.listProjects('test-user', false);
      assert(projects.length > 0, 'プロジェクトが取得されませんでした');
      assert(projects[0].id === 'PVT_test_project_1', 'プロジェクトIDが正しくありません');

      // プロジェクト詳細を取得
      const project = await client.getProject('PVT_test_project_1');
      assert(project.title === 'Test Project', 'プロジェクトタイトルが正しくありません');
      assert(project.fields.nodes.length > 0, 'フィールドが取得されませんでした');

      console.log('✅ GitHubProjectsClientが正常に動作しました');
      passed++;
    } catch (error) {
      console.error('❌ エラー:', error.message);
      failed++;
    }

    // テスト2: StatusManagerとの連携
    console.log('\n📋 テスト2: StatusManagerとの連携');
    try {
      const GitHubProjectsSync = require('../../src/github-projects-sync');
      const StatusManager = require('../../src/status-manager');
      
      const tempDir = await helper.createTempDir('status-sync-');
      const stateFile = path.join(tempDir, 'issue-status.json');
      
      // StatusManagerを初期化
      const statusManager = new StatusManager(stateFile, console);
      await statusManager.initialize();

      // モックGitHubProjectsClient
      const mockProjectsClient = {
        getProject: async (projectId) => ({
          id: projectId,
          title: 'Test Project',
          fields: {
            nodes: [{
              __typename: 'ProjectV2SingleSelectField',
              id: 'PVTF_status',
              name: 'Status',
              options: [
                { id: 'PVTO_todo', name: 'Todo' },
                { id: 'PVTO_in_progress', name: 'In Progress' },
                { id: 'PVTO_done', name: 'Done' }
              ]
            }]
          }
        }),
        getProjectItems: async (projectId) => ([
          {
            id: 'PVTI_item_1',
            content: {
              __typename: 'Issue',
              number: 123,
              title: 'Test Issue'
            },
            fieldValues: {
              nodes: [{
                __typename: 'ProjectV2ItemFieldSingleSelectValue',
                field: { name: 'Status' },
                value: { name: 'In Progress' }
              }]
            }
          }
        ]),
        updateItemStatus: async (projectId, itemId, fieldId, optionId) => true,
        addIssueToProject: async (projectId, issueId) => ({
          id: 'PVTI_new_item'
        })
      };

      // GitHubProjectsSyncを初期化
      const config = {
        githubProjects: {
          enabled: true,
          projects: [{
            id: 'PVT_test_project',
            name: 'Test Project',
            autoAdd: true,
            statusMapping: {
              'pending': 'Todo',
              'processing': 'In Progress',
              'completed': 'Done'
            }
          }]
        }
      };

      const githubConfig = {
        owner: 'test-owner',
        repo: 'test-repo'
      };

      const sync = new GitHubProjectsSync(config, githubConfig, statusManager, console);
      sync.projectsClient = mockProjectsClient;

      // イベントを監視
      const events = [];
      sync.on('status-updated', (event) => events.push(event));

      // 初期化
      await sync.initialize();

      // StatusManagerでステータス変更をシミュレート
      await statusManager.updateStatus(123, 'processing', {
        processId: 'test-process',
        taskType: 'test'
      });

      // 同期を待機
      await helper.wait(100);

      // イベントが発生したか確認
      const updateEvent = events.find(e => e.issueNumber === 123);
      assert(updateEvent, 'status-updatedイベントが発生していません');

      console.log('✅ StatusManagerとの連携が正常に動作しました');
      passed++;

      // クリーンアップ
      await sync.cleanup();
      await statusManager.cleanup();
    } catch (error) {
      console.error('❌ エラー:', error.message);
      failed++;
    }

    // テスト3: 双方向同期の動作確認
    console.log('\n📋 テスト3: 双方向同期の動作確認');
    try {
      const GitHubProjectsSync = require('../../src/github-projects-sync');
      const StatusManager = require('../../src/status-manager');
      
      const tempDir = await helper.createTempDir('bidirectional-');
      const statusManager = new StatusManager(
        path.join(tempDir, 'issue-status.json'),
        console
      );
      await statusManager.initialize();

      // プロジェクトアイテムの状態を保持
      let projectItems = new Map([
        ['PVTI_1', {
          id: 'PVTI_1',
          content: { number: 100, title: 'Issue 100' },
          fieldValues: {
            nodes: [{
              __typename: 'ProjectV2ItemFieldSingleSelectValue',
              field: { name: 'Status' },
              value: { name: 'Todo' }
            }]
          }
        }]
      ]);

      // モッククライアント
      const mockProjectsClient = {
        getProject: async () => ({
          id: 'PVT_test',
          fields: {
            nodes: [{
              __typename: 'ProjectV2SingleSelectField',
              id: 'PVTF_status',
              name: 'Status',
              options: [
                { id: 'PVTO_todo', name: 'Todo' },
                { id: 'PVTO_in_progress', name: 'In Progress' },
                { id: 'PVTO_done', name: 'Done' }
              ]
            }]
          }
        }),
        getProjectItems: async () => Array.from(projectItems.values()),
        updateItemStatus: async (projectId, itemId, fieldId, optionId) => {
          // ステータスを更新
          const item = projectItems.get(itemId);
          if (item) {
            const option = ['Todo', 'In Progress', 'Done'].find(
              name => `PVTO_${name.toLowerCase().replace(' ', '_')}` === optionId
            );
            item.fieldValues.nodes[0].value.name = option;
          }
          return true;
        }
      };

      const config = {
        githubProjects: {
          enabled: true,
          syncInterval: 100, // 短い間隔でテスト
          projects: [{
            id: 'PVT_test',
            statusMapping: {
              'pending': 'Todo',
              'processing': 'In Progress',
              'completed': 'Done'
            }
          }]
        }
      };

      const sync = new GitHubProjectsSync(
        config,
        { owner: 'test', repo: 'test' },
        statusManager,
        console
      );
      sync.projectsClient = mockProjectsClient;

      await sync.initialize();

      // PoppoBuilder → Projects 方向の同期
      await statusManager.updateStatus(100, 'processing');
      await helper.wait(200);

      const item = projectItems.get('PVTI_1');
      assert(
        item.fieldValues.nodes[0].value.name === 'In Progress',
        'プロジェクトのステータスが更新されていません'
      );

      // Projects → PoppoBuilder 方向の同期
      item.fieldValues.nodes[0].value.name = 'Done';
      await sync.syncFromProject('PVT_test');
      
      const status = await statusManager.getStatus(100);
      assert(status.status === 'completed', 'StatusManagerが更新されていません');

      console.log('✅ 双方向同期が正常に動作しました');
      passed++;

      await sync.cleanup();
      await statusManager.cleanup();
    } catch (error) {
      console.error('❌ エラー:', error.message);
      failed++;
    }

    // テスト4: レポート生成機能
    console.log('\n📋 テスト4: レポート生成機能');
    try {
      const GitHubProjectsSync = require('../../src/github-projects-sync');
      
      // モッククライアント
      const mockProjectsClient = {
        getProject: async () => ({
          id: 'PVT_report_test',
          title: 'Report Test Project',
          fields: { nodes: [] }
        }),
        getProjectItems: async () => ([
          {
            content: { number: 1, title: 'Issue 1' },
            fieldValues: {
              nodes: [{
                field: { name: 'Status' },
                value: { name: 'Done' }
              }]
            }
          },
          {
            content: { number: 2, title: 'Issue 2' },
            fieldValues: {
              nodes: [{
                field: { name: 'Status' },
                value: { name: 'In Progress' }
              }]
            }
          },
          {
            content: { number: 3, title: 'Issue 3' },
            fieldValues: {
              nodes: [{
                field: { name: 'Status' },
                value: { name: 'Todo' }
              }]
            }
          }
        ])
      };

      const sync = new GitHubProjectsSync(
        { githubProjects: { projects: [] } },
        { owner: 'test', repo: 'test' },
        { on: () => {} }, // モックStatusManager
        console
      );
      sync.projectsClient = mockProjectsClient;

      const report = await sync.generateProgressReport('PVT_report_test');
      
      assert(report.projectTitle === 'Report Test Project', 'プロジェクトタイトルが正しくありません');
      assert(report.totalItems === 3, 'アイテム数が正しくありません');
      assert(report.completedCount === 1, '完了数が正しくありません');
      assert(report.progressRate === '33.33%', '進捗率が正しくありません');
      assert(report.statusCount['Done'] === 1, 'ステータスカウントが正しくありません');
      assert(report.statusCount['In Progress'] === 1, 'ステータスカウントが正しくありません');
      assert(report.statusCount['Todo'] === 1, 'ステータスカウントが正しくありません');

      console.log('✅ レポート生成が正常に動作しました');
      passed++;
    } catch (error) {
      console.error('❌ エラー:', error.message);
      failed++;
    }

    // テスト5: エラー処理とリトライ
    console.log('\n📋 テスト5: エラー処理とリトライ');
    try {
      const GitHubProjectsSync = require('../../src/github-projects-sync');
      
      let callCount = 0;
      const mockProjectsClient = {
        getProject: async () => {
          callCount++;
          if (callCount < 2) {
            throw new Error('一時的なエラー');
          }
          return {
            id: 'PVT_retry_test',
            fields: { nodes: [] }
          };
        },
        updateItemStatus: async () => {
          throw new Error('更新エラー');
        }
      };

      const sync = new GitHubProjectsSync(
        { githubProjects: { projects: [{ id: 'PVT_retry_test' }] } },
        { owner: 'test', repo: 'test' },
        { on: () => {} },
        console
      );
      sync.projectsClient = mockProjectsClient;

      // 初期化（リトライが成功するはず）
      await sync.initialize();
      assert(callCount >= 2, 'リトライが実行されませんでした');

      // 更新エラーのハンドリング
      try {
        await sync.syncIssueStatus(123, 'processing');
      } catch (error) {
        // エラーが適切にハンドリングされることを確認
        assert(error.message.includes('更新エラー'), 'エラーメッセージが正しくありません');
      }

      console.log('✅ エラー処理とリトライが正常に動作しました');
      passed++;
    } catch (error) {
      console.error('❌ エラー:', error.message);
      failed++;
    }

  } finally {
    // クリーンアップ
    await helper.cleanup();
  }

  // 結果サマリー
  console.log('\n📊 テスト結果サマリー');
  console.log(`✅ 成功: ${passed}`);
  console.log(`❌ 失敗: ${failed}`);
  console.log(`🏁 合計: ${passed + failed}`);

  process.exit(failed > 0 ? 1 : 0);
}

// テスト実行
runTests().catch(error => {
  console.error('致命的なエラー:', error);
  process.exit(1);
});