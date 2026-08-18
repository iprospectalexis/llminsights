"""One-off backfill: categorize ALL existing citation domains.

Loops classify_new_domains (rules → gpt-5-nano batches) until no
unclassified domains remain. Idempotent — safe to interrupt and re-run.

On start it purges low-confidence 'Other' fallback rows (source='llm',
confidence<=0.3) — the ones written when a model batch failed or omitted
domains — so those domains get a fresh classification attempt.

Usage:
    docker exec llmi python classify_domains_backfill.py          # everything
    docker exec llmi python classify_domains_backfill.py 500      # cap per loop
"""
import asyncio
import sys

from sqlalchemy import text

from app.database import AsyncSessionLocal
from app.services import domain_classifier
from app.services.supabase_db import db


async def _purge_fallback_rows() -> int:
    async with AsyncSessionLocal() as s:
        res = await s.execute(text(
            "DELETE FROM domain_categories WHERE source = 'llm' AND confidence <= 0.3"
        ))
        await s.commit()
        return res.rowcount or 0


async def _reapply_rules() -> int:
    """Upgrade previously LLM-classified domains that a (newer) curated rule
    now covers — rules are authoritative over nano guesses."""
    async with AsyncSessionLocal() as s:
        domains = (await s.execute(text(
            "SELECT domain FROM domain_categories WHERE source = 'llm'"
        ))).scalars().all()
    upserts = [
        {"domain": d, "category": cat, "source": "rule", "confidence": 1.0}
        for d in domains
        if (cat := domain_classifier.classify_by_rules(d))
    ]
    if upserts:
        await db.upsert_domain_categories(upserts)
    return len(upserts)


async def main() -> None:
    per_loop = int(sys.argv[1]) if len(sys.argv) > 1 else 300
    purged = await _purge_fallback_rows()
    if purged:
        print(f"purged {purged} low-confidence fallback rows for re-classification", flush=True)
    upgraded = await _reapply_rules()
    if upgraded:
        print(f"re-applied curated rules to {upgraded} previously LLM-classified domains", flush=True)
    total = {"rules": 0, "llm": 0, "failed": 0}
    loops = 0
    while True:
        stats = await domain_classifier.classify_new_domains(limit=per_loop)
        done = stats["rules"] + stats["llm"]
        for k in total:
            total[k] += stats[k]
        loops += 1
        print(
            f"loop {loops}: rules={stats['rules']} llm={stats['llm']} failed={stats['failed']}",
            flush=True,
        )
        # Stop when nothing new was classified (failed-only loops would spin).
        if done == 0:
            break
    print(
        f"DONE: rules={total['rules']} llm={total['llm']} failed={total['failed']}",
        flush=True,
    )


if __name__ == "__main__":
    asyncio.run(main())
