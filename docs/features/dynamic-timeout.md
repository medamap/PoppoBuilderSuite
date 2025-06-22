# Dynamic Timeout Management

## Overview

PoppoBuilder's dynamic timeout management feature automatically adjusts timeout durations based on task type and complexity. This allows simple tasks to be processed quickly while ensuring complex tasks have sufficient time to complete.

## Key Features

### 1. Automatic Task Complexity Assessment

The system analyzes the Issue body to determine complexity based on:

- **Body length**: Score based on character count (max 10 points)
- **Code blocks**: 2 points per block
- **Links**: 0.5 points per link
- **Images**: 1 point per image
- **List items**: 0.3 points per item
- **Label scores**: 
  - `complex`: 10 points
  - `feature`: 5 points
  - `documentation`: 3 points
  - `bug`: 2 points

Complexity levels:
- **simple**: Score < 10
- **moderate**: Score 10-20
- **complex**: Score ≥ 20

### 2. Default Timeouts by Task Type

```json
{
  "misc": 30 minutes,
  "dogfooding": 2 hours,
  "documentation": 1 hour,
  "complex": 6 hours,
  "feature": 2 hours,
  "bug": 1 hour
}
```

### 3. Learning from Execution History

- Records average execution time for each task type
- When history exists, uses the average of default and historical values
- Gradual learning impact ensures stability

### 4. Timeout Extension Feature

Running tasks can request additional time, extending the current timeout by 50%.

## Configuration

Configure in `config/config.json`:

```json
{
  "dynamicTimeout": {
    "enabled": true,                    // Enable/disable feature
    "minTimeout": 600000,              // Minimum timeout (10 minutes)
    "maxTimeout": 86400000,            // Maximum timeout (24 hours)
    "timeoutProfiles": {               // Default values by task type
      "misc": 1800000,                 // 30 minutes
      "dogfooding": 7200000,           // 2 hours
      "documentation": 3600000,        // 1 hour
      "complex": 21600000,             // 6 hours
      "feature": 7200000,              // 2 hours
      "bug": 3600000                   // 1 hour
    },
    "complexityFactors": {
      "enableLearning": true,          // Enable/disable learning
      "learningWeight": 0.5            // Learning weight (0.0-1.0)
    }
  }
}
```

## Usage Examples

### 1. Simple Task

```
Issue content: "What is the current time?"
Complexity: simple (score: 0.16)
Task type: misc
Calculated timeout: 24 minutes (30 minutes × 0.8)
```

### 2. Complex Task

```
Issue content: Long description with multiple code blocks, links, and images
Complexity: complex (score: 29.56)
Task type: complex
Labels: task:complex, feature
Calculated timeout: 720 minutes (360 minutes × 2.0)
```

### 3. Learning-based Adjustment

```
Task type: misc
Historical average: 15 minutes
Default: 30 minutes
Adjusted: 21 minutes ((30 + 15×1.5) / 2)
```

## Execution History

Execution history is saved to `logs/execution-history.json`:

```json
{
  "taskTypes": {
    "misc": {
      "count": 10,
      "totalTime": 9000000,
      "averageExecutionTime": 900000,
      "successCount": 8,
      "timeoutCount": 1,
      "errorCount": 1
    }
  },
  "complexityHistory": [
    {
      "taskId": "issue-123",
      "timestamp": "2025-06-16T10:00:00.000Z",
      "taskType": "misc",
      "complexity": 5.2,
      "complexityLevel": "simple",
      "executionTime": 900000,
      "status": "completed"
    }
  ]
}
```

## Statistics

Statistics are displayed on PoppoBuilder startup:

```
📊 Timeout Statistics: {
  "taskTypes": {
    "misc": {
      "count": 10,
      "successRate": "80.0%",
      "averageExecutionTime": "15 min",
      "timeoutRate": "10.0%"
    },
    "dogfooding": {
      "count": 5,
      "successRate": "100.0%",
      "averageExecutionTime": "45 min",
      "timeoutRate": "0.0%"
    }
  },
  "overallStats": {
    "totalTasks": 15,
    "successRate": "86.7%",
    "averageExecutionTime": "25 min",
    "timeoutRate": "6.7%"
  }
}
```

## Future Enhancements

1. **Machine Learning for Improved Prediction**
   - Consider more features
   - Task similarity-based prediction

2. **Real-time Extension via IPC**
   - Extension requests from running tasks
   - Dynamic adjustment based on progress

3. **Detailed Metrics Collection**
   - Correlation with CPU/memory usage
   - Time-of-day execution variations

4. **Custom Rule Definition**
   - Keyword-based timeout adjustments
   - User-defined complexity rules