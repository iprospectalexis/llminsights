# Fix for Stuck Audits Issue

## Problem Identified (March 12, 2026)

Audits were getting stuck in "running" status even when all LLM responses were received and processed.

### Specific Case: DRHAT Projects

**Affected audits:**
- `DRHAT - Visibilité 1/2`: 210/210 responses, 973 citations, but stuck at 25% progress
- `DRHAT - Visibilité 2/2`: 180/180 responses, 1144 citations, but stuck at 25% progress

## Root Cause Analysis

### The Issue

The trigger `llm_responses_activity_update` was only configured to fire on **INSERT** events, not **UPDATE** events.

**Timeline of what happens:**

1. ✅ Audit starts → creates llm_responses with `job_id` → **INSERT** trigger fires → `last_activity_at` updated
2. ⏳ OneSearch processes the job asynchronously
3. ✅ OneSearch webhook receives results → **UPDATES** llm_responses with `answer_text`, `citations`, etc.
4. ❌ **UPDATE** trigger does NOT exist → `last_activity_at` NOT updated
5. ❌ `last_activity_at` remains at the initial INSERT timestamp (e.g., 9 seconds after audit start)
6. ❌ Recovery function checks `last_activity_at > NOW() - 2 hours`
7. ❌ After 2 hours, audit is incorrectly marked as "dead" and skipped by recovery

### Why This Matters

The `recover_stuck_audits()` function (line 146 in migration `20260312110409`) requires:
```sql
WHERE a.last_activity_at > NOW() - INTERVAL '2 hours' -- But not completely dead
```

Without updating `last_activity_at` on webhook UPDATEs, the recovery function couldn't distinguish between:
- **Active audits**: Waiting for webhook to complete processing
- **Dead audits**: No activity for 2+ hours due to real failures

## The Solution

### Created Two Separate Triggers

PostgreSQL doesn't support transition tables (`REFERENCING NEW TABLE AS`) with multiple events in a single trigger.

**Solution:** Create two STATEMENT-level triggers:

1. **`llm_responses_activity_insert`** - Fires on INSERT events
2. **`llm_responses_activity_update`** - Fires on UPDATE events

Both triggers call similar functions that update `last_activity_at` for affected audits.

### Migration Applied

File: `fix_last_activity_with_two_triggers.sql`

```sql
-- Function for INSERT events
CREATE FUNCTION update_audit_activity_on_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE audits
  SET last_activity_at = now()
  WHERE id IN (
    SELECT DISTINCT audit_id
    FROM new_table
    WHERE audit_id IS NOT NULL
  );

  RETURN NULL;
END;
$$;

-- Function for UPDATE events
CREATE FUNCTION update_audit_activity_on_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE audits
  SET last_activity_at = now()
  WHERE id IN (
    SELECT DISTINCT audit_id
    FROM new_table
    WHERE audit_id IS NOT NULL
  );

  RETURN NULL;
END;
$$;

-- Trigger for INSERT
CREATE TRIGGER llm_responses_activity_insert
  AFTER INSERT ON llm_responses
  REFERENCING NEW TABLE AS new_table
  FOR EACH STATEMENT
  EXECUTE FUNCTION update_audit_activity_on_insert();

-- Trigger for UPDATE
CREATE TRIGGER llm_responses_activity_update
  AFTER UPDATE ON llm_responses
  REFERENCING NEW TABLE AS new_table
  FOR EACH STATEMENT
  EXECUTE FUNCTION update_audit_activity_on_update();
```

## Recovery Actions Taken

### 1. Fixed Currently Stuck Audits

Manually completed the two stuck DRHAT audits:

```sql
UPDATE audits
SET
  status = 'completed',
  current_step = NULL,
  finished_at = NOW(),
  progress = 100,
  last_activity_at = NOW()
WHERE id IN (
  '59a6d90a-889a-41c8-912b-efc109574454', -- DRHAT - Visibilité 1/2
  '66fe2293-66b2-486b-82c3-d98a323f2d66'  -- DRHAT - Visibilité 2/2
);
```

**Results:**
- ✅ DRHAT - Visibilité 1/2: 210 responses, 973 citations, 443 domains
- ✅ DRHAT - Visibilité 2/2: 180 responses, 1144 citations, 356 domains

### 2. Synced Domains

Extracted domains from citations:

```sql
SELECT sync_domains_from_citations(p.id)
FROM projects p
WHERE p.name ILIKE '%DRHAT%';
```

**Results:**
- DRHAT - Démo: 1,146 domains
- DRHAT - Perception: 283 domains
- DRHAT - Visibilité: 463 domains
- DRHAT - Visibilité 1/2: 443 domains
- DRHAT - Visibilité 2/2: 356 domains

