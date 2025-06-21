/**
 * Multi-Logger Tests
 */

const { expect } = require('chai');
const sinon = require('sinon');
const path = require('path');
const fs = require('fs').promises;
const os = require('os');
const { MultiLogger } = require('../lib/utils/multi-logger');

describe('MultiLogger', function() {
  this.timeout(10000);
  
  let logger;
  let sandbox;
  let tempDir;
  let projectDir;
  
  beforeEach(async () => {
    sandbox = sinon.createSandbox();
    
    // テンポラリディレクトリの作成
    tempDir = path.join(os.tmpdir(), `multi-logger-test-${Date.now()}`);
    projectDir = path.join(tempDir, 'test-project');
    
    await fs.mkdir(tempDir, { recursive: true });
    await fs.mkdir(projectDir, { recursive: true });
    
    // テスト用のLoggerを作成
    logger = new MultiLogger({
      globalLogDir: path.join(tempDir, 'logs'),
      logLevel: 'debug',
      maxFileSize: 1024, // 1KB for testing
      enableRotation: true,
      enableCompression: false // テストでは圧縮を無効化
    });
    
    await logger.initialize();
  });
  
  afterEach(async () => {
    if (logger) {
      await logger.cleanup();
    }
    
    sandbox.restore();
    
    // テンポラリディレクトリのクリーンアップ
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch (error) {
      // エラーは無視
    }
  });
  
  describe('Initialization', () => {
    it('should initialize with default options', async () => {
      const ml = new MultiLogger();
      expect(ml.options.logLevel).to.equal('info');
      expect(ml.options.maxFileSize).to.equal(100 * 1024 * 1024);
      expect(ml.options.enableRotation).to.be.true;
    });
    
    it('should create global log directory', async () => {
      const stats = await fs.stat(logger.options.globalLogDir);
      expect(stats.isDirectory()).to.be.true;
    });
    
    it('should create global log files', async () => {
      const daemonLog = path.join(logger.options.globalLogDir, 'daemon.log');
      const globalLog = path.join(logger.options.globalLogDir, 'global.log');
      
      await fs.access(daemonLog);
      await fs.access(globalLog);
    });
  });
  
  describe('Project Registration', () => {
    it('should register a project', async () => {
      await logger.registerProject('test-project', projectDir);
      
      expect(logger.projectLoggers.has('test-project')).to.be.true;
      expect(logger.streams.has('project:test-project')).to.be.true;
      
      // プロジェクトログディレクトリが作成されていることを確認
      const logDir = path.join(projectDir, '.poppobuilder', 'logs');
      const stats = await fs.stat(logDir);
      expect(stats.isDirectory()).to.be.true;
    });
    
    it('should emit project-registered event', async () => {
      const eventSpy = sandbox.spy();
      logger.on('project-registered', eventSpy);
      
      await logger.registerProject('test-project', projectDir);
      
      expect(eventSpy.calledOnce).to.be.true;
      expect(eventSpy.firstCall.args[0]).to.deep.equal({
        projectId: 'test-project'
      });
    });
    
    it('should unregister a project', async () => {
      await logger.registerProject('test-project', projectDir);
      await logger.unregisterProject('test-project');
      
      expect(logger.projectLoggers.has('test-project')).to.be.false;
      expect(logger.streams.has('project:test-project')).to.be.false;
    });
  });
  
  describe('Logging', () => {
    it('should log to global log', async () => {
      await logger.info('Test message');
      
      // ログファイルの内容を確認
      const globalLog = path.join(logger.options.globalLogDir, 'global.log');
      const content = await fs.readFile(globalLog, 'utf8');
      
      expect(content).to.include('Test message');
      expect(content).to.include('"level":"info"');
    });
    
    it('should log to daemon log', async () => {
      await logger.info('Daemon test', { daemon: true });
      
      const daemonLog = path.join(logger.options.globalLogDir, 'daemon.log');
      const content = await fs.readFile(daemonLog, 'utf8');
      
      expect(content).to.include('Daemon test');
    });
    
    it('should log to project log', async () => {
      await logger.registerProject('test-project', projectDir);
      await logger.info('Project test', { projectId: 'test-project' });
      
      const projectLog = path.join(projectDir, '.poppobuilder', 'logs', 'project.log');
      const content = await fs.readFile(projectLog, 'utf8');
      
      expect(content).to.include('Project test');
    });
    
    it('should broadcast to all projects', async () => {
      await logger.registerProject('project1', path.join(tempDir, 'project1'));
      await logger.registerProject('project2', path.join(tempDir, 'project2'));
      
      await logger.info('Broadcast test', { broadcast: true });
      
      // 両方のプロジェクトログに記録されているか確認
      const log1 = await fs.readFile(
        path.join(tempDir, 'project1', '.poppobuilder', 'logs', 'project.log'),
        'utf8'
      );
      const log2 = await fs.readFile(
        path.join(tempDir, 'project2', '.poppobuilder', 'logs', 'project.log'),
        'utf8'
      );
      
      expect(log1).to.include('Broadcast test');
      expect(log2).to.include('Broadcast test');
    });
  });
  
  describe('Log Levels', () => {
    it('should respect log level settings', async () => {
      const infoLogger = new MultiLogger({
        globalLogDir: path.join(tempDir, 'info-logs'),
        logLevel: 'info'
      });
      await infoLogger.initialize();
      
      await infoLogger.debug('Debug message');
      await infoLogger.info('Info message');
      
      const globalLog = path.join(infoLogger.options.globalLogDir, 'global.log');
      const content = await fs.readFile(globalLog, 'utf8');
      
      expect(content).to.not.include('Debug message');
      expect(content).to.include('Info message');
      
      await infoLogger.cleanup();
    });
    
    it('should log all levels when set to trace', async () => {
      await logger.error('Error test');
      await logger.warn('Warn test');
      await logger.info('Info test');
      await logger.debug('Debug test');
      await logger.trace('Trace test');
      
      const globalLog = path.join(logger.options.globalLogDir, 'global.log');
      const content = await fs.readFile(globalLog, 'utf8');
      
      expect(content).to.include('Error test');
      expect(content).to.include('Warn test');
      expect(content).to.include('Info test');
      expect(content).to.include('Debug test');
      expect(content).to.include('Trace test');
    });
  });
  
  describe('Log Formatting', () => {
    it('should include metadata in logs', async () => {
      await logger.info('Test with metadata', {
        metadata: { userId: 123, action: 'test' }
      });
      
      const globalLog = path.join(logger.options.globalLogDir, 'global.log');
      const content = await fs.readFile(globalLog, 'utf8');
      const logEntry = JSON.parse(content.split('\n')[0]);
      
      expect(logEntry.metadata).to.deep.equal({
        userId: 123,
        action: 'test'
      });
    });
    
    it('should include error details', async () => {
      const testError = new Error('Test error');
      testError.code = 'TEST_ERROR';
      
      await logger.error('Error occurred', { error: testError });
      
      const globalLog = path.join(logger.options.globalLogDir, 'global.log');
      const content = await fs.readFile(globalLog, 'utf8');
      const logEntry = JSON.parse(content.split('\n')[0]);
      
      expect(logEntry.error).to.exist;
      expect(logEntry.error.message).to.equal('Test error');
      expect(logEntry.error.code).to.equal('TEST_ERROR');
      expect(logEntry.error.stack).to.exist;
    });
    
    it('should support text format', async () => {
      const textLogger = new MultiLogger({
        globalLogDir: path.join(tempDir, 'text-logs'),
        format: 'text'
      });
      await textLogger.initialize();
      
      await textLogger.info('Text format test', {
        component: 'TestComponent',
        projectId: 'test-project'
      });
      
      const globalLog = path.join(textLogger.options.globalLogDir, 'global.log');
      const content = await fs.readFile(globalLog, 'utf8');
      
      expect(content).to.match(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\s+INFO\s+\[TestComponent\]\[test-project\]\s+Text format test/);
      
      await textLogger.cleanup();
    });
  });
  
  describe('Log Rotation', () => {
    it('should rotate logs when size limit is reached', async () => {
      // 大きなメッセージを作成
      const largeMessage = 'x'.repeat(500);
      
      // サイズ制限を超えるまでログを書き込む
      await logger.info(largeMessage);
      await logger.info(largeMessage);
      await logger.info(largeMessage);
      
      // ローテーションが発生するのを待つ
      await new Promise(resolve => setTimeout(resolve, 100));
      
      const logFiles = await fs.readdir(logger.options.globalLogDir);
      const globalLogs = logFiles.filter(f => f.startsWith('global'));
      
      // ローテーションされたファイルが存在することを確認
      expect(globalLogs.length).to.be.greaterThan(1);
    });
    
    it('should emit log-rotated event', async () => {
      const eventSpy = sandbox.spy();
      logger.on('log-rotated', eventSpy);
      
      // サイズ制限を超えるログを書き込む
      const largeMessage = 'x'.repeat(1100);
      await logger.info(largeMessage);
      
      // イベントを待つ
      await new Promise(resolve => setTimeout(resolve, 200));
      
      expect(eventSpy.called).to.be.true;
    });
    
    it('should cleanup old log files', async () => {
      const rotationLogger = new MultiLogger({
        globalLogDir: path.join(tempDir, 'rotation-logs'),
        maxFileSize: 100,
        maxFiles: 3
      });
      await rotationLogger.initialize();
      
      // 複数のローテーションを発生させる
      for (let i = 0; i < 5; i++) {
        await rotationLogger.info('x'.repeat(150));
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      
      // 少し待つ
      await new Promise(resolve => setTimeout(resolve, 500));
      
      const logFiles = await fs.readdir(rotationLogger.options.globalLogDir);
      const globalLogs = logFiles.filter(f => f.startsWith('global'));
      
      // maxFiles以下であることを確認
      expect(globalLogs.length).to.be.at.most(4); // 現在のファイル + maxFiles
      
      await rotationLogger.cleanup();
    });
  });
  
  describe('Statistics', () => {
    it('should track log statistics', async () => {
      await logger.registerProject('test-project', projectDir);
      
      await logger.info('Test 1');
      await logger.info('Test 2', { projectId: 'test-project' });
      await logger.error('Test error', { daemon: true });
      
      const stats = logger.getStats();
      
      expect(stats.totals.activeStreams).to.equal(3); // global, daemon, project
      expect(stats.totals.linesWritten).to.be.greaterThan(0);
      expect(stats.totals.bytesWritten).to.be.greaterThan(0);
      
      expect(stats.loggers).to.have.property('global');
      expect(stats.loggers).to.have.property('daemon');
      expect(stats.loggers).to.have.property('project:test-project');
    });
  });
  
  describe('Event Emission', () => {
    it('should emit log-written event', async () => {
      const eventSpy = sandbox.spy();
      logger.on('log-written', eventSpy);
      
      await logger.info('Test message', { component: 'TestComponent' });
      
      expect(eventSpy.calledOnce).to.be.true;
      const eventData = eventSpy.firstCall.args[0];
      expect(eventData.level).to.equal('info');
      expect(eventData.message).to.equal('Test message');
      expect(eventData.options.component).to.equal('TestComponent');
    });
  });
  
  describe('Cleanup', () => {
    it('should close all streams on cleanup', async () => {
      await logger.registerProject('project1', path.join(tempDir, 'project1'));
      await logger.registerProject('project2', path.join(tempDir, 'project2'));
      
      const initialStats = logger.getStats();
      expect(initialStats.totals.activeStreams).to.equal(4); // global, daemon, 2 projects
      
      await logger.cleanup();
      
      expect(logger.streams.size).to.equal(0);
      expect(logger.rotationTimers.size).to.equal(0);
    });
    
    it('should emit cleanup event', async () => {
      const eventSpy = sandbox.spy();
      logger.on('cleanup', eventSpy);
      
      await logger.cleanup();
      
      expect(eventSpy.calledOnce).to.be.true;
    });
  });
});