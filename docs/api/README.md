# PoppoBuilder Suite - API Documentation

## Overview

PoppoBuilder Suite provides a comprehensive REST API for managing projects, monitoring system health, and controlling automation processes. This documentation covers all available endpoints, authentication methods, and usage examples.

## Base URL

- **Development**: `http://localhost:3000`
- **Production**: `https://your-domain.com`

## Authentication

### API Key Authentication

Most endpoints require authentication using an API key:

```bash
curl -H "Authorization: Bearer YOUR_API_KEY" \
  http://localhost:3000/api/projects
```

### Dashboard Authentication

The dashboard uses session-based authentication:

```bash
# Login
curl -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username": "admin", "password": "your_password"}'
```

## Rate Limiting

API requests are rate-limited to prevent abuse:

- **Default**: 100 requests per minute per IP
- **Authenticated**: 1000 requests per minute per API key
- **Headers**: Rate limit information is returned in response headers

```
X-RateLimit-Limit: 1000
X-RateLimit-Remaining: 999
X-RateLimit-Reset: 1609459200
```

## Response Format

All API responses follow a consistent format:

### Success Response
```json
{
  "success": true,
  "data": {
    // Response data
  },
  "meta": {
    "timestamp": "2023-12-01T12:00:00Z",
    "version": "3.0.0"
  }
}
```

### Error Response
```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid input parameters",
    "details": {
      "field": "projectId",
      "reason": "Project ID is required"
    }
  },
  "meta": {
    "timestamp": "2023-12-01T12:00:00Z",
    "version": "3.0.0"
  }
}
```

## Health and Status Endpoints

### GET /health

Basic health check endpoint.

**Response:**
```json
{
  "status": "healthy",
  "timestamp": "2023-12-01T12:00:00Z",
  "uptime": 3600,
  "version": "3.0.0"
}
```

### GET /health/detailed

Detailed health information including dependencies.

**Response:**
```json
{
  "status": "healthy",
  "checks": {
    "database": {
      "status": "healthy",
      "responseTime": 5,
      "lastCheck": "2023-12-01T12:00:00Z"
    },
    "redis": {
      "status": "healthy",
      "responseTime": 2,
      "lastCheck": "2023-12-01T12:00:00Z"
    },
    "github": {
      "status": "healthy",
      "rateLimit": 4500,
      "lastCheck": "2023-12-01T12:00:00Z"
    },
    "claude": {
      "status": "healthy",
      "lastCheck": "2023-12-01T12:00:00Z"
    }
  },
  "system": {
    "cpu": 45.2,
    "memory": 68.5,
    "disk": 34.1
  }
}
```

### GET /health/ready

Readiness check for load balancers.

**Response:**
```json
{
  "ready": true,
  "timestamp": "2023-12-01T12:00:00Z"
}
```

### GET /metrics

Prometheus metrics endpoint.

**Response:**
```
# HELP poppobuilder_cpu_usage_percent CPU usage percentage
# TYPE poppobuilder_cpu_usage_percent gauge
poppobuilder_cpu_usage_percent 45.2

# HELP poppobuilder_memory_usage_bytes Memory usage in bytes
# TYPE poppobuilder_memory_usage_bytes gauge
poppobuilder_memory_usage_bytes{type="heap_used"} 123456789
```

## Project Management

### GET /api/projects

List all projects.

**Parameters:**
- `limit` (optional): Number of results (default: 50, max: 200)
- `offset` (optional): Pagination offset (default: 0)
- `status` (optional): Filter by status (`active`, `paused`, `archived`)

**Response:**
```json
{
  "success": true,
  "data": {
    "projects": [
      {
        "id": "project-123",
        "name": "PoppoBuilder Suite",
        "repository": "owner/repo",
        "status": "active",
        "createdAt": "2023-01-01T00:00:00Z",
        "lastActivity": "2023-12-01T11:30:00Z",
        "stats": {
          "totalIssues": 156,
          "processedIssues": 143,
          "pendingIssues": 13,
          "errorRate": 0.02
        }
      }
    ],
    "pagination": {
      "total": 25,
      "limit": 50,
      "offset": 0,
      "hasMore": false
    }
  }
}
```

### POST /api/projects

Create a new project.

**Request Body:**
```json
{
  "name": "New Project",
  "repository": "owner/repo",
  "description": "Project description",
  "settings": {
    "processingEnabled": true,
    "priority": "normal",
    "labels": ["task:feature", "task:bug"],
    "agents": ["CCPM", "CCQA"]
  }
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "project": {
      "id": "project-456",
      "name": "New Project",
      "repository": "owner/repo",
      "status": "active",
      "createdAt": "2023-12-01T12:00:00Z"
    }
  }
}
```

