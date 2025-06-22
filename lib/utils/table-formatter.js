/**
 * Table Formatter with i18n support
 * Provides internationalized table display functionality
 */

const chalk = require('chalk');
const { t } = require('../i18n');

class TableFormatter {
  constructor(options = {}) {
    this.maxColumnWidth = options.maxColumnWidth || 50;
    this.defaultAlignment = options.defaultAlignment || 'left';
    this.colorEnabled = options.color !== false;
    this.borderStyle = options.borderStyle || 'single';
    this.compact = options.compact || false;
  }

  /**
   * Format data as a table
   * @param {Array} data - Array of objects to display
   * @param {Object} options - Table options
   * @returns {string} Formatted table
   */
  formatTable(data, options = {}) {
    if (!data || data.length === 0) {
      return t('table:noData');
    }

    const columns = this.prepareColumns(data, options);
    const rows = this.prepareRows(data, columns, options);
    const widths = this.calculateWidths(columns, rows, options);

    const lines = [];

    // Add title if provided
    if (options.title) {
      lines.push(this.colorize(options.title, 'title'));
      if (!this.compact) lines.push('');
    }

    // Add header
    if (!options.noHeader) {
      lines.push(this.formatHeader(columns, widths));
      lines.push(this.formatSeparator(widths));
    }

    // Add rows
    rows.forEach((row, index) => {
      lines.push(this.formatRow(row, widths, columns));
      
      // Add separator after specific rows if requested
      if (options.separatorAfter && options.separatorAfter.includes(index)) {
        lines.push(this.formatSeparator(widths));
      }
    });

    // Add footer
    if (options.footer) {
      lines.push(this.formatSeparator(widths));
      lines.push(this.formatFooter(options.footer, widths));
    }

    // Add summary
    if (options.summary) {
      if (!this.compact) lines.push('');
      lines.push(this.formatSummary(data, options));
    }

    return lines.join('\n');
  }

  /**
   * Prepare column definitions
   * @private
   */
  prepareColumns(data, options) {
    let columns;

    if (options.columns) {
      // Use provided column definitions
      columns = options.columns;
    } else {
      // Auto-detect columns from data
      const keys = new Set();
      data.forEach(item => {
        Object.keys(item).forEach(key => keys.add(key));
      });

      columns = Array.from(keys).map(key => ({
        key,
        label: this.translateColumnLabel(key),
        align: this.detectAlignment(data, key)
      }));
    }

    // Apply i18n to column labels
    return columns.map(col => ({
      ...col,
      label: col.labelKey ? t(col.labelKey) : col.label || this.translateColumnLabel(col.key)
    }));
  }

  /**
   * Translate column label
   * @private
   */
  translateColumnLabel(key) {
    // Try specific table column translation
    const tableKey = `table:columns.${key}`;
    if (this.hasTranslation(tableKey)) {
      return t(tableKey);
    }

    // Try generic field translation
    const fieldKey = `fields:${key}`;
    if (this.hasTranslation(fieldKey)) {
      return t(fieldKey);
    }

    // Fallback to humanized key
    return this.humanize(key);
  }

  /**
   * Check if translation exists
   * @private
   */
  hasTranslation(key) {
    try {
      const translation = t(key);
      return translation !== key;
    } catch {
      return false;
    }
  }

  /**
   * Humanize a key (camelCase/snake_case to Title Case)
   * @private
   */
  humanize(str) {
    return str
      .replace(/([A-Z])/g, ' $1')
      .replace(/_/g, ' ')
      .replace(/^./, s => s.toUpperCase())
      .trim();
  }

  /**
   * Prepare row data
   * @private
   */
  prepareRows(data, columns, options) {
    return data.map(item => {
      const row = {};
      columns.forEach(col => {
        let value = this.getValue(item, col.key);

        // Apply formatter if provided
        if (col.formatter) {
          value = col.formatter(value, item);
        } else if (options.formatters && options.formatters[col.key]) {
          value = options.formatters[col.key](value, item);
        } else {
          value = this.defaultFormatter(value, col);
        }

        row[col.key] = value;
      });
      return row;
    });
  }

  /**
   * Get value from object (supports nested keys)
   * @private
   */
  getValue(obj, key) {
    const keys = key.split('.');
    let value = obj;
    
    for (const k of keys) {
      value = value?.[k];
      if (value === undefined) break;
    }
    
    return value;
  }

  /**
   * Default value formatter
   * @private
   */
  defaultFormatter(value, column) {
    if (value === null || value === undefined) {
      return '-';
    }

    if (typeof value === 'boolean') {
      return value ? t('common:yes') : t('common:no');
    }

    if (value instanceof Date) {
      return value.toLocaleString();
    }

    if (typeof value === 'number') {
      if (column.type === 'percentage') {
        return `${value}%`;
      }
      if (column.type === 'currency') {
        return this.formatCurrency(value, column.currency);
      }
      if (Number.isInteger(value)) {
        return value.toLocaleString();
      }
      return value.toFixed(2);
    }

    if (Array.isArray(value)) {
      return value.join(', ');
    }

    if (typeof value === 'object') {
      return JSON.stringify(value);
    }

    return String(value);
  }

  /**
   * Format currency value
   * @private
   */
  formatCurrency(value, currency = 'USD') {
    try {
      return new Intl.NumberFormat(undefined, {
        style: 'currency',
        currency
      }).format(value);
    } catch {
      return `${currency} ${value.toFixed(2)}`;
    }
  }

