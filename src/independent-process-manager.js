const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const i18n = require('../lib/i18n');

/**
 * 独立プロセス方式のClaude CLI管理
 * PoppoBuilder再起動時もタスクが継続実行される
 */
class IndependentProcessManager {
  constructor(config, rateLimiter, logger, stateManager, lockManager = null) {
    this.config = config;
    this.rateLimiter = rateLimiter;
    this.logger = logger;
    this.stateManager = stateManager; // FileStateManagerを直接受け取る
    this.lockManager = lockManager; // IssueLockManager（オプショナル）
    this.tempDir = path.join(__dirname, '../temp');
    
    // ディレクトリ作成
    this.ensureDirectories();
    
    // 起動時に既存タスクを検出（非同期実行）
    this.recoverExistingTasks().catch(error => {
      console.error('既存タスクの回復に失敗:', error);
    });
  }

  /**
   * StateManagerを設定（後から設定可能）
   */
  setStateManager(stateManager) {
    this.stateManager = stateManager;
    console.log('✅ StateManagerが設定されました');
    
    // 設定後に既存タスクを検出
    this.recoverExistingTasks().catch(error => {
      console.error('既存タスクの回復に失敗:', error);
    });
  }

  /**
   * 必要なディレクトリを作成
   */
  ensureDirectories() {
    if (!fs.existsSync(this.tempDir)) {
      fs.mkdirSync(this.tempDir, { recursive: true });
    }
  }

  /**
   * PoppoBuilder起動時に既存の実行中タスクを検出・回復
   */
  async recoverExistingTasks() {
    try {
      if (!this.stateManager) {
        console.warn('StateManagerが設定されていません');
        return;
      }
      
      const runningTasks = await this.stateManager.loadRunningTasks();
      console.log(`🔄 既存の実行中タスクを検出: ${Object.keys(runningTasks).length}件`);
      
      for (const [taskId, taskInfo] of Object.entries(runningTasks)) {
        await this.verifyTaskStatus(taskId, taskInfo);
      }
    } catch (error) {
      console.error('既存タスク回復エラー:', error.message);
      // エラー時は空のタスクリストで開始
      if (this.stateManager) {
        await this.stateManager.saveRunningTasks({});
      }
    }
  }

  /**
   * タスクの実際の状況を確認
   */
  async verifyTaskStatus(taskId, taskInfo) {
    const pidFile = path.join(this.tempDir, `task-${taskId}.pid`);
    const statusFile = path.join(this.tempDir, `task-${taskId}.status`);
    
    try {
      // プロセスが実際に動いているかチェック
      if (fs.existsSync(pidFile)) {
        const pid = parseInt(fs.readFileSync(pidFile, 'utf8'));
        const isRunning = this.isProcessRunning(pid);
        
        if (isRunning) {
          console.log(`✅ タスク ${taskId} は継続実行中 (PID: ${pid})`);
          // 状態ファイルを更新
          this.updateTaskStatus(taskId, 'running', '継続実行中（PoppoBuilder再起動後に検出）');
        } else {
          console.log(`⚠️  タスク ${taskId} のプロセスが見つかりません (PID: ${pid})`);
          await this.handleOrphanedTask(taskId, taskInfo);
        }
      } else {
        console.log(`⚠️  タスク ${taskId} のPIDファイルが見つかりません`);
        await this.handleOrphanedTask(taskId, taskInfo);
      }
    } catch (error) {
      console.error(`タスク ${taskId} の状況確認エラー:`, error.message);
      await this.handleOrphanedTask(taskId, taskInfo);
    }
  }

