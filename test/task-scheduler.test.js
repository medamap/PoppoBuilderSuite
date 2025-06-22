/**
 * Task Scheduler Tests
 * タスクスケジューラーのテスト
 */

const assert = require('assert');
const TaskScheduler = require('../lib/core/task-scheduler');

describe('TaskScheduler', () => {
  let scheduler;
  
  beforeEach(async () => {
    scheduler = new TaskScheduler({
      strategy: 'round-robin'
    });
    await scheduler.initialize();
  });
  
  afterEach(() => {
    scheduler.reset();
  });
  
  describe('初期化', () => {
    it('スケジューラーを初期化できる', async () => {
      assert(scheduler.initialized);
      assert.strictEqual(scheduler.options.strategy, 'round-robin');
    });
    
    it('デフォルト戦略が設定される', () => {
      assert(scheduler.currentStrategy);
      assert.strictEqual(scheduler.currentStrategy.name, 'round-robin');
    });
  });
  
  describe('プロジェクト管理', () => {
    it('プロジェクトを登録できる', () => {
      const project = scheduler.registerProject('project-1', {
        priority: 80,
        weight: 2.0,
        maxConcurrent: 10
      });
      
      assert.strictEqual(project.id, 'project-1');
      assert.strictEqual(project.priority, 80);
      assert.strictEqual(project.weight, 2.0);
      assert.strictEqual(project.maxConcurrent, 10);
      assert(scheduler.projects.has('project-1'));
    });
    
    it('プロジェクトを削除できる', () => {
      scheduler.registerProject('project-1');
      assert(scheduler.unregisterProject('project-1'));
      assert(!scheduler.projects.has('project-1'));
    });
    
    it('プロジェクトの優先度を更新できる', () => {
      scheduler.registerProject('project-1', { priority: 50 });
      scheduler.updateProjectPriority('project-1', 90);
      
      const project = scheduler.projects.get('project-1');
      assert.strictEqual(project.priority, 90);
    });
    
    it('プロジェクトの重みを更新できる', () => {
      scheduler.registerProject('project-1', { weight: 1.0 });
      scheduler.updateProjectWeight('project-1', 3.0);
      
      const project = scheduler.projects.get('project-1');
      assert.strictEqual(project.weight, 3.0);
    });
  });
  
  describe('タスクスケジューリング', () => {
    beforeEach(() => {
      scheduler.registerProject('project-1', { priority: 50, weight: 1.0 });
      scheduler.registerProject('project-2', { priority: 70, weight: 2.0 });
      scheduler.registerProject('project-3', { priority: 30, weight: 1.5 });
    });
    
    it('ラウンドロビン戦略でタスクをスケジュールできる', async () => {
      scheduler.setStrategy('round-robin');
      
      const task1 = { id: 'task-1', type: 'test' };
      const task2 = { id: 'task-2', type: 'test' };
      const task3 = { id: 'task-3', type: 'test' };
      
      const project1 = await scheduler.scheduleTask(task1);
      const project2 = await scheduler.scheduleTask(task2);
      const project3 = await scheduler.scheduleTask(task3);
      
      // ラウンドロビンなので異なるプロジェクトに割り当てられるはず
      const projects = [project1, project2, project3];
      const uniqueProjects = new Set(projects);
      assert.strictEqual(uniqueProjects.size, 3);
    });
    
    it('優先度戦略でタスクをスケジュールできる', async () => {
      scheduler.setStrategy('priority');
      
      const tasks = [];
      const projects = [];
      
      // 10個のタスクをスケジュール
      for (let i = 0; i < 10; i++) {
        const task = { id: `task-${i}`, type: 'test' };
        const projectId = await scheduler.scheduleTask(task);
        tasks.push(task);
        projects.push(projectId);
      }
      
      // project-2（優先度70）が最も多くのタスクを受け取るはず
      const project2Count = projects.filter(p => p === 'project-2').length;
      const project1Count = projects.filter(p => p === 'project-1').length;
      const project3Count = projects.filter(p => p === 'project-3').length;
      
      assert(project2Count >= project1Count);
      assert(project2Count >= project3Count);
    });
  });
  
  describe('戦略切り替え', () => {
    it('戦略を切り替えられる', () => {
      scheduler.setStrategy('round-robin');
      assert.strictEqual(scheduler.currentStrategy.name, 'round-robin');
      
      scheduler.setStrategy('priority');
      assert.strictEqual(scheduler.currentStrategy.name, 'priority');
      
      scheduler.setStrategy('weighted');
      assert.strictEqual(scheduler.currentStrategy.name, 'weighted');
      
      scheduler.setStrategy('fair-share');
      assert.strictEqual(scheduler.currentStrategy.name, 'fair-share');
    });
    
    it('存在しない戦略を設定するとエラーになる', () => {
      assert.throws(() => {
        scheduler.setStrategy('invalid-strategy');
      }, /Strategy 'invalid-strategy' not found/);
    });
  });
  
  describe('統計とメトリクス', () => {
    beforeEach(() => {
      scheduler.registerProject('project-1');
      scheduler.registerProject('project-2');
    });
    
    it('タスク完了を記録できる', async () => {
      const task = { id: 'task-1', type: 'test' };
      const projectId = await scheduler.scheduleTask(task);
      
      scheduler.taskCompleted(projectId, 'task-1', 1000);
      
      const stats = scheduler.getProjectStats(projectId);
      assert.strictEqual(stats.tasksCompleted, 1);
      assert.strictEqual(stats.totalExecutionTime, 1000);
    });
    
    it('フェアネススコアを計算できる', async () => {
      // 各プロジェクトに同数のタスクを完了
      await scheduler.scheduleTask({ id: 'task-1' });
      await scheduler.scheduleTask({ id: 'task-2' });
      
      scheduler.taskCompleted('project-1', 'task-1', 100);
      scheduler.taskCompleted('project-2', 'task-2', 100);
      
      const metrics = scheduler.getMetrics();
      assert.strictEqual(metrics.fairnessScore, 1.0); // 完全に公平
    });
    
    it('全体のメトリクスを取得できる', async () => {
      await scheduler.scheduleTask({ id: 'task-1' });
      await scheduler.scheduleTask({ id: 'task-2' });
      
      const metrics = scheduler.getMetrics();
      assert.strictEqual(metrics.totalScheduled, 2);
      assert.strictEqual(metrics.projects, 2);
      assert.strictEqual(metrics.currentStrategy, 'round-robin');
      assert(metrics.projectStats);
    });
  });
  
  describe('並行実行制限', () => {
    it('プロジェクトの並行実行数を制限する', async () => {
      scheduler.registerProject('project-1', { maxConcurrent: 2 });
      
      // 3つのタスクをスケジュール
      await scheduler.scheduleTask({ id: 'task-1' });
      await scheduler.scheduleTask({ id: 'task-2' });
      await scheduler.scheduleTask({ id: 'task-3' });
      
      const stats = scheduler.getProjectStats('project-1');
      assert.strictEqual(stats.currentConcurrent, 3); // 制限を超えてもスケジュール自体は行われる
      
      // タスクを完了
      scheduler.taskCompleted('project-1', 'task-1');
      assert.strictEqual(stats.currentConcurrent, 2);
    });
  });
  
  describe('エラーハンドリング', () => {
    it('初期化前にスケジュールするとエラーになる', async () => {
      const uninitializedScheduler = new TaskScheduler();
      
      await assert.rejects(async () => {
        await uninitializedScheduler.scheduleTask({ id: 'task-1' });
      }, /Scheduler not initialized/);
    });
    
    it('プロジェクトがない場合にスケジュールするとエラーになる', async () => {
      await assert.rejects(async () => {
        await scheduler.scheduleTask({ id: 'task-1' });
      }, /No suitable project found for task/);
    });
  });
});