### GET /api/projects/:projectId

Get project details.

**Response:**
```json
{
  "success": true,
  "data": {
    "project": {
      "id": "project-123",
      "name": "PoppoBuilder Suite",
      "repository": "owner/repo",
      "status": "active",
      "settings": {
        "processingEnabled": true,
        "priority": "high",
        "labels": ["task:feature", "task:bug"],
        "agents": ["CCPM", "CCQA", "CCRA"]
      },
      "stats": {
        "totalIssues": 156,
        "processedIssues": 143,
        "pendingIssues": 13,
        "averageProcessingTime": 1800,
        "successRate": 0.98
      },
      "recentActivity": [
        {
          "timestamp": "2023-12-01T11:30:00Z",
          "type": "issue_processed",
          "issueNumber": 142,
          "agent": "CCPM",
          "duration": 1234
        }
      ]
    }
  }
}
```

### PUT /api/projects/:projectId

Update project settings.

**Request Body:**
```json
{
  "name": "Updated Project Name",
  "settings": {
    "processingEnabled": false,
    "priority": "low"
  }
}
```

### DELETE /api/projects/:projectId

Archive a project.

**Response:**
```json
{
  "success": true,
  "data": {
    "message": "Project archived successfully"
  }
}
```

## Task Management

### GET /api/tasks

List tasks across all projects.

**Parameters:**
- `projectId` (optional): Filter by project
- `status` (optional): Filter by status (`pending`, `running`, `completed`, `failed`)
- `agent` (optional): Filter by agent
- `limit` (optional): Number of results (default: 50)
- `offset` (optional): Pagination offset

**Response:**
```json
{
  "success": true,
  "data": {
    "tasks": [
      {
        "id": "task-789",
        "projectId": "project-123",
        "type": "issue_processing",
        "status": "running",
        "agent": "CCPM",
        "issueNumber": 142,
        "createdAt": "2023-12-01T11:00:00Z",
        "startedAt": "2023-12-01T11:01:00Z",
        "progress": {
          "stage": "analysis",
          "completion": 0.6
        },
        "metadata": {
          "issueTitle": "Implement new feature",
          "labels": ["task:feature"],
          "priority": "high"
        }
      }
    ],
    "pagination": {
      "total": 342,
      "limit": 50,
      "offset": 0,
      "hasMore": true
    }
  }
}
```

### GET /api/tasks/:taskId

Get task details.

**Response:**
```json
{
  "success": true,
  "data": {
    "task": {
      "id": "task-789",
      "projectId": "project-123",
      "type": "issue_processing",
      "status": "completed",
      "agent": "CCPM",
      "issueNumber": 142,
      "createdAt": "2023-12-01T11:00:00Z",
      "startedAt": "2023-12-01T11:01:00Z",
      "completedAt": "2023-12-01T11:31:00Z",
      "duration": 1800000,
      "result": {
        "success": true,
        "actions": [
          {
            "type": "comment",
            "content": "Analysis completed successfully"
          },
          {
            "type": "label_update",
            "added": ["status:analyzed"],
            "removed": ["status:pending"]
          }
        ]
      },
      "logs": [
        {
          "timestamp": "2023-12-01T11:01:00Z",
          "level": "info",
          "message": "Starting issue analysis"
        },
        {
          "timestamp": "2023-12-01T11:31:00Z",
          "level": "info",
          "message": "Analysis completed successfully"
        }
      ]
    }
  }
}
```

### POST /api/tasks

Create a new task.

**Request Body:**
```json
{
  "projectId": "project-123",
  "type": "issue_processing",
  "issueNumber": 143,
  "priority": "high",
  "agent": "CCPM",
  "metadata": {
    "issueTitle": "Bug fix needed",
    "labels": ["task:bug"],
    "requestedBy": "user@example.com"
  }
}
```

### DELETE /api/tasks/:taskId

Cancel a pending or running task.

**Response:**
```json
{
  "success": true,
  "data": {
    "message": "Task cancelled successfully"
  }
}
```

## Agent Management

### GET /api/agents

List all available agents.

