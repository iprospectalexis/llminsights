"""
Live smoke-test for the DataForSEO integration.

Makes ONE real DataForSEO request (1 keyword) using the credentials in
llmi_be/.env (DATAFORSEO_LOGIN / DATAFORSEO_PASSWORD) and prints the
mapped canonical record: AI Overview answer_text, citations/all_sources,
organic count, and the reported cost.

Run from the llmi_be directory:
    venv/Scripts/python.exe test_dataforseo_live.py
"""

import asyncio
import importlib.util
from pathlib import Path

# Load the client module directly (bypasses app.services.__init__ which
# pulls in the DB engine / asyncpg).
_spec = importlib.util.spec_from_file_location(
    "dfs_live", str(Path(__file__).parent / "app" / "services" / "dataforseo_client.py")
)
dfs = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(dfs)

KEYWORD = "¿Cuál es la mejor web para pedir neumáticos al mejor precio?"
COUNTRY = "ES"


async def main():
    client = dfs.DataForSeoClient()
    if not client.login or not client.password:
        print("!! DATAFORSEO_LOGIN / DATAFORSEO_PASSWORD not set in .env")
        return
    print(f"Login present: {bool(client.login)}  base_url={client.base_url}")
    results, failed = await client.process_all_prompts(
        prompts=[KEYWORD], geo_targeting=COUNTRY, source="google_ai_overview"
    )
    print(f"\nresults={len(results)} failed={len(failed)} cost=${client.total_cost:.4f}")
    if failed:
        print("FAILED keywords:", failed)
    def safe(s: str) -> str:
        # Windows consoles default to cp1252; drop chars it can't encode so
        # the diagnostic never crashes on accented / box-drawing output.
        return (s or "").encode("ascii", "replace").decode("ascii")

    for r in results:
        print("\n-- record --")
        print("prompt        :", safe(r["prompt"]))
        print("answer_text   :", safe(r["answer_text"])[:300], "...")
        print("citations     :", len(r["citations"]))
        print("all_sources   :", len(r["all_sources"]))
        print("links_attached:", len(r["links_attached"]))
        print("organic       :", len(r["organic"]),
              "->", [safe(o["domain"] or "") for o in r["organic"][:5]])


if __name__ == "__main__":
    asyncio.run(main())
