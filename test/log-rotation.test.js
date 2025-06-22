const { expect } = require('chai');
const fs = require('fs');
const path = require('path');
const sinon = require('sinon');
const LogRotator = require('../src/log-rotator');
const Logger = require('../src/logger');
const { promisify } = require('util');

const writeFile = promisify(fs.writeFile);
const mkdir = promisify(fs.mkdir);
const rm = promisify(fs.rm);
const readdir = promisify(fs.readdir);
const stat = promisify(fs.stat);

describe('ログローテーション機能', function() {
  this.timeout(30000); // タイムアウトを30秒に設定
  const testLogDir = path.join(__dirname, 'test-logs');
  const testArchiveDir = path.join(testLogDir, 'archive');
  let logger;
  let clock;
  let sandbox;

  beforeEach(async () => {
    // テスト用ディレクトリを作成
    await mkdir(testLogDir, { recursive: true });
    await mkdir(testArchiveDir, { recursive: true });
    
    // Sinonのフェイクタイマーを使用
    clock = sinon.useFakeTimers();
  });

  afterEach(async () => {
    // クリーンアップ
    if (logger) {
      logger.close();
    }
    
    clock.restore();
    
    // テストディレクトリを削除
    try {
      await rm(testLogDir, { recursive: true, force: true });
    } catch (error) {
      // エラーは無視
    }
  });

  describe('LogRotator', () => {
    it('設定に基づいて初期化される', () => {
      const config = {
        enabled: true,
        maxSize: 1024 * 1024, // 1MB
        maxFiles: 5,
        compress: true,
        retentionDays: 7
      };
      
      const rotator = new LogRotator(config);
      
      expect(rotator.config.enabled).to.be.true;
      expect(rotator.config.maxSize).to.equal(1024 * 1024);
      expect(rotator.config.maxFiles).to.equal(5);
      expect(rotator.config.compress).to.be.true;
      expect(rotator.config.retentionDays).to.equal(7);
      
      rotator.stopWatching();
    });

    it('サイズベースのローテーションが動作する', async () => {
      const config = {
        enabled: true,
        maxSize: 100, // 100バイト（テスト用に小さく設定）
        compress: false,
        archivePath: testArchiveDir,
        checkInterval: 100
      };
      
      const rotator = new LogRotator(config);
      const testLogFile = path.join(testLogDir, 'test.log');
      
      // テストログファイルを作成
      await writeFile(testLogFile, 'x'.repeat(150)); // 150バイト
      
      // ローテーションをチェック
      await rotator.checkLogFile(testLogFile);
      
      // アーカイブディレクトリにファイルが移動されているか確認
      const archiveFiles = await readdir(testArchiveDir);
      expect(archiveFiles.length).to.be.greaterThan(0);
      
      // 新しい空のログファイルが作成されているか確認
      expect(fs.existsSync(testLogFile)).to.be.true;
      const stats = await stat(testLogFile);
      expect(stats.size).to.equal(0);
      
      rotator.stopWatching();
    });

    it('ファイル数制限が適用される', async () => {
      const config = {
        enabled: true,
        maxFiles: 3,
        compress: false,
        archivePath: testArchiveDir
      };
      
      const rotator = new LogRotator(config);
      
      // テスト用のアーカイブファイルを作成
      for (let i = 0; i < 5; i++) {
        await writeFile(
          path.join(testArchiveDir, `test-${i}.log`),
          `log content ${i}`
        );
      }
      
      // ファイル数制限を適用
      await rotator.enforceFileLimit();
      
      // 3ファイルのみ残っているか確認
      const remainingFiles = await readdir(testArchiveDir);
      const logFiles = remainingFiles.filter(f => f.endsWith('.log'));
      expect(logFiles.length).to.equal(3);
      
      rotator.stopWatching();
    });

    it('古いアーカイブがクリーンアップされる', async () => {
      const config = {
        enabled: true,
        retentionDays: 1,
        archivePath: testArchiveDir
      };
      
      const rotator = new LogRotator(config);
      
      // 古いファイルを作成（2日前）
      const oldFile = path.join(testArchiveDir, 'old.log');
      await writeFile(oldFile, 'old content');
      
      // ファイルの更新時刻を2日前に設定
      const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
      fs.utimesSync(oldFile, twoDaysAgo, twoDaysAgo);
      
      // 新しいファイルも作成
      await writeFile(path.join(testArchiveDir, 'new.log'), 'new content');
      
      // クリーンアップを実行
      await rotator.cleanupOldArchives();
      
      // 古いファイルが削除されているか確認
      expect(fs.existsSync(oldFile)).to.be.false;
      
      // 新しいファイルは残っているか確認
      expect(fs.existsSync(path.join(testArchiveDir, 'new.log'))).to.be.true;
      
      rotator.stopWatching();
    });

    it('統計情報を正しく取得できる', async () => {
      const config = {
        enabled: true,
        compress: true,
        archivePath: testArchiveDir
      };
      
      const rotator = new LogRotator(config);
      
      // テスト用のファイルを作成
      await writeFile(path.join(testArchiveDir, 'test1.log'), 'content1');
      await writeFile(path.join(testArchiveDir, 'test2.log.gz'), 'compressed');
      
      const stats = await rotator.getArchiveStats();
      
      expect(stats).to.not.be.null;
      expect(stats.totalFiles).to.equal(2);
      expect(stats.compressedFiles).to.equal(1);
      expect(stats.totalSize).to.be.greaterThan(0);
      
      rotator.stopWatching();
    });
  });

  describe('Logger統合', () => {
    it('ログローテーション設定でLoggerが初期化される', () => {
      const rotationConfig = {
        enabled: true,
        maxSize: 1024 * 1024,
        logLevel: 'WARN'
      };
      
      logger = new Logger(testLogDir, rotationConfig);
      
      expect(logger.rotator).to.not.be.undefined;
      expect(logger.currentLogLevel).to.equal('WARN');
    });

    it('ログレベルフィルタリングが動作する', () => {
      logger = new Logger(testLogDir, { logLevel: 'WARN' });
      
      // DEBUGログは出力されない
      expect(logger.shouldLog('DEBUG')).to.be.false;
      expect(logger.shouldLog('INFO')).to.be.false;
      
      // WARN以上は出力される
      expect(logger.shouldLog('WARN')).to.be.true;
      expect(logger.shouldLog('ERROR')).to.be.true;
    });

    it('手動ローテーションが実行できる', async () => {
      logger = new Logger(testLogDir, {
        enabled: true,
        archivePath: testArchiveDir,
        compress: false
      });
      
      // テストログを書き込み
      logger.info('TEST', 'テストメッセージ');
      
      // 手動ローテーション実行
      await logger.rotate();
      
      // アーカイブディレクトリにファイルがあるか確認
      const archiveFiles = await readdir(testArchiveDir);
      expect(archiveFiles.length).to.be.greaterThan(0);
    });

    it('アーカイブ統計を取得できる', async () => {
      logger = new Logger(testLogDir, {
        enabled: true,
        archivePath: testArchiveDir
      });
      
      const stats = await logger.getArchiveStats();
      expect(stats).to.not.be.null;
    });

    it('ログレベルを動的に変更できる', () => {
      logger = new Logger(testLogDir, { logLevel: 'INFO' });
      
      expect(logger.shouldLog('DEBUG')).to.be.false;
      
      // ログレベルをDEBUGに変更
      logger.setLogLevel('DEBUG');
      
      expect(logger.shouldLog('DEBUG')).to.be.true;
    });
  });

  describe('圧縮機能', () => {
    it('ファイルが正しく圧縮される', async () => {
      const config = {
        enabled: true,
        compress: true,
        compressionLevel: 6,
        archivePath: testArchiveDir
      };
      
      const rotator = new LogRotator(config);
      const testFile = path.join(testLogDir, 'compress-test.log');
      
      // テストファイルを作成
      const content = 'This is a test log file content that should be compressed\n'.repeat(100);
      await writeFile(testFile, content);
      
      // 圧縮を実行
      await rotator.compressFile(testFile);
      
      // 圧縮ファイルが作成されているか確認
      const archiveFiles = await readdir(testArchiveDir);
      const gzFiles = archiveFiles.filter(f => f.endsWith('.gz'));
      expect(gzFiles.length).to.equal(1);
      
      // メタデータファイルが作成されているか確認
      const metaFiles = archiveFiles.filter(f => f.endsWith('.meta.json'));
      expect(metaFiles.length).to.equal(1);
      
      rotator.stopWatching();
    });
  });
});

describe('ログローテーションCLI', () => {
  it('CLIスクリプトが存在する', () => {
    const scriptPath = path.join(__dirname, '../scripts/poppo-log-rotate.js');
    expect(fs.existsSync(scriptPath)).to.be.true;
  });
});