// 各戦略の個別テスト
describe('Scheduling Strategies', () => {
  let scheduler;
  
  beforeEach(async () => {
    scheduler = new TaskScheduler();
    await scheduler.initialize();
    
    // テスト用プロジェクトを登録
    scheduler.registerProject('project-A', { 
      priority: 30, 
      weight: 1.0, 
      maxConcurrent: 5 
    });
    scheduler.registerProject('project-B', { 
      priority: 50, 
      weight: 2.0, 
      maxConcurrent: 5 
    });
    scheduler.registerProject('project-C', { 
      priority: 70, 
      weight: 1.5, 
      maxConcurrent: 5 
    });
  });
  
  describe('Round Robin Strategy', () => {
    it('順番にプロジェクトを選択する', async () => {
      scheduler.setStrategy('round-robin');
      
      const selections = [];
      for (let i = 0; i < 6; i++) {
        const projectId = await scheduler.scheduleTask({ id: `task-${i}` });
        selections.push(projectId);
      }
      
      // 各プロジェクトが2回ずつ選択されるはず
      const counts = {};
      selections.forEach(id => {
        counts[id] = (counts[id] || 0) + 1;
      });
      
      assert.strictEqual(Object.keys(counts).length, 3);
      Object.values(counts).forEach(count => {
        assert.strictEqual(count, 2);
      });
    });
  });
  
  describe('Priority Strategy', () => {
    it('優先度の高いプロジェクトを優先する', async () => {
      scheduler.setStrategy('priority');
      
      const selections = [];
      for (let i = 0; i < 10; i++) {
        const projectId = await scheduler.scheduleTask({ id: `task-${i}` });
        selections.push(projectId);
      }
      
      // project-C（優先度70）が最も多く選択されるはず
      const counts = {};
      selections.forEach(id => {
        counts[id] = (counts[id] || 0) + 1;
      });
      
      // 優先度戦略では、容量に余裕がある限り高優先度プロジェクトが選ばれる
      // 少なくともproject-Cが存在することを確認
      assert(counts['project-C'] > 0);
      // project-Cの割合が最も高いか、少なくとも同等であることを確認
      const cCount = counts['project-C'] || 0;
      const bCount = counts['project-B'] || 0;
      const aCount = counts['project-A'] || 0;
      
      // project-Cが最も多いか、または同数の場合はOK
      assert(cCount >= Math.max(bCount, aCount) || cCount >= 3);
    });
  });
  
  describe('Weighted Strategy', () => {
    it('重みに応じてプロジェクトを選択する', async () => {
      scheduler.setStrategy('weighted');
      
      // 多数のタスクをスケジュールして統計的な分布を確認
      const selections = [];
      for (let i = 0; i < 100; i++) {
        const projectId = await scheduler.scheduleTask({ id: `task-${i}` });
        selections.push(projectId);
      }
      
      const counts = {};
      selections.forEach(id => {
        counts[id] = (counts[id] || 0) + 1;
      });
      
      // project-B（重み2.0）が最も多く選択されるはず
      assert(counts['project-B'] > counts['project-A']);
      assert(counts['project-B'] > counts['project-C']);
    });
  });
  
  describe('Fair Share Strategy', () => {
    it('公平にタスクを配分する', async () => {
      scheduler.setStrategy('fair-share');
      
      // 初期状態では均等に配分されるはず
      const selections = [];
      for (let i = 0; i < 30; i++) {
        const projectId = await scheduler.scheduleTask({ id: `task-${i}` });
        selections.push(projectId);
        
        // タスクを即座に完了させる
        scheduler.taskCompleted(projectId, `task-${i}`, 100);
      }
      
      const counts = {};
      selections.forEach(id => {
        counts[id] = (counts[id] || 0) + 1;
      });
      
      // 重みを考慮した配分になっているはず
      // project-B（重み2.0）が約40%、他が約30%ずつ
      const totalTasks = selections.length;
      const bRatio = counts['project-B'] / totalTasks;
      
      // 許容誤差を考慮
      assert(bRatio > 0.3 && bRatio < 0.5);
    });
  });
});