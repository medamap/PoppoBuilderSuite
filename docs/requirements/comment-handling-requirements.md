# Comment Handling Feature Requirements

## 1. Background and Challenges

### Current Issues
- Current PoppoBuilder only processes the Issue description (body)
- After initial processing and adding `completed` label, it doesn't respond to new comments
- Cannot handle additional requests or questions from the Issue creator (owner) via comments

### Business Needs
- Enable continuous dialogue with the creator after Issue processing
- Flexibly respond to additional questions or modification requests
- Achieve more natural interaction

## 2. Requirements

### Functional Requirements

#### FR-1: Comment Monitoring Feature
- Monitor new comments even on Issues with `completed` label
- Only process comments from the Issue creator (owner)
- Ignore PoppoBuilder's own comments

#### FR-2: State Management Extension
- Introduce new label "`awaiting-response`"
- State transitions:
  - On initial processing completion: `processing` → `awaiting-response`
  - On comment addition: `awaiting-response` → `processing`
  - On comment processing completion: `processing` → `awaiting-response`
  - On final completion: `awaiting-response` → `completed`

#### FR-3: Comment Processing Feature
- When detecting new comment, send the comment content to Claude
- Maintain previous processing context (Issue body + past interactions)
- Post processing results as reply to comment

#### FR-4: Completion Detection Feature
- When owner posts explicit completion comment (e.g., "thank you", "done", "OK")
- Or when no new comments for a certain period (configurable)
- Add `completed` label and finish processing

### Non-Functional Requirements

#### NFR-1: Performance
- Maintain existing polling interval (30 seconds) for comment monitoring
- Process efficiently even for Issues with many comments

#### NFR-2: Reliability
- Continue overall Issue processing even if error occurs during comment processing
- Implement mechanism to prevent duplicate processing

#### NFR-3: Usability
- Comment responses maintain the same quality as initial processing
- Natural conversation flow experience

## 3. Detailed Specifications

### 3.1 Comment Monitoring Logic

```javascript
// Pseudo code
function checkComments() {
  const awaitingIssues = getIssuesWithLabel('awaiting-response');
  
  for (const issue of awaitingIssues) {
    const lastProcessedTime = getLastProcessedTime(issue);
    const newComments = getCommentsSince(issue, lastProcessedTime);
    const ownerComments = filterByOwner(newComments);
    
    if (ownerComments.length > 0) {
      processComments(issue, ownerComments);
    }
  }
}
```

### 3.2 Context Building

When processing comments, build context including:
1. Original Issue body
2. All previous PoppoBuilder responses
3. All owner comments
4. Current comment to process

### 3.3 Completion Keywords

Default completion keywords (configurable):
- Japanese: "ありがとう", "ありがとうございます", "完了", "OK", "了解"
- English: "thank you", "thanks", "done", "complete", "finished"

## 4. Configuration Options

Add to `config/config.json`:

```json
{
  "commentHandling": {
    "enabled": true,
    "completionKeywords": ["thank you", "thanks", "done", "complete"],
    "maxCommentCount": 10,
    "timeoutHours": 24
  }
}
```

## 5. Implementation Priority

1. **Phase 1**: Basic comment monitoring and processing
2. **Phase 2**: Context management and state transitions
3. **Phase 3**: Completion detection and configuration options

## 6. Success Criteria

- Can detect and process new comments from Issue creator
- Maintains conversation context across multiple interactions
- Correctly transitions between states
- Automatically completes on detection of completion keywords
- No duplicate processing of comments