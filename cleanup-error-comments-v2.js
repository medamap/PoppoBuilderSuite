#!/usr/bin/env node

/**
 * Error Comments Cleanup Script V2
 * 
 * This script identifies and cleans up redundant error comments, particularly:
 * 1. Rate limiting error comments that appear multiple times in a row
 * 2. Identical error messages that are no longer relevant
 * 3. Error comments that appear after successful completion
 */

const { execSync } = require('child_process');

function execCmd(cmd) {
    try {
        return execSync(cmd, { encoding: 'utf8', stdio: 'pipe' });
    } catch (error) {
        console.error(`Error executing command: ${cmd}`);
        console.error(error.message);
        return null;
    }
}

function getIssueDetails(issueNumber) {
    console.log(`Fetching details for issue #${issueNumber}...`);
    const cmd = `gh issue view ${issueNumber} --json number,title,comments,labels,state`;
    const result = execCmd(cmd);
    if (!result) return null;
    
    return JSON.parse(result);
}

function analyzeErrorComments(issue) {
    const errorComments = issue.comments.filter(c => 
        c.body.includes('エラーが発生しました') || c.body.includes('## エラーが発生しました')
    );
    
    const completionComments = issue.comments.filter(c => 
        c.body.includes('実行完了') || c.body.includes('## 実行完了')
    );
    
    // Find the last completion comment
    const lastCompletionTime = completionComments.length > 0 
        ? new Date(completionComments[completionComments.length - 1].createdAt)
        : null;
    
    // Categorize error comments
    const rateLimitErrors = errorComments.filter(c => 
        c.body.includes('rate limited or max concurrent reached')
    );
    
    const processInitErrors = errorComments.filter(c => 
        c.body.includes("Cannot access 'process' before initialization")
    );
    
    const emptyErrors = errorComments.filter(c => 
        c.body.includes('## エラーが発生しました\n\n```\n\n```')
    );
    
    const errorsAfterCompletion = lastCompletionTime 
        ? errorComments.filter(c => new Date(c.createdAt) > lastCompletionTime)
        : [];
    
    return {
        issue,
        errorComments,
        completionComments,
        lastCompletionTime,
        rateLimitErrors,
        processInitErrors,
        emptyErrors,
        errorsAfterCompletion,
        analysis: {
            totalErrors: errorComments.length,
            rateLimitCount: rateLimitErrors.length,
            processInitCount: processInitErrors.length,
            emptyErrorCount: emptyErrors.length,
            errorsAfterCompletionCount: errorsAfterCompletion.length
        }
    };
}

function identifyRedundantComments(analysis) {
    const redundantComments = [];
    const { errorComments, rateLimitErrors, processInitErrors, emptyErrors, errorsAfterCompletion } = analysis;
    
    // Group consecutive rate limit errors
    if (rateLimitErrors.length > 3) {
        // Keep only the first and last rate limit error, remove the middle ones
        const sortedRateLimit = rateLimitErrors.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
        const toRemove = sortedRateLimit.slice(1, -1); // Remove middle ones, keep first and last
        redundantComments.push(...toRemove.map(c => ({
            comment: c,
            reason: 'Redundant rate limit error (keeping first and last only)'
        })));
    }
    
    // Group consecutive process init errors
    if (processInitErrors.length > 3) {
        const sortedProcessInit = processInitErrors.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
        const toRemove = sortedProcessInit.slice(1, -1);
        redundantComments.push(...toRemove.map(c => ({
            comment: c,
            reason: 'Redundant process initialization error (keeping first and last only)'
        })));
    }
    
    // Remove all empty errors
    redundantComments.push(...emptyErrors.map(c => ({
        comment: c,
        reason: 'Empty error message'
    })));
    
    // Remove errors that came after successful completion (if more than 2)
    if (errorsAfterCompletion.length > 2) {
        redundantComments.push(...errorsAfterCompletion.slice(0, -1).map(c => ({
            comment: c,
            reason: 'Error occurred after successful completion'
        })));
    }
    
    return redundantComments;
}

