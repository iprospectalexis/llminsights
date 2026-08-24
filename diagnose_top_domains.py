"""Pull top-cited domains from prod and show ones NOT covered by current rules."""
import asyncio
import ssl
import sys
import types
import importlib.util

import asyncpg

DSN = (
    "postgresql://postgres.gpjkhdsonsdbnvmicgqf:8yixUcNRE8wAjUsR"
    "@aws-1-eu-west-3.pooler.supabase.com:5432/postgres"
)

# Load domain_classifier with stubbed deps
for name in ["app", "app.services"]:
    if name not in sys.modules:
        m = types.ModuleType(name); m.__path__ = []; sys.modules[name] = m
db_mod = types.ModuleType("app.services.supabase_db"); db_mod.db = object()
sys.modules["app.services.supabase_db"] = db_mod
oc = types.ModuleType("app.services.openai_client")
oc.MODEL_COMPETITORS = "gpt-5-nano"; oc._call_openai = None
sys.modules["app.services.openai_client"] = oc
spec = importlib.util.spec_from_file_location(
    "dc", r"C:\Users\arylko01\python-alexis\llmi_new\llmi_be\app\services\domain_classifier.py")
dc = importlib.util.module_from_spec(spec); spec.loader.exec_module(dc)


async def main() -> None:
    sslctx = ssl.create_default_context()
    sslctx.check_hostname = False
    sslctx.verify_mode = ssl.CERT_NONE
    conn = await asyncpg.connect(DSN, ssl=sslctx)
    try:
        rows = await conn.fetch("""
            SELECT domain, count(*) AS n
            FROM citations
            WHERE domain IS NOT NULL AND domain <> ''
            GROUP BY domain
            ORDER BY n DESC
            LIMIT 800
        """)
        covered = uncovered = 0
        out = []
        for r in rows:
            cat = dc.classify_by_rules(r["domain"])
            if cat:
                covered += r["n"]
            else:
                uncovered += r["n"]
                out.append((r["domain"], r["n"]))
        total = await conn.fetchval(
            "SELECT count(*) FROM citations WHERE domain IS NOT NULL AND domain <> ''")
        distinct = await conn.fetchval(
            "SELECT count(DISTINCT domain) FROM citations WHERE domain IS NOT NULL AND domain <> ''")
        print(f"total citations: {total}, distinct domains: {distinct}")
        print(f"top-800 citations covered by rules: {covered}, uncovered: {uncovered}")
        print(f"uncovered domains in top-800: {len(out)}")
        print("---")
        for d, n in out:
            print(f"{n:7}  {d}")
    finally:
        await conn.close()


asyncio.run(main())
