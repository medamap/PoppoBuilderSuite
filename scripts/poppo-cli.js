#!/usr/bin/env node

const { Command } = require('commander');
const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');
const { spawn } = require('child_process');
const chalk = require('chalk');

// Default daemon URL
const DAEMON_URL = process.env.POPPO_DAEMON_URL || 'http://localhost:3003';

// CLI program
const program = new Command();

program
  .name('poppo')
  .description('PoppoBuilder Multi-Project Management CLI')
  .version('1.0.0');

// Daemon command
program
  .command('daemon')
  .description('Manage daemon process')
  .option('--start', 'Start daemon')
  .option('--stop', 'Stop daemon')
  .option('--status', 'Check daemon status')
  .option('--restart', 'Restart daemon')
  .action(async (options) => {
    try {
      if (options.start) {
        await startDaemon();
      } else if (options.stop) {
        await stopDaemon();
      } else if (options.status) {
        await checkDaemonStatus();
      } else if (options.restart) {
        await stopDaemon();
        await new Promise(resolve => setTimeout(resolve, 2000));
        await startDaemon();
      } else {
        console.log('Please specify an option: --start, --stop, --status, --restart');
      }
    } catch (error) {
      console.error(chalk.red('Error:'), error.message);
      process.exit(1);
    }
  });

// Project command
program
  .command('project')
  .description('Manage projects')
  .option('-r, --register <path>', 'Register project')
  .option('-u, --unregister <id>', 'Unregister project')
  .option('-l, --list', 'List projects')
  .option('-s, --scan <id>', 'Scan project tasks')
  .option('-p, --priority <id> <priority>', 'Set project priority')
  .action(async (options) => {
    try {
      if (options.register) {
        await registerProject(options.register);
      } else if (options.unregister) {
        await unregisterProject(options.unregister);
      } else if (options.list) {
        await listProjects();
      } else if (options.scan) {
        await scanProjectTasks(options.scan);
      } else if (options.priority) {
        const args = program.args;
        if (args.length >= 2) {
          await updateProjectPriority(args[0], parseInt(args[1]));
        } else {
          console.error('Usage: poppo project -p <id> <priority>');
        }
      } else {
        program.help();
      }
    } catch (error) {
      console.error(chalk.red('Error:'), error.message);
      process.exit(1);
    }
  });

// Queue command
program
  .command('queue')
  .description('Manage global queue')
  .option('-s, --status', 'Show queue status')
  .option('-c, --clear', 'Clear queue')
  .action(async (options) => {
    try {
      if (options.status) {
        await showQueueStatus();
      } else if (options.clear) {
        await clearQueue();
      } else {
        program.help();
      }
    } catch (error) {
      console.error(chalk.red('Error:'), error.message);
      process.exit(1);
    }
  });

// Worker command
program
  .command('worker')
  .description('Manage worker processes')
  .option('-l, --list', 'List workers')
  .option('-s, --start <projectId>', 'Start worker for specific project')
  .option('-k, --stop <projectId>', 'Stop worker for specific project')
  .action(async (options) => {
    try {
      if (options.list) {
        await listWorkers();
      } else if (options.start) {
        await startWorker(options.start);
      } else if (options.stop) {
        await stopWorker(options.stop);
      } else {
        program.help();
      }
    } catch (error) {
      console.error(chalk.red('Error:'), error.message);
      process.exit(1);
    }
  });

// Dashboard command
program
  .command('dashboard')
  .description('Open dashboard')
  .action(() => {
    const dashboardUrl = 'http://localhost:3001/multi-project.html';
    console.log(chalk.green(`Opening dashboard: ${dashboardUrl}`));
    
    // Open browser
    const platform = process.platform;
    const command = platform === 'darwin' ? 'open' :
                   platform === 'win32' ? 'start' :
                   'xdg-open';
    
    spawn(command, [dashboardUrl], { shell: true });
  });

// Start daemon
async function startDaemon() {
  console.log(chalk.blue('Starting daemon...'));
  
  const daemonScript = path.join(__dirname, '..', 'src', 'poppo-daemon.js');
  const daemon = spawn('node', [daemonScript], {
    detached: true,
    stdio: 'ignore'
  });
  
  daemon.unref();
  
  // Wait for startup
  await new Promise(resolve => setTimeout(resolve, 3000));
  
  // Check status
  try {
    const response = await axios.get(`${DAEMON_URL}/api/health`);
    console.log(chalk.green('✓ Daemon started successfully'));
    console.log(chalk.gray(`  PID: ${response.data.daemon.pid}`));
    console.log(chalk.gray(`  API: ${DAEMON_URL}`));
  } catch (error) {
    console.error(chalk.red('✗ Failed to start daemon'));
  }
}

