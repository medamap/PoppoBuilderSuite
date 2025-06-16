const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

/**
 * 独立プロセス方式のClaude CLI管理
 * PoppoBuilder再起動時もタスクが継続実行される
 */
class IndependentProcessManager {
  constructor(config, rateLimiter, logger) {
    this.config = config;
    this.rateLimiter = rateLimiter;
    this.logger = logger;
    this.tempDir = path.join(__dirname, '../temp');
    this.runningTasksFile = path.join(__dirname, '../logs/running-tasks.json');
    this.stateManager = null; // プロセス状態マネージャー（既存のものを流用予定）
    
    // ディレクトリ作成
    this.ensureDirectories();
    
    // 起動時に既存タスクを検出
    this.recoverExistingTasks();
  }

  /**
   * 必要なディレクトリを作成
   */
  ensureDirectories() {
    const dirs = [this.tempDir, path.dirname(this.runningTasksFile)];
    dirs.forEach(dir => {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    });
  }

  /**
   * PoppoBuilder起動時に既存の実行中タスクを検出・回復
   */
  recoverExistingTasks() {
    try {
      if (fs.existsSync(this.runningTasksFile)) {
        const runningTasks = JSON.parse(fs.readFileSync(this.runningTasksFile, 'utf8'));
        console.log(`🔄 既存の実行中タスクを検出: ${Object.keys(runningTasks).length}件`);
        
        for (const [taskId, taskInfo] of Object.entries(runningTasks)) {
          this.verifyTaskStatus(taskId, taskInfo);
        }
      }
    } catch (error) {
      console.error('既存タスク回復エラー:', error.message);
      // エラー時は空のタスクリストで開始
      this.saveRunningTasks({});
    }
  }

  /**
   * タスクの実際の状況を確認
   */
  verifyTaskStatus(taskId, taskInfo) {
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
          this.handleOrphanedTask(taskId, taskInfo);
        }
      } else {
        console.log(`⚠️  タスク ${taskId} のPIDファイルが見つかりません`);
        this.handleOrphanedTask(taskId, taskInfo);
      }
    } catch (error) {
      console.error(`タスク ${taskId} の状況確認エラー:`, error.message);
      this.handleOrphanedTask(taskId, taskInfo);
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
  handleOrphanedTask(taskId, taskInfo) {
    console.log(`🧹 孤児タスク ${taskId} をクリーンアップ`);
    
    // 結果ファイルがあるかチェック
    const resultFile = path.join(this.tempDir, `task-${taskId}.result`);
    if (fs.existsSync(resultFile)) {
      console.log(`📋 タスク ${taskId} の結果ファイルを発見、回収処理を実行`);
      this.processCompletedTask(taskId, taskInfo);
    } else {
      // 未完了のタスクとして処理
      this.updateTaskStatus(taskId, 'failed', 'PoppoBuilder再起動により中断された可能性');
      this.removeTask(taskId);
    }
  }

  /**
   * Claude実行（独立プロセス方式）
   */
  async execute(taskId, instruction) {
    if (!await this.canExecute()) {
      throw new Error('Cannot execute: rate limited or max concurrent reached');
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
    const process = spawn('node', [wrapperFile], {
      detached: true,  // 親プロセスから独立
      stdio: 'ignore', // 標準入出力を切り離し
      cwd: process.cwd()
    });

    // プロセス情報を記録
    fs.writeFileSync(pidFile, process.pid.toString(), 'utf8');
    this.updateTaskStatus(taskId, 'running', 'Claude CLI実行中');
    
    // 実行中タスクリストに追加
    this.addRunningTask(taskId, {
      issueNumber: instruction.issue?.number || 0,
      title: instruction.issue?.title || 'Unknown Task',
      startTime: new Date().toISOString(),
      pid: process.pid,
      type: instruction.task || 'execute'
    });

    // プロセスを親から切り離し
    process.unref();

    console.log(`✅ タスク ${taskId} を独立プロセス (PID: ${process.pid}) として起動`);
    
    if (this.logger) {
      this.logger.logProcess(taskId, 'INDEPENDENT_START', { 
        pid: process.pid,
        instruction: instruction 
      });
    }

    return {
      taskId: taskId,
      pid: process.pid,
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

// タスク${taskId}のラッパースクリプト
console.log('独立プロセス ${taskId} 開始');

const prompt = '${instructionFile} の指示に従ってください。';
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

claude.on('exit', (code) => {
  console.log('Claude CLI終了 (code: ' + code + ')');
  
  // 結果ファイルに保存
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
  addRunningTask(taskId, taskInfo) {
    const runningTasks = this.getRunningTasks();
    runningTasks[taskId] = taskInfo;
    this.saveRunningTasks(runningTasks);
  }

  removeTask(taskId) {
    const runningTasks = this.getRunningTasks();
    delete runningTasks[taskId];
    this.saveRunningTasks(runningTasks);
    
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

  getRunningTasks() {
    try {
      if (fs.existsSync(this.runningTasksFile)) {
        return JSON.parse(fs.readFileSync(this.runningTasksFile, 'utf8'));
      }
    } catch (error) {
      console.error('実行中タスクリスト読み込みエラー:', error.message);
    }
    return {};
  }

  saveRunningTasks(tasks) {
    fs.writeFileSync(this.runningTasksFile, JSON.stringify(tasks, null, 2), 'utf8');
  }

  /**
   * 実行可能かチェック
   */
  async canExecute() {
    const rateLimitStatus = await this.rateLimiter.isRateLimited();
    const runningCount = Object.keys(this.getRunningTasks()).length;
    
    return !rateLimitStatus.limited && runningCount < this.config.maxConcurrent;
  }

  /**
   * ポーリング: 完了したタスクをチェック
   */
  async pollCompletedTasks() {
    const runningTasks = this.getRunningTasks();
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
      this.removeTask(taskId);
    }
  }

  /**
   * すべての実行中タスクを強制終了
   */
  killAll() {
    const runningTasks = this.getRunningTasks();
    
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
    this.saveRunningTasks({});
  }

  /**
   * タスクの実行状況を取得
   */
  getTaskStatus() {
    const runningTasks = this.getRunningTasks();
    const status = {
      running: Object.keys(runningTasks).length,
      tasks: {}
    };
    
    for (const [taskId, taskInfo] of Object.entries(runningTasks)) {
      const statusFile = path.join(this.tempDir, `task-${taskId}.status`);
      
      try {
        if (fs.existsSync(statusFile)) {
          const taskStatus = JSON.parse(fs.readFileSync(statusFile, 'utf8'));
          status.tasks[taskId] = {
            ...taskInfo,
            ...taskStatus
          };
        } else {
          status.tasks[taskId] = {
            ...taskInfo,
            status: 'unknown',
            message: 'ステータスファイルなし'
          };
        }
      } catch (error) {
        status.tasks[taskId] = {
          ...taskInfo,
          status: 'error',
          message: `ステータス読み込みエラー: ${error.message}`
        };
      }
    }
    
    return status;
  }

  /**
   * プロセス状態マネージャーを設定
   */
  setStateManager(stateManager) {
    this.stateManager = stateManager;
  }
}

module.exports = IndependentProcessManager;