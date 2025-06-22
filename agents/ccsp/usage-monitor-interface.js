/**
 * Usage Monitor Interface
 * 
 * Abstract interface for different LLM usage monitoring implementations
 */

class UsageMonitorInterface {
  /**
   * Get current usage status
   * @returns {Promise<Object>} Usage status object
   */
  async getCurrentUsage() {
    throw new Error('getCurrentUsage() must be implemented');
  }

  /**
   * Check if can continue processing
   * @param {string} priority - Task priority (critical, high, normal, low)
   * @returns {Promise<Object>} { canContinue: boolean, reason?: string }
   */
  async canContinue(priority = 'normal') {
    throw new Error('canContinue() must be implemented');
  }

  /**
   * Get recommendations based on current usage
   * @returns {Promise<Array>} Array of recommendations
   */
  async getRecommendations() {
    throw new Error('getRecommendations() must be implemented');
  }

  /**
   * Get plan-specific information
   * @returns {Object} Plan information
   */
  getPlanInfo() {
    throw new Error('getPlanInfo() must be implemented');
  }
}

module.exports = UsageMonitorInterface;