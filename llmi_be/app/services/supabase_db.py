"""
Direct async PostgreSQL access to Supabase tables.

Uses the same SQLAlchemy async engine from database.py (connection-pooled).
All queries use raw SQL via sqlalchemy.text() — no ORM models needed for
Supabase tables (audits, llm_responses, citations, etc.).
"""

import json
import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import AsyncSessionLocal

logger = logging.getLogger(__name__)


# Columns known to be jsonb (not text[])
_JSONB_COLUMNS = {
    "raw_response_data", "answer_competitors", "provider_config",
    "metadata", "config", "settings", "extra",
    "citations", "all_sources", "links_attached",
}

# Columns that are text[] (PostgreSQL arrays) — pass as native Python lists
_TEXT_ARRAY_COLUMNS = {"llms"}


def _serialize_value(v: Any, col: str = "") -> Any:
    """Convert Python values to asyncpg-compatible types."""
    if isinstance(v, dict):
        return json.dumps(v)  # dicts → JSON string for jsonb columns
    if isinstance(v, list):
        if col in _TEXT_ARRAY_COLUMNS:
            return v  # text[] columns: pass native Python list (asyncpg handles it)
        return json.dumps(v)  # ALL other lists → JSON string (safe default)
    return v


def _needs_jsonb_cast(v: Any, col: str) -> bool:
    """Check if a value needs CAST to jsonb."""
    return isinstance(v, dict) or (isinstance(v, list) and col not in _TEXT_ARRAY_COLUMNS)


def _build_insert(table: str, data: dict, returning: bool = True) -> tuple[str, dict]:
    """Build INSERT with type casts for jsonb columns."""
    cols = []
    placeholders = []
    params = {}
    for k, v in data.items():
        cols.append(k)
        sv = _serialize_value(v, k)
        params[k] = sv
        if _needs_jsonb_cast(v, k):
            placeholders.append(f"CAST(:{k} AS jsonb)")
        else:
            placeholders.append(f":{k}")
    sql = f"INSERT INTO {table} ({', '.join(cols)}) VALUES ({', '.join(placeholders)})"
    if returning:
        sql += " RETURNING *"
    return sql, params


