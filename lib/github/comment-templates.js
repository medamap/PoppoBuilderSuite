/**
 * GitHub Comment Templates
 * Internationalized templates for GitHub comments
 */

const { t } = require('../i18n');
const languageDetector = require('../utils/language-detector');
const errorFormatter = require('../errors/error-formatter');
const errorCatalog = require('../errors/error-catalog');

class CommentTemplates {
  constructor() {
    this.defaultLocale = 'en';
    // Ensure error catalog is loaded
    errorCatalog.load(['en', 'ja']).catch(console.error);
  }

  /**
   * Get appropriate locale for issue/PR
   * @param {Object} issue - GitHub issue/PR object
   * @returns {string} Locale code
   */
  getLocale(issue) {
    if (!issue) return this.defaultLocale;

    const detected = languageDetector.detect({
      title: issue.title,
      body: issue.body,
      labels: issue.labels,
      user: issue.user,
      repository: issue.repository
    });

    return detected || this.defaultLocale;
  }

  /**
   * Task processing started
   */
  taskStarted(issue, taskInfo = {}) {
    const locale = this.getLocale(issue);
    const { taskId, estimatedTime } = taskInfo;

    return t('github:comments.taskStarted', {
      lng: locale,
      issueNumber: issue.number,
      taskId,
      estimatedTime: estimatedTime || t('github:comments.unknown', { lng: locale })
    });
  }

  /**
   * Task completed successfully
   */
  taskCompleted(issue, result = {}) {
    const locale = this.getLocale(issue);
    const {
      taskId,
      duration,
      filesChanged = [],
      testsRun = 0,
      testsPassed = 0,
      summary = ''
    } = result;

    let template = t('github:comments.taskCompleted.header', { lng: locale, taskId });

    // Add execution details
    template += '\n\n' + t('github:comments.taskCompleted.details', { lng: locale });
    template += '\n' + t('github:comments.taskCompleted.duration', { lng: locale, duration });
    
    if (filesChanged.length > 0) {
      template += '\n' + t('github:comments.taskCompleted.filesChanged', { 
        lng: locale, 
        count: filesChanged.length 
      });
      
      // List changed files
      template += '\n```\n';
      filesChanged.forEach(file => {
        template += `${file.status}: ${file.path}\n`;
      });
      template += '```\n';
    }

    if (testsRun > 0) {
      template += '\n' + t('github:comments.taskCompleted.tests', {
        lng: locale,
        run: testsRun,
        passed: testsPassed,
        failed: testsRun - testsPassed
      });
    }

    if (summary) {
      template += '\n\n' + t('github:comments.taskCompleted.summary', { lng: locale });
      template += '\n' + summary;
    }

    template += '\n\n---\n';
    template += t('github:comments.footer', { lng: locale });

    return template;
  }

  /**
   * Task failed
   */
  taskFailed(issue, error = {}) {
    const locale = this.getLocale(issue);
    const { taskId, errorCode, errorMessage, duration } = error;

    let template = t('github:comments.taskFailed.header', { lng: locale, taskId });

    if (errorCode) {
      // Use error formatter for structured errors
      template += '\n\n' + errorFormatter.formatForGitHub(errorCode, { locale, includeDetails: true });
    } else if (errorMessage) {
      // Fallback for non-coded errors
      template += '\n\n' + t('github:comments.taskFailed.error', { 
        lng: locale, 
        error: errorMessage 
      });
    }

    if (duration) {
      template += '\n\n' + t('github:comments.taskFailed.duration', { lng: locale, duration });
    }

    template += '\n\n' + t('github:comments.taskFailed.instruction', { lng: locale });
    template += '\n\n---\n';
    template += t('github:comments.footer', { lng: locale });

    return template;
  }