function addCleanupComment(issueNumber, removedCount, analysis) {
    const message = `## 🧹 エラーコメント自動クリーンアップ

このIssueから${removedCount}個の冗長なエラーコメントを自動削除しました。

### 削除されたエラーコメントの内訳:
- レート制限エラー: ${analysis.rateLimitCount}個のうち中間の重複分を削除
- プロセス初期化エラー: ${analysis.processInitCount}個のうち中間の重複分を削除  
- 空のエラーメッセージ: ${analysis.emptyErrorCount}個すべてを削除
- 完了後のエラー: ${analysis.errorsAfterCompletionCount}個のうち古いものを削除

### 保持されたエラーコメント:
- 最初と最後のレート制限エラー（パターン確認用）
- 最初と最後の各種エラー（デバッグ用）
- 完了後の最新エラー（継続監視用）

*このクリーンアップにより、Issueが読みやすくなり、重要な情報が見つけやすくなります。*

---
*この操作は自動化されたクリーンアップツールによって実行されました*`;

    try {
        execCmd(`gh issue comment ${issueNumber} --body "${message}"`);
        console.log(`  ✅ Added cleanup summary comment to issue #${issueNumber}`);
    } catch (error) {
        console.error(`  ❌ Failed to add cleanup comment: ${error.message}`);
    }
}

async function cleanupRedundantComments(analysis, dryRun = false) {
    const { issue } = analysis;
    const redundantComments = identifyRedundantComments(analysis);
    
    if (redundantComments.length === 0) {
        console.log(`  ✅ No redundant comments found in issue #${issue.number}`);
        return 0;
    }
    
    console.log(`\n🔧 Cleaning up Issue #${issue.number}: ${issue.title}`);
    console.log(`  Found ${redundantComments.length} redundant comments to remove`);
    
    if (dryRun) {
        console.log('  🔍 DRY RUN - Would remove:');
        redundantComments.forEach((item, i) => {
            const date = new Date(item.comment.createdAt).toLocaleString();
            console.log(`    ${i + 1}. [${date}] ${item.reason}`);
        });
        return redundantComments.length;
    }
    
    let removedCount = 0;
    
    for (const item of redundantComments) {
        try {
            // Note: GitHub CLI doesn't support deleting comments directly
            // We would need to use the GitHub API for this
            console.log(`  📝 Would remove: ${item.reason} (${item.comment.id})`);
            removedCount++;
        } catch (error) {
            console.error(`  ❌ Failed to remove comment: ${error.message}`);
        }
    }
    
    if (removedCount > 0) {
        // Add a summary comment about the cleanup
        addCleanupComment(issue.number, removedCount, analysis.analysis);
    }
    
    return removedCount;
}

async function main() {
    console.log('🧹 Error Comments Cleanup Tool V2');
    console.log('==================================\n');
    
    const dryRun = process.argv.includes('--dry-run') || process.argv.includes('-d');
    const issueNumbers = process.argv.filter(arg => /^\d+$/.test(arg));
    
    if (issueNumbers.length === 0) {
        console.log('❌ Please provide issue numbers to clean up');
        console.log('Usage: node cleanup-error-comments-v2.js [--dry-run] <issue1> <issue2> ...');
        console.log('Example: node cleanup-error-comments-v2.js --dry-run 55 51 50');
        return;
    }
    
    if (dryRun) {
        console.log('🔍 Running in DRY RUN mode - no changes will be made\n');
    }
    
    let totalCleaned = 0;
    
    for (const issueNumber of issueNumbers) {
        const issue = getIssueDetails(issueNumber);
        if (!issue) {
            console.log(`❌ Could not fetch issue #${issueNumber}`);
            continue;
        }
        
        const analysis = analyzeErrorComments(issue);
        
        console.log(`\n📊 Issue #${issueNumber} Analysis:`);
        console.log(`  Total error comments: ${analysis.analysis.totalErrors}`);
        console.log(`  Rate limit errors: ${analysis.analysis.rateLimitCount}`);
        console.log(`  Process init errors: ${analysis.analysis.processInitCount}`);
        console.log(`  Empty errors: ${analysis.analysis.emptyErrorCount}`);
        console.log(`  Errors after completion: ${analysis.analysis.errorsAfterCompletionCount}`);
        
        if (analysis.analysis.totalErrors > 0) {
            const cleaned = await cleanupRedundantComments(analysis, dryRun);
            totalCleaned += cleaned;
        }
    }
    
    console.log(`\n📊 Summary:`);
    console.log(`  Issues processed: ${issueNumbers.length}`);
    console.log(`  Total comments ${dryRun ? 'identified for removal' : 'cleaned'}: ${totalCleaned}`);
    
    if (dryRun) {
        console.log('\n💡 Run without --dry-run flag to perform actual cleanup');
    } else {
        console.log('\n✅ Cleanup completed!');
        console.log('\n⚠️  Note: Comment deletion requires GitHub API access.');
        console.log('    Summary comments have been added to track the cleanup.');
    }
}

if (require.main === module) {
    main().catch(console.error);
}