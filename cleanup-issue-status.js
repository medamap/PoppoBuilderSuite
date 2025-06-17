#!/usr/bin/env node

/**
 * Issue Status Cleanup Script
 * 
 * This script identifies and cleans up issues that have:
 * 1. Error comments but are marked as "completed"
 * 2. Multiple redundant error comments
 * 3. Incorrect label combinations
 * 4. Old error comments that are no longer relevant
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

function getIssues() {
    console.log('Fetching all issues...');
    const cmd = `gh issue list --limit 100 --state all --json number,title,labels,comments,state`;
    const result = execCmd(cmd);
    if (!result) return [];
    
    return JSON.parse(result);
}

function analyzeIssue(issue) {
    const errorComments = issue.comments.filter(c => 
        c.body.includes('エラーが発生しました') || c.body.includes('## エラーが発生しました')
    );
    
    const completionComments = issue.comments.filter(c => 
        c.body.includes('実行完了') || c.body.includes('## 実行完了')
    );
    
    const labelNames = issue.labels.map(l => l.name);
    
    const hasCompletedLabel = labelNames.includes('completed');
    const hasProcessingLabel = labelNames.includes('processing');
    const hasAwaitingResponseLabel = labelNames.includes('awaiting-response');
    
    // Calculate when the last completion comment was made
    const lastCompletionTime = completionComments.length > 0 
        ? new Date(completionComments[completionComments.length - 1].createdAt)
        : null;
    
    // Find error comments that came after completion
    const errorsAfterCompletion = lastCompletionTime 
        ? errorComments.filter(c => new Date(c.createdAt) > lastCompletionTime)
        : errorComments;
    
    return {
        issue,
        errorComments,
        completionComments,
        labelNames,
        hasCompletedLabel,
        hasProcessingLabel,
        hasAwaitingResponseLabel,
        lastCompletionTime,
        errorsAfterCompletion,
        needsCleanup: false,
        problems: []
    };
}

function identifyProblems(analysis) {
    const problems = [];
    
    // Problem 1: Has completion comment but still has processing label
    if (analysis.completionComments.length > 0 && analysis.hasProcessingLabel) {
        problems.push({
            type: 'incorrect_processing_label',
            description: 'Issue has completion comments but still marked as processing',
            action: 'Remove processing label'
        });
    }
    
    // Problem 2: Has completion comment and completed label but still has errors after completion
    if (analysis.hasCompletedLabel && analysis.completionComments.length > 0 && analysis.errorsAfterCompletion.length > 5) {
        problems.push({
            type: 'excessive_errors_after_completion',
            description: `Issue marked completed but has ${analysis.errorsAfterCompletion.length} error comments after completion`,
            action: 'Clean up redundant error comments'
        });
    }
    
    // Problem 3: Too many error comments (likely rate limiting spam)
    if (analysis.errorComments.length > 10) {
        const rateLimitErrors = analysis.errorComments.filter(c => 
            c.body.includes('rate limited or max concurrent reached')
        );
        if (rateLimitErrors.length > 5) {
            problems.push({
                type: 'excessive_rate_limit_errors',
                description: `Issue has ${rateLimitErrors.length} rate limit error comments`,
                action: 'Clean up redundant rate limit error comments'
            });
        }
    }
    
    // Problem 4: Has both completed and processing labels
    if (analysis.hasCompletedLabel && analysis.hasProcessingLabel) {
        problems.push({
            type: 'conflicting_labels',
            description: 'Issue has both completed and processing labels',
            action: 'Remove processing label'
        });
    }
    
    // Problem 5: Issue has successful completion but no completed label
    if (analysis.completionComments.length > 0 && !analysis.hasCompletedLabel && !analysis.hasProcessingLabel) {
        const lastCompletion = analysis.completionComments[analysis.completionComments.length - 1];
        // Check if the completion comment indicates success
        if (lastCompletion.body.includes('完了しました') || lastCompletion.body.includes('実装完了')) {
            problems.push({
                type: 'missing_completed_label',
                description: 'Issue has successful completion comment but no completed label',
                action: 'Add completed label'
            });
        }
    }
    
    return problems;
}

function cleanupIssue(analysis) {
    const { issue, problems } = analysis;
    
    console.log(`\n🔧 Cleaning up Issue #${issue.number}: ${issue.title}`);
    
    let actionsPerformed = [];
    
    for (const problem of problems) {
        console.log(`  Problem: ${problem.description}`);
        console.log(`  Action: ${problem.action}`);
        
        try {
            switch (problem.type) {
                case 'incorrect_processing_label':
                case 'conflicting_labels':
                    execCmd(`gh issue edit ${issue.number} --remove-label processing`);
                    actionsPerformed.push('Removed processing label');
                    break;
                    
                case 'missing_completed_label':
                    execCmd(`gh issue edit ${issue.number} --add-label completed`);
                    actionsPerformed.push('Added completed label');
                    break;
                    
                case 'excessive_errors_after_completion':
                case 'excessive_rate_limit_errors':
                    // For now, just log these - cleaning up comments requires more careful handling
                    console.log(`    ⚠️  Manual cleanup recommended for ${analysis.errorComments.length} error comments`);
                    actionsPerformed.push(`Identified ${analysis.errorComments.length} error comments for manual review`);
                    break;
            }
        } catch (error) {
            console.error(`    ❌ Failed to perform action: ${error.message}`);
        }
    }
    
    if (actionsPerformed.length > 0) {
        console.log(`  ✅ Actions performed:`);
        actionsPerformed.forEach(action => console.log(`    - ${action}`));
    }
}

function main() {
    console.log('🔍 Issue Status Cleanup Tool');
    console.log('=============================\n');
    
    const issues = getIssues();
    console.log(`Found ${issues.length} issues to analyze\n`);
    
    const analyses = issues.map(analyzeIssue);
    
    // Identify issues that need cleanup
    const issuesNeedingCleanup = [];
    
    for (const analysis of analyses) {
        const problems = identifyProblems(analysis);
        if (problems.length > 0) {
            analysis.problems = problems;
            analysis.needsCleanup = true;
            issuesNeedingCleanup.push(analysis);
        }
    }
    
    console.log(`📊 Analysis Summary:`);
    console.log(`  Total issues: ${issues.length}`);
    console.log(`  Issues needing cleanup: ${issuesNeedingCleanup.length}`);
    
    if (issuesNeedingCleanup.length === 0) {
        console.log('\n✅ No issues need cleanup!');
        return;
    }
    
    console.log('\n🔍 Issues needing cleanup:');
    
    for (const analysis of issuesNeedingCleanup) {
        const { issue, errorComments, completionComments, problems } = analysis;
        
        console.log(`\n📝 Issue #${issue.number}: ${issue.title}`);
        console.log(`   State: ${issue.state}`);
        console.log(`   Labels: ${analysis.labelNames.join(', ')}`);
        console.log(`   Error comments: ${errorComments.length}`);
        console.log(`   Completion comments: ${completionComments.length}`);
        console.log(`   Problems identified: ${problems.length}`);
        
        problems.forEach((problem, i) => {
            console.log(`     ${i + 1}. ${problem.description}`);
        });
    }
    
    // Check if auto-cleanup flag is provided
    const autoCleanup = process.argv.includes('--auto') || process.argv.includes('-y');
    
    if (autoCleanup) {
        console.log('\n🚀 Starting automatic cleanup...');
        
        for (const analysis of issuesNeedingCleanup) {
            cleanupIssue(analysis);
        }
        
        console.log('\n✅ Cleanup completed!');
    } else {
        // Ask for confirmation before proceeding
        console.log('\n🤔 Proceed with cleanup? (y/N)');
        console.log('   Use --auto or -y flag to run automatically');
        const readline = require('readline');
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });
        
        rl.question('> ', (answer) => {
            if (answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes') {
                console.log('\n🚀 Starting cleanup...');
                
                for (const analysis of issuesNeedingCleanup) {
                    cleanupIssue(analysis);
                }
                
                console.log('\n✅ Cleanup completed!');
            } else {
                console.log('\n❌ Cleanup cancelled.');
            }
            
            rl.close();
        });
    }
}

if (require.main === module) {
    main();
}