class SupabaseDB:
    """Thin wrapper for async queries against Supabase PostgreSQL tables."""

    async def _session(self) -> AsyncSession:
        return AsyncSessionLocal()

    # ── Generic helpers ─────────────────────────────────────────────

    async def execute_scalar(self, sql: str, params: dict | None = None):
        """Run a SQL query and return the first column of the first row."""
        async with AsyncSessionLocal() as s:
            result = await s.execute(text(sql), params or {})
            row = result.first()
            return row[0] if row else None

    # ── Audits ────────────────────────────────────────────────────────

    async def get_audit(self, audit_id: str) -> Optional[dict]:
        async with AsyncSessionLocal() as s:
            row = (await s.execute(
                text("SELECT * FROM audits WHERE id = :id"),
                {"id": audit_id},
            )).mappings().first()
            return dict(row) if row else None

    async def create_audit(self, data: dict) -> dict:
        sql, params = _build_insert("audits", data)
        async with AsyncSessionLocal() as s:
            row = (await s.execute(text(sql), params)).mappings().first()
            await s.commit()
            return dict(row)

    async def update_audit(self, audit_id: str, data: dict, filters: Optional[dict] = None) -> None:
        parts = []
        params = {"id": audit_id}
        for k, v in data.items():
            sv = _serialize_value(v, k)
            params[k] = sv
            if _needs_jsonb_cast(v, k):
                parts.append(f"{k} = CAST(:{k} AS jsonb)")
            else:
                parts.append(f"{k} = :{k}")
        set_clause = ", ".join(parts)
        where = "id = :id"
        if filters:
            for fk, fv in filters.items():
                param_name = f"f_{fk}"
                where += f" AND {fk} = :{param_name}"
                params[param_name] = fv
        async with AsyncSessionLocal() as s:
            await s.execute(text(f"UPDATE audits SET {set_clause} WHERE {where}"), params)
            await s.commit()

    async def get_running_audits(self) -> list[dict]:
        async with AsyncSessionLocal() as s:
            rows = (await s.execute(
                text("SELECT id FROM audits WHERE status = 'running' ORDER BY started_at ASC"),
            )).mappings().all()
            return [dict(r) for r in rows]

    # ── Audit steps ───────────────────────────────────────────────────

    async def insert_audit_steps(self, steps: list[dict]) -> None:
        async with AsyncSessionLocal() as s:
            for step in steps:
                cols = ", ".join(step.keys())
                placeholders = ", ".join(f":{k}" for k in step.keys())
                await s.execute(text(f"INSERT INTO audit_steps ({cols}) VALUES ({placeholders})"), step)
            await s.commit()

    async def update_audit_step(self, audit_id: str, step: str, data: dict,
                                status_filter: Optional[str] = None) -> None:
        set_clause = ", ".join(f"{k} = :{k}" for k in data.keys())
        params = {**data, "audit_id": audit_id, "step": step}
        where = "audit_id = :audit_id AND step = :step"
        if status_filter:
            where += " AND status = :status_filter"
            params["status_filter"] = status_filter
        async with AsyncSessionLocal() as s:
            await s.execute(text(f"UPDATE audit_steps SET {set_clause} WHERE {where}"), params)
            await s.commit()

    async def get_audit_step(self, audit_id: str, step: str) -> Optional[dict]:
        async with AsyncSessionLocal() as s:
            row = (await s.execute(
                text("SELECT * FROM audit_steps WHERE audit_id = :audit_id AND step = :step"),
                {"audit_id": audit_id, "step": step},
            )).mappings().first()
            return dict(row) if row else None

    # ── Projects & prompts ────────────────────────────────────────────

    async def get_project_with_prompts(self, project_id: str) -> Optional[dict]:
        async with AsyncSessionLocal() as s:
            proj = (await s.execute(
                text("SELECT * FROM projects WHERE id = :id"),
                {"id": project_id},
            )).mappings().first()
            if not proj:
                return None
            project = dict(proj)
            prompts = (await s.execute(
                text("SELECT * FROM prompts WHERE project_id = :pid"),
                {"pid": project_id},
            )).mappings().all()
            project["prompts"] = [dict(p) for p in prompts]
            return project

    async def get_prompt_texts(self, prompt_ids: list[str]) -> dict[str, str]:
        if not prompt_ids:
            return {}
        async with AsyncSessionLocal() as s:
            rows = (await s.execute(
                text("SELECT id, prompt_text FROM prompts WHERE id = ANY(:ids)"),
                {"ids": prompt_ids},
            )).mappings().all()
            return {str(r["id"]): r["prompt_text"] for r in rows}

    # ── LLM data provider settings ────────────────────────────────────

    async def get_llm_provider_settings(self, llm_names: list[str]) -> list[dict]:
        async with AsyncSessionLocal() as s:
            rows = (await s.execute(
                text("SELECT llm_name, data_provider, provider_config FROM llm_data_provider_settings WHERE llm_name = ANY(:names)"),
                {"names": llm_names},
            )).mappings().all()
            return [dict(r) for r in rows]

    # ── LLM responses ─────────────────────────────────────────────────

    async def insert_llm_responses_chunked(self, responses: list[dict], chunk_size: int = 50) -> None:
        """Insert llm_responses in chunks to avoid overwhelming the DB."""
        if not responses:
            return
        async with AsyncSessionLocal() as s:
            for i in range(0, len(responses), chunk_size):
                chunk = responses[i:i + chunk_size]
                for row in chunk:
                    sql, params = _build_insert("llm_responses", row, returning=False)
                    await s.execute(text(sql), params)
                await s.commit()
                logger.info(f"Inserted chunk {i // chunk_size + 1} ({len(chunk)} rows)")

    async def get_pending_responses(self, audit_id: str, limit: int = 100,
                                     llm_filter: Optional[str] = None) -> list[dict]:
        """LEGACY: kept for any non-pipeline caller. New code should use
        `get_active_pending_responses` which honours the per-row poll state."""
        where = "audit_id = :audit_id AND answer_text IS NULL AND raw_response_data IS NULL"
        params: dict[str, Any] = {"audit_id": audit_id, "lim": limit}
        if llm_filter:
            where += " AND llm = :llm"
            params["llm"] = llm_filter
        async with AsyncSessionLocal() as s:
            rows = (await s.execute(
                text(f"SELECT * FROM llm_responses WHERE {where} LIMIT :lim"),
                params,
            )).mappings().all()
            return [dict(r) for r in rows]

    async def get_active_pending_responses(
        self,
        audit_id: str,
        min_interval_seconds: int = 5,
        limit: int = 200,
    ) -> list[dict]:
        """Rows that need polling: no data yet AND not terminal AND not polled
        too recently. Used by the pipeline polling handler.

        The cutoff is computed in Python and passed as a real `timestamptz`
        bind — `make_interval(secs => :n)` was the only untested SQL idiom
        left in this helper after the post-mortem of the
        `CAST(:ids AS uuid[])` crash, so we just remove the risk entirely.
        """
        cutoff = datetime.now(timezone.utc) - timedelta(seconds=min_interval_seconds)
        async with AsyncSessionLocal() as s:
            rows = (await s.execute(
                text("""
                    SELECT *
                    FROM llm_responses
                    WHERE audit_id = :audit_id
                      AND answer_text IS NULL
                      AND raw_response_data IS NULL
                      AND poll_terminal_reason IS NULL
                      AND (last_polled_at IS NULL OR last_polled_at < :cutoff)
                    ORDER BY first_polled_at NULLS FIRST, id
                    LIMIT :lim
                """),
                {"audit_id": audit_id, "cutoff": cutoff, "lim": limit},
            )).mappings().all()
            return [dict(r) for r in rows]

    async def mark_polling_attempt(self, row_ids: list[str]) -> None:
        """Increment poll_attempts and stamp first/last_polled_at.

        NB: uses `ANY(:ids)` (no CAST). asyncpg+SQLAlchemy `text()` cannot
        bind a Python list inside `CAST(:ids AS uuid[])` — that idiom was
        the root cause of the polling-stuck incident on 2026-04-08, where
        every tick crashed silently inside `mark_polling_terminal` and the
        audit sat in `polling` for 40 minutes. The proven pattern is plain
        `ANY(:ids)`, which is what `get_prompt_texts` already uses.
        """
        if not row_ids:
            return
        async with AsyncSessionLocal() as s:
            await s.execute(
                text("""
                    UPDATE llm_responses
                    SET poll_attempts   = poll_attempts + 1,
                        first_polled_at = COALESCE(first_polled_at, now()),
                        last_polled_at  = now()
                    WHERE id = ANY(:ids)
                """),
                {"ids": list(row_ids)},
            )
            await s.commit()

    async def mark_polling_terminal(self, row_ids: list[str], reason: str) -> int:
        """Mark rows as terminally failed at polling. Returns rows updated.

        Only touches `poll_terminal_reason` + `last_polled_at`. Does NOT
        write anything into `raw_response_data`.

        History: until 2026-04-08 this helper ALSO wrote a
        `{'error': reason, 'failed_at': now()}` sentinel into
        `raw_response_data` (COALESCE-guarded, so it never clobbered real
        data). The stated reason was that a legacy `get_pending_responses`
        helper defined the "pending" set as `answer_text IS NULL AND
        raw_response_data IS NULL`, and without the sentinel terminal rows
        would stay in that set forever. But grep confirms that legacy
        helper has zero callers — every live path (`get_polling_status`,
        `get_active_pending_responses`) already filters on
        `poll_terminal_reason IS NULL`, so the sentinel was pure
        landmine: after a premature `polling_timeout` sweep, there was
        no way to recover the row by re-fetching from the provider,
        because something that looked like a response was already there.
        Dropping the sentinel makes recovery from a false-positive sweep
        a simple `UPDATE llm_responses SET poll_terminal_reason = NULL`.

        See `mark_polling_attempt` for the `ANY(:ids)` rationale.
        """
        if not row_ids:
            return 0
        async with AsyncSessionLocal() as s:
            result = await s.execute(
                text("""
                    UPDATE llm_responses
                    SET poll_terminal_reason = :reason,
                        last_polled_at       = now()
                    WHERE id = ANY(:ids)
                    RETURNING id
                """),
                {"reason": reason, "ids": list(row_ids)},
            )
            updated = len(result.fetchall())
            await s.commit()
            return updated

    async def get_polling_status(self, audit_id: str) -> dict:
        """Single-row health summary for an audit's polling progress.

        Used by `handle_polling` as the source of truth for total/received/
        active_pending/terminal — replaces the in-Python counter loop.
        """
        async with AsyncSessionLocal() as s:
            row = (await s.execute(
                text("""
                    SELECT
                      count(*)                                                                    AS total,
                      -- "received" = row has left the pending set for ANY reason
                      -- (real data, raw provider dump, or terminal failure). This
                      -- also counts terminal rows so the progress bar keeps
                      -- moving instead of freezing when the provider drops some
                      -- rows — the separate `terminal` column below still lets
                      -- the caller distinguish successes from drops.
                      count(*) FILTER (
                        WHERE answer_text IS NOT NULL
                           OR raw_response_data IS NOT NULL
                           OR poll_terminal_reason IS NOT NULL
                      )                                                                           AS received,
                      count(*) FILTER (
                        WHERE answer_text IS NULL
                          AND raw_response_data IS NULL
                          AND poll_terminal_reason IS NULL
                      )                                                                           AS active_pending,
                      count(*) FILTER (WHERE poll_terminal_reason IS NOT NULL)                    AS terminal,
                      COALESCE(max(poll_attempts), 0)                                             AS max_attempts
                    FROM llm_responses
                    WHERE audit_id = :aid
                """),
                {"aid": audit_id},
            )).mappings().first()
            return dict(row) if row else {
                "total": 0, "received": 0, "active_pending": 0,
                "terminal": 0, "max_attempts": 0,
            }

    async def insert_pipeline_log(
        self,
        audit_id: str,
        state: str,
        phase: str,
        message: str,
        level: str = "error",
    ) -> None:
        """Append one row to `audit_pipeline_log` — insert-only crash journal.

        Catches its own exceptions: this is the LAST line of defense in the
        observability chain, so it must never raise back into the caller's
        except block (which would mask the original error). If even this
        insert fails we log a warning and move on — the original exception
        in `handle_polling` / `process_step` is still propagated upstream.
        """
        try:
            async with AsyncSessionLocal() as s:
                await s.execute(
                    text("""
                        INSERT INTO audit_pipeline_log
                            (audit_id, state, phase, level, message)
                        VALUES (:aid, :state, :phase, :level, :message)
                    """),
                    {
                        "aid": audit_id,
                        "state": state,
                        "phase": phase,
                        "level": level,
                        "message": (message or "")[:1000],
                    },
                )
                await s.commit()
        except Exception as e:
            logger.error(f"[pipeline_log] insert failed for {audit_id}: {e}")

    async def upsert_llm_responses(self, updates: list[dict]) -> None:
        """Batch upsert llm_responses by id.

        Groups rows by their column set, then uses UPDATE … FROM VALUES
        for each group. Falls back to per-row UPDATE for groups with
        jsonb columns that need casting.

        Treats `updates` as read-only.
        """
        if not updates:
            return

        # Group by column set so we can batch rows with identical shapes
        from collections import defaultdict
        groups: dict[frozenset[str], list[dict]] = defaultdict(list)
        for original in updates:
            u = dict(original)
            uid = u.pop("id", None)
            if not uid:
                continue
            u["id"] = uid  # keep id in the dict for batching
            cols = frozenset(k for k in u if k != "id")
            groups[cols].append(u)

        CHUNK = 50
        async with AsyncSessionLocal() as s:
            for cols_set, rows in groups.items():
                cols = sorted(cols_set)
                # Check if any column needs jsonb cast (use first row as representative)
                sample = rows[0]
                has_jsonb = any(_needs_jsonb_cast(sample.get(c), c) for c in cols)

                if has_jsonb:
                    # Jsonb columns need per-row CAST — batch is harder, use small-batch approach
                    for row in rows:
                        parts = []
                        params: dict[str, Any] = {"id": row["id"]}
                        for k in cols:
                            sv = _serialize_value(row[k], k)
                            params[k] = sv
                            if _needs_jsonb_cast(row[k], k):
                                parts.append(f"{k} = CAST(:{k} AS jsonb)")
                            else:
                                parts.append(f"{k} = :{k}")
                        set_clause = ", ".join(parts)
                        await s.execute(
                            text(f"UPDATE llm_responses SET {set_clause} WHERE id = :id"),
                            params,
                        )
                else:
                    # Pure scalar columns — use UPDATE … FROM VALUES
                    for i in range(0, len(rows), CHUNK):
                        chunk = rows[i : i + CHUNK]
                        # Build VALUES list with typed casts
                        v_cols = ["id"] + cols
                        values_parts = []
                        params = {}
                        for j, row in enumerate(chunk):
                            ph = [f"CAST(:id_{j} AS uuid)"]
                            params[f"id_{j}"] = row["id"]
                            for c in cols:
                                sv = _serialize_value(row[c], c)
                                params[f"{c}_{j}"] = sv
                                ph.append(f":{c}_{j}")
                            values_parts.append(f"({', '.join(ph)})")
                        set_clause = ", ".join(f"{c} = v.{c}" for c in cols)
                        v_col_list = ", ".join(v_cols)
                        sql = f"""
                            UPDATE llm_responses SET {set_clause}
                            FROM (VALUES {', '.join(values_parts)}) AS v({v_col_list})
                            WHERE llm_responses.id = v.id
                        """
                        await s.execute(text(sql), params)
            await s.commit()

    async def get_all_responses_for_audit(self, audit_id: str) -> list[dict]:
        async with AsyncSessionLocal() as s:
            rows = (await s.execute(
                text("SELECT id, answer_text, raw_response_data FROM llm_responses WHERE audit_id = :aid"),
                {"aid": audit_id},
            )).mappings().all()
            return [dict(r) for r in rows]

    async def get_responses_for_competitors(self, audit_id: str) -> list[dict]:
        """Get responses that need competitor extraction.

        Rows with an error sentinel are retried up to 3 times (tracked via
        the ``_retry`` counter inside the JSONB). After 3 failures the row is
        left as-is and excluded from future processing.
        """
        async with AsyncSessionLocal() as s:
            rows = (await s.execute(
                text("""
                    SELECT lr.id, lr.answer_text, lr.answer_competitors, p.prompt_text
                    FROM llm_responses lr
                    JOIN prompts p ON lr.prompt_id = p.id
                    WHERE lr.audit_id = :aid
                      AND lr.answer_text IS NOT NULL
                      AND (lr.answer_competitors IS NULL
                           OR lr.answer_competitors = '{"brands": []}'::jsonb
                           OR (lr.answer_competitors ? 'error'
                               AND COALESCE(
                                   (lr.answer_competitors->>'_retry')::int, 0
                               ) < 3))
                """),
                {"aid": audit_id},
            )).mappings().all()
            return [dict(r) for r in rows]

    async def update_competitors_batch(self, updates: list[dict]) -> None:
        """Batch-update answer_competitors using UPDATE … FROM VALUES."""
        if not updates:
            return
        CHUNK = 100
        async with AsyncSessionLocal() as s:
            for i in range(0, len(updates), CHUNK):
                chunk = updates[i : i + CHUNK]
                values_parts = []
                params: dict[str, Any] = {}
                for j, u in enumerate(chunk):
                    values_parts.append(f"(CAST(:id_{j} AS uuid), CAST(:comp_{j} AS jsonb))")
                    params[f"id_{j}"] = u["id"]
                    params[f"comp_{j}"] = _serialize_value(u["competitors"])
                sql = f"""
                    UPDATE llm_responses SET
                      answer_competitors = v.competitors
                    FROM (VALUES {', '.join(values_parts)}) AS v(id, competitors)
                    WHERE llm_responses.id = v.id
                """
                await s.execute(text(sql), params)
            await s.commit()

    async def get_responses_for_sentiment(self, audit_id: str) -> list[dict]:
        """Get responses that need sentiment analysis (legacy, single-row)."""
        async with AsyncSessionLocal() as s:
            rows = (await s.execute(
                text("""
                    SELECT * FROM llm_responses
                    WHERE audit_id = :aid
                      AND answer_text IS NOT NULL
                      AND sentiment_score IS NULL
                """),
                {"aid": audit_id},
            )).mappings().all()
            return [dict(r) for r in rows]

    async def update_sentiment_batch(self, updates: list[dict]) -> None:
        """Batch-update legacy sentiment columns using UPDATE … FROM VALUES."""
        if not updates:
            return
        CHUNK = 200
        async with AsyncSessionLocal() as s:
            for i in range(0, len(updates), CHUNK):
                chunk = updates[i : i + CHUNK]
                values_parts = []
                params: dict[str, Any] = {}
                for j, u in enumerate(chunk):
                    values_parts.append(f"(CAST(:id_{j} AS uuid), CAST(:score_{j} AS numeric), CAST(:label_{j} AS text))")
                    params[f"id_{j}"] = u["id"]
                    params[f"score_{j}"] = u["score"]
                    params[f"label_{j}"] = u["label"]
                sql = f"""
                    UPDATE llm_responses SET
                      sentiment_score = v.score,
                      sentiment_label = v.label
                    FROM (VALUES {', '.join(values_parts)}) AS v(id, score, label)
                    WHERE llm_responses.id = v.id
                """
                await s.execute(text(sql), params)
            await s.commit()

    # ── Sentiment V2 ──────────────────────────────────────────────────

    async def get_responses_for_sentiment_v2(self, audit_id: str) -> list[dict]:
        """
        Get responses that still need V2 sentiment analysis.
        Idempotent: skips responses that already have any row in
        response_brand_sentiment for this audit, so a crashed batch
        resumes cleanly on the next pipeline tick.
        """
        async with AsyncSessionLocal() as s:
            rows = (await s.execute(
                text("""
                    SELECT lr.id, lr.audit_id, lr.llm, lr.answer_text, p.prompt_text
                    FROM llm_responses lr
                    JOIN prompts p ON lr.prompt_id = p.id
                    WHERE lr.audit_id = :aid
                      AND lr.answer_text IS NOT NULL
                      AND NOT EXISTS (
                          SELECT 1 FROM response_brand_sentiment rbs
                          WHERE rbs.response_id = lr.id
                      )
                """),
                {"aid": audit_id},
            )).mappings().all()
            return [dict(r) for r in rows]

    async def upsert_response_brand_sentiment(self, rows: list[dict]) -> None:
        """Insert per-brand-per-response sentiment rows. ON CONFLICT updates.

        Uses multi-value INSERT in chunks of 100 to avoid N+1 query overhead.
        """
        if not rows:
            return
        _COLS = [
            "response_id", "audit_id", "brand", "brand_kind", "label", "score",
            "confidence", "reasoning", "is_fallback", "model", "prompt_version",
        ]
        CHUNK = 100
        async with AsyncSessionLocal() as s:
            for i in range(0, len(rows), CHUNK):
                chunk = rows[i : i + CHUNK]
                values_parts = []
                params: dict[str, Any] = {}
                for j, r in enumerate(chunk):
                    placeholders = ", ".join(f":{c}_{j}" for c in _COLS)
                    values_parts.append(f"({placeholders})")
                    for c in _COLS:
                        params[f"{c}_{j}"] = r[c]
                sql = f"""
                    INSERT INTO response_brand_sentiment
                      ({', '.join(_COLS)})
                    VALUES {', '.join(values_parts)}
                    ON CONFLICT (response_id, brand) DO UPDATE SET
                      brand_kind = EXCLUDED.brand_kind,
                      label = EXCLUDED.label,
                      score = EXCLUDED.score,
                      confidence = EXCLUDED.confidence,
                      reasoning = EXCLUDED.reasoning,
                      is_fallback = EXCLUDED.is_fallback,
                      model = EXCLUDED.model,
                      prompt_version = EXCLUDED.prompt_version
                """
                await s.execute(text(sql), params)
            await s.commit()

    async def get_brand_specs(self, audit_id: str) -> tuple[list[dict], list[dict]]:
        """
        Return (own_brands, competitor_brands) as lists of dicts:
            [{"name": str, "aliases": list[str]}, ...]
        """
        async with AsyncSessionLocal() as s:
            row = (await s.execute(
                text("SELECT project_id FROM audits WHERE id = :aid"),
                {"aid": audit_id},
            )).mappings().first()
            if not row:
                return [], []
            pid = row["project_id"]
            rows = (await s.execute(
                text("""
                    SELECT brand_name, is_competitor, COALESCE(aliases, '{}') AS aliases
                    FROM brands WHERE project_id = :pid
                """),
                {"pid": pid},
            )).mappings().all()
        own, comp = [], []
        for r in rows:
            spec = {"name": r["brand_name"], "aliases": list(r["aliases"] or [])}
            (comp if r["is_competitor"] else own).append(spec)
        return own, comp

    async def get_sentiment_cache(self, cache_key: str) -> Optional[dict]:
        async with AsyncSessionLocal() as s:
            row = (await s.execute(
                text("SELECT result FROM sentiment_cache WHERE cache_key = :k"),
                {"k": cache_key},
            )).mappings().first()
            if not row:
                return None
            # Bump usage stats (best-effort)
            await s.execute(
                text("""
                    UPDATE sentiment_cache
                    SET hit_count = hit_count + 1, last_used_at = now()
                    WHERE cache_key = :k
                """),
                {"k": cache_key},
            )
            await s.commit()
            return row["result"] if isinstance(row["result"], dict) else json.loads(row["result"])

    async def put_sentiment_cache(self, cache_key: str, result: dict) -> None:
        async with AsyncSessionLocal() as s:
            await s.execute(
                text("""
                    INSERT INTO sentiment_cache (cache_key, result)
                    VALUES (:k, CAST(:r AS jsonb))
                    ON CONFLICT (cache_key) DO UPDATE SET
                      result = EXCLUDED.result, last_used_at = now()
                """),
                {"k": cache_key, "r": json.dumps(result)},
            )
            await s.commit()

    # ── Citations ─────────────────────────────────────────────────────

    async def delete_citations_batch(self, keys: list[dict]) -> None:
        """Batch delete citations — single DELETE with OR conditions instead of N+1."""
        if not keys:
            return
        async with AsyncSessionLocal() as s:
            # Build a single DELETE with OR-ed conditions
            conditions = []
            params = {}
            for i, k in enumerate(keys):
                conditions.append(
                    f"(audit_id = :aid_{i} AND prompt_id = :pid_{i} AND llm = :llm_{i})"
                )
                params[f"aid_{i}"] = k["audit_id"]
                params[f"pid_{i}"] = k["prompt_id"]
                params[f"llm_{i}"] = k["llm"]
            where = " OR ".join(conditions)
            await s.execute(text(f"DELETE FROM citations WHERE {where}"), params)
            await s.commit()

    async def insert_citations_batch(self, citations: list[dict]) -> None:
        """Batch-insert citations using multi-value INSERT, chunks of 100."""
        if not citations:
            return
        _COLS = [
            "audit_id", "prompt_id", "llm", "page_url", "domain",
            "citation_text", "position", "checked_at", "cited",
        ]
        CHUNK = 100
        async with AsyncSessionLocal() as s:
            for i in range(0, len(citations), CHUNK):
                chunk = citations[i : i + CHUNK]
                values_parts = []
                params: dict[str, Any] = {}
                for j, c in enumerate(chunk):
                    placeholders = ", ".join(f":{col}_{j}" for col in _COLS)
                    values_parts.append(f"({placeholders})")
                    for col in _COLS:
                        params[f"{col}_{j}"] = c.get(col)
                sql = f"""
                    INSERT INTO citations ({', '.join(_COLS)})
                    VALUES {', '.join(values_parts)}
                """
                await s.execute(text(sql), params)
            await s.commit()

    # ── Brands ────────────────────────────────────────────────────────

    async def get_own_brands(self, audit_id: str) -> tuple[list[str], Optional[str], Optional[str]]:
        """Get own brand names, project_id, and created_by for an audit."""
        async with AsyncSessionLocal() as s:
            row = (await s.execute(
                text("""
                    SELECT a.id as audit_id, p.id as project_id, p.created_by
                    FROM audits a
                    JOIN projects p ON a.project_id = p.id
                    WHERE a.id = :aid
                """),
                {"aid": audit_id},
            )).mappings().first()
            if not row:
                return [], None, None
            brands_rows = (await s.execute(
                text("SELECT brand_name FROM brands WHERE project_id = :pid AND is_competitor = false"),
                {"pid": row["project_id"]},
            )).mappings().all()
            return [r["brand_name"] for r in brands_rows], str(row["project_id"]), str(row["created_by"])

    async def get_competitor_brands(self, audit_id: str) -> list[str]:
        """Get competitor brand names for the project associated with an audit."""
        async with AsyncSessionLocal() as s:
            row = (await s.execute(
                text("SELECT project_id FROM audits WHERE id = :aid"),
                {"aid": audit_id},
            )).mappings().first()
            if not row:
                return []
            brands_rows = (await s.execute(
                text("SELECT brand_name FROM brands WHERE project_id = :pid AND is_competitor = true"),
                {"pid": row["project_id"]},
            )).mappings().all()
            return [r["brand_name"] for r in brands_rows]

    async def get_project_name(self, audit_id: str) -> Optional[str]:
        """Get the project name for an audit (used as industry context)."""
        async with AsyncSessionLocal() as s:
            row = (await s.execute(
                text("""
                    SELECT p.name FROM audits a
                    JOIN projects p ON a.project_id = p.id
                    WHERE a.id = :aid
                """),
                {"aid": audit_id},
            )).mappings().first()
            return row["name"] if row else None

    # ── Metrics ───────────────────────────────────────────────────────

    async def refresh_audit_metrics(self, audit_id: str) -> None:
        """Queue and trigger metrics refresh via RPC."""
        try:
            async with AsyncSessionLocal() as s:
                await s.execute(
                    text("""
                        INSERT INTO audit_metrics_refresh_queue (audit_id, queued_at)
                        VALUES (:aid, :now)
                        ON CONFLICT (audit_id) DO UPDATE SET queued_at = :now
                    """),
                    {"aid": audit_id, "now": datetime.now(timezone.utc)},
                )
                # Increase statement timeout for MV refresh (default is too low for large tables)
                await s.execute(text("SET LOCAL statement_timeout = '120s'"))
                await s.execute(
                    text("SELECT refresh_audit_metrics(:aid)"),
                    {"aid": audit_id},
                )
                await s.commit()
        except Exception as e:
            logger.warning(f"Failed to refresh metrics for {audit_id}: {e}")

    async def calculate_project_metrics(self, audit_id: str) -> None:
        """Calculate and save project-level metrics."""
        try:
            async with AsyncSessionLocal() as s:
                # Get project info
                audit_row = (await s.execute(
                    text("SELECT project_id FROM audits WHERE id = :aid"),
                    {"aid": audit_id},
                )).mappings().first()
                if not audit_row:
                    return
                project_id = str(audit_row["project_id"])

                # Total prompts & audits
                total_prompts = (await s.execute(
                    text("SELECT count(*) FROM prompts WHERE project_id = :pid"),
                    {"pid": project_id},
                )).scalar() or 0

                total_audits = (await s.execute(
                    text("SELECT count(*) FROM audits WHERE project_id = :pid AND status = 'completed'"),
                    {"pid": project_id},
                )).scalar() or 0

                # Get domain and own brands
                proj = (await s.execute(
                    text("SELECT domain FROM projects WHERE id = :pid"),
                    {"pid": project_id},
                )).mappings().first()

                brands_rows = (await s.execute(
                    text("SELECT brand_name FROM brands WHERE project_id = :pid AND is_competitor = false"),
                    {"pid": project_id},
                )).mappings().all()
                own_brands = [r["brand_name"].lower() for r in brands_rows]

                # Audit IDs
                audit_ids_rows = (await s.execute(
                    text("SELECT id FROM audits WHERE project_id = :pid"),
                    {"pid": project_id},
                )).mappings().all()
                audit_ids = [str(r["id"]) for r in audit_ids_rows]

                # Mention rate
                mention_rate = 0
                if audit_ids and own_brands:
                    lr_rows = (await s.execute(
                        text("""
                            SELECT answer_text, audit_id, prompt_id
                            FROM llm_responses
                            WHERE audit_id = ANY(:aids)
                              AND answer_text IS NOT NULL
                        """),
                        {"aids": audit_ids},
                    )).mappings().all()

                    if lr_rows:
                        unique_prompts = set()
                        prompts_with_mentions = set()
                        for r in lr_rows:
                            key = f"{r['audit_id']}-{r['prompt_id']}"
                            unique_prompts.add(key)
                            answer_lower = (r["answer_text"] or "").lower()
                            if any(b in answer_lower for b in own_brands):
                                prompts_with_mentions.add(key)
                        if unique_prompts:
                            mention_rate = round((len(prompts_with_mentions) / len(unique_prompts)) * 100)

                # Citation rate
                citation_rate = 0
                if audit_ids and proj:
                    project_domain = (proj["domain"] or "").lower().lstrip("www.")
                    if project_domain:
                        cit_rows = (await s.execute(
                            text("""
                                SELECT domain, audit_id, prompt_id, llm
                                FROM citations WHERE audit_id = ANY(:aids) AND domain IS NOT NULL
                            """),
                            {"aids": audit_ids},
                        )).mappings().all()

                        lr_count_rows = (await s.execute(
                            text("SELECT audit_id, prompt_id, llm FROM llm_responses WHERE audit_id = ANY(:aids)"),
                            {"aids": audit_ids},
                        )).mappings().all()

                        if cit_rows and lr_count_rows:
                            cited_keys = set()
                            for c in cit_rows:
                                d = (c["domain"] or "").lower().lstrip("www.")
                                if d == project_domain or d.endswith(f".{project_domain}"):
                                    cited_keys.add(f"{c['audit_id']}-{c['prompt_id']}-{c['llm']}")
                            citation_rate = round((len(cited_keys) / len(lr_count_rows)) * 100)

                # Last audit
                last_audit = (await s.execute(
                    text("""
                        SELECT finished_at FROM audits
                        WHERE project_id = :pid AND status = 'completed'
                        ORDER BY finished_at DESC LIMIT 1
                    """),
                    {"pid": project_id},
                )).scalar()

                # Upsert project_metrics
                now = datetime.now(timezone.utc)
                await s.execute(
                    text("""
                        INSERT INTO project_metrics (project_id, mention_rate, citation_rate, total_prompts, total_audits, last_audit_at, updated_at)
                        VALUES (:pid, :mr, :cr, :tp, :ta, :la, :now)
                        ON CONFLICT (project_id) DO UPDATE SET
                            mention_rate = :mr, citation_rate = :cr, total_prompts = :tp,
                            total_audits = :ta, last_audit_at = :la, updated_at = :now
                    """),
                    {"pid": project_id, "mr": mention_rate, "cr": citation_rate,
                     "tp": total_prompts, "ta": total_audits,
                     "la": last_audit if last_audit else now, "now": now},
                )
                await s.commit()
                logger.info(f"Project metrics saved: mention={mention_rate}% citation={citation_rate}%")
        except Exception as e:
            logger.error(f"Error calculating project metrics: {e}")


# Singleton
db = SupabaseDB()
