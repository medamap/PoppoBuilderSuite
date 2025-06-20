/**
 * MirinOrphanManagerの修正をテストするスクリプト
 */
const fs = require('fs').promises;
const path = require('path');

// テスト用のモックを作成
const mockLogger = {
  info: (...args) => console.log('[INFO]', ...args),
  warn: (...args) => console.log('[WARN]', ...args),
  error: (...args) => console.log('[ERROR]', ...args),
  debug: (...args) => console.log('[DEBUG]', ...args)
};

// MirinOrphanManagerのprocessRequestメソッドをテスト
async function testProcessRequest() {
  console.log('=== MirinOrphanManager processRequest テスト開始 ===\n');

  // テスト用ディレクトリの作成
  const testDir = path.join(__dirname, 'test-requests');
  await fs.mkdir(testDir, { recursive: true });

  // MirinOrphanManagerのインスタンスを作成（必要な部分のみ）
  const manager = {
    config: { requestsDir: testDir },
    logger: mockLogger,
    updateLabels: async (request) => {
      console.log('[TEST] updateLabels呼び出し:', request);
      return true;
    }
  };

  // processRequestメソッドを定義（修正版）
  manager.processRequest = async function(filename) {
    const filepath = path.join(this.config.requestsDir, filename);
    
    try {
      // ファイルの存在を確認
      try {
        await fs.access(filepath);
      } catch (accessError) {
        // ファイルが存在しない場合は単にスキップ
        this.logger.debug(`リクエストファイルが存在しません（既に処理済みの可能性）: ${filename}`);
        return;
      }
      
      // リクエストを読み込む
      const content = await fs.readFile(filepath, 'utf8');
      const request = JSON.parse(content);
      
      // ラベルを更新
      await this.updateLabels(request);
      
      // 処理済みリクエストを削除
      await fs.unlink(filepath);
      
      this.logger.info(`ラベル更新リクエスト処理完了: ${request.requestId}`);
    } catch (error) {
      // ENOENTエラー（ファイルが存在しない）の場合は無視
      if (error.code === 'ENOENT') {
        this.logger.debug(`リクエストファイルが既に削除されています: ${filename}`);
        return;
      }
      
      this.logger.error(`リクエスト処理エラー (${filename}):`, error);
      
      // エラーが続く場合は古いリクエストを削除
      try {
        const stats = await fs.stat(filepath);
        const age = Date.now() - stats.mtime.getTime();
        if (age > 60 * 60 * 1000) { // 1時間以上古い
          await fs.unlink(filepath);
          this.logger.warn(`古いリクエストを削除: ${filename}`);
        }
      } catch (unlinkError) {
        // 既に削除されている場合は無視
        if (unlinkError.code !== 'ENOENT') {
          this.logger.debug(`古いリクエストファイルの削除エラー: ${unlinkError.message}`);
        }
      }
    }
  };

  // テスト1: 正常なファイル処理
  console.log('テスト1: 正常なファイル処理');
  const testFile1 = 'label-update-test1.json';
  await fs.writeFile(
    path.join(testDir, testFile1),
    JSON.stringify({ requestId: 'test-1', issueNumber: 123, addLabels: ['test'] })
  );
  await manager.processRequest(testFile1);
  console.log('');

  // テスト2: 存在しないファイル
  console.log('テスト2: 存在しないファイル（エラーが出ないことを確認）');
  await manager.processRequest('label-update-nonexistent.json');
  console.log('');

  // テスト3: 同じファイルを二回処理（2回目はファイルが存在しない）
  console.log('テスト3: 同じファイルを二回処理');
  const testFile3 = 'label-update-test3.json';
  await fs.writeFile(
    path.join(testDir, testFile3),
    JSON.stringify({ requestId: 'test-3', issueNumber: 456, removeLabels: ['old'] })
  );
  await manager.processRequest(testFile3);
  console.log('2回目の処理:');
  await manager.processRequest(testFile3);
  console.log('');

  // クリーンアップ
  await fs.rmdir(testDir, { recursive: true });
  
  console.log('=== テスト完了 ===');
}

// テストを実行
testProcessRequest().catch(console.error);