## Prevention for Future Audits

### Automatic Recovery

The fix ensures that:

1. **Webhook UPDATEs now update `last_activity_at`**
   - Every time webhook updates llm_responses, audit activity timestamp refreshes
   - Recovery function can properly track audit activity

2. **Recovery function works correctly**
   - Can distinguish active audits (recent `last_activity_at`) from dead ones
   - Audits with complete data are auto-recovered

3. **Cron job continues to run**
   - `recover-stuck-audits-job` runs every minute
   - Automatically completes audits when all responses received

### Monitoring

Check for stuck audits:

```sql
-- Find potentially stuck audits
SELECT
  p.name as project_name,
  a.id,
  a.status,
  a.progress,
  a.current_step,
  a.created_at,
  a.last_activity_at,
  NOW() - a.last_activity_at as time_since_activity,
  (SELECT COUNT(*) FROM llm_responses WHERE audit_id = a.id) as responses,
  (SELECT COUNT(*) FROM prompts WHERE project_id = a.project_id) * array_length(a.llms, 1) as expected_responses
FROM audits a
JOIN projects p ON a.project_id = p.id
WHERE a.status = 'running'
  AND a.created_at < NOW() - INTERVAL '30 minutes'
ORDER BY a.created_at DESC;
```

### Manual Recovery (if needed)

If audits get stuck again:

```sql
-- Complete stuck audits that have all responses
WITH ready_audits AS (
  SELECT
    a.id,
    (SELECT COUNT(*) FROM prompts WHERE project_id = a.project_id) as total_prompts,
    array_length(a.llms, 1) as llm_count,
    (SELECT COUNT(*) FROM llm_responses WHERE audit_id = a.id) as response_count
  FROM audits a
  WHERE a.status = 'running'
    AND (SELECT COUNT(*) FROM llm_responses WHERE audit_id = a.id) >=
        (SELECT COUNT(*) FROM prompts WHERE project_id = a.project_id) * array_length(a.llms, 1)
)
UPDATE audits a
SET
  status = 'completed',
  current_step = NULL,
  finished_at = NOW(),
  progress = 100,
  last_activity_at = NOW()
FROM ready_audits ra
WHERE a.id = ra.id
RETURNING a.id, a.progress;
```

## Technical Details

### Why STATEMENT-level Triggers?

- **Performance**: Single UPDATE query instead of one per row
- **Efficiency**: Processes all affected rows in batch
- **Lower CPU**: Reduces trigger overhead significantly

### Why Two Triggers?

PostgreSQL limitation: Cannot use `REFERENCING NEW TABLE AS` with multiple events (`INSERT OR UPDATE`).

Error if attempted:
```
ERROR: transition tables cannot be specified for triggers with more than one event
```

Solution: Create separate triggers for each event type, both using transition tables.

## Verification

Verify triggers are active:

```sql
SELECT
  t.tgname as trigger_name,
  CASE t.tgtype & 1 WHEN 1 THEN 'ROW' ELSE 'STATEMENT' END as trigger_level,
  CASE
    WHEN (t.tgtype & 4) > 0 THEN 'INSERT'
    WHEN (t.tgtype & 16) > 0 THEN 'UPDATE'
    ELSE 'OTHER'
  END as events,
  p.proname as function_name
FROM pg_trigger t
JOIN pg_class c ON t.tgrelid = c.oid
JOIN pg_namespace n ON c.relnamespace = n.oid
JOIN pg_proc p ON t.tgfoid = p.oid
WHERE n.nspname = 'public'
  AND c.relname = 'llm_responses'
  AND t.tgname LIKE '%activity%'
  AND NOT t.tgisinternal;
```

**Expected result:**
```
llm_responses_activity_insert | STATEMENT | INSERT | update_audit_activity_on_insert
llm_responses_activity_update | STATEMENT | UPDATE | update_audit_activity_on_update
```

## Impact

✅ **Fixed:** Audits no longer get stuck waiting for webhook processing
✅ **Fixed:** Recovery function can properly identify active vs dead audits
✅ **Fixed:** `last_activity_at` updates on both INSERT and UPDATE
✅ **Improved:** Better audit lifecycle management
✅ **Improved:** Automatic recovery for legitimate stuck audits

## Related Files

- Migration: `supabase/migrations/fix_last_activity_with_two_triggers.sql`
- Webhook: `supabase/functions/onesearch-webhook/index.ts`
- Recovery Function: Defined in `20260312110409_fix_audit_completion_with_fallback_and_recovery.sql`