// Stop daemon
async function stopDaemon() {
  console.log(chalk.blue('Stopping daemon...'));
  
  try {
    await axios.post(`${DAEMON_URL}/api/shutdown`);
    console.log(chalk.green('✓ Daemon shutdown requested'));
  } catch (error) {
    console.error(chalk.red('✗ Failed to communicate with daemon'));
  }
}

// Check daemon status
async function checkDaemonStatus() {
  try {
    const response = await axios.get(`${DAEMON_URL}/api/health`);
    const health = response.data;
    
    console.log(chalk.green('✓ Daemon is running'));
    console.log(chalk.gray(`  PID: ${health.daemon.pid}`));
    console.log(chalk.gray(`  Uptime: ${Math.floor(health.daemon.uptime)} seconds`));
    console.log(chalk.gray(`  Memory usage: ${Math.round(health.daemon.memory.heapUsed / 1024 / 1024)}MB`));
    console.log(chalk.gray(`  Queue size: ${health.queue.queueSize}`));
    console.log(chalk.gray(`  Workers: ${health.workers}`));
  } catch (error) {
    console.error(chalk.red('✗ Daemon is not responding'));
    console.error(chalk.gray('  Daemon may not be running'));
  }
}

// Register project
async function registerProject(projectPath) {
  const absolutePath = path.resolve(projectPath);
  console.log(chalk.blue(`Registering project: ${absolutePath}`));
  
  try {
    const response = await axios.post(`${DAEMON_URL}/api/projects/register`, {
      path: absolutePath
    });
    
    const project = response.data.project;
    console.log(chalk.green('✓ プロジェクトを登録しました'));
    console.log(chalk.gray(`  ID: ${project.id}`));
    console.log(chalk.gray(`  名前: ${project.name}`));
    console.log(chalk.gray(`  優先度: ${project.priority}`));
  } catch (error) {
    console.error(chalk.red('✗ プロジェクトの登録に失敗しました'));
    console.error(chalk.gray(`  ${error.response?.data?.error || error.message}`));
  }
}

// プロジェクトを削除
async function unregisterProject(projectId) {
  console.log(chalk.blue(`プロジェクトを削除しています: ${projectId}`));
  
  try {
    await axios.delete(`${DAEMON_URL}/api/projects/${projectId}`);
    console.log(chalk.green('✓ プロジェクトを削除しました'));
  } catch (error) {
    console.error(chalk.red('✗ プロジェクトの削除に失敗しました'));
    console.error(chalk.gray(`  ${error.response?.data?.error || error.message}`));
  }
}

// プロジェクト一覧を表示
async function listProjects() {
  try {
    const response = await axios.get(`${DAEMON_URL}/api/projects`);
    const projects = response.data.projects;
    
    if (projects.length === 0) {
      console.log(chalk.yellow('登録されたプロジェクトがありません'));
      return;
    }
    
    console.log(chalk.bold('\nプロジェクト一覧:'));
    console.log(chalk.gray('─'.repeat(80)));
    
    projects.forEach(project => {
      console.log(chalk.blue(`\n${project.name} (${project.id})`));
      console.log(chalk.gray(`  パス: ${project.path}`));
      console.log(chalk.gray(`  優先度: ${project.priority}`));
      console.log(chalk.gray(`  健全性: ${getHealthEmoji(project.health)} ${project.health}`));
      console.log(chalk.gray(`  キュー: 待機中 ${project.currentQueue.queued}, 処理中 ${project.currentQueue.processing}`));
      console.log(chalk.gray(`  統計: 完了 ${project.statistics.completed}, 失敗 ${project.statistics.failed}`));
    });
    
    console.log(chalk.gray('\n─'.repeat(80)));
  } catch (error) {
    console.error(chalk.red('✗ プロジェクト一覧の取得に失敗しました'));
    console.error(chalk.gray(`  ${error.message}`));
  }
}

// タスクをスキャン
async function scanProjectTasks(projectId) {
  console.log(chalk.blue(`プロジェクトのタスクをスキャンしています: ${projectId}`));
  
  try {
    const response = await axios.post(`${DAEMON_URL}/api/projects/${projectId}/scan`);
    const tasks = response.data.tasks;
    
    console.log(chalk.green(`✓ ${tasks.length}個のタスクを見つけました`));
    
    if (tasks.length > 0) {
      console.log(chalk.gray('\n最初の5件:'));
      tasks.slice(0, 5).forEach(task => {
        console.log(chalk.gray(`  - Issue #${task.issueNumber}: ${task.metadata.title}`));
      });
    }
  } catch (error) {
    console.error(chalk.red('✗ タスクのスキャンに失敗しました'));
    console.error(chalk.gray(`  ${error.response?.data?.error || error.message}`));
  }
}

