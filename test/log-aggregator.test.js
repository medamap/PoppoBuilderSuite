/**
 * Log Aggregator Tests
 */

const { expect } = require('chai');
const sinon = require('sinon');
const path = require('path');
const fs = require('fs').promises;
const os = require('os');
const LogAggregator = require('../lib/utils/log-aggregator');
const { MultiLogger } = require('../lib/utils/multi-logger');

describe('LogAggregator', function() {
  this.timeout(10000);
  
  let aggregator;
  let logger;
  let sandbox;
  let tempDir;
  let project1Dir;
  let project2Dir;
  
  beforeEach(async () => {
    sandbox = sinon.createSandbox();
    
    // テンポラリディレクトリの作成
    tempDir = path.join(os.tmpdir(), `log-aggregator-test-${Date.now()}`);
    project1Dir = path.join(tempDir, 'project1');
    project2Dir = path.join(tempDir, 'project2');
    
    await fs.mkdir(tempDir, { recursive: true });
    await fs.mkdir(project1Dir, { recursive: true });
    await fs.mkdir(project2Dir, { recursive: true });
    
    // MultiLoggerでログを作成
    logger = new MultiLogger({
      globalLogDir: path.join(tempDir, 'logs'),
      format: 'json'
    });
    await logger.initialize();
    
    // プロジェクトを登録
    await logger.registerProject('project1', project1Dir);
    await logger.registerProject('project2', project2Dir);
    
    // テストログを作成
    await createTestLogs(logger);
    
    // LogAggregatorを作成
    aggregator = new LogAggregator({
      globalLogDir: path.join(tempDir, 'logs')
    });
    
    await aggregator.initialize();
    aggregator.registerProject('project1', project1Dir);
    aggregator.registerProject('project2', project2Dir);
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
    it('should initialize with default options', () => {
      const agg = new LogAggregator();
      expect(agg.options.maxLinesPerFile).to.equal(10000);
      expect(agg.options.searchTimeout).to.equal(30000);
      expect(agg.options.enableCache).to.be.true;
    });
    
    it('should register projects', () => {
      expect(aggregator.projectDirs.has('project1')).to.be.true;
      expect(aggregator.projectDirs.has('project2')).to.be.true;
    });
  });
  
  describe('Search', () => {
    it('should search all logs', async () => {
      const results = await aggregator.search();
      
      expect(results).to.be.an('array');
      expect(results.length).to.be.greaterThan(0);
      
      // 結果がタイムスタンプの降順でソートされていることを確認
      for (let i = 1; i < results.length; i++) {
        const prev = new Date(results[i - 1].timestamp).getTime();
        const curr = new Date(results[i].timestamp).getTime();
        expect(prev).to.be.at.least(curr);
      }
    });
    
    it('should filter by log level', async () => {
      const errors = await aggregator.search({ level: 'error' });
      
      expect(errors).to.be.an('array');
      expect(errors.every(e => e.level === 'error')).to.be.true;
    });
    
    it('should filter by project', async () => {
      const project1Logs = await aggregator.search({ projectId: 'project1' });
      
      expect(project1Logs).to.be.an('array');
      expect(project1Logs.every(e => e.projectId === 'project1')).to.be.true;
    });
    
    it('should filter by time range', async () => {
      const now = new Date();
      const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
      
      const recentLogs = await aggregator.search({
        startTime: oneHourAgo,
        endTime: now
      });
      
      expect(recentLogs).to.be.an('array');
      
      for (const log of recentLogs) {
        const logTime = new Date(log.timestamp).getTime();
        expect(logTime).to.be.at.least(oneHourAgo.getTime());
        expect(logTime).to.be.at.most(now.getTime());
      }
    });
    
    it('should search by query', async () => {
      const results = await aggregator.search({ query: 'specific' });
      
      expect(results).to.be.an('array');
      expect(results.length).to.be.greaterThan(0);
      
      // すべての結果にクエリが含まれていることを確認
      for (const result of results) {
        const searchableText = [
          result.message,
          result.component,
          JSON.stringify(result.metadata)
        ].join(' ').toLowerCase();
        
        expect(searchableText).to.include('specific');
      }
    });
    
    it('should limit results', async () => {
      const results = await aggregator.search({ limit: 5 });
      
      expect(results).to.have.lengthOf.at.most(5);
    });
    
    it('should cache search results', async () => {
      const criteria = { level: 'info', limit: 10 };
      
      // 最初の検索
      const results1 = await aggregator.search(criteria);
      
      // キャッシュから取得
      const results2 = await aggregator.search(criteria);
      
      expect(results1).to.deep.equal(results2);
      expect(aggregator.searchCache.size).to.be.greaterThan(0);
    });
  });
  
  describe('Aggregation', () => {
    it('should aggregate by level', async () => {
      const aggregated = await aggregator.aggregate({
        groupBy: 'level'
      });
      
      expect(aggregated.groups).to.have.property('info');
      expect(aggregated.groups).to.have.property('error');
      expect(aggregated.groups).to.have.property('warn');
      
      expect(aggregated.stats.byLevel).to.exist;
      expect(aggregated.stats.total).to.be.greaterThan(0);
    });
    
    it('should aggregate by project', async () => {
      const aggregated = await aggregator.aggregate({
        groupBy: 'project'
      });
      
      expect(aggregated.groups).to.have.property('project1');
      expect(aggregated.groups).to.have.property('project2');
      expect(aggregated.groups).to.have.property('global');
    });
    
    it('should aggregate by hour', async () => {
      const aggregated = await aggregator.aggregate({
        groupBy: 'hour'
      });
      
      expect(aggregated.groups).to.be.an('object');
      
      // 時間形式のキーを確認
      for (const key of Object.keys(aggregated.groups)) {
        expect(key).to.match(/^\d{4}-\d{2}-\d{2}T\d{2}:00$/);
      }
    });
    
    it('should include statistics', async () => {
      const aggregated = await aggregator.aggregate({
        includeStats: true
      });
      
      expect(aggregated.stats).to.exist;
      expect(aggregated.stats.total).to.be.a('number');
      expect(aggregated.stats.byLevel).to.be.an('object');
      expect(aggregated.stats.byProject).to.be.an('object');
      expect(aggregated.stats.timeRange).to.have.property('start');
      expect(aggregated.stats.timeRange).to.have.property('end');
    });
  });
  
  describe('Recent Logs', () => {
    it('should get recent logs', async () => {
      const recent = await aggregator.getRecent({ limit: 10 });
      
      expect(recent).to.be.an('array');
      expect(recent.length).to.be.at.most(10);
      
      // 最近のログであることを確認
      const oneHourAgo = Date.now() - 60 * 60 * 1000;
      for (const log of recent) {
        const logTime = new Date(log.timestamp).getTime();
        expect(logTime).to.be.at.least(oneHourAgo);
      }
    });
  });
  
  describe('Error Summary', () => {
    it('should generate error summary', async () => {
      const summary = await aggregator.getErrorSummary();
      
      expect(summary).to.have.property('total');
      expect(summary).to.have.property('byComponent');
      expect(summary).to.have.property('byProject');
      expect(summary).to.have.property('topErrors');
      expect(summary).to.have.property('timeline');
      
      expect(summary.total).to.be.a('number');
      expect(summary.topErrors).to.be.an('array');
    });
    
    it('should limit top errors', async () => {
      // 多数のエラーを作成
      for (let i = 0; i < 15; i++) {
        await logger.error(`Error type ${i}`, { 
          error: new Error(`Error message ${i}`) 
        });
      }
      
      const summary = await aggregator.getErrorSummary();
      
      expect(summary.topErrors).to.have.lengthOf.at.most(10);
    });
  });
  
  describe('Export', () => {
    it('should export logs to JSON', async () => {
      const exportPath = path.join(tempDir, 'export.json');
      
      await aggregator.export(exportPath, { level: 'info' }, 'json');
      
      const content = await fs.readFile(exportPath, 'utf8');
      const exported = JSON.parse(content);
      
      expect(exported).to.be.an('array');
      expect(exported.every(e => e.level === 'info')).to.be.true;
    });
    
    it('should export logs to CSV', async () => {
      const exportPath = path.join(tempDir, 'export.csv');
      
      await aggregator.export(exportPath, { limit: 5 }, 'csv');
      
      const content = await fs.readFile(exportPath, 'utf8');
      const lines = content.split('\n');
      
      expect(lines[0]).to.equal('timestamp,level,source,component,projectId,message');
      expect(lines.length).to.be.at.least(2); // ヘッダー + データ
    });
    
    it('should export logs to text', async () => {
      const exportPath = path.join(tempDir, 'export.txt');
      
      await aggregator.export(exportPath, { limit: 5 }, 'text');
      
      const content = await fs.readFile(exportPath, 'utf8');
      
      expect(content).to.be.a('string');
      expect(content).to.include('INFO');
    });
  });
  
  describe('Stream Logs', () => {
    it('should stream logs without follow', async () => {
      const stream = aggregator.streamLogs({ follow: false, tail: 5 });
      const logs = [];
      
      stream.on('log', (log) => logs.push(log));
      
      // ストリームが完了するのを待つ
      await new Promise(resolve => setTimeout(resolve, 100));
      
      expect(logs).to.be.an('array');
      expect(logs.length).to.be.at.most(5);
    });
    
    it('should stream logs with follow', async () => {
      const stream = aggregator.streamLogs({ follow: true, tail: 0 });
      const logs = [];
      
      stream.on('log', (log) => logs.push(log));
      
      // 新しいログを追加
      await logger.info('Streamed log 1');
      await logger.info('Streamed log 2');
      
      // ログが到着するのを待つ
      await new Promise(resolve => setTimeout(resolve, 200));
      
      stream.stop();
      
      expect(logs.some(log => log.message === 'Streamed log 1')).to.be.true;
      expect(logs.some(log => log.message === 'Streamed log 2')).to.be.true;
    });
  });
  
  describe('Cache Management', () => {
    it('should clear cache', async () => {
      // キャッシュを作成
      await aggregator.search({ level: 'info' });
      expect(aggregator.searchCache.size).to.be.greaterThan(0);
      
      // キャッシュをクリア
      aggregator.clearCache();
      expect(aggregator.searchCache.size).to.equal(0);
    });
    
    it('should emit cache-cleared event', async () => {
      const eventSpy = sandbox.spy();
      aggregator.on('cache-cleared', eventSpy);
      
      aggregator.clearCache();
      
      expect(eventSpy.calledOnce).to.be.true;
    });
    
    it('should limit cache size', async () => {
      const smallCacheAggregator = new LogAggregator({
        globalLogDir: path.join(tempDir, 'logs'),
        cacheSize: 3
      });
      
      // キャッシュサイズを超える検索を実行
      for (let i = 0; i < 5; i++) {
        await smallCacheAggregator.search({ limit: i + 1 });
      }
      
      expect(smallCacheAggregator.searchCache.size).to.equal(3);
    });
  });
});

/**
 * テストログを作成するヘルパー関数
 */
async function createTestLogs(logger) {
  // グローバルログ
  await logger.info('Global info message');
  await logger.warn('Global warning message');
  await logger.error('Global error message', {
    error: new Error('Test error')
  });
  
  // デーモンログ
  await logger.info('Daemon started', { daemon: true, component: 'daemon-manager' });
  await logger.error('Daemon error', { daemon: true, component: 'daemon-manager' });
  
  // プロジェクト1のログ
  await logger.info('Project 1 info', { projectId: 'project1', component: 'builder' });
  await logger.debug('Project 1 debug with specific keyword', { projectId: 'project1' });
  await logger.error('Project 1 error', { 
    projectId: 'project1',
    error: new Error('Project error')
  });
  
  // プロジェクト2のログ
  await logger.info('Project 2 info', { projectId: 'project2', component: 'tester' });
  await logger.warn('Project 2 warning', { projectId: 'project2' });
  
  // メタデータ付きログ
  await logger.info('Log with metadata', {
    metadata: {
      userId: 123,
      action: 'test-action',
      specific: 'value'
    }
  });
}