  /**
   * プロセスが実行中かチェック
   */
  isProcessRunning(pid) {
    try {
      process.kill(pid, 0); // シグナル0は存在チェック
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * 孤児となったタスクの処理
   */
  async handleOrphanedTask(taskId, taskInfo) {
    console.log(`🧹 孤児タスク ${taskId} をクリーンアップ`);
    
    // 結果ファイルがあるかチェック
    const resultFile = path.join(this.tempDir, `task-${taskId}.result`);
    if (fs.existsSync(resultFile)) {
      console.log(`📋 タスク ${taskId} の結果ファイルを発見、回収処理を実行`);
      await this.processCompletedTask(taskId, taskInfo);
    } else {
      // 未完了のタスクとして処理
      this.updateTaskStatus(taskId, 'failed', 'PoppoBuilder再起動により中断された可能性');
      await this.removeTask(taskId);
    }
  }

  /**
   * Claude実行（独立プロセス方式）
   * @param {string} taskId - タスクID
   * @param {Object} instruction - 実行指示
   * @param {Object} options - オプション設定
   * @param {boolean} options.skipLockAcquisition - ロック取得をスキップするかどうか（既に取得済みの場合）
   */
  async execute(taskId, instruction, options = {}) {
    if (!await this.canExecute()) {
      throw new Error(i18n.t('errors.process.cannotExecute'));
    }

    // IssueLockManagerが設定されている場合、ロックを取得
    // ただし、skipLockAcquisitionが指定されている場合はスキップ
    const issueNumber = instruction.issue?.number;
    if (this.lockManager && issueNumber && !options.skipLockAcquisition) {
      const lockAcquired = await this.lockManager.acquireLock(issueNumber, {
        pid: process.pid,
        sessionId: process.env.CLAUDE_SESSION_ID,
        taskId: taskId,
        type: 'issue_processing'
      });
      
      if (!lockAcquired) {
        throw new Error(`Failed to acquire lock for Issue #${issueNumber} - already being processed`);
      }
    }

    console.log(`🚀 独立プロセスでタスク ${taskId} を開始`);
    
    // 指示ファイルを作成
    const instructionFile = path.join(this.tempDir, `instruction-${taskId}.txt`);
    fs.writeFileSync(instructionFile, JSON.stringify(instruction, null, 2), 'utf8');

    // 各種ファイルパスを定義
    const pidFile = path.join(this.tempDir, `task-${taskId}.pid`);
    const statusFile = path.join(this.tempDir, `task-${taskId}.status`);
    const outputFile = path.join(this.tempDir, `task-${taskId}.output`);
    const resultFile = path.join(this.tempDir, `task-${taskId}.result`);

    // ラッパースクリプトを作成（Claude CLI実行 + 結果保存）
    const wrapperScript = this.createWrapperScript(taskId, instructionFile, outputFile, resultFile);
    const wrapperFile = path.join(this.tempDir, `wrapper-${taskId}.js`);
    fs.writeFileSync(wrapperFile, wrapperScript, 'utf8');

    // 独立プロセスとして起動
    // 現在の作業ディレクトリを事前に取得（Node.js v23での問題回避）
    const currentWorkingDir = process.cwd();
    const childProcess = spawn('node', [wrapperFile], {
      detached: true,  // 親プロセスから独立
      stdio: 'ignore', // 標準入出力を切り離し
      cwd: currentWorkingDir
    });

    // プロセス情報を記録
    fs.writeFileSync(pidFile, childProcess.pid.toString(), 'utf8');
    this.updateTaskStatus(taskId, 'running', 'Claude CLI実行中');
    
    // 実行中タスクリストに追加
    await this.addRunningTask(taskId, {
      issueNumber: instruction.issue?.number || 0,
      title: instruction.issue?.title || 'Unknown Task',
      startTime: new Date().toISOString(),
      pid: childProcess.pid,
      type: instruction.task || 'execute'
    });

    // プロセスを親から切り離し
    childProcess.unref();

    console.log(`✅ タスク ${taskId} を独立プロセス (PID: ${childProcess.pid}) として起動`);
    
    if (this.logger) {
      this.logger.logProcess(taskId, 'INDEPENDENT_START', { 
        pid: childProcess.pid,
        instruction: instruction 
      });
    }

    return {
      taskId: taskId,
      pid: childProcess.pid,
      status: 'started'
    };
  }

  /**
   * ラッパースクリプトを生成
   */
  createWrapperScript(taskId, instructionFile, outputFile, resultFile) {
    return `
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const RateLimitHandler = require('${path.join(__dirname, 'rate-limit-handler.js').replace(/\\/g, '\\\\')}');

// タスク${taskId}のラッパースクリプト
console.log('独立プロセス ${taskId} 開始');

const rateLimitHandler = new RateLimitHandler('${this.tempDir}');

async function executeClaudeTask() {
  // 指示ファイルの内容を読み込む
  const instructionContent = fs.readFileSync('${instructionFile}', 'utf8');
  const instruction = JSON.parse(instructionContent);
  
  // JSON形式の構造化プロンプトを構築
  const structuredPrompt = {
    system_prompt: {
      type: "instruction_string",
      content: [
        instruction.systemPrompt || "あなたはGitHub Issueを処理する開発アシスタントです。",
        "ユーザープロンプトの内容を処理してください。",
        "ユーザープロンプトに明示されていなくても、必ず詳細なコメントをIssueに返すために適切な回答を生成してください。",
        "要約ではなく、具体的で実行可能な内容を提供してください。",
        "処理が完全に完了したと判断できる場合は「completed」、まだユーザーからの返答が必要な場合は「awaiting-response」として扱ってください。",
        instruction.metadata?.projectId ? \`プロジェクトID: \${instruction.metadata.projectId}\` : "",
        instruction.issue?.number ? \`Issue番号: #\${instruction.issue.number}\` : "",
        instruction.issue?.title ? \`Issueタイトル: \${instruction.issue.title}\` : "",
        instruction.issue?.labels?.length > 0 ? \`ラベル: \${instruction.issue.labels.join(', ')}\` : ""
      ].filter(Boolean).join('\\n')
    },
    user_prompt: {
      type: "instruction_content",
      content: instruction.instructions || instruction.issue?.body || ""
    },
    output_requirements: {
      type: "instruction_string",
      content: [
        "必ず以下の形式で回答してください：",
        "1. 要求の理解と分析",
        "2. 具体的な提案や回答",
        "3. 実行した内容の説明（もしあれば）",
        "4. 次のステップの提案"
      ].join('\\n')
    }
  };
  
  // JSON形式のプロンプトを文字列に変換
  const prompt = JSON.stringify(structuredPrompt, null, 2);
  
  const args = ['--dangerously-skip-permissions', '--print'];

  const claude = spawn('claude', args, {
    stdio: ['pipe', 'pipe', 'pipe']
  });

  // プロンプトを送信
  claude.stdin.write(prompt);
  claude.stdin.end();

  let stdout = '';
  let stderr = '';

  claude.stdout.on('data', (data) => {
    const chunk = data.toString();
    stdout += chunk;
    
    // リアルタイムで出力ファイルに書き込み
    fs.appendFileSync('${outputFile}', chunk, 'utf8');
  });

  claude.stderr.on('data', (data) => {
    stderr += data.toString();
  });

  claude.on('exit', async (code) => {
    console.log('Claude CLI終了 (code: ' + code + ')');
    
    // レート制限エラーをチェック
    const resetTime = rateLimitHandler.parseRateLimitError(stderr);
    if (resetTime) {
      console.log('レート制限エラーを検出');
      
      // 一時的な結果を保存
      const tempResult = {
        taskId: '${taskId}',
        exitCode: code,
        output: stdout,
        error: stderr,
        completedAt: new Date().toISOString(),
        success: false,
        rateLimited: true,
        resetTime: resetTime
      };
      fs.writeFileSync('${resultFile}', JSON.stringify(tempResult, null, 2), 'utf8');
      
      // レート制限解除まで待機して再開
      try {
        const resumeResult = await rateLimitHandler.waitAndResume('${taskId}', resetTime, '${outputFile}', '${resultFile}');
        console.log('タスク${taskId}再開完了');
        
        // クリーンアップ
        try {
          fs.unlinkSync('${instructionFile}');
          fs.unlinkSync(__filename); // このラッパースクリプト自体を削除
        } catch (e) {
          // エラーは無視
        }
        
        process.exit(resumeResult.success ? 0 : 1);
      } catch (error) {
        console.error('再開エラー:', error.message);
        process.exit(1);
      }
    } else {
      // 通常の終了処理
      const result = {
        taskId: '${taskId}',
        exitCode: code,
        output: stdout,
        error: stderr,
        completedAt: new Date().toISOString(),
        success: code === 0
      };
      
      fs.writeFileSync('${resultFile}', JSON.stringify(result, null, 2), 'utf8');
      
      // クリーンアップ
      try {
        fs.unlinkSync('${instructionFile}');
        fs.unlinkSync(__filename); // このラッパースクリプト自体を削除
      } catch (e) {
        // エラーは無視
      }
      
      console.log('タスク${taskId}完了');
      process.exit(code);
    }
  });

  claude.on('error', (error) => {
    console.error('Claude CLI エラー:', error.message);
    
    const result = {
      taskId: '${taskId}',
      exitCode: -1,
      output: stdout,
      error: error.message,
      completedAt: new Date().toISOString(),
      success: false
    };
    
    fs.writeFileSync('${resultFile}', JSON.stringify(result, null, 2), 'utf8');
    process.exit(1);
  });
}

// 実行開始
executeClaudeTask().catch(error => {
  console.error('タスク実行エラー:', error);
  process.exit(1);
});
`;
  }

  /**
   * タスクの状態を更新
   */
  updateTaskStatus(taskId, status, message) {
    const statusFile = path.join(this.tempDir, `task-${taskId}.status`);
    const statusData = {
      taskId: taskId,
      status: status,
      message: message,
      updatedAt: new Date().toISOString()
    };
    
    fs.writeFileSync(statusFile, JSON.stringify(statusData, null, 2), 'utf8');
  }

  /**
   * 実行中タスクリストを管理
   */
  async addRunningTask(taskId, taskInfo) {
    if (!this.stateManager) return;
    
    const runningTasks = await this.stateManager.loadRunningTasks();
    runningTasks[taskId] = taskInfo;
    await this.stateManager.saveRunningTasks(runningTasks);
  }

  async removeTask(taskId) {
    if (this.stateManager) {
      const runningTasks = await this.stateManager.loadRunningTasks();
      const taskInfo = runningTasks[taskId];
      
      // IssueLockManagerが設定されている場合、ロックを解放
      if (this.lockManager && taskInfo && taskInfo.issueNumber) {
        try {
          await this.lockManager.releaseLock(taskInfo.issueNumber, taskInfo.pid || process.pid);
          console.log(`🔓 Issue #${taskInfo.issueNumber} のロックを解放しました`);
        } catch (error) {
          console.error(`Failed to release lock for Issue #${taskInfo.issueNumber}:`, error);
        }
      }
      
      delete runningTasks[taskId];
      await this.stateManager.saveRunningTasks(runningTasks);
    }
    
    // 関連ファイルもクリーンアップ
    const files = [
      `task-${taskId}.pid`,
      `task-${taskId}.status`,
      `task-${taskId}.output`,
      `task-${taskId}.result`
    ];
    
    files.forEach(file => {
      const filePath = path.join(this.tempDir, file);
      try {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      } catch (error) {
        // エラーは無視
      }
    });
  }

  async getRunningTasks() {
    try {
      if (this.stateManager) {
        return await this.stateManager.loadRunningTasks();
      }
    } catch (error) {
      console.error('実行中タスクリスト読み込みエラー:', error.message);
    }
    return {};
  }

  async saveRunningTasks(tasks) {
    if (this.stateManager) {
      await this.stateManager.saveRunningTasks(tasks);
    }
  }

  /**
   * 実行可能かチェック
   */
  async canExecute() {
    const rateLimitStatus = await this.rateLimiter.isRateLimited();
    const runningTasks = await this.getRunningTasks();
    const runningCount = Object.keys(runningTasks).length;
    
    return !rateLimitStatus.limited && runningCount < this.config.maxConcurrent;
  }

  /**
   * ポーリング: 完了したタスクをチェック
   */
  async pollCompletedTasks() {
    const runningTasks = await this.getRunningTasks();
    const completedResults = [];
    
    for (const [taskId, taskInfo] of Object.entries(runningTasks)) {
      const resultFile = path.join(this.tempDir, `task-${taskId}.result`);
      
      if (fs.existsSync(resultFile)) {
        console.log(`📋 タスク ${taskId} の完了を検出`);
        const result = await this.processCompletedTask(taskId, taskInfo);
        if (result) {
          completedResults.push(result);
        }
      }
    }
    
    return completedResults;
  }

  /**
   * 完了したタスクの結果を処理
   */
  async processCompletedTask(taskId, taskInfo) {
    try {
      const resultFile = path.join(this.tempDir, `task-${taskId}.result`);
      const result = JSON.parse(fs.readFileSync(resultFile, 'utf8'));
      
      console.log(`🎯 タスク ${taskId} の結果を処理中`);
      
      if (this.logger) {
        this.logger.logProcess(taskId, 'INDEPENDENT_COMPLETED', {
          success: result.success,
          exitCode: result.exitCode,
          outputLength: result.output?.length || 0
        });
      }

      // 結果を返す（呼び出し元でGitHubコメント等を処理）
      return {
        taskId: taskId,
        success: result.success,
        output: result.output || '',
        error: result.error || '',
        taskInfo: taskInfo
      };
      
    } catch (error) {
      console.error(`タスク ${taskId} の結果処理エラー:`, error.message);
      return {
        taskId: taskId,
        success: false,
        output: '',
        error: `結果処理エラー: ${error.message}`,
        taskInfo: taskInfo
      };
    } finally {
      // タスクを実行中リストから削除
      await this.removeTask(taskId);
    }
  }

  /**
   * すべての実行中タスクを強制終了
   */
  async killAll() {
    const runningTasks = await this.getRunningTasks();
    
    for (const [taskId, taskInfo] of Object.entries(runningTasks)) {
      console.log(`🛑 タスク ${taskId} を強制終了 (PID: ${taskInfo.pid})`);
      
      try {
        if (this.isProcessRunning(taskInfo.pid)) {
          process.kill(taskInfo.pid, 'SIGTERM');
        }
      } catch (error) {
        console.error(`タスク ${taskId} 終了エラー:`, error.message);
      }
      
      this.updateTaskStatus(taskId, 'killed', '手動で強制終了');
    }
    
    // 実行中タスクリストをクリア
    await this.saveRunningTasks({});
  }


  /**
   * 実行中のプロセス一覧を取得（ApplicationMonitor用）
   */
  async getRunningProcesses() {
    try {
      const runningTasks = await this.stateManager.loadRunningTasks();
      return Object.entries(runningTasks).map(([taskId, taskInfo]) => ({
        taskId,
        pid: taskInfo.pid,
        startTime: taskInfo.startTime,
        status: 'running',
        issueNumber: taskInfo.issueNumber
      }));
    } catch (error) {
      console.error('実行中プロセス取得エラー:', error);
      return [];
    }
  }

  /**
   * 全プロセス一覧を取得（ApplicationMonitor用）
   */
  async getAllProcesses() {
    // 実装を簡単にするため、現在は実行中プロセスのみ返す
    return await this.getRunningProcesses();
  }

}

module.exports = IndependentProcessManager;