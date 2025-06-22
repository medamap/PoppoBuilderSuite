const { expect } = require('chai');
const sinon = require('sinon');
const fs = require('fs');
const path = require('path');
const LogSearchAPI = require('../dashboard/server/api/logs');

describe('Dashboard Log Search API', () => {
  let logSearchAPI;
  let mockLogger;
  let sandbox;
  let mockApp;
  let mockReq;
  let mockRes;
  
  beforeEach(() => {
    sandbox = sinon.createSandbox();
    mockLogger = {
      error: sinon.stub(),
      info: sinon.stub()
    };
    
    logSearchAPI = new LogSearchAPI(mockLogger);
    
    mockApp = {
      get: sinon.stub()
    };
    
    mockRes = {
      json: sinon.stub(),
      status: sinon.stub().returnsThis(),
      setHeader: sinon.stub(),
      send: sinon.stub()
    };
    
    mockReq = {
      query: {}
    };
  });
  
  describe('setupRoutes', () => {
    it('should register all required routes', () => {
      logSearchAPI.setupRoutes(mockApp);
      
      expect(mockApp.get.callCount).to.equal(4);
      expect(mockApp.get.getCall(0).args[0]).to.equal('/api/logs/search');
      expect(mockApp.get.getCall(1).args[0]).to.equal('/api/logs/files');
      expect(mockApp.get.getCall(2).args[0]).to.equal('/api/logs/stats');
      expect(mockApp.get.getCall(3).args[0]).to.equal('/api/logs/export');
    });
  });
  
  describe('parseLine', () => {
    it('should parse standard log line format', () => {
      const line = '[2025-06-17 10:00:00] [INFO] [issue-63-12345] Processing Issue #63';
      const result = logSearchAPI.parseLine(line);
      
      expect(result).to.deep.include({
        level: 'INFO',
        processId: 'issue-63-12345',
        issueNumber: 63,
        message: 'Processing Issue #63',
        raw: line
      });
      expect(result.timestamp).to.be.instanceOf(Date);
    });
    
    it('should parse log line without process ID', () => {
      const line = '[2025-06-17 10:00:00] [ERROR] System error occurred';
      const result = logSearchAPI.parseLine(line);
      
      expect(result).to.deep.include({
        level: 'ERROR',
        processId: 'main',
        issueNumber: null,
        message: 'System error occurred'
      });
    });
    
    it('should extract issue number from message', () => {
      const line = '[2025-06-17 10:00:00] [INFO] Working on Issue #42';
      const result = logSearchAPI.parseLine(line);
      
      expect(result.issueNumber).to.equal(42);
    });
    
    it('should return null for invalid log line', () => {
      const line = 'This is not a valid log line';
      const result = logSearchAPI.parseLine(line);
      
      expect(result).to.be.null;
    });
  });
  
  describe('convertToCSV', () => {
    it('should convert logs to CSV format', () => {
      const logs = [
        {
          timestamp: new Date('2025-06-17T10:00:00'),
          level: 'INFO',
          processId: 'test-123',
          issueNumber: 42,
          message: 'Test message'
        },
        {
          timestamp: new Date('2025-06-17T10:01:00'),
          level: 'ERROR',
          processId: 'main',
          issueNumber: null,
          message: 'Error with "quotes"'
        }
      ];
      
      const csv = logSearchAPI.convertToCSV(logs);
      const lines = csv.split('\n');
      
      expect(lines[0]).to.equal('Timestamp,Level,Process ID,Issue Number,Message');
      expect(lines[1]).to.include('2025-06-17'); // 日付のみチェック（タイムゾーン依存を避ける）
      expect(lines[1]).to.include('INFO');
      expect(lines[1]).to.include('test-123');
      expect(lines[1]).to.include('42');
      expect(lines[2]).to.include('"Error with ""quotes"""');
    });
  });
  
  describe('getLogFiles', () => {
    it('should return sorted list of log files', () => {
      const mockFiles = ['app.log', 'error.log', 'test.txt'];
      const mockStats = {
        size: 1024,
        mtime: new Date()
      };
      
      sinon.stub(fs, 'readdirSync').returns(mockFiles);
      sinon.stub(fs, 'statSync').returns(mockStats);
      
      const files = logSearchAPI.getLogFiles();
      
      expect(files).to.have.lengthOf(2); // Only .log files
      expect(files[0]).to.deep.include({
        name: 'app.log',
        size: 1024
      });
      
      fs.readdirSync.restore();
      fs.statSync.restore();
    });
  });
  
  describe('searchInFile', () => {
    it('should filter logs by keyword', async () => {
      const filePath = path.join(__dirname, 'test.log');
      const logContent = [
        '[2025-06-17 10:00:00] [INFO] Test message',
        '[2025-06-17 10:01:00] [ERROR] Error occurred',
        '[2025-06-17 10:02:00] [INFO] Another test'
      ].join('\n');
      
      // テスト用ログファイルを作成
      fs.writeFileSync(filePath, logContent);
      
      try {
        const results = await logSearchAPI.searchInFile(filePath, {
          keyword: 'test'
        });
        
        expect(results).to.have.lengthOf(2);
        expect(results[0].message).to.include('Test message');
        expect(results[1].message).to.include('Another test');
      } finally {
        // クリーンアップ
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      }
    });
    
    it('should filter logs by level', async () => {
      const filePath = path.join(__dirname, 'test.log');
      const logContent = [
        '[2025-06-17 10:00:00] [INFO] Info message',
        '[2025-06-17 10:01:00] [ERROR] Error message',
        '[2025-06-17 10:02:00] [INFO] Another info'
      ].join('\n');
      
      fs.writeFileSync(filePath, logContent);
      
      try {
        const results = await logSearchAPI.searchInFile(filePath, {
          level: 'ERROR'
        });
        
        expect(results).to.have.lengthOf(1);
        expect(results[0].level).to.equal('ERROR');
      } finally {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      }
    });
    
    it('should filter logs by date range', async () => {
      const filePath = path.join(__dirname, 'test.log');
      const logContent = [
        '[2025-06-17 09:00:00] [INFO] Early message',
        '[2025-06-17 10:00:00] [INFO] Middle message',
        '[2025-06-17 11:00:00] [INFO] Late message'
      ].join('\n');
      
      fs.writeFileSync(filePath, logContent);
      
      try {
        const results = await logSearchAPI.searchInFile(filePath, {
          startDate: new Date('2025-06-17T09:30:00'),
          endDate: new Date('2025-06-17T10:30:00')
        });
        
        expect(results).to.have.lengthOf(1);
        expect(results[0].message).to.include('Middle message');
      } finally {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      }
    });
  });
  
  describe('API endpoints', () => {
    beforeEach(() => {
    sandbox = sinon.createSandbox();
      logSearchAPI.setupRoutes(mockApp);
    })

  afterEach(() => {
    sandbox.restore();
  });;
    
    it('should handle search request with filters', async () => {
      const handler = mockApp.get.getCall(0).args[1];
      mockReq.query = {
        keyword: 'test',
        level: 'INFO',
        limit: '50'
      };
      
      // searchLogsメソッドをモック
      sinon.stub(logSearchAPI, 'searchLogs').resolves({
        logs: [{ message: 'test' }],
        total: 1,
        limit: 50,
        offset: 0,
        hasMore: false
      });
      
      await handler(mockReq, mockRes);
      
      expect(mockRes.json.calledOnce).to.be.true;
      expect(mockRes.json.getCall(0).args[0]).to.deep.include({
        total: 1,
        limit: 50
      });
      
      logSearchAPI.searchLogs.restore();
    });
    
    it('should handle export request', async () => {
      const handler = mockApp.get.getCall(3).args[1];
      mockReq.query = {
        format: 'csv'
      };
      
      sinon.stub(logSearchAPI, 'searchLogs').resolves({
        logs: [
          {
            timestamp: new Date(),
            level: 'INFO',
            processId: 'test',
            message: 'Test'
          }
        ]
      });
      
      await handler(mockReq, mockRes);
      
      expect(mockRes.setHeader.calledWith('Content-Type', 'text/csv')).to.be.true;
      expect(mockRes.send.calledOnce).to.be.true;
      
      logSearchAPI.searchLogs.restore();
    });
  });
});