/**
 * Setup Recovery Utilities
 * Handles partial setup states and allows resuming from failures
 */

const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const chalk = require('chalk');

const RECOVERY_FILE = path.join(os.homedir(), '.poppobuilder', '.setup-recovery.json');

/**
 * Save current setup progress
 */
async function saveProgress(step, data) {
  try {
    const dir = path.dirname(RECOVERY_FILE);
    await fs.mkdir(dir, { recursive: true });
    
    let recovery = {};
    try {
      const existing = await fs.readFile(RECOVERY_FILE, 'utf8');
      recovery = JSON.parse(existing);
    } catch {
      // File doesn't exist yet
    }
    
    recovery[step] = {
      data,
      timestamp: new Date().toISOString()
    };
    
    await fs.writeFile(RECOVERY_FILE, JSON.stringify(recovery, null, 2));
  } catch (error) {
    // Don't fail the setup if we can't save recovery
    console.warn(chalk.gray('警告: リカバリ情報を保存できませんでした'));
  }
}

/**
 * Load previous setup progress
 */
async function loadProgress() {
  try {
    const content = await fs.readFile(RECOVERY_FILE, 'utf8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

/**
 * Clear recovery file after successful setup
 */
async function clearRecovery() {
  try {
    await fs.unlink(RECOVERY_FILE);
  } catch {
    // Ignore if file doesn't exist
  }
}

/**
 * Check if there's a recoverable setup state
 */
async function hasRecoverableSetup() {
  try {
    await fs.access(RECOVERY_FILE);
    const recovery = await loadProgress();
    return recovery && Object.keys(recovery).length > 0;
  } catch {
    return false;
  }
}

/**
 * Get recovery summary
 */
async function getRecoverySummary() {
  const recovery = await loadProgress();
  if (!recovery) return null;
  
  const steps = Object.keys(recovery);
  const lastStep = steps[steps.length - 1];
  const lastTimestamp = recovery[lastStep]?.timestamp;
  
  return {
    completedSteps: steps,
    lastStep,
    lastTimestamp,
    data: recovery
  };
}

module.exports = {
  saveProgress,
  loadProgress,
  clearRecovery,
  hasRecoverableSetup,
  getRecoverySummary
};