# Excel Export Fix - Duplicate Rows Issue

## Problem Identified

In the "DRHAT - Perception" project export, rows 12-21 had:
- **Empty prompt cells**
- **Duplicate fan-out queries**
- **Duplicate citations**
- Only 11 unique prompts but 20 total rows

## Root Cause

The Excel export function (`exportToExcel` in `ProjectDetailPage.tsx:1790-1868`) was iterating through **LLM responses** instead of **prompts**.

### Why This Caused Duplicates

- Each prompt can have multiple responses (one per audit, or multiple audits)
- The code did: `responses.map(response => ...)`
- This created one Excel row per response, not per prompt
- When a prompt had multiple responses, it created multiple rows with:
  - The prompt text only in the first row
  - Empty prompt cells in subsequent rows
  - Duplicate citations and fan-out queries

## Solution Implemented

Changed the export logic to:

1. **Group responses by prompt_id first**
   ```typescript
   const responsesByPrompt = responses.reduce((acc, response) => {
     const promptId = response.prompt_id || 'unknown';
     if (!acc[promptId]) {
       acc[promptId] = [];
     }
     acc[promptId].push(response);
     return acc;
   }, {} as Record<string, any[]>);
   ```

2. **Process each prompt once, aggregating data from all its responses**
   ```typescript
   const exportData = Object.values(responsesByPrompt).map(promptResponses => {
     // Use first response for prompt text
     const response = promptResponses[0];
     const promptText = response.prompts?.prompt_text || '';

     // Aggregate all fan-out queries from all responses
     // Aggregate all citations from all responses
     // etc.
   });
   ```

3. **Use Sets to deduplicate URLs and queries**
   - Fan-out queries: `new Set<string>()` for unique queries
   - Citations: `new Set()` for unique URLs
   - All sources: `new Set<string>()` for unique sources

## Changes Made

**File**: `src/pages/ProjectDetailPage.tsx`
**Lines**: 1790-1868

### Key Improvements

1. ✅ **One row per prompt** (not per response)
2. ✅ **No empty prompt cells**
3. ✅ **Deduplicated fan-out queries** across multiple responses
4. ✅ **Deduplicated citations** across multiple responses
5. ✅ **Deduplicated all sources** across multiple responses
6. ✅ **Same citation logic preserved**:
   - SearchGPT: Only `cited=true`
   - Other LLMs: `cited=true` OR `cited=null`
   - Citations More: `cited=false` for all LLMs

## Expected Result

For "DRHAT - Perception" project:
- **Before**: 20 rows (11 prompts + 9 duplicates), with row 12 having empty prompt
- **After**: 11 rows (one per unique prompt)
- All fan-out queries, citations, and sources are properly aggregated
- No empty prompt cells
- Responses without valid prompts are excluded from export

## Testing

To verify the fix:
1. Go to the project detail page
2. Navigate to the "Perception" tab or equivalent
3. Click "Export to Excel"
4. Open the exported file
5. Verify:
   - Each row has a prompt text
   - Number of rows = number of unique prompts
   - Citations are complete and deduplicated
   - Fan-out queries are complete and deduplicated

## Technical Details

### Aggregation Logic

**Fan-out queries**:
```typescript
const allFanOutQueries = new Set<string>();
promptResponses.forEach(r => {
  if (r.web_search_query) {
    if (Array.isArray(r.web_search_query)) {
      r.web_search_query.forEach(q => allFanOutQueries.add(q));
    } else if (typeof r.web_search_query === 'string') {
      const cleaned = r.web_search_query
        .replace(/^\[['"]?|['"]?\]$/g, '')
        .replace(/^['"]|['"]$/g, '');
      if (cleaned) allFanOutQueries.add(cleaned);
    }
  }
});
```

**Citations**:
```typescript
// Get ALL citations for this prompt (not filtered by audit_id)
const promptCitations = citationsFromLastAudit.filter(citation =>
  citation.prompt_id === response.prompt_id &&
  citation.llm === response.llm
);

// Use Set to deduplicate URLs
const citedUrls = new Set(
  promptCitations
    .filter(citation => citation.cited === true)
    .map(citation => citation.page_url)
    .filter(Boolean)
);
```

## Additional Fix - Empty Prompt Row

### Issue
After the initial fix, there was still one row (row 12) with an empty prompt column. This occurred when:
- A response existed in the database without a valid `prompt_id`
- Or the prompt was deleted but responses still reference it
- Or the join to the `prompts` table failed

### Solution
Added filtering to exclude rows where the prompt text is empty:

```typescript
.filter(row => row.prompt.trim() !== ''); // Exclude rows with empty prompts
```

This ensures only valid prompts with text are included in the export.

## Impact

- **Data Quality**: Improved - No more duplicates or empty cells
- **Data Integrity**: Only valid prompts are exported
- **User Experience**: Better - Cleaner exports that are easier to analyze
- **Performance**: Slightly better - Fewer rows to process
- **Backward Compatibility**: Maintained - Same columns and data format

## Root Cause Analysis

The empty prompt row could come from:
1. **Orphaned responses**: LLM responses that reference a deleted prompt
2. **Data integrity issue**: Missing join relationship between `llm_responses` and `prompts`
3. **Null prompt_id**: Responses created without a proper prompt association

The filter prevents these edge cases from appearing in exports.

---

**Fixed**: 2026-02-25
**File Modified**: `src/pages/ProjectDetailPage.tsx`
**Lines Changed**: 1790-1892
