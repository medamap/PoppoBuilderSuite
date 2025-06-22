/**
 * Interactive Prompts with i18n support
 * Provides internationalized prompts for CLI interactions
 */

const readline = require('readline');
const chalk = require('chalk');
const { t } = require('../i18n');

class InteractivePrompts {
  constructor() {
    this.rl = null;
  }

  /**
   * Create readline interface
   * @private
   */
  createInterface() {
    if (!this.rl) {
      this.rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
      });
    }
    return this.rl;
  }

  /**
   * Close readline interface
   */
  close() {
    if (this.rl) {
      this.rl.close();
      this.rl = null;
    }
  }

  /**
   * Ask a question with i18n support
   * @param {string} questionKey - i18n key for the question
   * @param {Object} options - Options
   * @returns {Promise<string>} User's answer
   */
  async ask(questionKey, options = {}) {
    const rl = this.createInterface();
    const questionText = t(questionKey, options.context || {});
    
    // Add default value display if provided
    let prompt = questionText;
    if (options.default !== undefined) {
      const defaultText = t('prompts:defaultValue', { value: options.default });
      prompt = `${questionText} ${chalk.gray(defaultText)}: `;
    } else {
      prompt = `${questionText}: `;
    }

    return new Promise((resolve) => {
      rl.question(prompt, (answer) => {
        resolve(answer.trim() || options.default || '');
      });
    });
  }

  /**
   * Ask a yes/no question
   * @param {string} questionKey - i18n key for the question
   * @param {Object} options - Options including default (true/false)
   * @returns {Promise<boolean>} User's answer as boolean
   */
  async confirm(questionKey, options = {}) {
    const defaultValue = options.default !== undefined ? options.default : null;
    const yesNo = defaultValue === true ? 'Y/n' : defaultValue === false ? 'y/N' : 'y/n';
    
    const answer = await this.ask(questionKey, {
      ...options,
      context: {
        ...options.context,
        yesNo: t(`prompts:yesNo.${yesNo}`)
      }
    });

    const lowerAnswer = answer.toLowerCase();
    
    // Handle default values
    if (!lowerAnswer && defaultValue !== null) {
      return defaultValue;
    }

    // Check localized yes/no responses
    const yesResponses = t('prompts:yesResponses', { returnObjects: true }) || ['y', 'yes'];
    const noResponses = t('prompts:noResponses', { returnObjects: true }) || ['n', 'no'];

    if (Array.isArray(yesResponses) && yesResponses.some(r => lowerAnswer === r.toLowerCase())) {
      return true;
    }
    if (Array.isArray(noResponses) && noResponses.some(r => lowerAnswer === r.toLowerCase())) {
      return false;
    }

    // Default to English y/n
    return lowerAnswer === 'y' || lowerAnswer === 'yes';
  }

  /**
   * Ask for a selection from a list
   * @param {string} questionKey - i18n key for the question
   * @param {Array} choices - Array of choices
   * @param {Object} options - Options
   * @returns {Promise<*>} Selected choice
   */
  async select(questionKey, choices, options = {}) {
    const rl = this.createInterface();
    
    console.log(t(questionKey, options.context || {}));
    console.log();

    // Display choices
    choices.forEach((choice, index) => {
      const displayText = choice.nameKey ? t(choice.nameKey) : choice.name || choice;
      const description = choice.descriptionKey ? chalk.gray(t(choice.descriptionKey)) : 
                         choice.description ? chalk.gray(choice.description) : '';
      console.log(`  ${chalk.cyan(index + 1)}) ${displayText} ${description}`);
    });

    const defaultIndex = options.default !== undefined ? 
      choices.findIndex(c => (c.value || c) === options.default) + 1 : null;

    const prompt = defaultIndex ? 
      t('prompts:selectWithDefault', { default: defaultIndex }) :
      t('prompts:select');

    const answer = await this.ask('prompts:selectPrompt', { 
      default: defaultIndex ? defaultIndex.toString() : undefined 
    });

    const selection = parseInt(answer) || defaultIndex || 1;
    
    if (selection < 1 || selection > choices.length) {
      console.log(chalk.red(t('prompts:invalidSelection')));
      return this.select(questionKey, choices, options);
    }

    const selected = choices[selection - 1];
    return selected.value !== undefined ? selected.value : selected;
  }

  /**
   * Ask for password/secret input
   * @param {string} questionKey - i18n key for the question
   * @param {Object} options - Options
   * @returns {Promise<string>} User's answer (masked)
   */
  async password(questionKey, options = {}) {
    const rl = this.createInterface();
    const questionText = t(questionKey, options.context || {});
    const prompt = `${questionText}: `;

    // Backup the original write function
    const originalWrite = process.stdout.write;
    let input = '';

    return new Promise((resolve) => {
      // Override stdout.write to mask password
      process.stdout.write = function(string, encoding, callback) {
        if (string === '\r' || string === '\n' || string === '\r\n') {
          originalWrite.apply(process.stdout, arguments);
        } else {
          originalWrite.call(process.stdout, '*', encoding, callback);
        }
      };

      rl.question(prompt, (answer) => {
        // Restore original write function
        process.stdout.write = originalWrite;
        console.log(); // New line after password
        resolve(answer);
      });

      // Handle input manually for masking
      rl._writeToOutput = function(stringToWrite) {
        if (stringToWrite.includes(prompt)) {
          originalWrite.call(process.stdout, stringToWrite);
        } else {
          const char = stringToWrite.slice(-1);
          if (char === '\r' || char === '\n') {
            originalWrite.call(process.stdout, '\n');
          } else if (char === '\b' || char === '\x7f') {
            if (input.length > 0) {
              input = input.slice(0, -1);
              originalWrite.call(process.stdout, '\b \b');
            }
          } else {
            input += char;
            originalWrite.call(process.stdout, '*');
          }
        }
      };
    });
  }

  /**
   * Display a spinner with message
   * @param {string} messageKey - i18n key for the message
   * @param {Object} context - Context for translation
   * @returns {Object} Spinner control object
   */
  spinner(messageKey, context = {}) {
    const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
    let index = 0;
    let interval;

    const start = () => {
      process.stdout.write('\x1B[?25l'); // Hide cursor
      interval = setInterval(() => {
        const message = t(messageKey, context);
        process.stdout.write(`\r${chalk.cyan(frames[index])} ${message}`);
        index = (index + 1) % frames.length;
      }, 80);
    };

    const stop = (finalMessageKey, finalContext = {}) => {
      clearInterval(interval);
      process.stdout.write('\x1B[?25h'); // Show cursor
      if (finalMessageKey) {
        const finalMessage = t(finalMessageKey, finalContext);
        process.stdout.write(`\r${chalk.green('✓')} ${finalMessage}\n`);
      } else {
        process.stdout.write('\r\x1B[K'); // Clear line
      }
    };

    start();
    return { stop };
  }

  /**
   * Display progress bar
   * @param {string} labelKey - i18n key for the label
   * @param {number} total - Total steps
   * @param {Object} context - Context for translation
   * @returns {Object} Progress bar control object
   */
  progressBar(labelKey, total, context = {}) {
    let current = 0;
    const barLength = 30;

    const update = (value, additionalContext = {}) => {
      current = Math.min(value, total);
      const percentage = Math.floor((current / total) * 100);
      const filled = Math.floor((current / total) * barLength);
      const empty = barLength - filled;
      
      const bar = chalk.green('█'.repeat(filled)) + chalk.gray('░'.repeat(empty));
      const label = t(labelKey, { ...context, ...additionalContext, current, total, percentage });
      
      process.stdout.write(`\r${label} ${bar} ${percentage}%`);
      
      if (current === total) {
        console.log(); // New line when complete
      }
    };

    const increment = (additionalContext = {}) => {
      update(current + 1, additionalContext);
    };

    return { update, increment };
  }
}

// Export singleton instance
module.exports = new InteractivePrompts();