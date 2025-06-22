# Traceability Feature Usage Guide

## Overview

The traceability feature in PoppoBuilder Suite is a powerful tool that ensures traceability from requirements to implementation and testing, and automatically analyzes the impact of changes.

## Feature Overview

### Phase 1: Basic Features (Implemented)
- Automatic ID numbering system (PBS-REQ-001 format)
- Bidirectional link management
- YAML-based data persistence
- Consistency check functionality
- Traceability matrix generation

### Phase 2: Change Impact Analysis (Implemented)
- Automatic impact analysis for changes
- Impact level display (High/Medium/Low)
- Identification of areas requiring updates
- Generation of recommended actions
- Detailed impact analysis reports

## Usage

### Basic Commands

#### Adding Items
```bash
npm run trace add <phase> <title>

# Examples
npm run trace add REQ "User authentication feature"
npm run trace add SPEC "OAuth2 authentication specification"
npm run trace add IMP "Authentication module implementation"
```

#### Creating Links
```bash
npm run trace link <from-id> <to-id> [link-type]

# Examples
npm run trace link PBS-SPEC-001 PBS-REQ-001 implements
npm run trace link PBS-IMP-001 PBS-SPEC-001
```

#### Listing Items
```bash
# Show all items
npm run trace list

# Show by phase
npm run trace list REQ
npm run trace list SPEC
```

#### Generating Traceability Matrix
```bash
npm run trace matrix
# → Generates traceability-matrix.md
```

#### Consistency Check
```bash
npm run trace check
# Detects unimplemented requirements, implementations without tests, etc.
```

### Impact Analysis Commands

#### Change Impact Analysis
```bash
npm run trace impact <item-id> [change-type]

# Analyze impact of modification
npm run trace impact PBS-REQ-001 modify

# Analyze impact of deletion
npm run trace impact PBS-SPEC-001 delete

# Analyze impact of addition
npm run trace impact PBS-IMP-003 add
```

#### Comprehensive Impact Analysis
```bash
npm run trace analyze <item-id>
# Shows impact summary for each change type
```

### Update and Delete Operations

#### Updating Items
```bash
npm run trace update <item-id> <field> <value>

# Examples
npm run trace update PBS-REQ-001 title "Improved user authentication feature"
npm run trace update PBS-IMP-001 status "completed"
npm run trace update PBS-SPEC-001 description "Detailed authentication flow"
```

#### Deleting Items
```bash
npm run trace delete <item-id>
# Impact analysis is performed before deletion, and confirmation is requested
```

## Phases and Link Types

### Phases
- `REQ` - Requirements
- `SPEC` - Specifications  
- `HLD` - High Level Design
- `DLD` - Detailed Design
- `IMP` - Implementation
- `TEST` - Testing

### Link Types
- `implements` - Implementation relationship (default)
- `references` - Reference relationship
- `derives_from` - Derivation relationship
- `conflicts_with` - Conflict relationship
- `supersedes` - Replacement relationship

## ID Format

All items are automatically assigned IDs:
```
PBS-<PHASE>-<sequential number>

Examples:
- PBS-REQ-001  (Requirement 001)
- PBS-SPEC-001 (Specification 001)
- PBS-IMP-001  (Implementation 001)
```

## Interpreting Impact Analysis

### Impact Levels
- **High**: Direct implementation relationship exists, verification and updates are required
- **Medium**: Related, updates should be considered
- **Low**: Only indirect impact, check just in case

### Impact Factors
1. **Inter-phase relationships**: Upstream changes have major impact downstream
2. **Link types**: implements and conflicts_with have strong impact
3. **Distance**: Direct links have high impact, indirect links have low impact

## Practical Examples

### New Feature Addition Workflow
```bash
# 1. Add requirement
npm run trace add REQ "Notification feature implementation"
# → PBS-REQ-002

# 2. Define specification
npm run trace add SPEC "Real-time notification specification"
# → PBS-SPEC-003

# 3. Create link
npm run trace link PBS-SPEC-003 PBS-REQ-002

# 4. Add implementation
npm run trace add IMP "WebSocket notification module"
# → PBS-IMP-003

# 5. Link implementation to specification
npm run trace link PBS-IMP-003 PBS-SPEC-003

# 6. Verify with matrix
npm run trace matrix
```

### Checking Impact of Requirement Changes
```bash
# 1. Analyze impact before change
npm run trace impact PBS-REQ-001 modify

# 2. Review impact report
# - List of affected items
# - Areas requiring updates
# - Recommended actions

# 3. Update requirement
npm run trace update PBS-REQ-001 title "Improved authentication feature"

# 4. Update affected items sequentially
```

### Deleting Obsolete Items
```bash
# 1. Pre-analyze deletion impact
npm run trace impact PBS-SPEC-002 delete

# 2. Execute deletion (with confirmation)
npm run trace delete PBS-SPEC-002
# → Impact analysis results are displayed and confirmation is requested
```

## Data Storage Locations

- **Traceability data**: `.poppo/traceability.yaml`
- **Matrix**: `traceability-matrix.md`
- **Impact analysis reports**: `impact-analysis-<ID>-<timestamp>.md`

## Best Practices

1. **Frequent updates**: Always update traceability when implementing or changing documentation
2. **Regular consistency checks**: Early detection of issues with `npm run trace check`
3. **Pre-change impact analysis**: Always check with `impact` command before major changes
4. **Use appropriate link types**: Utilize more than just the default `implements`
5. **Add descriptions**: Set `description` for important items

## Troubleshooting

### When Link Errors Occur
- Verify both items exist: `npm run trace list`
- Confirm IDs are correct (case-sensitive)

### When Impact Analysis Differs from Expectations
- Check link relationships: `npm run trace matrix`
- Check consistency: `npm run trace check`

### When Data is Lost
- Restore from `.poppo/traceability.yaml` backup
- If version controlled with Git, restore with `git checkout`