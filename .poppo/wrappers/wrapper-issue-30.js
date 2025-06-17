
const { spawn } = require('child_process');
const fs = require('fs');

// タスクissue-30のラッパースクリプト
console.log('独立プロセス issue-30 開始');

const prompt = '/Volumes/PoppoSSD2T/Projects/ClaudeCodeProjects/AIBuildSystem/PoppoBuilderSuite/temp/instruction-issue-30.txt の指示に従ってください。';
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
  fs.appendFileSync('/Volumes/PoppoSSD2T/Projects/ClaudeCodeProjects/AIBuildSystem/PoppoBuilderSuite/temp/task-issue-30.output', chunk, 'utf8');
});

claude.stderr.on('data', (data) => {
  stderr += data.toString();
});

claude.on('exit', (code) => {
  console.log('Claude CLI終了 (code: ' + code + ')');
  
  // 結果ファイルに保存
  const result = {
    taskId: 'issue-30',
    exitCode: code,
    output: stdout,
    error: stderr,
    completedAt: new Date().toISOString(),
    success: code === 0
  };
  
  fs.writeFileSync('/Volumes/PoppoSSD2T/Projects/ClaudeCodeProjects/AIBuildSystem/PoppoBuilderSuite/temp/task-issue-30.result', JSON.stringify(result, null, 2), 'utf8');
  
  // クリーンアップ
  try {
    fs.unlinkSync('/Volumes/PoppoSSD2T/Projects/ClaudeCodeProjects/AIBuildSystem/PoppoBuilderSuite/temp/instruction-issue-30.txt');
    fs.unlinkSync(__filename); // このラッパースクリプト自体を削除
  } catch (e) {
    // エラーは無視
  }
  
  console.log('タスクissue-30完了');
  process.exit(code);
});

claude.on('error', (error) => {
  console.error('Claude CLI エラー:', error.message);
  
  const result = {
    taskId: 'issue-30',
    exitCode: -1,
    output: stdout,
    error: error.message,
    completedAt: new Date().toISOString(),
    success: false
  };
  
  fs.writeFileSync('/Volumes/PoppoSSD2T/Projects/ClaudeCodeProjects/AIBuildSystem/PoppoBuilderSuite/temp/task-issue-30.result', JSON.stringify(result, null, 2), 'utf8');
  process.exit(1);
});
