"""One-off backfill: categorize the most-cited citation domains.

Loops classify_new_domains (rules → gpt-5-nano batches) over unclassified
domains in citation-count order, most-cited first, until the cap is
reached or nothing is left. Idempotent — safe to interrupt and re-run;
a re-run continues with the NEXT most-cited domains (already-classified
ones are skipped), so running it twice with the default covers the
top-10000, and so on.

On start it purges low-confidence 'Other' fallback rows (source='llm',
confidence<=0.3) and re-applies curated rules over previous LLM guesses.

Usage:
    docker exec llmi python classify_domains_backfill.py          # top-5000
    docker exec llmi python classify_domains_backfill.py 20000    # top-20000
    docker exec llmi python classify_domains_backfill.py 0        # no cap (all)
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


PER_LOOP = 300


async def main() -> None:
    cap = int(sys.argv[1]) if len(sys.argv) > 1 else 5000  # 0 = no cap
    purged = await _purge_fallback_rows()
    if purged:
        print(f"purged {purged} low-confidence fallback rows for re-classification", flush=True)
    upgraded = await _reapply_rules()
    if upgraded:
        print(f"re-applied curated rules to {upgraded} previously LLM-classified domains", flush=True)
    total = {"rules": 0, "llm": 0, "failed": 0}
    processed = 0
    loops = 0
    while True:
        limit = PER_LOOP if cap <= 0 else min(PER_LOOP, cap - processed)
        if limit <= 0:
            print(f"cap of {cap} domains reached", flush=True)
            break
        stats = await domain_classifier.classify_new_domains(limit=limit)
        done = stats["rules"] + stats["llm"]
        processed += stats["rules"] + stats["llm"] + stats["failed"]
        for k in total:
            total[k] += stats[k]
        loops += 1
        print(
            f"loop {loops}: rules={stats['rules']} llm={stats['llm']} "
            f"failed={stats['failed']} (processed {processed}"
            + (f"/{cap}" if cap > 0 else "") + ")",
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
