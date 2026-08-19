"""One-off backfill: resolve official-site domains for ALL existing brands.

Iterates every project (via its latest audit) and runs the same
citations-first / nano-fallback resolver used at audit finalize.
Idempotent — already-resolved brands are skipped.

Usage:
    docker exec llmi python resolve_brand_domains_backfill.py
"""
import asyncio

from sqlalchemy import text

from app.database import AsyncSessionLocal
from app.services import brand_domain_resolver


async def main() -> None:
    async with AsyncSessionLocal() as s:
        rows = (await s.execute(text("""
            SELECT DISTINCT ON (a.project_id) a.project_id, a.id
            FROM audits a
            JOIN brands b ON b.project_id = a.project_id
            ORDER BY a.project_id, a.created_at DESC
        """))).all()
    print(f"{len(rows)} projects with brands", flush=True)
    total_c = total_l = 0
    for i, (project_id, audit_id) in enumerate(rows, start=1):
        try:
            stats = await brand_domain_resolver.resolve_new_brands(str(audit_id))
        except Exception as e:
            print(f"  [{i}/{len(rows)}] {project_id}: FAILED {e}", flush=True)
            continue
        total_c += stats["citations"]
        total_l += stats["llm"]
        if stats["citations"] or stats["llm"]:
            print(f"  [{i}/{len(rows)}] {project_id}: +{stats['citations']} citations, "
                  f"+{stats['llm']} llm", flush=True)
    print(f"DONE: {total_c} from citations, {total_l} via LLM", flush=True)


if __name__ == "__main__":
    asyncio.run(main())