**Response:**
```json
{
  "success": true,
  "data": {
    "agents": [
      {
        "name": "CCPM",
        "displayName": "Code Change Project Manager",
        "version": "3.0.0",
        "status": "active",
        "capabilities": [
          "issue_analysis",
          "code_review",
          "project_management"
        ],
        "stats": {
          "tasksProcessed": 1234,
          "averageProcessingTime": 1800,
          "successRate": 0.98,
          "lastActivity": "2023-12-01T11:30:00Z"
        }
      },
      {
        "name": "CCQA",
        "displayName": "Code Change Quality Assurance",
        "version": "3.0.0",
        "status": "active",
        "capabilities": [
          "quality_analysis",
          "test_execution",
          "security_scanning"
        ],
        "stats": {
          "tasksProcessed": 876,
          "averageProcessingTime": 2100,
          "successRate": 0.96,
          "lastActivity": "2023-12-01T11:25:00Z"
        }
      }
    ]
  }
}
```

### GET /api/agents/:agentName

Get detailed agent information.

**Response:**
```json
{
  "success": true,
  "data": {
    "agent": {
      "name": "CCPM",
      "displayName": "Code Change Project Manager",
      "version": "3.0.0",
      "status": "active",
      "description": "Manages code changes and project workflows",
      "capabilities": [
        "issue_analysis",
        "code_review",
        "project_management"
      ],
      "configuration": {
        "maxConcurrentTasks": 5,
        "timeout": 1800000,
        "retryAttempts": 3
      },
      "stats": {
        "tasksProcessed": 1234,
        "averageProcessingTime": 1800,
        "successRate": 0.98,
        "errorRate": 0.02,
        "lastActivity": "2023-12-01T11:30:00Z"
      },
      "recentTasks": [
        {
          "taskId": "task-789",
          "issueNumber": 142,
          "status": "completed",
          "duration": 1800000,
          "completedAt": "2023-12-01T11:31:00Z"
        }
      ]
    }
  }
}
```

### PUT /api/agents/:agentName

Update agent configuration.

**Request Body:**
```json
{
  "configuration": {
    "maxConcurrentTasks": 3,
    "timeout": 2400000
  }
}
```

### POST /api/agents/:agentName/restart

Restart an agent.

**Response:**
```json
{
  "success": true,
  "data": {
    "message": "Agent restart initiated",
    "restartId": "restart-123"
  }
}
```

## Analytics and Reporting

### GET /api/analytics/overview

Get system overview analytics.

**Parameters:**
- `period` (optional): Time period (`hour`, `day`, `week`, `month`)
- `startDate` (optional): Start date (ISO 8601)
- `endDate` (optional): End date (ISO 8601)

**Response:**
```json
{
  "success": true,
  "data": {
    "overview": {
      "totalProjects": 25,
      "activeProjects": 18,
      "totalTasks": 12543,
      "completedTasks": 12234,
      "failedTasks": 309,
      "averageProcessingTime": 1847,
      "successRate": 0.975
    },
    "trends": {
      "tasksPerDay": [
        {"date": "2023-11-25", "count": 89},
        {"date": "2023-11-26", "count": 95},
        {"date": "2023-11-27", "count": 78}
      ],
      "successRate": [
        {"date": "2023-11-25", "rate": 0.98},
        {"date": "2023-11-26", "rate": 0.97},
        {"date": "2023-11-27", "rate": 0.99}
      ]
    }
  }
}
```

### GET /api/analytics/performance

Get performance analytics.

**Response:**
```json
{
  "success": true,
  "data": {
    "performance": {
      "responseTime": {
        "p50": 1234,
        "p95": 2876,
        "p99": 4521
      },
      "throughput": {
        "tasksPerHour": 45,
        "requestsPerSecond": 12.3
      },
      "resourceUsage": {
        "cpu": 45.2,
        "memory": 68.5,
        "disk": 34.1
      },
      "errors": {
        "errorRate": 0.025,
        "topErrors": [
          {
            "type": "GITHUB_RATE_LIMIT",
            "count": 15,
            "percentage": 0.4
          },
          {
            "type": "TIMEOUT_ERROR",
            "count": 8,
            "percentage": 0.21
          }
        ]
      }
    }
  }
}
```

### GET /api/analytics/agents

Get agent performance analytics.

**Response:**
```json
{
  "success": true,
  "data": {
    "agents": [
      {
        "name": "CCPM",
        "performance": {
          "tasksProcessed": 1234,
          "averageTime": 1800,
          "successRate": 0.98,
          "trend": "improving"
        }
      },
      {
        "name": "CCQA",
        "performance": {
          "tasksProcessed": 876,
          "averageTime": 2100,
          "successRate": 0.96,
          "trend": "stable"
        }
      }
    ]
  }
}
```

## System Administration

### GET /api/admin/status

Get detailed system status (admin only).