// プロジェクト優先度を更新
async function updateProjectPriority(projectId, priority) {
  console.log(chalk.blue(`プロジェクトの優先度を更新しています: ${projectId} → ${priority}`));
  
  try {
    await axios.patch(`${DAEMON_URL}/api/projects/${projectId}/priority`, {
      priority
    });
    console.log(chalk.green('✓ 優先度を更新しました'));
  } catch (error) {
    console.error(chalk.red('✗ 優先度の更新に失敗しました'));
    console.error(chalk.gray(`  ${error.response?.data?.error || error.message}`));
  }
}

// キュー状態を表示
async function showQueueStatus() {
  try {
    const response = await axios.get(`${DAEMON_URL}/api/queue/status`);
    const status = response.data;
    
    console.log(chalk.bold('\nキューステータス:'));
    console.log(chalk.gray('─'.repeat(40)));
    console.log(chalk.gray(`  キューサイズ: ${status.queueSize}`));
    console.log(chalk.gray(`  実行中タスク: ${status.runningTasks}`));
    console.log(chalk.gray(`  プロジェクト数: ${status.projects}`));
    
    console.log(chalk.bold('\n統計:'));
    console.log(chalk.gray(`  総エンキュー数: ${status.statistics.totalEnqueued}`));
    console.log(chalk.gray(`  総処理数: ${status.statistics.totalProcessed}`));
    console.log(chalk.gray(`  総失敗数: ${status.statistics.totalFailed}`));
    
    if (Object.keys(status.tasksByProject).length > 0) {
      console.log(chalk.bold('\nプロジェクト別タスク:'));
      Object.entries(status.tasksByProject).forEach(([projectId, tasks]) => {
        console.log(chalk.gray(`  ${projectId}: 待機中 ${tasks.queued}, 処理中 ${tasks.processing}`));
      });
    }
    
    console.log(chalk.gray('\n─'.repeat(40)));
  } catch (error) {
    console.error(chalk.red('✗ キューステータスの取得に失敗しました'));
    console.error(chalk.gray(`  ${error.message}`));
  }
}

// キューをクリア
async function clearQueue() {
  console.log(chalk.yellow('⚠️  警告: この操作はすべてのキュータスクを削除します'));
  
  // 実装は省略（確認プロンプトを追加すべき）
  console.log(chalk.gray('この機能は現在実装されていません'));
}

// ワーカー一覧を表示
async function listWorkers() {
  try {
    const response = await axios.get(`${DAEMON_URL}/api/workers`);
    const workers = response.data.workers;
    
    if (workers.length === 0) {
      console.log(chalk.yellow('稼働中のワーカーがありません'));
      return;
    }
    
    console.log(chalk.bold('\nワーカー一覧:'));
    console.log(chalk.gray('─'.repeat(60)));
    
    workers.forEach(worker => {
      const uptime = Date.now() - new Date(worker.startedAt).getTime();
      const uptimeMinutes = Math.floor(uptime / 1000 / 60);
      
      console.log(chalk.blue(`\n${worker.projectId}`));
      console.log(chalk.gray(`  PID: ${worker.pid}`));
      console.log(chalk.gray(`  状態: ${worker.status}`));
      console.log(chalk.gray(`  稼働時間: ${uptimeMinutes}分`));
      console.log(chalk.gray(`  最終活動: ${new Date(worker.lastActivity).toLocaleTimeString('ja-JP')}`));
    });
    
    console.log(chalk.gray('\n─'.repeat(60)));
  } catch (error) {
    console.error(chalk.red('✗ ワーカー一覧の取得に失敗しました'));
    console.error(chalk.gray(`  ${error.message}`));
  }
}

// ワーカーを起動
async function startWorker(projectId) {
  console.log(chalk.blue(`ワーカーを起動しています: ${projectId}`));
  
  try {
    await axios.post(`${DAEMON_URL}/api/workers/start`, {
      projectId
    });
    console.log(chalk.green('✓ ワーカーを起動しました'));
  } catch (error) {
    console.error(chalk.red('✗ ワーカーの起動に失敗しました'));
    console.error(chalk.gray(`  ${error.response?.data?.error || error.message}`));
  }
}

// ワーカーを停止
async function stopWorker(projectId) {
  console.log(chalk.blue(`ワーカーを停止しています: ${projectId}`));
  
  try {
    await axios.post(`${DAEMON_URL}/api/workers/stop`, {
      projectId
    });
    console.log(chalk.green('✓ ワーカーを停止しました'));
  } catch (error) {
    console.error(chalk.red('✗ ワーカーの停止に失敗しました'));
    console.error(chalk.gray(`  ${error.response?.data?.error || error.message}`));
  }
}

// 健全性の絵文字を取得
function getHealthEmoji(health) {
  switch (health) {
    case 'excellent': return '🟢';
    case 'good': return '🔵';
    case 'fair': return '🟡';
    case 'poor': return '🔴';
    default: return '⚪';
  }
}

// コマンドを解析
program.parse(process.argv);

// コマンドが指定されていない場合はヘルプを表示
if (!process.argv.slice(2).length) {
  program.outputHelp();
}