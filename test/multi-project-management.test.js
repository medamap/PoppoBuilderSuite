const { expect } = require('chai');
const sinon = require('sinon');
const AdvancedGlobalQueueManager = require('../src/advanced-global-queue-manager');
const ResourceManager = require('../src/resource-manager');
const ProjectConfigManager = require('../src/project-config-manager');
const CrossProjectCoordinator = require('../src/cross-project-coordinator');

describe('マルチプロジェクト高度管理機能', () => {
  let sandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('AdvancedGlobalQueueManager', () => {
    let queueManager;

    beforeEach(async () => {
      queueManager = new AdvancedGlobalQueueManager({
        schedulingAlgorithm: 'weighted-fair',
        resourceQuotaEnabled: true,
        dynamicPriorityEnabled: true
      });
      await queueManager.initialize();
    });

    it('プロジェクトを登録できる', async () => {
      const project = await queueManager.registerProject({
        id: 'test-project',
        name: 'Test Project',
        path: '/test/path',
        priority: 70,
        config: {
          shareWeight: 2.0,
          resourceQuota: {
            cpu: '2000m',
            memory: '2Gi',
            maxConcurrent: 5
          }
        }
      });

      expect(project.id).to.equal('test-project');
      expect(project.config.shareWeight).to.equal(2.0);
      expect(queueManager.projects.has('test-project')).to.be.true;
    });

    it('タスクをエンキューして優先度順に処理できる', async () => {
      // プロジェクトを登録
      await queueManager.registerProject({
        id: 'project1',
        name: 'Project 1',
        path: '/project1',
        priority: 80
      });
      await queueManager.registerProject({
        id: 'project2',
        name: 'Project 2',
        path: '/project2',
        priority: 60
      });

      // タスクをエンキュー
      const task1 = await queueManager.enqueueTask({
        projectId: 'project1',
        issueNumber: 1,
        priority: 50
      });
      const task2 = await queueManager.enqueueTask({
        projectId: 'project2',
        issueNumber: 2,
        priority: 90
      });

      expect(queueManager.queue.length).to.equal(2);
      
      // 次のタスクを取得（優先度が高い方）
      const nextTask = await queueManager.getNextTask();
      expect(nextTask.projectId).to.equal('project1'); // プロジェクト優先度が高い
    });

    it('フェアシェアスケジューリングが機能する', async () => {
      queueManager.config.schedulingAlgorithm = 'weighted-fair';

      await queueManager.registerProject({
        id: 'project1',
        name: 'Project 1',
        path: '/project1',
        config: { shareWeight: 3.0 }
      });
      await queueManager.registerProject({
        id: 'project2',
        name: 'Project 2',
        path: '/project2',
        config: { shareWeight: 1.0 }
      });

      // 複数のタスクをエンキュー
      for (let i = 0; i < 4; i++) {
        await queueManager.enqueueTask({
          projectId: 'project1',
          issueNumber: i + 1,
          priority: 50
        });
        await queueManager.enqueueTask({
          projectId: 'project2',
          issueNumber: i + 1,
          priority: 50
        });
      }

      // タスクを取得して比率を確認
      const project1Tasks = [];
      const project2Tasks = [];

      for (let i = 0; i < 4; i++) {
        const task = await queueManager.getNextTask();
        if (task.projectId === 'project1') {
          project1Tasks.push(task);
        } else {
          project2Tasks.push(task);
        }
        await queueManager.completeTask(task.id);
      }

      // Project1の方が多く処理されているはず
      expect(project1Tasks.length).to.be.greaterThan(project2Tasks.length);
    });

    it('デッドラインを考慮してタスクをスケジューリングできる', async () => {
      queueManager.config.schedulingAlgorithm = 'deadline-aware';

      await queueManager.registerProject({
        id: 'project1',
        name: 'Project 1',
        path: '/project1'
      });

      const now = new Date();
      const task1 = await queueManager.enqueueTask({
        projectId: 'project1',
        issueNumber: 1,
        priority: 50,
        deadline: new Date(now.getTime() + 86400000) // 1日後
      });
      const task2 = await queueManager.enqueueTask({
        projectId: 'project1',
        issueNumber: 2,
        priority: 50,
        deadline: new Date(now.getTime() + 3600000) // 1時間後
      });

      // デッドラインが近いタスクが先に選ばれる
      const nextTask = await queueManager.getNextTask();
      expect(nextTask.issueNumber).to.equal(2);
    });

    it('動的優先度調整が機能する', async () => {
      await queueManager.registerProject({
        id: 'project1',
        name: 'Project 1',
        path: '/project1',
        priority: 50,
        config: {
          scheduling: {
            minThroughput: 10,
            maxLatency: 60000
          }
        }
      });

      // 低いスループットをシミュレート
      const metrics = await queueManager.getProjectMetrics('project1');
      sandbox.stub(queueManager, 'getProjectMetrics').resolves({
        throughput: 5, // 目標の半分
        averageLatency: 120000, // 目標の倍
        successRate: 100
      });

      await queueManager.adjustDynamicPriorities();

      const newPriority = queueManager.schedulingState.dynamicPriorities.get('project1');
      expect(newPriority).to.be.greaterThan(50); // 優先度が上がっている
    });
  });

  describe('ResourceManager', () => {
    let resourceManager;

    beforeEach(async () => {
      resourceManager = new ResourceManager({
        enableQuota: true,
        enableDynamicAllocation: true
      });
      await resourceManager.initialize();
    });

    it('プロジェクトのクォータを設定できる', () => {
      resourceManager.setProjectQuota('project1', {
        cpu: '2000m',
        memory: '4Gi',
        maxConcurrent: 5
      });

      const quota = resourceManager.projectQuotas.get('project1');
      expect(quota.cpu).to.equal(2);
      expect(quota.memory).to.equal(4 * 1024 * 1024 * 1024);
      expect(quota.maxConcurrent).to.equal(5);
    });

    it('リソースを割り当てできる', async () => {
      resourceManager.setProjectQuota('project1', {
        cpu: '2000m',
        memory: '4Gi',
        maxConcurrent: 3
      });

      const result = await resourceManager.allocateResources('project1', 'process1', {
        cpu: '500m',
        memory: '1Gi'
      });

      expect(result.allocated).to.be.true;
      expect(result.resources.cpu).to.equal(0.5);
      expect(result.resources.memory).to.equal(1024 * 1024 * 1024);

      const usage = resourceManager.projectUsage.get('project1');
      expect(usage.cpu).to.equal(0.5);
      expect(usage.concurrent).to.equal(1);
    });

    it('クォータを超えるとリソース割り当てを拒否する', async () => {
      resourceManager.setProjectQuota('project1', {
        cpu: '1000m',
        memory: '1Gi',
        maxConcurrent: 1
      });

      await resourceManager.allocateResources('project1', 'process1', {
        cpu: '800m',
        memory: '512Mi'
      });

      const result = await resourceManager.allocateResources('project1', 'process2', {
        cpu: '500m',
        memory: '512Mi'
      });

      expect(result.allocated).to.be.false;
      expect(result.reason).to.include('CPU quota exceeded');
    });

    it('リソースを解放できる', async () => {
      resourceManager.setProjectQuota('project1', {
        cpu: '2000m',
        memory: '4Gi',
        maxConcurrent: 3
      });

      await resourceManager.allocateResources('project1', 'process1', {
        cpu: '1000m',
        memory: '2Gi'
      });

      await resourceManager.releaseResources('process1');

      const usage = resourceManager.projectUsage.get('project1');
      expect(usage.cpu).to.equal(0);
      expect(usage.memory).to.equal(0);
      expect(usage.concurrent).to.equal(0);
    });

    it('動的リソース再配分が機能する', async () => {
      resourceManager.setProjectQuota('project1', {
        cpu: '2000m',
        memory: '4Gi',
        maxConcurrent: 3,
        priority: 80
      });
      resourceManager.setProjectQuota('project2', {
        cpu: '1000m',
        memory: '2Gi',
        maxConcurrent: 2,
        priority: 50
      });

      // メトリクスをモック
      sandbox.stub(resourceManager, 'collectPerformanceMetrics').resolves(new Map([
        ['project1', {
          cpuUtilization: 0.9,
          memoryUtilization: 0.8,
          throughput: 100,
          priority: 80
        }],
        ['project2', {
          cpuUtilization: 0.2,
          memoryUtilization: 0.3,
          throughput: 20,
          priority: 50
        }]
      ]));

      await resourceManager.performDynamicReallocation();

      // Project1により多くのリソースが割り当てられているはず
      const quota1 = resourceManager.projectQuotas.get('project1');
      const quota2 = resourceManager.projectQuotas.get('project2');
      expect(quota1.cpu).to.be.greaterThan(quota2.cpu);
    });
  });

  describe('ProjectConfigManager', () => {
    let configManager;

    beforeEach(async () => {
      configManager = new ProjectConfigManager({
        enableInheritance: true,
        enableTemplates: true
      });
      await configManager.initialize();
    });

    it('プロジェクト設定を登録できる', async () => {
      const config = await configManager.registerProjectConfig('project1', {
        language: { primary: 'en' },
        claude: { timeout: 300000 }
      });

      expect(config.language.primary).to.equal('en');
      expect(config.claude.timeout).to.equal(300000);
      expect(config._metadata.projectId).to.equal('project1');
    });

    it('テンプレートを適用できる', async () => {
      await configManager.registerTemplate('high-performance', {
        claude: { maxConcurrent: 10 },
        resources: { cpu: '4000m', memory: '8Gi' }
      });

      const config = await configManager.registerProjectConfig('project1', {
        template: 'high-performance',
        language: { primary: 'ja' }
      });

      expect(config.claude.maxConcurrent).to.equal(10);
      expect(config.resources.cpu).to.equal('4000m');
      expect(config.language.primary).to.equal('ja'); // 上書き
    });

    it('設定を継承できる', async () => {
      await configManager.registerProjectConfig('base-project', {
        language: { primary: 'ja' },
        claude: { timeout: 600000 },
        github: { pollingInterval: 60000 }
      });

      const config = await configManager.registerProjectConfig('child-project', {
        extends: 'base-project',
        claude: { timeout: 300000 } // 上書き
      });

      expect(config.language.primary).to.equal('ja'); // 継承
      expect(config.claude.timeout).to.equal(300000); // 上書き
      expect(config.github.pollingInterval).to.equal(60000); // 継承
    });

    it('循環継承を防止する', async () => {
      await configManager.registerProjectConfig('project1', {
        extends: 'project2'
      });

      try {
        await configManager.registerProjectConfig('project2', {
          extends: 'project1'
        });
        expect.fail('循環継承が許可されてしまった');
      } catch (error) {
        expect(error.message).to.include('他のプロジェクトから継承されています');
      }
    });

    it('設定の差分を検出できる', () => {
      configManager.projectConfigs.set('project1', {
        language: { primary: 'ja' },
        claude: { timeout: 600000 },
        github: { pollingInterval: 30000 }
      });

      const diff = configManager.getConfigDiff('project1', {
        language: { primary: 'en' }, // 変更
        claude: { timeout: 600000, maxRetries: 5 }, // 追加
        // github削除
      });

      expect(diff.modified['language.primary']).to.deep.equal({
        old: 'ja',
        new: 'en'
      });
      expect(diff.added['claude.maxRetries']).to.equal(5);
      expect(diff.removed['github']).to.exist;
    });
  });

  describe('CrossProjectCoordinator', () => {
    let coordinator;

    beforeEach(async () => {
      coordinator = new CrossProjectCoordinator({
        enableDependencyTracking: true,
        enableKnowledgeSharing: true,
        enableCrossProjectIssues: true
      });
      await coordinator.initialize();
    });

    it('プロジェクト依存関係を設定できる', async () => {
      await coordinator.setDependency('project1', ['project2', 'project3']);

      const deps = coordinator.getDependencies('project1');
      expect(deps.dependsOn).to.include('project2');
      expect(deps.dependsOn).to.include('project3');

      const revDeps = coordinator.getDependencies('project2');
      expect(revDeps.dependents).to.include('project1');
    });

    it('循環依存を検出できる', async () => {
      await coordinator.setDependency('project1', 'project2');
      await coordinator.setDependency('project2', 'project3');

      try {
        await coordinator.setDependency('project3', 'project1');
        expect.fail('循環依存が検出されなかった');
      } catch (error) {
        expect(error.message).to.include('循環依存が検出されました');
      }
    });

    it('クロスプロジェクトIssueを管理できる', async () => {
      const issue = await coordinator.registerCrossProjectIssue('issue-1', {
        title: 'Cross-project feature',
        description: 'Feature spanning multiple projects',
        projects: ['project1', 'project2', 'project3'],
        priority: 80
      });

      expect(issue.id).to.equal('issue-1');
      expect(issue.projects.size).to.equal(3);
      expect(issue.status).to.equal('open');
    });

    it('知識を共有・検索できる', async () => {
      await coordinator.shareKnowledge('Docker setup', 'How to configure Docker...', {
        projectId: 'project1',
        category: 'deployment',
        tags: ['docker', 'setup'],
        confidence: 0.9
      });

      const results = await coordinator.searchKnowledge('docker', {
        category: 'deployment'
      });

      expect(results.length).to.be.greaterThan(0);
      expect(results[0].knowledge.topic).to.equal('Docker setup');
    });

    it('統合レポートを生成できる', async () => {
      // テストデータの準備
      await coordinator.setDependency('project1', 'project2');
      await coordinator.registerCrossProjectIssue('issue-1', {
        title: 'Test Issue',
        projects: ['project1', 'project2'],
        priority: 90
      });
      await coordinator.shareKnowledge('Test Topic', 'Test content', {
        projectId: 'project1',
        category: 'test'
      });

      const report = await coordinator.generateIntegratedReport();

      expect(report.dependencies.graph).to.exist;
      expect(report.crossProjectIssues.total).to.equal(1);
      expect(report.knowledgeSharing.totalTopics).to.equal(1);
      expect(report.recommendations).to.be.an('array');
    });
  });

  describe('統合テスト', () => {
    let queueManager, resourceManager, configManager, coordinator;

    beforeEach(async () => {
      queueManager = new AdvancedGlobalQueueManager();
      resourceManager = new ResourceManager();
      configManager = new ProjectConfigManager();
      coordinator = new CrossProjectCoordinator();

      await Promise.all([
        queueManager.initialize(),
        resourceManager.initialize(),
        configManager.initialize(),
        coordinator.initialize()
      ]);
    });

    it('複数のコンポーネントが連携して動作する', async () => {
      // プロジェクト設定を登録
      const config = await configManager.registerProjectConfig('integrated-project', {
        resources: { cpu: '2000m', memory: '4Gi' },
        claude: { maxConcurrent: 3 }
      });

      // キューマネージャーにプロジェクトを登録
      await queueManager.registerProject({
        id: 'integrated-project',
        name: 'Integrated Project',
        path: '/integrated',
        config: config.resources
      });

      // リソースマネージャーにクォータを設定
      resourceManager.setProjectQuota('integrated-project', config.resources);

      // タスクをエンキュー
      const task = await queueManager.enqueueTask({
        projectId: 'integrated-project',
        issueNumber: 1,
        priority: 70
      });

      // リソースを割り当て
      const allocation = await resourceManager.allocateResources(
        'integrated-project',
        task.id,
        { cpu: '500m', memory: '1Gi' }
      );

      expect(allocation.allocated).to.be.true;

      // タスクを処理
      const nextTask = await queueManager.getNextTask('integrated-project');
      expect(nextTask).to.exist;
      expect(nextTask.id).to.equal(task.id);

      // タスクを完了
      await queueManager.completeTask(task.id);
      await resourceManager.releaseResources(task.id);

      // 使用状況を確認
      const usage = resourceManager.getResourceUsage('integrated-project');
      expect(usage.cpu.used).to.equal(0);
      expect(usage.concurrent.used).to.equal(0);
    });
  });
});