/**
 * Task Scheduler Tests
 */

const TaskScheduler = require('../../lib/daemon/task-scheduler');
const QueueManager = require('../../lib/daemon/queue-manager');
const assert = require('assert');
const sinon = require('sinon');

describe('TaskScheduler', () => {
  let scheduler;
  let queueManager;
  let clock;

  beforeEach(() => {
    scheduler = new TaskScheduler({
      defaultPollingInterval: 1000,
      minPollingInterval: 100
    });
    queueManager = new QueueManager();
    scheduler.setQueueManager(queueManager);
    clock = sinon.useFakeTimers();
  });

  afterEach(() => {
    clock.restore();
  });

  describe('Project Registration', () => {
    it('should register a project with required fields', () => {
      const projectId = scheduler.registerProject({
        id: 'test-project',
        owner: 'test-owner',
        repo: 'test-repo'
      });

      assert.strictEqual(projectId, 'test-project');
      assert.ok(scheduler.getProject('test-project'));
    });

    it('should throw error for missing required fields', () => {
      assert.throws(() => {
        scheduler.registerProject({ id: 'test' });
      }, /must have id, owner, and repo/);
    });

    it('should unregister a project', () => {
      scheduler.registerProject({
        id: 'test-project',
        owner: 'test-owner',
        repo: 'test-repo'
      });

      const result = scheduler.unregisterProject('test-project');
      assert.strictEqual(result, true);
      assert.strictEqual(scheduler.getProject('test-project'), undefined);
    });
  });

  describe('Polling Control', () => {
    it('should start polling when scheduler starts', async () => {
      const pollingSpy = sinon.spy();
      scheduler.on('polling-started', pollingSpy);

      scheduler.registerProject({
        id: 'test-project',
        owner: 'test-owner',
        repo: 'test-repo',
        pollingInterval: 100
      });

      await scheduler.start();
      clock.tick(100);

      assert.ok(pollingSpy.calledOnce);
    });

    it('should respect project enabled state', async () => {
      const pollingSpy = sinon.spy();
      scheduler.on('polling-started', pollingSpy);

      scheduler.registerProject({
        id: 'test-project',
        owner: 'test-owner',
        repo: 'test-repo',
        enabled: false
      });

      await scheduler.start();
      clock.tick(1000);

      assert.ok(pollingSpy.notCalled);
    });

    it('should allow immediate polling', async () => {
      const mockGitHub = {
        listIssues: sinon.stub().resolves([])
      };

      scheduler.registerProject({
        id: 'test-project',
        owner: 'test-owner',
        repo: 'test-repo'
      });

      const project = scheduler.getProject('test-project');
      project.githubClient = mockGitHub;

      await scheduler.start();
      await scheduler.pollProjectNow('test-project');

      assert.ok(mockGitHub.listIssues.calledOnce);
    });
  });

  describe('Task Discovery', () => {
    it('should discover issues with task labels', async () => {
      const mockIssues = [
        {
          number: 1,
          title: 'Test Issue',
          body: 'Test body',
          labels: [{ name: 'task:feature' }],
          author: { login: 'user' },
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
      ];

      const project = {
        id: 'test',
        owner: 'owner',
        repo: 'repo',
        labels: [],
        excludeLabels: [],
        processComments: false,
        githubClient: {
          listIssues: sinon.stub().resolves(mockIssues)
        }
      };

      const tasks = await scheduler.discoverTasks(project);
      assert.strictEqual(tasks.length, 1);
      assert.strictEqual(tasks[0].type, 'issue-processing');
      assert.strictEqual(tasks[0].issueNumber, 1);
    });

    it('should filter excluded labels', async () => {
      const mockIssues = [
        {
          number: 1,
          title: 'Test Issue',
          body: 'Test body',
          labels: [
            { name: 'task:feature' },
            { name: 'wontfix' }
          ],
          author: { login: 'user' },
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
      ];

      const project = {
        id: 'test',
        owner: 'owner',
        repo: 'repo',
        labels: [],
        excludeLabels: ['wontfix'],
        processComments: false,
        githubClient: {
          listIssues: sinon.stub().resolves(mockIssues)
        }
      };

      const tasks = await scheduler.discoverTasks(project);
      assert.strictEqual(tasks.length, 0);
    });

    it('should discover comment tasks when enabled', async () => {
      const mockIssues = [
        {
          number: 1,
          title: 'Test Issue',
          body: 'Test body',
          labels: [{ name: 'task:feature' }],
          author: { login: 'user' },
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
      ];

      const mockComments = [
        {
          id: 'comment-1',
          body: 'Please fix this issue',
          author: { login: 'user2' },
          createdAt: new Date().toISOString()
        }
      ];

      const project = {
        id: 'test',
        owner: 'owner',
        repo: 'repo',
        labels: [],
        excludeLabels: [],
        processComments: true,
        pollingInterval: 5000,
        githubClient: {
          listIssues: sinon.stub().resolves(mockIssues),
          listComments: sinon.stub().resolves(mockComments)
        }
      };

      const tasks = await scheduler.discoverTasks(project);
      assert.strictEqual(tasks.length, 2);
      assert.strictEqual(tasks[1].type, 'comment-processing');
    });
  });

  describe('Priority Calculation', () => {
    it('should calculate priority based on labels', () => {
      const issue = {
        labels: [
          { name: 'priority:urgent' },
          { name: 'task:bug' }
        ],
        createdAt: new Date().toISOString()
      };

      const priority = scheduler.calculatePriority(issue);
      assert.strictEqual(priority, 100); // Max of urgent (100) and bug (80)
    });

    it('should boost priority for old issues', () => {
      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 10);

      const issue = {
        labels: [{ name: 'task:misc' }],
        createdAt: oldDate.toISOString()
      };

      const priority = scheduler.calculatePriority(issue);
      assert.strictEqual(priority, 50); // misc (40) + age boost (10)
    });
  });

  describe('Error Handling', () => {
    it('should handle polling errors with backoff', async () => {
      const errorSpy = sinon.spy();
      scheduler.on('polling-error', errorSpy);

      const project = {
        id: 'test',
        owner: 'owner',
        repo: 'repo',
        enabled: true,
        pollingInterval: 1000,
        githubClient: {
          listIssues: sinon.stub().rejects(new Error('API Error'))
        }
      };

      scheduler.projects.set('test', project);
      await scheduler.start();

      // Trigger polling
      await scheduler.pollProject('test').catch(() => {});

      assert.ok(errorSpy.calledOnce);
      assert.strictEqual(scheduler.errorCounts.get('test'), 1);
    });
  });

  describe('Statistics', () => {
    it('should provide scheduler statistics', () => {
      scheduler.registerProject({
        id: 'project1',
        owner: 'owner',
        repo: 'repo1',
        enabled: true
      });

      scheduler.registerProject({
        id: 'project2',
        owner: 'owner',
        repo: 'repo2',
        enabled: false
      });

      const stats = scheduler.getStats();
      assert.strictEqual(stats.totalProjects, 2);
      assert.strictEqual(stats.enabledProjects, 1);
      assert.strictEqual(stats.projectStats.length, 2);
    });
  });

  describe('Pause and Resume', () => {
    it('should pause all projects', () => {
      scheduler.registerProject({
        id: 'project1',
        owner: 'owner',
        repo: 'repo1'
      });

      scheduler.registerProject({
        id: 'project2',
        owner: 'owner',
        repo: 'repo2'
      });

      scheduler.pauseAll();

      assert.strictEqual(scheduler.getProject('project1').enabled, false);
      assert.strictEqual(scheduler.getProject('project2').enabled, false);
    });

    it('should resume all projects', () => {
      scheduler.registerProject({
        id: 'project1',
        owner: 'owner',
        repo: 'repo1',
        enabled: false
      });

      scheduler.resumeAll();

      assert.strictEqual(scheduler.getProject('project1').enabled, true);
    });
  });
});