  /**
   * Detect column alignment
   * @private
   */
  detectAlignment(data, key) {
    const sample = data.slice(0, 10);
    const values = sample.map(item => this.getValue(item, key)).filter(v => v != null);
    
    if (values.every(v => typeof v === 'number')) {
      return 'right';
    }
    
    if (values.every(v => typeof v === 'boolean')) {
      return 'center';
    }
    
    return 'left';
  }

  /**
   * Calculate column widths
   * @private
   */
  calculateWidths(columns, rows, options) {
    const widths = {};

    columns.forEach(col => {
      // Start with header width
      let maxWidth = col.label.length;

      // Check all row values
      rows.forEach(row => {
        const value = String(row[col.key] || '');
        maxWidth = Math.max(maxWidth, value.length);
      });

      // Apply min/max constraints
      if (col.minWidth) {
        maxWidth = Math.max(maxWidth, col.minWidth);
      }
      if (col.maxWidth) {
        maxWidth = Math.min(maxWidth, col.maxWidth);
      } else {
        maxWidth = Math.min(maxWidth, this.maxColumnWidth);
      }

      widths[col.key] = maxWidth;
    });

    return widths;
  }

  /**
   * Format table header
   * @private
   */
  formatHeader(columns, widths) {
    const cells = columns.map(col => {
      const width = widths[col.key];
      const label = this.truncate(col.label, width);
      return this.pad(label, width, col.align || this.defaultAlignment);
    });

    return this.colorize(cells.join(' │ '), 'header');
  }

  /**
   * Format separator line
   * @private
   */
  formatSeparator(widths) {
    const parts = Object.values(widths).map(width => '─'.repeat(width));
    
    switch (this.borderStyle) {
      case 'double':
        return parts.join('═╪═');
      case 'thick':
        return parts.join('━┿━');
      default:
        return parts.join('─┼─');
    }
  }

  /**
   * Format data row
   * @private
   */
  formatRow(row, widths, columns) {
    const cells = columns.map(col => {
      const width = widths[col.key];
      const value = String(row[col.key] || '');
      const truncated = this.truncate(value, width);
      return this.pad(truncated, width, col.align || this.defaultAlignment);
    });

    return cells.join(' │ ');
  }

  /**
   * Format footer
   * @private
   */
  formatFooter(footer, widths) {
    const totalWidth = Object.values(widths).reduce((sum, w) => sum + w, 0) + 
                      (Object.keys(widths).length - 1) * 3; // separators
    
    if (typeof footer === 'string') {
      return this.pad(footer, totalWidth, 'center');
    }

    // Footer with calculations
    return this.colorize(footer, 'footer');
  }

  /**
   * Format summary
   * @private
   */
  formatSummary(data, options) {
    const lines = [];
    
    lines.push(this.colorize('─'.repeat(60), 'separator'));
    
    if (options.summary === true) {
      // Auto-generate summary
      lines.push(t('table:summary.total', { count: data.length }));
    } else if (typeof options.summary === 'function') {
      // Custom summary function
      lines.push(options.summary(data));
    } else {
      // Pre-defined summary
      lines.push(options.summary);
    }

    return lines.join('\n');
  }

  /**
   * Truncate text to fit width
   * @private
   */
  truncate(text, width) {
    if (text.length <= width) {
      return text;
    }
    return text.substring(0, width - 3) + '...';
  }

  /**
   * Pad text to width with alignment
   * @private
   */
  pad(text, width, align) {
    const padding = width - text.length;
    
    if (padding <= 0) {
      return text;
    }

    switch (align) {
      case 'right':
        return ' '.repeat(padding) + text;
      case 'center':
        const left = Math.floor(padding / 2);
        const right = padding - left;
        return ' '.repeat(left) + text + ' '.repeat(right);
      default:
        return text + ' '.repeat(padding);
    }
  }

  /**
   * Apply color to text
   * @private
   */
  colorize(text, type) {
    if (!this.colorEnabled) {
      return text;
    }

    switch (type) {
      case 'header':
        return chalk.bold(text);
      case 'title':
        return chalk.bold.blue(text);
      case 'footer':
        return chalk.gray(text);
      case 'separator':
        return chalk.gray(text);
      case 'error':
        return chalk.red(text);
      case 'success':
        return chalk.green(text);
      case 'warning':
        return chalk.yellow(text);
      default:
        return text;
    }
  }

  /**
   * Create a simple list display
   */
  formatList(items, options = {}) {
    if (!items || items.length === 0) {
      return t('table:noData');
    }

    const lines = [];

    if (options.title) {
      lines.push(this.colorize(options.title, 'title'));
      if (!this.compact) lines.push('');
    }

    items.forEach((item, index) => {
      const prefix = options.numbered ? `${index + 1}. ` : '• ';
      const formatted = options.formatter ? options.formatter(item) : String(item);
      lines.push(prefix + formatted);
    });

    return lines.join('\n');
  }

  /**
   * Create a key-value display
   */
  formatKeyValue(data, options = {}) {
    const lines = [];

    if (options.title) {
      lines.push(this.colorize(options.title, 'title'));
      if (!this.compact) lines.push('');
    }

    const keys = Object.keys(data);
    const maxKeyLength = Math.max(...keys.map(k => this.translateColumnLabel(k).length));

    keys.forEach(key => {
      const label = this.translateColumnLabel(key);
      const value = this.defaultFormatter(data[key], { key });
      const paddedLabel = label.padEnd(maxKeyLength);
      lines.push(`${paddedLabel} : ${value}`);
    });

    return lines.join('\n');
  }
}

// Export singleton instance with default options
module.exports = new TableFormatter();

// Also export the class for custom instances
module.exports.TableFormatter = TableFormatter;