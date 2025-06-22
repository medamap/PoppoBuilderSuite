/**
 * List Command Tests
 */

const { expect } = require('chai');
const sinon = require('sinon');
const colors = require('colors');

describe('ListCommand', () => {
  let ListCommand;
  let listCommand;
  let sandbox;
  let mockProjectRegistry;
  let mockProjects;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    
    // Load ListCommand
    ListCommand = require('../lib/commands/list');
    listCommand = new ListCommand();
    
    // Mock projects data
    mockProjects = {
      'project1-abc123': {
        path: '/home/user/project1',
        enabled: true,
        createdAt: '2025-06-20T10:00:00Z',
        updatedAt: '2025-06-21T08:00:00Z',
        config: {
          name: 'Project One',
          description: 'First test project',
          priority: 80,
          tags: ['web', 'api'],
          github: {
            owner: 'testuser',
            repo: 'project1'
          },
          resources: {
            maxConcurrent: 3,
            cpuWeight: 2.0,
            memoryLimit: '1G'
          }
        },
        stats: {
          totalIssuesProcessed: 15,
          totalErrors: 2,
          averageProcessingTime: 1500,
          lastActivityAt: '2025-06-21T07:30:00Z'
        }
      },
      'project2-def456': {
        path: '/home/user/project2',
        enabled: false,
        createdAt: '2025-06-19T15:00:00Z',
        updatedAt: '2025-06-20T12:00:00Z',
        config: {
          name: 'Project Two',
          description: 'Second test project',
          priority: 50,
          tags: ['mobile', 'app']
        },
        stats: {
          totalIssuesProcessed: 0,
          totalErrors: 0,
          averageProcessingTime: 0
        }
      },
      'project3-ghi789': {
        path: '/home/user/project3',
        enabled: true,
        createdAt: '2025-06-21T09:00:00Z',
        updatedAt: '2025-06-21T09:00:00Z',
        config: {
          name: 'Project Three',
          priority: 90,
          tags: ['web', 'frontend']
        },
        stats: {
          totalIssuesProcessed: 5,
          totalErrors: 0,
          averageProcessingTime: 800,
          lastActivityAt: '2025-06-21T09:30:00Z'
        }
      }
    };

    // Mock ProjectRegistry
    mockProjectRegistry = {
      initialize: sandbox.stub().resolves(),
      getAllProjects: sandbox.stub().returns(mockProjects),
      getEnabledProjects: sandbox.stub().returns({
        'project1-abc123': mockProjects['project1-abc123'],
        'project3-ghi789': mockProjects['project3-ghi789']
      })
    };

    // Mock i18n
    const i18n = require('../lib/i18n');
    sandbox.stub(i18n, 'init').resolves();
    sandbox.stub(i18n, 't').returns('Test message');
    
    // Mock project registry instance
    sandbox.stub(require('../lib/core/project-registry'), 'getInstance').returns(mockProjectRegistry);
    
    // Mock console.log to capture output
    sandbox.stub(console, 'log');
    sandbox.stub(console, 'error');
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('execute', () => {
    it('should display all projects by default', async () => {
      const options = {};
      
      await listCommand.execute(options);
      
      expect(mockProjectRegistry.initialize.called).to.be.true;
      expect(mockProjectRegistry.getAllProjects.called).to.be.true;
      expect(console.log.called).to.be.true;
      
      // Check that project names are displayed
      const output = console.log.getCalls().map(call => call.args.join(' ')).join('\n');
      expect(output).to.include('Project One');
      expect(output).to.include('Project Two');
      expect(output).to.include('Project Three');
    });

    it('should filter enabled projects only', async () => {
      const options = { enabled: true };
      
      await listCommand.execute(options);
      
      expect(mockProjectRegistry.getEnabledProjects.called).to.be.true;
      
      const output = console.log.getCalls().map(call => call.args.join(' ')).join('\n');
      expect(output).to.include('Project One');
      expect(output).to.not.include('Project Two'); // disabled
      expect(output).to.include('Project Three');
    });

    it('should filter projects by tag', async () => {
      const options = { tag: 'web' };
      
      await listCommand.execute(options);
      
      const output = console.log.getCalls().map(call => call.args.join(' ')).join('\n');
      expect(output).to.include('Project One'); // has 'web' tag
      expect(output).to.not.include('Project Two'); // has 'mobile' tag
      expect(output).to.include('Project Three'); // has 'web' tag
    });

    it('should output JSON format', async () => {
      const options = { json: true };
      
      await listCommand.execute(options);
      
      // Should call console.log with JSON string
      const jsonCalls = console.log.getCalls().filter(call => {
        try {
          JSON.parse(call.args[0]);
          return true;
        } catch {
          return false;
        }
      });
      
      expect(jsonCalls.length).to.be.greaterThan(0);
    });

    it('should handle empty project list', async () => {
      mockProjectRegistry.getAllProjects.returns({});
      const options = {};
      
      await listCommand.execute(options);
      
      const output = console.log.getCalls().map(call => call.args.join(' ')).join('\n');
      expect(output).to.include('No projects registered yet');
    });
  });

  describe('sortProjects', () => {
    it('should sort by name by default', () => {
      const projectIds = Object.keys(mockProjects);
      
      const sorted = listCommand.sortProjects(projectIds, mockProjects, 'name');
      
      expect(sorted[0]).to.equal('project1-abc123'); // Project One
      expect(sorted[1]).to.equal('project3-ghi789'); // Project Three  
      expect(sorted[2]).to.equal('project2-def456'); // Project Two
    });

    it('should sort by priority descending', () => {
      const projectIds = Object.keys(mockProjects);
      
      const sorted = listCommand.sortProjects(projectIds, mockProjects, 'priority');
      
      expect(sorted[0]).to.equal('project3-ghi789'); // priority 90
      expect(sorted[1]).to.equal('project1-abc123'); // priority 80
      expect(sorted[2]).to.equal('project2-def456'); // priority 50
    });

    it('should sort by creation date descending', () => {
      const projectIds = Object.keys(mockProjects);
      
      const sorted = listCommand.sortProjects(projectIds, mockProjects, 'created');
      
      expect(sorted[0]).to.equal('project3-ghi789'); // 2025-06-21
      expect(sorted[1]).to.equal('project1-abc123'); // 2025-06-20
      expect(sorted[2]).to.equal('project2-def456'); // 2025-06-19
    });

    it('should sort by last activity descending', () => {
      const projectIds = Object.keys(mockProjects);
      
      const sorted = listCommand.sortProjects(projectIds, mockProjects, 'activity');
      
      expect(sorted[0]).to.equal('project3-ghi789'); // 09:30
      expect(sorted[1]).to.equal('project1-abc123'); // 07:30
      expect(sorted[2]).to.equal('project2-def456'); // no activity
    });
  });

  describe('buildTableRow', () => {
    it('should build correct table row for project', () => {
      const project = mockProjects['project1-abc123'];
      const options = {};
      
      const row = listCommand.buildTableRow('project1-abc123', project, options);
      
      expect(row[0]).to.equal('project1-abc123'); // ID
      expect(row[1]).to.equal('Project One'); // Name
      expect(row[2]).to.equal('enabled'); // Status
      expect(row[3]).to.equal('80'); // Priority
      expect(row[4]).to.include('/home/user/project1'); // Path
    });

    it('should include verbose information in table row', () => {
      const project = mockProjects['project1-abc123'];
      const options = { verbose: true };
      
      const row = listCommand.buildTableRow('project1-abc123', project, options);
      
      expect(row).to.have.length(8); // Base 5 + 3 verbose columns
      expect(row[5]).to.equal('15'); // Issues processed
      expect(row[6]).to.equal('2'); // Errors
      expect(row[7]).to.include('2025'); // Last activity date
    });
  });

  describe('truncatePath', () => {
    it('should not truncate short paths', () => {
      const shortPath = '/home/user';
      
      const result = listCommand.truncatePath(shortPath, 50);
      
      expect(result).to.equal(shortPath);
    });

    it('should truncate long paths appropriately', () => {
      const longPath = '/very/long/path/to/some/deeply/nested/project/directory';
      
      const result = listCommand.truncatePath(longPath, 30);
      
      expect(result).to.have.length.at.most(30);
      expect(result).to.include('...');
    });

    it('should preserve important path parts', () => {
      const path = '/home/user/important-project';
      
      const result = listCommand.truncatePath(path, 20);
      
      expect(result).to.include('important-project');
    });
  });

  describe('calculateColumnWidths', () => {
    it('should calculate appropriate column widths', () => {
      const projectIds = Object.keys(mockProjects);
      const headers = ['ID', 'Name', 'Status', 'Priority', 'Path'];
      const options = {};
      
      const widths = listCommand.calculateColumnWidths(projectIds, mockProjects, headers, options);
      
      expect(widths).to.be.an('array');
      expect(widths).to.have.length(5);
      expect(widths.every(w => w >= 2)).to.be.true; // All widths should be reasonable
    });

    it('should respect maximum width limits', () => {
      const projectIds = Object.keys(mockProjects);
      const headers = ['ID', 'Name', 'Status', 'Priority', 'Path'];
      const options = {};
      
      const widths = listCommand.calculateColumnWidths(projectIds, mockProjects, headers, options);
      
      expect(widths[0]).to.be.at.most(20); // ID column max
      expect(widths[4]).to.be.at.most(40); // Path column max
    });
  });

  describe('integration features', () => {
    it('should have all required methods', () => {
      expect(listCommand.execute).to.be.a('function');
      expect(listCommand.sortProjects).to.be.a('function');
      expect(listCommand.outputDefault).to.be.a('function');
      expect(listCommand.outputTable).to.be.a('function');
      expect(listCommand.outputJson).to.be.a('function');
      expect(listCommand.displayProject).to.be.a('function');
      expect(listCommand.showSummary).to.be.a('function');
    });

    it('should handle various options combinations', async () => {
      const options = { 
        enabled: true, 
        sort: 'priority', 
        verbose: true,
        table: true
      };
      
      // Should not throw error
      await listCommand.execute(options);
      
      expect(console.log.called).to.be.true;
    });
  });
});