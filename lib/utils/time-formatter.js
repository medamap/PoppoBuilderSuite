/**
 * Time Formatting Utilities
 * Provides consistent time formatting across the application
 */

const { t } = require('../i18n');
const { I18N_KEYS } = require('../constants/status-constants');

class TimeFormatter {
  /**
   * Format duration in human-readable format
   * @param {number} ms - Duration in milliseconds
   * @returns {string} Formatted duration
   */
  static formatDuration(ms) {
    if (!ms || ms < 0) return 'Unknown';
    
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) {
      return `${days}d ${hours % 24}h`;
    } else if (hours > 0) {
      return `${hours}h ${minutes % 60}m`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    } else {
      return `${seconds}s`;
    }
  }

  /**
   * Format relative time (e.g., "5 minutes ago")
   * @param {string|Date} dateStr - Date string or Date object
   * @returns {string} Formatted relative time
   */
  static formatRelativeTime(dateStr) {
    if (!dateStr) return '-';
    
    try {
      const date = dateStr instanceof Date ? dateStr : new Date(dateStr);
      if (isNaN(date.getTime())) return '-';
      
      const now = new Date();
      const diffMs = now - date;
      
      if (diffMs < 0) return t(I18N_KEYS.TIME.justNow) || 'Just now';
      
      const minutes = Math.floor(diffMs / 60000);
      const hours = Math.floor(minutes / 60);
      const days = Math.floor(hours / 24);

      if (days > 0) {
        const timeStr = t(I18N_KEYS.TIME.days, { count: days }) || `${days}d`;
        return t(I18N_KEYS.TIME.ago, { time: timeStr }) || `${timeStr} ago`;
      } else if (hours > 0) {
        const timeStr = t(I18N_KEYS.TIME.hours, { count: hours }) || `${hours}h`;
        return t(I18N_KEYS.TIME.ago, { time: timeStr }) || `${timeStr} ago`;
      } else if (minutes > 0) {
        const timeStr = t(I18N_KEYS.TIME.minutes, { count: minutes }) || `${minutes}m`;
        return t(I18N_KEYS.TIME.ago, { time: timeStr }) || `${timeStr} ago`;
      } else {
        return t(I18N_KEYS.TIME.justNow) || 'Just now';
      }
    } catch (error) {
      return '-';
    }
  }

  /**
   * Format ISO date string to locale string
   * @param {string|Date} dateStr - Date string or Date object
   * @param {string} locale - Locale string (optional)
   * @returns {string} Formatted date
   */
  static formatDate(dateStr, locale) {
    if (!dateStr) return '-';
    
    try {
      const date = dateStr instanceof Date ? dateStr : new Date(dateStr);
      if (isNaN(date.getTime())) return '-';
      
      return date.toLocaleString(locale);
    } catch (error) {
      return '-';
    }
  }

  /**
   * Calculate uptime from start time
   * @param {string|Date} startTime - Start time
   * @returns {number} Uptime in milliseconds
   */
  static calculateUptime(startTime) {
    if (!startTime) return 0;
    
    try {
      const start = startTime instanceof Date ? startTime : new Date(startTime);
      if (isNaN(start.getTime())) return 0;
      
      return Math.max(0, Date.now() - start.getTime());
    } catch (error) {
      return 0;
    }
  }
}

module.exports = TimeFormatter;