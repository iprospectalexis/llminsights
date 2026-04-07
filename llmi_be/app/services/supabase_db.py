"""
Direct async PostgreSQL access to Supabase tables.

Uses the same SQLAlchemy async engine from database.py (connection-pooled).
All queries use raw SQL via sqlalchemy.text() — no ORM models needed for
Supabase tables (audits, llm_responses, citations, etc.).
"""

import json
import logging
from datetime import datetime, timezone
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

    async def upsert_llm_responses(self, updates: list[dict]) -> None:
        """Batch upsert llm_responses by id."""
        if not updates:
            return
        async with AsyncSessionLocal() as s:
            for u in updates:
                uid = u.pop("id", None) or u.get("id")
                if not uid:
                    continue
                parts = []
                params = {"id": uid}
                for k, v in u.items():
                    sv = _serialize_value(v, k)
                    params[k] = sv
                    if _needs_jsonb_cast(v, k):
                        parts.append(f"{k} = CAST(:{k} AS jsonb)")
                    else:
                        parts.append(f"{k} = :{k}")
                set_clause = ", ".join(parts)
                await s.execute(text(f"UPDATE llm_responses SET {set_clause} WHERE id = :id"), params)
            await s.commit()

    async def get_all_responses_for_audit(self, audit_id: str) -> list[dict]:
        async with AsyncSessionLocal() as s:
            rows = (await s.execute(
                text("SELECT id, answer_text, raw_response_data FROM llm_responses WHERE audit_id = :aid"),
                {"aid": audit_id},
            )).mappings().all()
            return [dict(r) for r in rows]

    async def get_responses_for_competitors(self, audit_id: str) -> list[dict]:
        """Get responses that need competitor extraction."""
        async with AsyncSessionLocal() as s:
            rows = (await s.execute(
                text("""
                    SELECT lr.id, lr.answer_text, lr.answer_competitors, p.prompt_text
                    FROM llm_responses lr
                    JOIN prompts p ON lr.prompt_id = p.id
                    WHERE lr.audit_id = :aid
                      AND lr.answer_text IS NOT NULL
                      AND (lr.answer_competitors IS NULL OR lr.answer_competitors = '{"brands": []}'::jsonb)
                """),
                {"aid": audit_id},
            )).mappings().all()
            return [dict(r) for r in rows]

    async def update_competitors_batch(self, updates: list[dict]) -> None:
        """Batch update answer_competitors for multiple responses."""
        if not updates:
            return
        async with AsyncSessionLocal() as s:
            for u in updates:
                comp = _serialize_value(u["competitors"])
                await s.execute(
                    text("UPDATE llm_responses SET answer_competitors = CAST(:competitors AS jsonb) WHERE id = :id"),
                    {"id": u["id"], "competitors": comp},
                )
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
        if not updates:
            return
        async with AsyncSessionLocal() as s:
            for u in updates:
                await s.execute(
                    text("UPDATE llm_responses SET sentiment_score = :score, sentiment_label = :label WHERE id = :id"),
                    u,
                )
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
        """Insert per-brand-per-response sentiment rows. ON CONFLICT updates."""
        if not rows:
            return
        async with AsyncSessionLocal() as s:
            for r in rows:
                await s.execute(
                    text("""
                        INSERT INTO response_brand_sentiment
                          (response_id, audit_id, brand, brand_kind, label, score,
                           confidence, reasoning, is_fallback, model, prompt_version)
                        VALUES
                          (:response_id, :audit_id, :brand, :brand_kind, :label, :score,
                           :confidence, :reasoning, :is_fallback, :model, :prompt_version)
                        ON CONFLICT (response_id, brand) DO UPDATE SET
                          brand_kind = EXCLUDED.brand_kind,
                          label = EXCLUDED.label,
                          score = EXCLUDED.score,
                          confidence = EXCLUDED.confidence,
                          reasoning = EXCLUDED.reasoning,
                          is_fallback = EXCLUDED.is_fallback,
                          model = EXCLUDED.model,
                          prompt_version = EXCLUDED.prompt_version
                    """),
                    r,
                )
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
        if not citations:
            return
        async with AsyncSessionLocal() as s:
            for c in citations:
                sql, params = _build_insert("citations", c, returning=False)
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
