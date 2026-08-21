"""Recompute project_metrics for every project with the unified formula.

Needed once after migration 20260820140000: existing rows were written by
five different implementations (per-prompt vs per-response mentions,
substring brand matching, citations that counted the `cited = false`
tier), and some are mid-audit snapshots — one project card showed
citation_rate=3% because its metrics were calculated 10 seconds before
its last 97 own-domain citations were written.

Dry-run by default (shows the before → after diff for every project).

Usage:
    docker exec llmi python recalculate_all_project_metrics.py
    docker exec llmi python recalculate_all_project_metrics.py --apply
"""
import asyncio
import sys

from sqlalchemy import text

from app.database import AsyncSessionLocal


async def main() -> None:
    apply = "--apply" in sys.argv

    async with AsyncSessionLocal() as s:
        projects = (await s.execute(text("""
            SELECT p.id::text AS id, p.name,
                   coalesce(m.mention_rate, -1) AS old_mr,
                   coalesce(m.citation_rate, -1) AS old_cr
            FROM projects p
            LEFT JOIN project_metrics m ON m.project_id = p.id
            ORDER BY p.name
        """))).mappings().all()

    print(f"projects: {len(projects)}", flush=True)
    if not apply:
        print("DRY-RUN — computing without writing is not possible (the SQL "
              "function upserts). Re-run with --apply to recalculate.", flush=True)
        return

    changed = unchanged = failed = 0
    for i, p in enumerate(projects, start=1):
        try:
            async with AsyncSessionLocal() as s:
                row = (await s.execute(
                    text("SELECT * FROM recalculate_project_metrics(CAST(:pid AS uuid))"),
                    {"pid": p["id"]},
                )).mappings().first()
                await s.commit()
        except Exception as e:
            failed += 1
            print(f"  [{i}/{len(projects)}] {p['name'][:40]}: FAILED {str(e)[:90]}", flush=True)
            continue
        if not row:
            continue
        if row["mention_rate"] != p["old_mr"] or row["citation_rate"] != p["old_cr"]:
            changed += 1
            print(f"  [{i}/{len(projects)}] {p['name'][:40]:42} "
                  f"mention {p['old_mr']}% → {row['mention_rate']}% | "
                  f"citation {p['old_cr']}% → {row['citation_rate']}% "
                  f"({row['answered_responses']} answers)", flush=True)
        else:
            unchanged += 1

    print(f"DONE: {changed} changed, {unchanged} unchanged, {failed} failed", flush=True)


if __name__ == "__main__":
    asyncio.run(main())
