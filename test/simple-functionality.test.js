const { expect } = require('chai');
const fs = require('fs');
const path = require('path');

describe('基本機能テスト', () => {
  describe('プロジェクト構造', () => {
    it('必要なディレクトリが存在すること', () => {
      const requiredDirs = ['src', 'agents', 'config', 'logs', 'state'];
      requiredDirs.forEach(dir => {
        expect(fs.existsSync(dir)).to.be.true;
      });
    });

    it('主要な設定ファイルが存在すること', () => {
      const configFiles = [
        'config/config.json',
        'package.json',
        'README.md'
      ];
      configFiles.forEach(file => {
        expect(fs.existsSync(file)).to.be.true;
      });
    });
  });

  describe('コアモジュール', () => {
    it('minimal-poppo.jsが読み込めること', () => {
      expect(() => {
        const poppoPath = path.join(__dirname, '..', 'src', 'minimal-poppo.js');
        require.resolve(poppoPath);
      }).to.not.throw();
    });

    it('Logger クラスが使用できること', () => {
      const Logger = require('../src/logger');
      const logger = new Logger('test');
      expect(logger).to.be.an('object');
      expect(logger.info).to.be.a('function');
      expect(logger.error).to.be.a('function');
    });

    it('FileStateManager が使用できること', () => {
      const FileStateManager = require('../src/file-state-manager');
      const stateManager = new FileStateManager();
      expect(stateManager).to.be.an('object');
      expect(stateManager.loadProcessedIssues).to.be.a('function');
    });
  });

  describe('新規実装機能', () => {
    it('MemoryMonitor が読み込めること', () => {
      const MemoryMonitor = require('../src/memory-monitor');
      const monitor = new MemoryMonitor();
      expect(monitor).to.be.an('object');
      expect(monitor.getCurrentMemoryUsage).to.be.a('function');
    });

    it('ErrorHandler が読み込めること', () => {
      const { ErrorHandler } = require('../src/error-handler');
      const handler = new ErrorHandler();
      expect(handler).to.be.an('object');
      expect(handler.handleError).to.be.a('function');
    });

    it('CircuitBreaker が読み込めること', () => {
      const { CircuitBreaker } = require('../src/circuit-breaker');
      const breaker = new CircuitBreaker('test');
      expect(breaker).to.be.an('object');
      expect(breaker.execute).to.be.a('function');
    });
  });

  describe('設定管理', () => {
    it('設定ファイルが正しいJSON形式であること', () => {
      const config = require('../config/config.json');
      expect(config).to.be.an('object');
      expect(config.claude).to.be.an('object');
      expect(config.github).to.be.an('object');
      expect(config.dashboard).to.be.an('object');
      expect(config.memory).to.be.an('object');
      expect(config.errorHandling).to.be.an('object');
    });
  });
});