  /**
   * Progress update
   */
  progressUpdate(issue, progress = {}) {
    const locale = this.getLocale(issue);
    const { taskId, percent, currentStep, totalSteps, message } = progress;

    let template = t('github:comments.progress.header', { 
      lng: locale, 
      taskId,
      percent: percent || 0
    });

    if (currentStep && totalSteps) {
      template += '\n' + t('github:comments.progress.steps', {
        lng: locale,
        current: currentStep,
        total: totalSteps
      });
    }

    if (message) {
      template += '\n\n' + t('github:comments.progress.currentAction', { lng: locale });
      template += ' ' + message;
    }

    return template;
  }

  /**
   * Code review comment
   */
  codeReview(pr, review = {}) {
    const locale = this.getLocale(pr);
    const {
      approved = false,
      suggestions = [],
      issues = [],
      compliments = []
    } = review;

    let template = approved
      ? t('github:comments.review.approved', { lng: locale })
      : t('github:comments.review.changesRequested', { lng: locale });

    if (compliments.length > 0) {
      template += '\n\n' + t('github:comments.review.compliments', { lng: locale });
      compliments.forEach(item => {
        template += `\n- ✅ ${item}`;
      });
    }

    if (issues.length > 0) {
      template += '\n\n' + t('github:comments.review.issues', { lng: locale });
      issues.forEach((issue, index) => {
        template += `\n${index + 1}. ❗ ${issue.message}`;
        if (issue.file && issue.line) {
          template += ` (${issue.file}:${issue.line})`;
        }
      });
    }

    if (suggestions.length > 0) {
      template += '\n\n' + t('github:comments.review.suggestions', { lng: locale });
      suggestions.forEach((suggestion, index) => {
        template += `\n${index + 1}. 💡 ${suggestion}`;
      });
    }

    template += '\n\n---\n';
    template += t('github:comments.footer', { lng: locale });

    return template;
  }

  /**
   * Welcome message for new contributors
   */
  welcomeContributor(issue, isFirstTime = true) {
    const locale = this.getLocale(issue);
    
    if (isFirstTime) {
      return t('github:comments.welcome.firstTime', {
        lng: locale,
        user: issue.user.login
      });
    } else {
      return t('github:comments.welcome.returning', {
        lng: locale,
        user: issue.user.login
      });
    }
  }

  /**
   * Help/usage information
   */
  help(issue) {
    const locale = this.getLocale(issue);
    
    return t('github:comments.help.header', { lng: locale }) + '\n\n' +
           t('github:comments.help.commands', { lng: locale }) + '\n\n' +
           t('github:comments.help.documentation', { lng: locale });
  }

  /**
   * Validation error
   */
  validationError(issue, errors = []) {
    const locale = this.getLocale(issue);
    
    let template = t('github:comments.validation.header', { lng: locale });

    if (errors.length > 0) {
      template += '\n\n' + t('github:comments.validation.errors', { lng: locale });
      errors.forEach(error => {
        template += `\n- ❌ ${error}`;
      });
    }

    template += '\n\n' + t('github:comments.validation.instruction', { lng: locale });

    return template;
  }

  /**
   * Processing skipped
   */
  skipped(issue, reason) {
    const locale = this.getLocale(issue);
    
    return t('github:comments.skipped', {
      lng: locale,
      reason: reason || t('github:comments.skipped.unknown', { lng: locale })
    });
  }

  /**
   * Rate limit warning
   */
  rateLimitWarning(issue, rateLimitInfo = {}) {
    const locale = this.getLocale(issue);
    const { remaining, limit, reset } = rateLimitInfo;

    return t('github:comments.rateLimit', {
      lng: locale,
      remaining,
      limit,
      reset: new Date(reset * 1000).toLocaleString(locale)
    });
  }

  /**
   * Create a custom comment with template
   */
  custom(issue, templateKey, data = {}) {
    const locale = this.getLocale(issue);
    
    return t(`github:comments.${templateKey}`, {
      lng: locale,
      ...data
    });
  }
}

// Export singleton instance
module.exports = new CommentTemplates();