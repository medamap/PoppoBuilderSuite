# Comment Handling Feature Design Document

## 1. Requirements Definition

### 1.1 Functional Requirements

#### 1.1.1 Comment Monitoring and Processing
- **Requirement ID**: REQ-CH-001
- **Content**: Monitor and process new comments on Issues with `awaiting-response` label
- **Details**:
  - Check comments at polling interval (30 seconds)
  - Only process comments from Issue creator
  - Ignore PoppoBuilder's own comments

#### 1.1.2 State Management
- **Requirement ID**: REQ-CH-002
- **Content**: Properly manage Issue processing states
- **Details**:
  - `processing`: Currently processing
  - `awaiting-response`: Awaiting response (newly introduced)
  - `completed`: Completed
  - State transitions are reversible (`awaiting-response` ⇔ `processing`)

#### 1.1.3 Context Management
- **Requirement ID**: REQ-CH-003
- **Content**: Maintain conversation context to generate appropriate responses
- **Details**:
  - Issue body
  - Past comment history
  - Processing result history

#### 1.1.4 Completion Detection
- **Requirement ID**: REQ-CH-004
- **Content**: Complete Issue at appropriate timing
- **Details**:
  - Explicit completion keyword detection
  - Timeout (configurable)
  - Maximum processing count limit

### 1.2 Non-Functional Requirements

#### 1.2.1 Performance Requirements
- **Requirement ID**: REQ-CH-NFR-001
- **Content**: Maintain existing processing performance
- **Criteria**: 
  - Maintain 30-second polling interval
  - Process decision within 5 seconds even for Issues with 100 comments

#### 1.2.2 Reliability Requirements
- **Requirement ID**: REQ-CH-NFR-002
- **Content**: Maintain system stability
- **Criteria**:
  - No duplicate comment processing
  - No infinite loops
  - Graceful error handling

## 2. System Architecture

### 2.1 Component Diagram

```
┌─────────────────────────────────────────────────────┐
│                  GitHub API                         │
└──────────────────┬─────────────┬───────────────────┘
                   │             │
                   ▼             ▼
         ┌─────────────┐   ┌─────────────┐
         │   Issue      │   │  Comment    │
         │  Monitor     │   │  Monitor    │
         └──────┬──────┘   └──────┬──────┘
                │                 │
                ▼                 ▼
         ┌────────────────────────┐
         │   State Manager        │
         │  ・Label Management    │
         │  ・Context Building    │
         └──────────┬─────────────┘
                    │
                    ▼
         ┌────────────────────────┐
         │   Claude Processor     │
         │  ・Context Injection   │
         │  ・Response Generation │
         └────────────────────────┘
```

### 2.2 State Transition Diagram

```
[New Issue] 
    │
    ▼
[processing] ──────► [awaiting-response]
    ▲                      │
    │                      │ (new comment)
    └──────────────────────┘
              │
              │ (completion keyword or timeout)
              ▼
         [completed]
```

## 3. Detailed Design

### 3.1 Data Structures

#### 3.1.1 Comment Context
```javascript
{
  issueNumber: number,
  issueBody: string,
  comments: [
    {
      id: number,
      author: string,
      body: string,
      createdAt: Date,
      isOwner: boolean
    }
  ],
  lastProcessedCommentId: number,
  conversationHistory: [
    {
      role: "user" | "assistant",
      content: string
    }
  ]
}
```

### 3.2 Key Algorithms

#### 3.2.1 Comment Detection Algorithm
```javascript
function detectNewComments(issue) {
  const comments = github.getComments(issue.number);
  const lastProcessed = getLastProcessedCommentId(issue.number);
  
  return comments
    .filter(c => c.id > lastProcessed)
    .filter(c => c.author === issue.creator)
    .filter(c => !isPoppoBuilderComment(c));
}
```

#### 3.2.2 Completion Detection Algorithm
```javascript
function isCompletionComment(comment) {
  const keywords = config.completionKeywords;
  const lowerBody = comment.body.toLowerCase();
  
  return keywords.some(keyword => 
    lowerBody.includes(keyword.toLowerCase())
  );
}
```

## 4. Interface Design

### 4.1 GitHub API Extensions

#### 4.1.1 getIssue(issueNumber)
- Get single Issue details including labels

#### 4.1.2 listComments(issueNumber)
- Get all comments for an Issue
- Returns sorted by creation date

### 4.2 Configuration Extensions

```json
{
  "commentHandling": {
    "enabled": true,
    "completionKeywords": [
      "thank you", "thanks", "done", "complete", "finished"
    ],
    "maxCommentCount": 10,
    "timeoutHours": 24
  }
}
```

## 5. Implementation Plan

### Phase 1: Core Implementation (2 days)
- Comment monitoring logic
- State management extension
- Basic context building

### Phase 2: Integration (1 day)
- Claude processor integration
- Response posting
- Error handling

### Phase 3: Testing & Refinement (1 day)
- End-to-end testing
- Performance optimization
- Documentation

## 6. Testing Strategy

### 6.1 Unit Tests
- Comment detection logic
- Completion keyword matching
- Context building

### 6.2 Integration Tests
- Full comment processing flow
- State transition verification
- Error recovery

### 6.3 End-to-End Tests
- Real GitHub Issue with comments
- Multiple conversation turns
- Completion scenarios

## 7. Risk Analysis

### 7.1 Technical Risks
- **GitHub API rate limits**: Mitigate with efficient polling
- **Context size limits**: Truncate old conversation history
- **Duplicate processing**: Use comment ID tracking

### 7.2 Operational Risks
- **Infinite conversation loops**: Implement max comment count
- **Resource consumption**: Add timeout mechanism

## 8. Success Metrics

- Comment response time < 1 minute
- Successful conversation completion rate > 90%
- No duplicate comment processing
- User satisfaction with conversation flow