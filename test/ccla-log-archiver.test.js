const assert = require('assert');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const zlib = require('zlib');
const { promisify } = require('util');
const LogArchiver = require('../agents/ccla/log-archiver');

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

describe('CCLA LogArchiver', () => {
  let tempDir;
  let archiver;
  let sandbox;
  let mockLogger;
  let config;

  beforeEach(async () => {
    sandbox = sinon.createSandbox();
    // 一時ディレクトリの作成
    tempDir = path.join(os.tmpdir(), `ccla-test-${Date.now()}`);
    await fs.mkdir(tempDir, { recursive: true });

    // モックロガー
    mockLogger = {
      info: () => {},
      debug: () => {},
      warn: () => {},
      error: () => {}
    };

    // テスト用設定
    config = {
      errorLogCollection: {
        archiving: {
          enabled: true,
          archivePath: path.join(tempDir, 'archives'),
          processedLogsPath: path.join(tempDir, 'processed'),
          retentionDays: 7,
          compressionLevel: 6,
          autoCleanup: true,
          maxArchiveSize: '100MB',
          alertThreshold: '80MB'
        }
      }
    };

    archiver = new LogArchiver(config, mockLogger);
    await archiver.initialize();
  });

  afterEach(async () => {
    sandbox.restore();
    // 一時ディレクトリのクリーンアップ
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch (error) {
      // エラーは無視
    }
  });

  describe('初期化', () => {
    it('必要なディレクトリを作成する', async () => {
      const archiveDirExists = await fs.access(archiver.archivePath).then(() => true).catch(() => false);
      const processedDirExists = await fs.access(archiver.processedPath).then(() => true).catch(() => false);
      
      assert.strictEqual(archiveDirExists, true);
      assert.strictEqual(processedDirExists, true);
    });

    it('デフォルト設定を適用する', () => {
      const defaultArchiver = new LogArchiver({}, mockLogger);
      
      assert.strictEqual(defaultArchiver.retentionDays, 30);
      assert.strictEqual(defaultArchiver.compressionLevel, 6);
      assert.strictEqual(defaultArchiver.autoCleanup, true);
    });
  });

  describe('ファイルアーカイブ', () => {
    it('ファイルを圧縮してアーカイブする', async () => {
      // テストファイルの作成
      const testFile = path.join(archiver.processedPath, 'test.log');
      const testContent = 'これはテストログファイルです\n'.repeat(100);
      await fs.writeFile(testFile, testContent);

      // アーカイブ実行
      const result = await archiver.archiveFile(testFile);
      assert.strictEqual(result, true);

      // 元ファイルが削除されていることを確認
      const fileExists = await fs.access(testFile).then(() => true).catch(() => false);
      assert.strictEqual(fileExists, false);

      // アーカイブファイルの存在確認
      const date = new Date();
      const dateDir = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
      const archiveDir = path.join(archiver.archivePath, dateDir);
      const files = await fs.readdir(archiveDir);
      
      const archiveFile = files.find(f => f.startsWith('test.log') && f.endsWith('.gz'));
      assert(archiveFile, 'アーカイブファイルが見つかりません');

      // メタデータファイルの確認
      const metaFile = files.find(f => f.endsWith('.meta.json'));
      assert(metaFile, 'メタデータファイルが見つかりません');

      // メタデータの内容確認
      const metadata = JSON.parse(await fs.readFile(path.join(archiveDir, metaFile), 'utf8'));
      assert.strictEqual(metadata.originalName, 'test.log');
      assert(metadata.compressionRatio > 0, '圧縮率が正しく計算されていません');
    });

    it('圧縮ファイルのサイズが元ファイルより小さいことを確認', async () => {
      const testFile = path.join(archiver.processedPath, 'large.log');
      const testContent = 'A'.repeat(10000); // 圧縮しやすいデータ
      await fs.writeFile(testFile, testContent);

      await archiver.archiveFile(testFile);

      const date = new Date();
      const dateDir = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
      const archiveDir = path.join(archiver.archivePath, dateDir);
      const files = await fs.readdir(archiveDir);
      const archiveFile = files.find(f => f.startsWith('large.log') && f.endsWith('.gz'));
      
      const archivePath = path.join(archiveDir, archiveFile);
      const stats = await fs.stat(archivePath);
      
      assert(stats.size < testContent.length, '圧縮後のサイズが元のサイズより大きいです');
    });
  });

  describe('処理済みログのアーカイブ', () => {
    it('24時間以上経過したファイルをアーカイブする', async () => {
      // 古いファイルと新しいファイルを作成
      const oldFile = path.join(archiver.processedPath, 'old.log');
      const newFile = path.join(archiver.processedPath, 'new.log');
      
      await fs.writeFile(oldFile, 'old content');
      await fs.writeFile(newFile, 'new content');
      
      // 古いファイルのタイムスタンプを変更
      const oldTime = new Date(Date.now() - 25 * 60 * 60 * 1000); // 25時間前
      await fs.utimes(oldFile, oldTime, oldTime);
      
      // アーカイブ処理を実行
      await archiver.archiveProcessedLogs();
      
      // 古いファイルがアーカイブされ、新しいファイルは残っていることを確認
      const oldExists = await fs.access(oldFile).then(() => true).catch(() => false);
      const newExists = await fs.access(newFile).then(() => true).catch(() => false);
      
      assert.strictEqual(oldExists, false, '古いファイルが削除されていません');
      assert.strictEqual(newExists, true, '新しいファイルが削除されました');
    });
  });

  describe('古いアーカイブのクリーンアップ', () => {
    it('保存期間を過ぎたアーカイブを削除する', async () => {
      // 古い日付のディレクトリを作成
      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 10); // 10日前
      const oldDir = `${oldDate.getFullYear()}-${String(oldDate.getMonth() + 1).padStart(2, '0')}-${String(oldDate.getDate()).padStart(2, '0')}`;
      const oldDirPath = path.join(archiver.archivePath, oldDir);
      
      await fs.mkdir(oldDirPath, { recursive: true });
      await fs.writeFile(path.join(oldDirPath, 'old.log.gz'), 'dummy');
      
      // 新しい日付のディレクトリも作成
      const newDate = new Date();
      const newDir = `${newDate.getFullYear()}-${String(newDate.getMonth() + 1).padStart(2, '0')}-${String(newDate.getDate()).padStart(2, '0')}`;
      const newDirPath = path.join(archiver.archivePath, newDir);
      
      await fs.mkdir(newDirPath, { recursive: true });
      await fs.writeFile(path.join(newDirPath, 'new.log.gz'), 'dummy');
      
      // クリーンアップ実行
      await archiver.cleanupOldArchives();
      
      // 古いディレクトリが削除され、新しいディレクトリは残っていることを確認
      const oldDirExists = await fs.access(oldDirPath).then(() => true).catch(() => false);
      const newDirExists = await fs.access(newDirPath).then(() => true).catch(() => false);
      
      assert.strictEqual(oldDirExists, false, '古いディレクトリが削除されていません');
      assert.strictEqual(newDirExists, true, '新しいディレクトリが削除されました');
    });
  });

  describe('アーカイブ検索', () => {
    it('ファイル名で検索できる', async () => {
      // テストアーカイブを作成
      const testFile = path.join(archiver.processedPath, 'search-test.log');
      await fs.writeFile(testFile, 'test content');
      await archiver.archiveFile(testFile);
      
      // 検索実行
      const results = await archiver.searchArchives({ fileName: 'search-test' });
      
      assert.strictEqual(results.length, 1);
      assert.strictEqual(results[0].originalName, 'search-test.log');
    });

    it('日付範囲で検索できる', async () => {
      // テストアーカイブを作成
      const testFile = path.join(archiver.processedPath, 'date-test.log');
      await fs.writeFile(testFile, 'test content');
      await archiver.archiveFile(testFile);
      
      // 検索実行
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      
      const results = await archiver.searchArchives({
        dateFrom: yesterday.toISOString(),
        dateTo: tomorrow.toISOString()
      });
      
      assert(results.length > 0, '日付範囲検索で結果が見つかりません');
    });
  });

  describe('アーカイブ復元', () => {
    it('アーカイブされたファイルを復元できる', async () => {
      // テストファイルをアーカイブ
      const originalContent = 'This is the original content';
      const testFile = path.join(archiver.processedPath, 'restore-test.log');
      await fs.writeFile(testFile, originalContent);
      await archiver.archiveFile(testFile);
      
      // アーカイブファイルを探す
      const date = new Date();
      const dateDir = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
      const archiveDir = path.join(archiver.archivePath, dateDir);
      const files = await fs.readdir(archiveDir);
      const archiveFile = files.find(f => f.startsWith('restore-test.log') && f.endsWith('.gz'));
      
      // 復元実行
      const restoredPath = await archiver.restoreArchive(
        path.join(dateDir, archiveFile)
      );
      
      // 復元されたファイルの内容確認
      const restoredContent = await fs.readFile(restoredPath, 'utf8');
      assert.strictEqual(restoredContent, originalContent);
    });
  });

  describe('サイズ管理', () => {
    it('サイズ文字列を正しくパースする', () => {
      assert.strictEqual(archiver.parseSize('100B'), 100);
      assert.strictEqual(archiver.parseSize('1KB'), 1024);
      assert.strictEqual(archiver.parseSize('1MB'), 1024 * 1024);
      assert.strictEqual(archiver.parseSize('1GB'), 1024 * 1024 * 1024);
      assert.strictEqual(archiver.parseSize('1.5MB'), Math.floor(1.5 * 1024 * 1024));
    });

    it('バイトサイズを読みやすい形式にフォーマットする', () => {
      assert.strictEqual(archiver.formatSize(100), '100.00 B');
      assert.strictEqual(archiver.formatSize(1024), '1.00 KB');
      assert.strictEqual(archiver.formatSize(1024 * 1024), '1.00 MB');
      assert.strictEqual(archiver.formatSize(1536 * 1024), '1.50 MB');
    });

    it('ディレクトリサイズを計算できる', async () => {
      // テストファイルを作成
      const testDir = path.join(tempDir, 'size-test');
      await fs.mkdir(testDir, { recursive: true });
      
      await fs.writeFile(path.join(testDir, 'file1.txt'), 'a'.repeat(1000));
      await fs.writeFile(path.join(testDir, 'file2.txt'), 'b'.repeat(2000));
      
      const subDir = path.join(testDir, 'sub');
      await fs.mkdir(subDir, { recursive: true });
      await fs.writeFile(path.join(subDir, 'file3.txt'), 'c'.repeat(3000));
      
      const totalSize = await archiver.calculateDirectorySize(testDir);
      assert.strictEqual(totalSize, 6000);
    });
  });
});

// テスト実行
if (require.main === module) {
  console.log('CCLA LogArchiver テストを実行中...');
  const { execSync } = require('child_process');
  try {
    execSync('npm test -- test/ccla-log-archiver.test.js', { stdio: 'inherit' });
  } catch (error) {
    process.exit(1);
  }
}