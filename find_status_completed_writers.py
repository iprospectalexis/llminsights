"""Find every place in the DB that writes audits.status = 'completed'."""
import asyncio
import ssl

import asyncpg

DSN = (
    "postgresql://postgres.gpjkhdsonsdbnvmicgqf:8yixUcNRE8wAjUsR"
    "@aws-1-eu-west-3.pooler.supabase.com:5432/postgres"
)


async def main() -> None:
    s = ssl.create_default_context()
    s.check_hostname = False
    s.verify_mode = ssl.CERT_NONE
    c = await asyncpg.connect(DSN, ssl=s)
    try:
        print("=" * 72)
        print("1. All non-system functions with their bodies dumped individually")
        print("=" * 72)
        fns = await c.fetch("""
            SELECT n.nspname, p.proname, p.oid
            FROM pg_proc p
            JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname IN ('public','auth','audits')
            ORDER BY n.nspname, p.proname
        """)
        hits: list[tuple[str, str, str]] = []
        for f in fns:
            try:
                src = await c.fetchval(
                    "SELECT pg_get_functiondef($1::oid)", f["oid"],
                )
            except Exception as e:
                continue
            if not src:
                continue
            low = src.lower()
            if "audits" in low and "status" in low and "completed" in low:
                # Only flag real writes, not reads.
                if ("set status" in low or "update audits" in low
                        or "status = 'completed'" in low
                        or 'status := ' in low):
                    hits.append((f["nspname"], f["proname"], src))

        print(f"  {len(hits)} function(s) that reference audits + status + completed")
        for nspname, proname, src in hits:
            print()
            print(f"  ----- {nspname}.{proname} -----")
            # Only show relevant lines.
            for ln in src.splitlines():
                if any(k in ln.lower() for k in ["status", "completed", "update audits", "pipeline_state"]):
                    print(f"    {ln}")

        print()
        print("=" * 72)
        print("2. Triggers on audits")
        print("=" * 72)
        trs = await c.fetch("""
            SELECT t.tgname, pg_get_triggerdef(t.oid) def
            FROM pg_trigger t
            JOIN pg_class c ON c.oid = t.tgrelid
            WHERE NOT t.tgisinternal
              AND c.relname = 'audits'
        """)
        print(f"  {len(trs)} user triggers on audits")
        for t in trs:
            print(f"  - {t['tgname']}: {t['def']}")

        print()
        print("=" * 72)
        print("3. Dump DAZN audit history: pipeline_log + any related rows")
        print("=" * 72)
        logs = await c.fetch("""
            SELECT created_at, state, phase, level, left(message, 300) msg
            FROM audit_pipeline_log
            WHERE audit_id = 'c18a6cdd-be3b-4e3e-bf0c-7edc08e2cc35'
            ORDER BY created_at
        """)
        print(f"  {len(logs)} log rows")
        for l in logs:
            print(f"    {l['created_at']}  {l['state']:<20} {l['phase'] or '-':<12} {l['level']}  {l['msg']}")

        print()
        print("=" * 72)
        print("4. Zombies currently in DB")
        print("=" * 72)
        zombies = await c.fetch("""
            SELECT id, project_id, status, pipeline_state, progress,
                   created_at, finished_at,
                   (SELECT count(*) FROM llm_responses WHERE audit_id = a.id) resp,
                   (SELECT count(*) FROM response_brand_sentiment WHERE audit_id = a.id) rbs
            FROM audits a
            WHERE status = 'completed'
              AND pipeline_state NOT IN ('completed','failed')
            ORDER BY created_at DESC
        """)
        print(f"  {len(zombies)} zombie audits (status=completed, pipeline_state != completed/failed)")
        for z in zombies:
            print(f"    {str(z['id'])[:8]}  ps={z['pipeline_state']:<20} "
                  f"resp={z['resp']:<4} rbs={z['rbs']:<4}  "
                  f"created={z['created_at']}")
    finally:
        await c.close()


if __name__ == "__main__":
    asyncio.run(main())
