"""
Cost tracker — records every external API call (OpenAI chat completions and
scrape jobs) into `api_usage_events` with the cost computed at write time
from the latest `api_pricing_rates`.

Designed to be **best-effort**: any failure here is logged and swallowed so a
pricing/DB hiccup never breaks an audit. Tarif lookups are cached in process
memory for 5 minutes to avoid an extra SELECT per API call.
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from typing import Any, Optional

from sqlalchemy import text

from app.database import AsyncSessionLocal

logger = logging.getLogger(__name__)

# (provider, model, operation) -> {unit: unit_cost_usd}
_RATES_CACHE: dict[tuple[str, str | None, str], dict[str, float]] = {}
_RATES_CACHE_AT: dict[tuple[str, str | None, str], float] = {}
_RATES_TTL_SECONDS = 300  # 5 min
_RATES_LOCK = asyncio.Lock()


async def _get_rates(provider: str, model: str | None, operation: str) -> dict[str, float]:
    key = (provider, model, operation)
    now = time.monotonic()
    cached = _RATES_CACHE.get(key)
    if cached is not None and (now - _RATES_CACHE_AT.get(key, 0)) < _RATES_TTL_SECONDS:
        return cached

    async with _RATES_LOCK:
        # Double-check after acquiring the lock
        cached = _RATES_CACHE.get(key)
        if cached is not None and (now - _RATES_CACHE_AT.get(key, 0)) < _RATES_TTL_SECONDS:
            return cached

        async with AsyncSessionLocal() as s:
            rows = (await s.execute(
                text(
                    """
                    SELECT DISTINCT ON (unit) unit, unit_cost_usd
                    FROM api_pricing_rates
                    WHERE provider = :provider
                      AND operation = :operation
                      AND (model = :model OR (model IS NULL AND :model IS NULL))
                      AND effective_from <= now()
                    ORDER BY unit, effective_from DESC
                    """
                ),
                {"provider": provider, "operation": operation, "model": model},
            )).mappings().all()

        rates = {r["unit"]: float(r["unit_cost_usd"]) for r in rows}
        _RATES_CACHE[key] = rates
        _RATES_CACHE_AT[key] = now
        return rates


async def _insert_event(**fields: Any) -> None:
    """Insert one row into api_usage_events (best-effort)."""
    metadata = fields.pop("metadata", None)
    if metadata is not None and not isinstance(metadata, str):
        metadata = json.dumps(metadata)

    cols = ", ".join(fields.keys()) + (", metadata" if metadata is not None else "")
    placeholders = ", ".join(f":{k}" for k in fields.keys()) + (", :metadata" if metadata is not None else "")
    params = dict(fields)
    if metadata is not None:
        params["metadata"] = metadata

    sql = f"INSERT INTO api_usage_events ({cols}) VALUES ({placeholders})"

    try:
        async with AsyncSessionLocal() as s:
            await s.execute(text(sql), params)
            await s.commit()
    except Exception as e:
        logger.warning(f"cost_tracker: failed to insert usage event: {e}")


def _ctx_value(ctx: dict | None, key: str) -> Any:
    if not ctx:
        return None
    return ctx.get(key)


async def record_openai_call(
    *,
    ctx: dict | None,
    model: str,
    operation: str,
    usage: Any,
    metadata: dict | None = None,
) -> None:
    """
    Persist an OpenAI chat completion event.

    `usage` is the `resp.usage` object from the OpenAI Python SDK
    (CompletionUsage). `ctx` carries audit_id / project_id / user_id from the
    caller (audit_pipeline). When ctx is None we still record the event with
    nullable foreign keys so that ad-hoc/manual calls aren't lost.
    """
    if usage is None:
        return

    try:
        prompt_tokens = int(getattr(usage, "prompt_tokens", 0) or 0)
        completion_tokens = int(getattr(usage, "completion_tokens", 0) or 0)
    except Exception:
        return

    cached_tokens = None
    reasoning_tokens = None
    try:
        details = getattr(usage, "prompt_tokens_details", None)
        if details is not None:
            cached_tokens = getattr(details, "cached_tokens", None)
        details = getattr(usage, "completion_tokens_details", None)
        if details is not None:
            reasoning_tokens = getattr(details, "reasoning_tokens", None)
    except Exception:
        pass

    rates = await _get_rates("openai", model, "chat")
    cost = (
        prompt_tokens * rates.get("token_input", 0.0)
        + completion_tokens * rates.get("token_output", 0.0)
    )

    await _insert_event(
        audit_id=_ctx_value(ctx, "audit_id"),
        project_id=_ctx_value(ctx, "project_id"),
        user_id=_ctx_value(ctx, "user_id"),
        provider="openai",
        model=model,
        operation=operation,
        prompt_tokens=prompt_tokens,
        completion_tokens=completion_tokens,
        cached_tokens=cached_tokens,
        reasoning_tokens=reasoning_tokens,
        units=None,
        cost_usd=cost,
        metadata=metadata,
    )


async def record_scrape_call(
    *,
    audit_id: str,
    project_id: Optional[str],
    user_id: Optional[str],
    provider: str,
    llm: str,
    prompt_count: int,
    metadata: dict | None = None,
) -> None:
    """Persist a scrape job (Brightdata or OneSearch) — 1 call × N prompts."""
    rates = await _get_rates(provider, None, "scrape")
    unit_cost = rates.get("prompt", 0.0)
    cost = prompt_count * unit_cost

    meta = dict(metadata or {})
    meta["llm"] = llm

    await _insert_event(
        audit_id=audit_id,
        project_id=project_id,
        user_id=user_id,
        provider=provider,
        model=llm,
        operation="scrape",
        prompt_tokens=None,
        completion_tokens=None,
        cached_tokens=None,
        reasoning_tokens=None,
        units=prompt_count,
        cost_usd=cost,
        metadata=meta,
    )
