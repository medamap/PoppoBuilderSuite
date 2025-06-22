const { describe, it, before, after, beforeEach, afterEach } = require('mocha');
const { expect } = require('chai');
const fs = require('fs').promises;
const path = require('path');
const BackupManager = require('../src/backup-manager');

describe('BackupManager', () => {
  let backupManager;
  const testDir = path.join(__dirname, 'test-backup');
  const testConfig = {
    enabled: true,
    storage: {
      type: 'local',
      path: path.join(testDir, 'backups'),
      compress: false,
      encrypt: false
    },
    targets: {
      config: true,
      database: false,
      logs: false,
      agents: false,
      state: true,
      security: false
    },
    retention: 7,
    maxBackups: 3
  };

  before(async () => {
    // テスト用ディレクトリを作成
    await fs.mkdir(testDir, { recursive: true });
    await fs.mkdir(path.join(testDir, 'config'), { recursive: true });
    await fs.mkdir(path.join(testDir, 'state'), { recursive: true });
    await fs.mkdir(path.join(testDir, '.poppo'), { recursive: true });
    
    // テスト用ファイルを作成
    await fs.writeFile(
      path.join(testDir, 'config', 'config.json'),
      JSON.stringify({ test: true }, null, 2)
    );
    await fs.writeFile(
      path.join(testDir, '.poppo', 'config.json'),
      JSON.stringify({ poppo: true }, null, 2)
    );
    await fs.writeFile(
      path.join(testDir, 'state', 'test.json'),
      JSON.stringify({ state: true }, null, 2)
    );
  });

  after(async () => {
    // テスト用ディレクトリをクリーンアップ
    await fs.rm(testDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    // プロセスのカレントディレクトリを一時的に変更
    process.chdir(testDir);
    backupManager = new BackupManager(testConfig);
  });

  afterEach(() => {
    // カレントディレクトリを元に戻す
    process.chdir(__dirname);
  });

  describe('createBackup', () => {
    it('バックアップを作成できること', async () => {
      const result = await backupManager.createBackup();
      
      expect(result).to.have.property('id');
      expect(result).to.have.property('timestamp');
      expect(result).to.have.property('targets');
      expect(result.targets).to.have.property('config');
      expect(result.targets).to.have.property('state');
      
      // バックアップディレクトリが作成されていること
      const backupPath = path.join(testConfig.storage.path, result.id);
      const stats = await fs.stat(backupPath);
      expect(stats.isDirectory()).to.be.true;
      
      // メタデータファイルが存在すること
      const metadataPath = path.join(backupPath, 'metadata.json');
      const metadataExists = await fs.access(metadataPath).then(() => true).catch(() => false);
      expect(metadataExists).to.be.true;
    });

    it('増分バックアップオプションが機能すること', async () => {
      const config = { ...testConfig, incremental: true };
      const manager = new BackupManager(config);
      
      const result = await manager.createBackup();
      expect(result.incremental).to.be.true;
    });

    it('二重実行を防ぐこと', async () => {
      const promise1 = backupManager.createBackup();
      const promise2 = backupManager.createBackup();
      
      await promise1;
      
      try {
        await promise2;
        expect.fail('二重実行が防がれませんでした');
      } catch (error) {
        expect(error.message).to.include('既に実行中');
      }
    });
  });

  describe('listBackups', () => {
    it('バックアップ一覧を取得できること', async () => {
      // 複数のバックアップを作成
      await backupManager.createBackup();
      await new Promise(resolve => setTimeout(resolve, 100)); // タイムスタンプを変えるため
      await backupManager.createBackup();
      
      const backups = await backupManager.listBackups();
      
      expect(backups).to.be.an('array');
      expect(backups.length).to.be.at.least(2);
      expect(backups[0]).to.have.property('id');
      expect(backups[0]).to.have.property('timestamp');
      expect(backups[0]).to.have.property('size');
    });

    it('新しい順にソートされていること', async () => {
      const backups = await backupManager.listBackups();
      
      for (let i = 1; i < backups.length; i++) {
        const date1 = new Date(backups[i - 1].timestamp);
        const date2 = new Date(backups[i].timestamp);
        expect(date1.getTime()).to.be.at.least(date2.getTime());
      }
    });
  });

  describe('verifyBackup', () => {
    it('有効なバックアップを検証できること', async () => {
      const backup = await backupManager.createBackup();
      const result = await backupManager.verifyBackup(backup.id);
      
      expect(result.valid).to.be.true;
      expect(result.checksum.expected).to.equal(result.checksum.actual);
    });

    it('存在しないバックアップの検証が失敗すること', async () => {
      const result = await backupManager.verifyBackup('non-existent-backup');
      
      expect(result.valid).to.be.false;
      expect(result.error).to.include('見つかりません');
    });
  });

  describe('restore', () => {
    let backupId;

    beforeEach(async () => {
      // リストア用のバックアップを作成
      const backup = await backupManager.createBackup();
      backupId = backup.id;
      
      // ファイルを変更
      await fs.writeFile(
        path.join(testDir, 'config', 'config.json'),
        JSON.stringify({ test: false, modified: true }, null, 2)
      );
    });

    it('バックアップからリストアできること', async () => {
      const result = await backupManager.restore(backupId, {
        skipBackup: true
      });
      
      expect(result.success).to.be.true;
      expect(result.backupId).to.equal(backupId);
      
      // ファイルが復元されていること
      const configContent = await fs.readFile(
        path.join(testDir, 'config', 'config.json'),
        'utf8'
      );
      const config = JSON.parse(configContent);
      expect(config.test).to.be.true;
      expect(config.modified).to.be.undefined;
    });

    it('ドライランモードが機能すること', async () => {
      const result = await backupManager.restore(backupId, {
        dryRun: true
      });
      
      expect(result.dryRun).to.be.true;
      
      // ファイルが変更されていないこと
      const configContent = await fs.readFile(
        path.join(testDir, 'config', 'config.json'),
        'utf8'
      );
      const config = JSON.parse(configContent);
      expect(config.modified).to.be.true;
    });

    it('選択的リストアが機能すること', async () => {
      await fs.writeFile(
        path.join(testDir, 'state', 'test.json'),
        JSON.stringify({ state: false, modified: true }, null, 2)
      );
      
      const result = await backupManager.restore(backupId, {
        targets: { config: true },
        skipBackup: true
      });
      
      expect(result.success).to.be.true;
      
      // configは復元される
      const configContent = await fs.readFile(
        path.join(testDir, 'config', 'config.json'),
        'utf8'
      );
      const config = JSON.parse(configContent);
      expect(config.test).to.be.true;
      
      // stateは復元されない
      const stateContent = await fs.readFile(
        path.join(testDir, 'state', 'test.json'),
        'utf8'
      );
      const state = JSON.parse(stateContent);
      expect(state.modified).to.be.true;
    });
  });

  describe('cleanupOldBackups', () => {
    it('古いバックアップを削除すること', async () => {
      // maxBackups = 3 なので、4つ作成
      for (let i = 0; i < 4; i++) {
        await backupManager.createBackup();
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      
      const backupsAfter = await backupManager.listBackups();
      expect(backupsAfter.length).to.equal(3);
    });
  });

  describe('暗号化機能', () => {
    it('暗号化と復号化が機能すること', () => {
      const encryptConfig = {
        ...testConfig,
        storage: {
          ...testConfig.storage,
          encrypt: true,
          encryptionKey: 'test-encryption-key'
        }
      };
      
      const manager = new BackupManager(encryptConfig);
      const testData = 'This is sensitive data';
      
      const encrypted = manager.encryptData(testData);
      expect(encrypted).to.not.equal(testData);
      expect(encrypted).to.include(':');
      
      const decrypted = manager.decryptData(encrypted);
      expect(decrypted).to.equal(testData);
    });
  });

  describe('エラーハンドリング', () => {
    it('無効な設定でエラーを投げること', async () => {
      const invalidConfig = {
        ...testConfig,
        storage: {
          ...testConfig.storage,
          path: '/invalid/path/that/does/not/exist'
        }
      };
      
      const manager = new BackupManager(invalidConfig);
      
      try {
        await manager.createBackup();
        expect.fail('エラーが投げられませんでした');
      } catch (error) {
        expect(error).to.be.an('error');
      }
    });
  });
});