# Feishu Document API: Native Table Support via Descendant API

**Author**: elarwei_ai  
**Date**: 2026-02-26  
**Status**: Implemented & Verified  
**Issue**: [#26222](https://github.com/openclaw/openclaw/issues/26222)  
**Branch**: `feat/feishu-docx-table`

## Executive Summary

This proposal documents the discovery that Feishu's Descendant API **natively supports Table blocks** when properly formatted, eliminating the need for complex placeholder-based table insertion workflows.

## Background

### Previous Approach (Complex)
```
Markdown with tables
    ↓ extractMarkdownTables()
Markdown (tables replaced with placeholders)
    ↓ Convert API
Blocks (no tables, just placeholder text blocks)
    ↓ Descendant API
Document with placeholders
    ↓ replacePlaceholdersWithTables()
Document with tables (via Children API + cell updates)
```

**Problems:**
- Multiple API calls per table
- Rate limiting issues (429 errors)
- Complex placeholder matching logic
- Cell content required separate updates

### New Approach (Simple)
```
Markdown with tables
    ↓ Convert API (handles tables natively!)
Blocks (includes Table + TableCell blocks)
    ↓ cleanBlocksForDescendant()
Cleaned blocks
    ↓ Descendant API (single call)
Document with tables ✓
```

## Key Findings

### 1. Convert API Supports GFM Tables (Experimental)

The Feishu Convert API (`POST /open-apis/docx/v1/documents/convert`) handles GitHub Flavored Markdown tables:

```markdown
| Header 1 | Header 2 |
|----------|----------|
| Cell 1   | Cell 2   |
```

Returns proper block structure:
- `block_type: 31` (Table) with `children` pointing to cells
- `block_type: 32` (TableCell) with nested Text blocks

### 2. Descendant API Supports Tables (With Cleaning)

The Descendant API (`POST /open-apis/docx/v1/documents/:id/blocks/:id/descendant`) accepts Table blocks, but Convert API returns read-only fields that must be removed:

**Convert API Returns:**
```json
{
  "block_type": 31,
  "children": ["cell1", "cell2", ...],
  "table": {
    "cells": ["cell1", "cell2", ...],  // ❌ Remove
    "property": {
      "row_size": 3,
      "column_size": 4,
      "column_width": [175, 175, 175, 175],  // ❌ Remove
      "merge_info": [{"row_span": 1, "col_span": 1}, ...]  // ❌ Remove
    }
  }
}
```

**Required Format:**
```json
{
  "block_type": 31,
  "children": ["cell1", "cell2", ...],
  "table": {
    "property": {
      "row_size": 3,
      "column_size": 4
    }
  }
}
```

### 3. Children Field Type Bug

Convert API sometimes returns `children` as a string instead of array for TableCell blocks:

```json
{
  "block_type": 32,
  "children": "text-block-id"  // Should be ["text-block-id"]
}
```

**Fix:** Normalize `children` to array format before insertion.

## Implementation

### cleanBlocksForDescendant()

```typescript
function cleanBlocksForDescendant(blocks: any[]): any[] {
  return blocks.map((block) => {
    const { parent_id, ...clean } = block;

    // Fix children type (string → array)
    if (clean.children && typeof clean.children === "string") {
      clean.children = [clean.children];
    }

    // Clean table blocks
    if (clean.block_type === 31 && clean.table) {
      const { cells, ...tableWithoutCells } = clean.table;
      if (tableWithoutCells.property) {
        const { row_size, column_size } = tableWithoutCells.property;
        tableWithoutCells.property = { row_size, column_size };
      }
      clean.table = tableWithoutCells;
    }

    return clean;
  });
}
```

### Simplified Write Flow

```typescript
async function writeDoc(client, docToken, markdown, maxBytes) {
  // 1. Convert markdown (including tables!)
  const { blocks, firstLevelBlockIds } = await convertMarkdown(client, markdown);
  
  // 2. Insert ALL blocks via Descendant API
  const { inserted } = await insertBlocks(client, docToken, blocks, firstLevelBlockIds);
  
  // 3. Process images (if any)
  await processImages(client, docToken, markdown, inserted, maxBytes);
  
  return { success: true, tables_created: countTables(blocks) };
}
```

## Test Results

### Simple Table Test
- **Input**: 3x3 markdown table
- **Result**: ✅ Rendered correctly
- **Doc**: https://bjpuodyq7upm.jp.larksuite.com/docx/GJ5WdkzkEotKWJxvIp0jHMcOpWg

### Complex Document Test
- **Input**: 66 blocks including:
  - Headers (H1-H4)
  - Bullet lists (3 levels)
  - Ordered lists
  - Code block
  - 5x4 Table (20 cells)
- **Result**: ✅ All elements rendered correctly
- **Doc**: https://bjpuodyq7upm.jp.larksuite.com/docx/PRkBdoVZWowjoRxqzSOjK7PApXg

## Benefits

| Aspect | Before | After |
|--------|--------|-------|
| API calls per table | 2 + (rows × cols) | 1 |
| Code complexity | ~300 lines | ~50 lines |
| Rate limiting risk | High | Low |
| Cell formatting | Manual parsing | Native |
| Error handling | Complex | Simple |

## Use Cases Supported

1. **Direct table writing** - Agent writes markdown with tables
2. **MD file conversion** - Import existing markdown files
3. **Content appending** - Add markdown content to existing docs

All three use cases now use the **same unified flow**.

## API Documentation References

- [Convert API](https://open.larkoffice.com/document/ukTMukTMukTM/uUDN04SN0QjL1QDN/document-docx/docx-v1/document/convert) - Table support in GFM mode
- [Descendant API](https://open.larkoffice.com/document/ukTMukTMukTM/uUDN04SN0QjL1QDN/document-docx/docx-v1/document-block-descendant/create) - Block types 31/32 supported
- [Document FAQ](https://open.larkoffice.com/document/ukTMukTMukTM/uUDN04SN0QjL1QDN/document-docx/docx-v1/faq) - Table creation examples + merge_info removal note

## Conclusion

The Feishu Descendant API fully supports native table insertion when:
1. Convert API is used to transform markdown → blocks
2. Read-only fields are removed from table blocks
3. Children field type is normalized

This simplification reduces code complexity by ~80% and eliminates rate limiting issues while supporting all document creation use cases.

---

## Appendix: Test Markdown

```markdown
# Feishu Document API - Complex Test

## Feature Comparison Table

| Feature | Children API | Descendant API | Notes |
|---------|-------------|----------------|-------|
| Flat blocks | ✅ Yes | ✅ Yes | Both work |
| Nested lists | ❌ Limited | ✅ Full support | 3+ levels |
| **Tables** | ❌ Separate flow | ✅ **Native** | Key finding! |
| Batch insert | 50/request | 1000/request | Better perf |

## Nested List Example

- Level 1 item
  - Level 2 item
    - Level 3 item (this works now!)
  - Another L2
- Back to L1

## Code Example

\`\`\`typescript
function cleanTableBlock(block: any) {
  const { cells, ...tableWithoutCells } = block.table;
  const { row_size, column_size } = tableWithoutCells.property;
  return { ...block, table: { property: { row_size, column_size } } };
}
\`\`\`
```
