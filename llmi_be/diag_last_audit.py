"""Read-only diagnostic: why did the last audit collect SearchGPT but not
Gemini / Perplexity? Inspects the most recent audit's per-LLM rows + jobs."""
import asyncio, os, json
import asyncpg

DSN = os.environ["DATABASE_URL_OVERRIDE"].replace("postgresql+asyncpg://", "postgresql://")


async def main():
    conn = await asyncpg.connect(DSN, ssl="require", timeout=20)
    try:
        # Columns of the tables we care about
        for t in ("audits", "llm_responses", "jobs"):
            rows = await conn.fetch(
                "SELECT column_name FROM information_schema.columns "
                "WHERE table_name=$1 ORDER BY ordinal_position", t)
            print(f"\n== columns[{t}] ==")
            print(", ".join(r["column_name"] for r in rows))

        # Latest audit
        a = await conn.fetchrow(
            "SELECT a.*, p.name AS project_name FROM audits a "
            "LEFT JOIN projects p ON p.id=a.project_id "
            "ORDER BY a.started_at DESC NULLS LAST LIMIT 1")
        print("\n== latest audit ==")
        if not a:
            print("no audits found")
            return
        d = dict(a)
        for k in ("id", "project_id", "project_name", "status", "pipeline_state",
                  "started_at", "completed_at", "data_provider",
                  "responses_expected", "error_message", "llms"):
            if k in d:
                print(f"  {k}: {d[k]}")
        print("AUDIT_ID=" + str(d["id"]))
    finally:
        await conn.close()


asyncio.run(main())