**Response:**
```json
{
  "success": true,
  "data": {
    "system": {
      "version": "3.0.0",
      "uptime": 86400,
      "environment": "production",
      "nodeVersion": "18.17.0",
      "pid": 1234
    },
    "database": {
      "status": "connected",
      "connections": 15,
      "poolSize": 20,
      "queryCount": 156789
    },
    "cache": {
      "status": "connected",
      "memory": 45234567,
      "hitRate": 0.89
    },
    "queue": {
      "pending": 5,
      "running": 3,
      "completed": 12234,
      "failed": 89
    }
  }
}
```

### POST /api/admin/maintenance

Enable/disable maintenance mode.

**Request Body:**
```json
{
  "enabled": true,
  "message": "System maintenance in progress"
}
```

### POST /api/admin/cache/clear

Clear system caches.

**Response:**
```json
{
  "success": true,
  "data": {
    "message": "Cache cleared successfully",
    "clearedItems": 1234
  }
}
```

### GET /api/admin/logs

Get system logs (admin only).

**Parameters:**
- `level` (optional): Log level (`error`, `warn`, `info`, `debug`)
- `component` (optional): Component name
- `limit` (optional): Number of entries (default: 100)
- `offset` (optional): Pagination offset

**Response:**
```json
{
  "success": true,
  "data": {
    "logs": [
      {
        "timestamp": "2023-12-01T12:00:00Z",
        "level": "info",
        "component": "TaskProcessor",
        "message": "Task completed successfully",
        "metadata": {
          "taskId": "task-789",
          "duration": 1800
        }
      }
    ],
    "pagination": {
      "total": 45678,
      "limit": 100,
      "offset": 0,
      "hasMore": true
    }
  }
}
```

## WebSocket API

### Connection

Connect to WebSocket for real-time updates:

```javascript
const ws = new WebSocket('ws://localhost:3000/ws');

ws.on('open', () => {
  // Send authentication
  ws.send(JSON.stringify({
    type: 'auth',
    token: 'YOUR_API_KEY'
  }));
});
```

### Events

#### Task Updates
```json
{
  "type": "task_update",
  "data": {
    "taskId": "task-789",
    "status": "completed",
    "progress": 1.0
  }
}
```

#### System Alerts
```json
{
  "type": "system_alert",
  "data": {
    "level": "warning",
    "message": "High CPU usage detected",
    "component": "system"
  }
}
```

#### Agent Status
```json
{
  "type": "agent_status",
  "data": {
    "agent": "CCPM",
    "status": "active",
    "currentTasks": 3
  }
}
```

## Error Codes

| Code | HTTP Status | Description |
|------|-------------|-------------|
| `VALIDATION_ERROR` | 400 | Invalid input parameters |
| `UNAUTHORIZED` | 401 | Authentication required |
| `FORBIDDEN` | 403 | Insufficient permissions |
| `NOT_FOUND` | 404 | Resource not found |
| `RATE_LIMIT` | 429 | Rate limit exceeded |
| `INTERNAL_ERROR` | 500 | Internal server error |
| `SERVICE_UNAVAILABLE` | 503 | Service temporarily unavailable |

## SDKs and Libraries

### JavaScript/Node.js
```bash
npm install @poppobuilder/sdk
```

```javascript
const PoppoBuilder = require('@poppobuilder/sdk');

const client = new PoppoBuilder({
  baseUrl: 'http://localhost:3000',
  apiKey: 'YOUR_API_KEY'
});

// List projects
const projects = await client.projects.list();

// Create task
const task = await client.tasks.create({
  projectId: 'project-123',
  type: 'issue_processing',
  issueNumber: 142
});
```

### Python
```bash
pip install poppobuilder-sdk
```

```python
from poppobuilder import PoppoBuilder

client = PoppoBuilder(
    base_url='http://localhost:3000',
    api_key='YOUR_API_KEY'
)

# List projects
projects = client.projects.list()

# Create task
task = client.tasks.create({
    'projectId': 'project-123',
    'type': 'issue_processing',
    'issueNumber': 142
})
```

## Best Practices

### Authentication
- Use API keys for programmatic access
- Rotate API keys regularly
- Use environment variables for sensitive data
- Implement proper error handling for auth failures

### Rate Limiting
- Implement exponential backoff for retries
- Monitor rate limit headers
- Cache responses when possible
- Use bulk operations when available

### Error Handling
- Always check response status
- Handle rate limits gracefully
- Log errors for debugging
- Implement circuit breakers for resilience

### Performance
- Use pagination for large datasets
- Filter results at the API level
- Cache frequently accessed data
- Use WebSockets for real-time updates

---

For additional support or questions about the API, please contact our support team or create an issue in the repository.