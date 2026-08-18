"""One-off backfill: categorize ALL existing citation domains.

Loops classify_new_domains (rules → gpt-5-nano batches) until no
unclassified domains remain. Idempotent — safe to interrupt and re-run.

Usage:
    docker exec llmi python classify_domains_backfill.py          # everything
    docker exec llmi python classify_domains_backfill.py 500      # cap per loop
"""
import asyncio
import sys

from app.services import domain_classifier


async def main() -> None:
    per_loop = int(sys.argv[1]) if len(sys.argv) > 1 else 300
    total = {"rules": 0, "llm": 0, "failed": 0}
    loops = 0
    while True:
        stats = await domain_classifier.classify_new_domains(limit=per_loop)
        done = stats["rules"] + stats["llm"]
        for k in total:
            total[k] += stats[k]
        loops += 1
        print(f"loop {loops}: rules={stats['rules']} llm={stats['llm']} failed={stats['failed']}")
        # Stop when nothing new was classified (failed-only loops would spin).
        if done == 0:
            break
    print(f"DONE: rules={total['rules']} llm={total['llm']} failed={total['failed']}")


if __name__ == "__main__":
    asyncio.run(main())
