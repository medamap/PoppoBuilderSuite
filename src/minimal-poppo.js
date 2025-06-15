#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const GitHubClient = require('./github-client');
const ProcessManager = require('./process-manager');
const RateLimiter = require('./rate-limiter');

// 設定読み込み
const config = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../config/config.json'), 'utf-8')
);

// インスタンス作成
const github = new GitHubClient(config.github);
const rateLimiter = new RateLimiter();
const processManager = new ProcessManager(config.claude, rateLimiter);

// 処理済みIssueを記録（メモリ内）
const processedIssues = new Set();

/**
 * Issueが処理対象かチェック
 */
function shouldProcessIssue(issue) {
  // すでに処理済み
  if (processedIssues.has(issue.number)) {
    return false;
  }

  // 作者のIssueかチェック
  if (issue.author.login !== config.github.owner) {
    return false;
  }

  // ラベルチェック
  const labels = issue.labels.map(l => l.name);
  
  // task:miscラベルが必要
  if (!labels.includes('task:misc')) {
    return false;
  }

  // completed or processingラベルがあればスキップ
  if (labels.includes('completed') || labels.includes('processing')) {
    return false;
  }

  return true;
}

/**
 * Issueを処理
 */
async function processIssue(issue) {
  const issueNumber = issue.number;
  console.log(`\nIssue #${issueNumber} の処理開始: ${issue.title}`);

  try {
    // processingラベルを追加
    await github.addLabels(issueNumber, ['processing']);

    // Claude用の指示を作成
    const instruction = {
      task: 'execute',
      issue: {
        number: issueNumber,
        title: issue.title,
        body: issue.body
      },
      context: {
        repository: `${config.github.owner}/${config.github.repo}`,
        workingDirectory: process.cwd(),
        defaultBranch: 'work/poppo-builder',
        systemPrompt: `
重要: あなたは PoppoBuilder の自動実行エージェントです。
以下のルールに従ってください：

1. デフォルトの作業ブランチは 'work/poppo-builder' です
2. 作業開始時は必ず:
   - git fetch origin
   - git checkout -B work/poppo-builder origin/develop
   - git pull origin work/poppo-builder || true
3. "developにマージ" や "mainにマージ" と言われたら、
   デフォルトで work/poppo-builder からのマージとして扱う
4. 明示的に別ブランチが指定された場合のみ、そのブランチを使用

現在のタスク: Issue #${issueNumber}
`
      }
    };

    // Claudeで実行
    const result = await processManager.execute(`issue-${issueNumber}`, instruction);

    // 結果をコメント
    const comment = `## 実行完了\n\n${result.output}`;
    await github.addComment(issueNumber, comment);

    // completedラベルを追加、processingを削除
    await github.removeLabels(issueNumber, ['processing']);
    await github.addLabels(issueNumber, ['completed']);

    // 処理済みとして記録
    processedIssues.add(issueNumber);
    
    console.log(`Issue #${issueNumber} の処理完了`);

  } catch (error) {
    console.error(`Issue #${issueNumber} の処理エラー:`, error.message);
    
    // エラーをコメント
    const errorComment = `## エラーが発生しました\n\n\`\`\`\n${error.message}\n\`\`\``;
    await github.addComment(issueNumber, errorComment);
    
    // processingラベルを削除
    await github.removeLabels(issueNumber, ['processing']);
  }
}

/**
 * メインループ
 */
async function mainLoop() {
  console.log('PoppoBuilder 最小限実装 起動');
  console.log(`設定: ${JSON.stringify(config, null, 2)}\n`);

  while (true) {
    try {
      // レート制限チェック
      if (rateLimiter.isRateLimited()) {
        const remaining = Math.ceil(rateLimiter.getRemainingTime() / 1000);
        console.log(`レート制限中... 残り${remaining}秒`);
        await rateLimiter.waitForReset();
        continue;
      }

      // Issue取得
      console.log('Issueをチェック中...');
      const issues = await github.listIssues({ state: 'open' });
      
      // 処理対象のIssueを抽出
      const targetIssues = issues.filter(shouldProcessIssue);
      
      if (targetIssues.length === 0) {
        console.log('処理対象のIssueはありません');
      } else {
        console.log(`${targetIssues.length}件のIssueが見つかりました`);
        
        // 古い順に処理
        targetIssues.sort((a, b) => 
          new Date(a.createdAt) - new Date(b.createdAt)
        );

        // 実行可能な分だけ処理
        for (const issue of targetIssues) {
          if (processManager.canExecute()) {
            processIssue(issue); // awaitしない（並行実行）
          } else {
            console.log('最大同時実行数に達しています');
            break;
          }
        }
      }

    } catch (error) {
      console.error('メインループエラー:', error.message);
    }

    // ポーリング間隔待機
    console.log(`\n${config.polling.interval / 1000}秒後に再チェック...`);
    await new Promise(resolve => setTimeout(resolve, config.polling.interval));
  }
}

// プロセス終了時のクリーンアップ
process.on('SIGINT', () => {
  console.log('\n\n終了します...');
  processManager.killAll();
  process.exit(0);
});

// 開始
mainLoop().catch(console.error);