const { describe, it, beforeEach, afterEach } = require('mocha');
const { expect } = require('chai');
const fs = require('fs').promises;
const path = require('path');
const { spawn } = require('child_process');
const FileStateManager = require('../src/file-state-manager');

describe('ロック機構の統合テスト', () => {
  const testStateDir = path.join(__dirname, '../state-test');
  let stateManager;

  beforeEach(async () => {
    // テスト用ディレクトリの作成
    await fs.mkdir(testStateDir, { recursive: true });
    stateManager = new FileStateManager(testStateDir);
    await stateManager.init();
  });

  afterEach(async () => {
    // テスト用ディレクトリのクリーンアップ
    try {
      await fs.rm(testStateDir, { recursive: true, force: true });
    } catch (error) {
      // エラーを無視
    }
  });

  describe('FileStateManagerのロックファイル', () => {
    it('poppo-node.lockファイルを作成できること', async () => {
      const result = await stateManager.acquireProcessLock();
      expect(result).to.be.true;

      // ロックファイルが存在することを確認
      const lockPath = path.join(testStateDir, 'poppo-node.lock');
      const stats = await fs.stat(lockPath);
      expect(stats.isFile()).to.be.true;
    });

    it('ロックファイルにPID情報が含まれること', async () => {
      await stateManager.acquireProcessLock();

      const lockPath = path.join(testStateDir, 'poppo-node.lock');
      const content = await fs.readFile(lockPath, 'utf8');
      const lockData = JSON.parse(content);

      expect(lockData).to.have.property('pid');
      expect(lockData.pid).to.equal(process.pid);
      expect(lockData).to.have.property('startTime');
      expect(lockData).to.have.property('hostname');
    });

    it('二重ロックを防げること', async () => {
      // 最初のロック取得
      const result1 = await stateManager.acquireProcessLock();
      expect(result1).to.be.true;

      // 同じプロセスからの二重ロック
      const result2 = await stateManager.acquireProcessLock();
      expect(result2).to.be.false;
    });

    it('ロックを解放できること', async () => {
      await stateManager.acquireProcessLock();
      await stateManager.releaseProcessLock();

      const lockPath = path.join(testStateDir, 'poppo-node.lock');
      try {
        await fs.access(lockPath);
        throw new Error('ロックファイルが削除されていません');
      } catch (error) {
        expect(error.code).to.equal('ENOENT');
      }
    });
  });

  describe('シェルスクリプトとの共存', () => {
    it('poppo-cron.lockディレクトリとpoppo-node.lockファイルが共存できること', async () => {
      // シェルスクリプトのロック（ディレクトリ）を作成
      const shellLockDir = path.join(testStateDir, 'poppo-cron.lock');
      await fs.mkdir(shellLockDir);
      await fs.writeFile(path.join(shellLockDir, 'pid'), '12345');

      // Node.jsのロックが取得できること
      const result = await stateManager.acquireProcessLock();
      expect(result).to.be.true;

      // 両方のロックが存在すること
      const shellStats = await fs.stat(shellLockDir);
      expect(shellStats.isDirectory()).to.be.true;

      const nodeLockPath = path.join(testStateDir, 'poppo-node.lock');
      const nodeStats = await fs.stat(nodeLockPath);
      expect(nodeStats.isFile()).to.be.true;
    });
  });
});