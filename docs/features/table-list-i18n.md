# Table and List Display Internationalization

PoppoBuilder Suite provides a comprehensive table formatting system with full internationalization support for displaying structured data in CLI output.

## Overview

The table formatter (`lib/utils/table-formatter.js`) provides a unified interface for displaying:
- Tables with headers and columns
- Lists (numbered or bulleted)
- Key-value pairs
- Summary information

All text elements are automatically translated based on the current language setting.

## Table Display

### Basic Usage

```javascript
const tableFormatter = require('./lib/utils/table-formatter');
const { t } = require('./lib/i18n');

const data = [
  { id: '001', name: 'Project A', status: 'active', priority: 80 },
  { id: '002', name: 'Project B', status: 'inactive', priority: 60 }
];

const table = tableFormatter.formatTable(data, {
  columns: [
    { key: 'id', labelKey: 'table:columns.id' },
    { key: 'name', labelKey: 'table:columns.name' },
    { key: 'status', labelKey: 'table:columns.status' },
    { key: 'priority', labelKey: 'table:columns.priority', align: 'right' }
  ]
});

console.log(table);
```

### Column Options

```javascript
{
  key: 'status',              // Data key
  labelKey: 'table:columns.status',  // Translation key for header
  label: 'Status',            // Fallback label
  align: 'left|center|right', // Column alignment
  minWidth: 10,               // Minimum column width
  maxWidth: 50,               // Maximum column width
  formatter: (value, row) => {  // Custom formatter
    return value ? '✓' : '✗';
  }
}
```

### Formatters

Built-in formatters handle common data types:

- **Boolean**: Displays as localized Yes/No
- **Date**: Uses locale-specific date format
- **Number**: Adds thousand separators
- **Array**: Joins with commas
- **Currency**: Formats with currency symbol
- **Percentage**: Adds % suffix

### Custom Formatting

```javascript
columns: [
  {
    key: 'status',
    labelKey: 'table:columns.status',
    formatter: (value) => {
      const text = t(`table:status.${value}`);
      return value === 'enabled' ? 
        chalk.green(text) : chalk.red(text);
    }
  }
]
```

## List Display

### Simple List

```javascript
const items = ['Item 1', 'Item 2', 'Item 3'];

const list = tableFormatter.formatList(items, {
  title: 'My List',
  numbered: true  // Use numbers instead of bullets
});
```

### Custom Item Formatting

```javascript
const projects = [
  { name: 'Project A', id: 'p1' },
  { name: 'Project B', id: 'p2' }
];

const list = tableFormatter.formatList(projects, {
  formatter: (item) => `${item.name} (${item.id})`
});
```

## Key-Value Display

```javascript
const details = tableFormatter.formatKeyValue({
  name: 'PoppoBuilder',
  version: '3.0.0',
  language: 'en',
  enabled: true
}, {
  title: 'Configuration Details'
});
```

## Translation Structure

### Column Headers

Column headers are translated using the `table:columns` namespace:

```json
{
  "table": {
    "columns": {
      "id": "ID",
      "name": "Name",
      "status": "Status",
      "priority": "Priority"
    }
  }
}
```

### Generic Fields

For common field names, use the `fields` namespace:

```json
{
  "fields": {
    "name": "Name",
    "description": "Description",
    "created": "Created",
    "updated": "Updated"
  }
}
```

### Status Values

Status values use the `table:status` namespace:

```json
{
  "table": {
    "status": {
      "enabled": "Enabled",
      "disabled": "Disabled",
      "active": "Active",
      "inactive": "Inactive"
    }
  }
}
```

## Integration Example

### List Command

```javascript
class ListCommand {
  async outputTable(projectIds, projects, options) {
    const data = projectIds.map(id => {
      const project = projects[id];
      return {
        id,
        name: project.config.name,
        status: project.enabled ? 
          t('table:status.enabled') : 
          t('table:status.disabled'),
        priority: project.config.priority
      };
    });

    const columns = [
      { key: 'id', labelKey: 'table:columns.id' },
      { key: 'name', labelKey: 'table:columns.name' },
      { 
        key: 'status', 
        labelKey: 'table:columns.status',
        formatter: (value) => {
          return value === t('table:status.enabled') ? 
            colors.green(value) : colors.red(value);
        }
      },
      { key: 'priority', labelKey: 'table:columns.priority' }
    ];

    const table = tableFormatter.formatTable(data, {
      columns,
      summary: true
    });

    console.log(table);
  }
}
```

## Advanced Features

### Summary Display

```javascript
const table = tableFormatter.formatTable(data, {
  columns: [...],
  summary: true  // Auto-generate summary
});

// Or custom summary
const table = tableFormatter.formatTable(data, {
  columns: [...],
  summary: (data) => {
    const total = data.length;
    const active = data.filter(d => d.status === 'active').length;
    return t('commands:list.summary', { total, active });
  }
});
```

### Table Options

```javascript
{
  title: 'Project List',        // Table title
  columns: [...],               // Column definitions
  compact: true,                // Reduce spacing
  borderStyle: 'single',        // single|double|thick
  color: false,                 // Disable colors
  noHeader: false,              // Hide header row
  separatorAfter: [2, 5],       // Add separators after rows
  footer: 'Total: 10 items',    // Footer text
  summary: true                 // Show summary
}
```

### Truncation

Long text is automatically truncated with ellipsis:

```javascript
{
  key: 'path',
  labelKey: 'table:columns.path',
  maxWidth: 30  // Truncate to 30 characters
}
```

## Best Practices

1. **Always Use Translation Keys**
   ```javascript
   // ❌ Bad
   { key: 'status', label: 'Status' }
   
   // ✅ Good
   { key: 'status', labelKey: 'table:columns.status' }
   ```

2. **Provide Fallbacks**
   ```javascript
   { 
     key: 'custom', 
     labelKey: 'table:columns.custom',
     label: 'Custom Field'  // Fallback if translation missing
   }
   ```

3. **Consider Column Width**
   - Account for different language text lengths
   - Use `maxWidth` to prevent excessive widths
   - Test with longest expected translations

4. **Use Appropriate Alignment**
   - Numbers: right-aligned
   - Boolean/status: center-aligned
   - Text: left-aligned (default)

## Testing

Run the table formatter test:

```bash
node test/test-table-formatter.js
```

This displays various table formats in both English and Japanese.

## Troubleshooting

### Columns Not Aligned

Check for:
- ANSI color codes affecting width calculation
- Unicode characters (properly handled by formatter)
- Mixed fonts in terminal

### Missing Translations

The formatter attempts translation in this order:
1. Specific table column key (`table:columns.${key}`)
2. Generic field key (`fields:${key}`)
3. Humanized key (camelCase → Title Case)

### Performance

For large datasets:
- Use `maxWidth` to limit column scanning
- Consider pagination for very long lists
- Use `compact: true` to reduce output size