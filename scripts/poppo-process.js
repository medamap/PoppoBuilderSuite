#!/usr/bin/env node

/**
 * PoppoBuilder Process Monitor CLI
 * 
 * Commands:
 *   poppo status              - Show running processes
 *   poppo kill <task-id>      - Stop specific task
 *   poppo logs <task-id>      - Show task logs
 */

const fs = require('fs');
const path = require('path');
const { execSync, spawn } = require('child_process');
const readline = require('readline');
const os = require('os');

// Setup i18n before using it
const i18nPath = path.join(__dirname, '..', 'lib', 'i18n');
const { initI18n, t } = require(i18nPath);
// Initialize i18n synchronously
initI18n().catch(console.error);

// Import table formatter
const tableFormatterPath = path.join(__dirname, '..', 'lib', 'utils', 'table-formatter');
const tableFormatter = require(tableFormatterPath);

// 設定とログパス
const basePath = process.cwd();
const runningTasksPath = path.join(basePath, 'logs', 'running-tasks.json');
const tempDir = path.join(basePath, 'temp', 'claude-tasks');
const logsDir = path.join(basePath, 'logs');

// カラー出力用のANSIエスケープコード
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  gray: '\x1b[90m',
  bold: '\x1b[1m'
};

// メモリ使用量をフォーマット
function formatMemory(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// 実行時間をフォーマット
function formatDuration(startTime) {
  const duration = Date.now() - startTime;
  const seconds = Math.floor(duration / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  
  if (hours > 0) {
    return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  } else {
    return `${seconds}s`;
  }
}

// プロセス情報を取得
function getProcessInfo(pid) {
  try {
    if (os.platform() === 'darwin' || os.platform() === 'linux') {
      // macOS/Linux用のコマンド - CPU使用率も取得
      const psOutput = execSync(`ps -p ${pid} -o pid,%cpu,rss,command`, { encoding: 'utf8' });
      const lines = psOutput.split('\n').filter(line => line.trim());
      if (lines.length > 1) {
        const parts = lines[1].trim().split(/\s+/);
        return {
          exists: true,
          cpu: parseFloat(parts[1]) || 0,
          memory: parseInt(parts[2]) * 1024, // RSS in KB to bytes
          command: parts.slice(3).join(' ')
        };
      }
    } else {
      // Windows用の実装
      try {
        // wmicコマンドを使用
        const wmicOutput = execSync(`wmic process where ProcessId=${pid} get ProcessId,WorkingSetSize,Name /format:csv`, { encoding: 'utf8' });
        const lines = wmicOutput.split('\n').filter(line => line.trim() && !line.startsWith('Node'));
        if (lines.length > 0) {
          const parts = lines[0].split(',');
          if (parts.length >= 4) {
            return {
              exists: true,
              cpu: 0, // WindowsではCPU使用率の取得が難しいため0に設定
              memory: parseInt(parts[3]) || 0,
              command: parts[1] || 'N/A'
            };
          }
        }
      } catch (e) {
        // tasklistにフォールバック
        const tasklistOutput = execSync(`tasklist /FI "PID eq ${pid}" /FO CSV`, { encoding: 'utf8' });
        if (tasklistOutput.includes(`"${pid}"`)) {
          return {
            exists: true,
            cpu: 0,
            memory: 0,
            command: 'N/A (Windows)'
          };
        }
      }
    }
  } catch (error) {
    // プロセスが存在しない
  }
  return { exists: false, cpu: 0, memory: 0, command: '' };
}

// 実行中のタスクを取得
function getRunningTasks() {
  const tasks = [];
  
  // running-tasks.jsonから読み込み
  if (fs.existsSync(runningTasksPath)) {
    try {
      const runningTasks = JSON.parse(fs.readFileSync(runningTasksPath, 'utf8'));
      for (const [taskId, task] of Object.entries(runningTasks)) {
        tasks.push({
          taskId,
          ...task,
          source: 'running-tasks.json'
        });
      }
    } catch (error) {
      console.error(`${colors.red}running-tasks.json の読み込みエラー: ${error.message}${colors.reset}`);
    }
  }
  
  // tempディレクトリのPIDファイルから読み込み
  if (fs.existsSync(tempDir)) {
    const pidFiles = fs.readdirSync(tempDir).filter(f => f.endsWith('.pid'));
    for (const pidFile of pidFiles) {
      const taskId = pidFile.replace('.pid', '');
      if (!tasks.find(t => t.taskId === taskId)) {
        try {
          const pid = parseInt(fs.readFileSync(path.join(tempDir, pidFile), 'utf8').trim());
          const statusFile = path.join(tempDir, `${taskId}.status`);
          let status = 'running';
          if (fs.existsSync(statusFile)) {
            const statusData = JSON.parse(fs.readFileSync(statusFile, 'utf8'));
            status = statusData.status || 'running';
          }
          
          tasks.push({
            taskId,
            issueNumber: taskId.split('-')[0],
            pid,
            status,
            source: 'pid-file'
          });
        } catch (error) {
          // PIDファイルの読み込みエラーは無視
        }
      }
    }
  }
  
  return tasks;
}

// statusコマンドの実装
function showStatus(options = {}) {
  const tasks = getRunningTasks();
  
  if (options.json) {
    // JSON出力
    const output = tasks.map(task => {
      const processInfo = task.pid ? getProcessInfo(task.pid) : { exists: false, cpu: 0, memory: 0 };
      return {
        taskId: task.taskId,
        issueNumber: task.issueNumber,
        pid: task.pid,
        status: task.status,
        running: processInfo.exists,
        cpu: processInfo.cpu,
        memory: processInfo.memory,
        startTime: task.startTime,
        duration: task.startTime ? Date.now() - task.startTime : null
      };
    });
    console.log(JSON.stringify(output, null, 2));
    return;
  }
  
  // 通常の出力
  console.log(`${colors.bold}${t('process:title')}${colors.reset}`);
  console.log(`${colors.gray}${t('process:updateTime')}: ${new Date().toLocaleString()}${colors.reset}\n`);
  
  if (tasks.length === 0) {
    console.log(`${colors.yellow}${t('process:noTasks')}${colors.reset}`);
    return;
  }
  
  // Prepare table data
  const tableData = tasks.map(task => {
    const processInfo = task.pid ? getProcessInfo(task.pid) : { exists: false, cpu: 0, memory: 0 };
    const duration = task.startTime ? formatDuration(task.startTime) : '-';
    const cpu = processInfo.exists ? `${processInfo.cpu.toFixed(1)}%` : '-';
    const memory = processInfo.exists ? formatMemory(processInfo.memory) : '-';
    
    return {
      taskId: task.taskId || '-',
      issueNumber: task.issueNumber ? `#${task.issueNumber}` : '-',
      pid: task.pid || '-',
      status: t(`process:status.${task.status || 'unknown'}`),
      duration,
      cpu,
      memory
    };
  });

  // Define columns
  const columns = [
    { key: 'taskId', labelKey: 'process:columns.taskId', maxWidth: 20 },
    { key: 'issueNumber', labelKey: 'process:columns.issue' },
    { key: 'pid', labelKey: 'process:columns.pid', align: 'right' },
    { 
      key: 'status', 
      labelKey: 'process:columns.status',
      formatter: (value, item) => {
        const statusMap = {
          [t('process:status.running')]: colors.green,
          [t('process:status.error')]: colors.red,
          [t('process:status.completed')]: colors.blue
        };
        const color = statusMap[value] || colors.yellow;
        return color + value + colors.reset;
      }
    },
    { key: 'duration', labelKey: 'process:columns.duration', align: 'right' },
    { key: 'cpu', labelKey: 'process:columns.cpu', align: 'right' },
    { key: 'memory', labelKey: 'process:columns.memory', align: 'right' }
  ];

  // Format and print table
  const table = tableFormatter.formatTable(tableData, {
    columns,
    summary: t('process:summary.total', { count: tasks.length })
  });

  console.log(table);
}

// killコマンドの実装
async function killTask(taskId, options = {}) {
  const tasks = getRunningTasks();
  const task = tasks.find(t => t.taskId === taskId);
  
  if (!task) {
    console.error(`${colors.red}タスク ${taskId} が見つかりません${colors.reset}`);
    if (require.main === module) {
      process.exit(1);
    }
    return;
  }
  
  if (!task.pid) {
    console.error(`${colors.red}タスク ${taskId} のPIDが不明です${colors.reset}`);
    if (require.main === module) {
      process.exit(1);
    }
    return;
  }
  
  const processInfo = getProcessInfo(task.pid);
  if (!processInfo.exists) {
    console.log(`${colors.yellow}タスク ${taskId} のプロセス (PID: ${task.pid}) は既に終了しています${colors.reset}`);
    return;
  }
  
  // 確認プロンプト
  if (!options.force) {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    
    const answer = await new Promise(resolve => {
      rl.question(
        `${colors.yellow}タスク ${taskId} (Issue #${task.issueNumber}, PID: ${task.pid}) を停止しますか? [y/N]: ${colors.reset}`,
        resolve
      );
    });
    rl.close();
    
    if (answer.toLowerCase() !== 'y' && answer.toLowerCase() !== 'yes') {
      console.log('キャンセルしました');
      return;
    }
  }
  
  // プロセスの停止
  try {
    // まず SIGTERM を送信
    process.kill(task.pid, 'SIGTERM');
    console.log(`${colors.green}タスク ${taskId} に終了シグナルを送信しました${colors.reset}`);
    
    // 5秒待機
    let killed = false;
    for (let i = 0; i < 50; i++) {
      await new Promise(resolve => setTimeout(resolve, 100));
      if (!getProcessInfo(task.pid).exists) {
        killed = true;
        break;
      }
    }
    
    if (!killed && options.force) {
      // 強制終了
      process.kill(task.pid, 'SIGKILL');
      console.log(`${colors.yellow}タスク ${taskId} を強制終了しました${colors.reset}`);
    } else if (!killed) {
      console.log(`${colors.yellow}タスクが終了していません。--force オプションで強制終了できます${colors.reset}`);
    }
    
    // ステータスファイルの更新
    const statusFile = path.join(tempDir, `${taskId}.status`);
    if (fs.existsSync(statusFile)) {
      const statusData = JSON.parse(fs.readFileSync(statusFile, 'utf8'));
      statusData.status = 'killed';
      statusData.endTime = Date.now();
      fs.writeFileSync(statusFile, JSON.stringify(statusData, null, 2));
    }
    
  } catch (error) {
    console.error(`${colors.red}プロセスの停止に失敗しました: ${error.message}${colors.reset}`);
    process.exit(1);
  }
}

// logsコマンドの実装
function showLogs(taskId, options = {}) {
  const logPattern = `*${taskId}*.log`;
  const logFiles = [];
  
  // ログファイルを検索
  if (fs.existsSync(logsDir)) {
    const files = fs.readdirSync(logsDir);
    for (const file of files) {
      if (file.includes(taskId) || (options.all && file.endsWith('.log'))) {
        logFiles.push(path.join(logsDir, file));
      }
    }
  }
  
  // 今日のログファイルも確認
  const todayLog = path.join(logsDir, `poppo-${new Date().toISOString().split('T')[0]}.log`);
  if (fs.existsSync(todayLog) && !logFiles.includes(todayLog)) {
    logFiles.push(todayLog);
  }
  
  if (logFiles.length === 0) {
    console.error(`${colors.red}タスク ${taskId} のログファイルが見つかりません${colors.reset}`);
    if (require.main === module) {
      process.exit(1);
    }
    return;
  }
  
  if (options.follow) {
    // リアルタイムログ追跡
    console.log(`${colors.blue}タスク ${taskId} のログを追跡中... (Ctrl+C で終了)${colors.reset}\n`);
    
    // tail -f 相当の処理
    const tail = spawn('tail', ['-f', ...logFiles]);
    
    tail.stdout.on('data', (data) => {
      const lines = data.toString().split('\n');
      for (const line of lines) {
        if (line.includes(taskId)) {
          // レベルに応じて色付け
          if (line.includes('ERROR')) {
            console.log(`${colors.red}${line}${colors.reset}`);
          } else if (line.includes('WARN')) {
            console.log(`${colors.yellow}${line}${colors.reset}`);
          } else if (line.includes('INFO')) {
            console.log(`${colors.green}${line}${colors.reset}`);
          } else {
            console.log(line);
          }
        } else if (options.all) {
          console.log(`${colors.gray}${line}${colors.reset}`);
        }
      }
    });
    
    tail.stderr.on('data', (data) => {
      console.error(`${colors.red}エラー: ${data}${colors.reset}`);
    });
    
    process.on('SIGINT', () => {
      tail.kill();
      process.exit(0);
    });
    
  } else {
    // 静的ログ表示
    console.log(`${colors.blue}タスク ${taskId} のログ:${colors.reset}\n`);
    
    let logCount = 0;
    for (const logFile of logFiles) {
      if (!fs.existsSync(logFile)) continue;
      const content = fs.readFileSync(logFile, 'utf8');
      const lines = content.split('\n');
      
      for (const line of lines) {
        if (line.includes(taskId) || options.all) {
          // レベルフィルタ
          if (options.level) {
            const levelUpper = options.level.toUpperCase();
            if (!line.includes(levelUpper)) continue;
          }
          
          // 最大行数制限
          if (options.lines && logCount >= options.lines) break;
          
          // レベルに応じて色付け
          if (line.includes('ERROR')) {
            console.log(`${colors.red}${line}${colors.reset}`);
          } else if (line.includes('WARN')) {
            console.log(`${colors.yellow}${line}${colors.reset}`);
          } else if (line.includes('INFO')) {
            console.log(`${colors.green}${line}${colors.reset}`);
          } else {
            console.log(line);
          }
          
          logCount++;
        }
      }
      
      if (options.lines && logCount >= options.lines) break;
    }
    
    if (logCount === 0) {
      console.log(`${colors.yellow}ログが見つかりませんでした${colors.reset}`);
    }
  }
}

// ヘルプメッセージ
function showHelp() {
  console.log(`
${colors.bold}PoppoBuilder プロセスモニター${colors.reset}

${colors.blue}使用方法:${colors.reset}
  poppo status [options]           実行中のプロセス一覧を表示
  poppo kill <task-id> [options]   特定タスクを停止
  poppo logs <task-id> [options]   タスク別ログを表示
  poppo help                       このヘルプを表示

${colors.blue}共通オプション:${colors.reset}
  --json                          JSON形式で出力

${colors.blue}status オプション:${colors.reset}
  なし

${colors.blue}kill オプション:${colors.reset}
  -f, --force                     確認なしで強制終了

${colors.blue}logs オプション:${colors.reset}
  -f, --follow                    リアルタイムでログを追跡
  -n, --lines <number>            表示する最大行数
  -l, --level <level>             ログレベルでフィルタ (error, warn, info)
  -a, --all                       全てのログを表示（タスクIDフィルタなし）

${colors.blue}例:${colors.reset}
  poppo status                    # 実行中のタスク一覧
  poppo status --json             # JSON形式で出力
  poppo kill 123-abc              # タスクを停止（確認あり）
  poppo kill 123-abc --force      # タスクを強制停止
  poppo logs 123-abc              # タスクのログ表示
  poppo logs 123-abc -f           # リアルタイムログ追跡
  poppo logs 123-abc -l error     # エラーログのみ表示
`);
}

// メイン処理
async function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  
  if (!command || command === 'help' || command === '--help' || command === '-h') {
    showHelp();
    return;
  }
  
  switch (command) {
    case 'status': {
      const options = {
        json: args.includes('--json')
      };
      showStatus(options);
      break;
    }
    
    case 'kill': {
      const taskId = args[1];
      if (!taskId) {
        console.error(`${colors.red}エラー: task-id を指定してください${colors.reset}`);
        console.log('使用方法: poppo kill <task-id>');
        process.exit(1);
      }
      
      const options = {
        force: args.includes('--force') || args.includes('-f')
      };
      await killTask(taskId, options);
      break;
    }
    
    case 'logs': {
      const taskId = args[1];
      if (!taskId) {
        console.error(`${colors.red}エラー: task-id を指定してください${colors.reset}`);
        console.log('使用方法: poppo logs <task-id>');
        process.exit(1);
      }
      
      const options = {
        follow: args.includes('--follow') || args.includes('-f'),
        all: args.includes('--all') || args.includes('-a')
      };
      
      // 行数オプション
      const linesIndex = args.findIndex(a => a === '--lines' || a === '-n');
      if (linesIndex !== -1 && args[linesIndex + 1]) {
        options.lines = parseInt(args[linesIndex + 1]);
      }
      
      // レベルオプション
      const levelIndex = args.findIndex(a => a === '--level' || a === '-l');
      if (levelIndex !== -1 && args[levelIndex + 1]) {
        options.level = args[levelIndex + 1];
      }
      
      showLogs(taskId, options);
      break;
    }
    
    default:
      console.error(`${colors.red}エラー: 不明なコマンド '${command}'${colors.reset}`);
      showHelp();
      process.exit(1);
  }
}

// エントリーポイント
if (require.main === module) {
  main().catch(error => {
    console.error(`${colors.red}エラー: ${error.message}${colors.reset}`);
    process.exit(1);
  });
}

module.exports = { getRunningTasks, showStatus, killTask, showLogs };